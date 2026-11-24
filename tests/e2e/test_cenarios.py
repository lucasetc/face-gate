"""Testes de ponta a ponta: exercitam o sistema real, sem simulações.

    navegador/teste → Nginx → API Gateway → Lambda → face-service, DynamoDB, S3, SQS
                                                        SQS → Lambda de eventos → DynamoDB

Pré-requisito: o ambiente no ar (docker compose up --build).
Execução:      pytest tests/e2e -v

Os cenários com rosto (seção 8.1) usam fotos de voluntários em tests/e2e/fotos/
(veja o LEIA-ME.md dessa pasta). Sem as fotos, esses cenários são pulados.
"""

from __future__ import annotations

import base64
import json
import os
import struct
import time
import urllib.error
import urllib.request
import uuid
import zlib
from pathlib import Path

import pytest

# 127.0.0.1 em vez de localhost: no Windows, "localhost" pode tentar o IPv6 antes.
API = os.environ.get("FACEGATE_API", "http://127.0.0.1:8088/api").rstrip("/")
# Pasta das fotos dos voluntários (pode ficar fora do projeto: FACEGATE_FOTOS=C:\caminho)
FOTOS = Path(os.environ.get("FACEGATE_FOTOS", Path(__file__).parent / "fotos"))


# ----------------------------------------------------------------- utilidades
def requisitar(metodo: str, caminho: str, corpo: dict | None = None) -> tuple[int, dict | None]:
    dados = None if corpo is None else json.dumps(corpo).encode()
    pedido = urllib.request.Request(
        f"{API}{caminho}", data=dados, method=metodo, headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(pedido, timeout=60) as resposta:
            conteudo = resposta.read()
            return resposta.status, (json.loads(conteudo) if conteudo else None)
    except urllib.error.HTTPError as erro:
        conteudo = erro.read()
        return erro.code, (json.loads(conteudo) if conteudo else None)


def png_sem_rosto(largura: int = 320, altura: int = 240) -> str:
    """Gera um PNG cinza (sem nenhum rosto) usando só a biblioteca padrão."""

    def bloco(tipo: bytes, conteudo: bytes) -> bytes:
        return struct.pack(">I", len(conteudo)) + tipo + conteudo + struct.pack(">I", zlib.crc32(tipo + conteudo))

    linha = b"\x00" + bytes([128, 128, 128]) * largura
    png = (
        b"\x89PNG\r\n\x1a\n"
        + bloco(b"IHDR", struct.pack(">IIBBBBB", largura, altura, 8, 2, 0, 0, 0))
        + bloco(b"IDAT", zlib.compress(linha * altura))
        + bloco(b"IEND", b"")
    )
    return base64.b64encode(png).decode()


def foto(nome: str) -> str:
    caminho = FOTOS / nome
    if not caminho.exists():
        pytest.skip(f"Foto {caminho.name} ausente em tests/e2e/fotos/ (veja o LEIA-ME.md)")
    return base64.b64encode(caminho.read_bytes()).decode()


def aguardar_processamento(dia: str, acesso_id: str, limite_s: float = 20) -> dict:
    """Espera a Lambda de eventos (acionada pelo SQS) marcar o acesso como processado."""
    prazo = time.monotonic() + limite_s
    while time.monotonic() < prazo:
        _, corpo = requisitar("GET", f"/acessos?dia={dia}")
        acesso = next((a for a in corpo["acessos"] if a["acessoId"] == acesso_id), None)
        if acesso and acesso.get("processadoEm"):
            return acesso
        time.sleep(0.5)
    pytest.fail(f"O acesso {acesso_id} não foi processado pela fila em {limite_s}s")


@pytest.fixture(scope="session", autouse=True)
def ambiente_no_ar():
    try:
        status, _ = requisitar("GET", "/sistema")
    except OSError:
        pytest.skip(f"API indisponível em {API}. Suba o ambiente com: docker compose up --build")
    if status != 200:
        pytest.skip(f"API respondeu {status} em {API}/sistema")


# -------------------------------------------------------- infraestrutura ----
def test_todos_os_servicos_estao_integrados():
    status, sistema = requisitar("GET", "/sistema")
    assert status == 200
    assert sistema["dynamodb"]["ok"] and sistema["s3"]["ok"] and sistema["sqs"]["ok"]
    assert sistema["lambda"]["estado"] == "Active"
    assert sistema["faceService"]["ok"], "o face-service deve estar acessível a partir da Lambda"


# ------------------------------------------ fluxo completo sem rosto (8.1) --
def test_imagem_sem_rosto_e_negada_registrada_e_processada_pela_fila():
    status, resposta = requisitar("POST", "/acessos/validar", {"imagem": png_sem_rosto()})
    assert status == 200
    assert (resposta["resultado"], resposta["motivo"]) == ("NEGADO", "NENHUM_ROSTO")

    servicos = [etapa["servico"] for etapa in resposta["rastreamento"]]
    assert servicos == ["dynamodb", "face-service", "lambda", "dynamodb", "sqs"]
    assert all(etapa["ok"] for etapa in resposta["rastreamento"])

    acesso = aguardar_processamento(resposta["dataHora"][:10], resposta["acessoId"])
    assert acesso["resultado"] == "NEGADO"
    assert acesso["notificacao"].startswith("Alerta: acesso negado")


def test_fila_de_mensagens_mortas_esta_vazia():
    _, sistema = requisitar("GET", "/sistema")
    assert sistema["sqs"]["mensagensDlq"] == 0


# ------------------------------------------------------------- validações --
@pytest.mark.parametrize(
    ("metodo", "caminho", "corpo", "status_esperado"),
    [
        ("POST", "/moradores", {"nome": "Ana", "unidade": "101", "imagem": png_sem_rosto()}, 400),  # sem consentimento
        ("POST", "/moradores", {"nome": "A", "unidade": "101", "imagem": "x", "consentimento": True}, 400),
        ("POST", "/acessos/validar", {"imagem": "isto não é base64"}, 400),
        ("PATCH", "/moradores/qualquer", {"status": "BLOQUEADO"}, 400),
        ("GET", f"/moradores/{uuid.uuid4()}", None, 404),
        ("DELETE", f"/moradores/{uuid.uuid4()}", None, 404),
        ("GET", "/acessos?dia=2026-13-45", None, 400),
    ],
)
def test_entradas_invalidas_sao_rejeitadas(metodo, caminho, corpo, status_esperado):
    status, resposta = requisitar(metodo, caminho, corpo)
    assert status == status_esperado
    assert resposta["erro"]["mensagem"]


def test_cadastro_de_foto_sem_rosto_explica_o_problema():
    corpo = {"nome": "Teste Sem Rosto", "unidade": "000", "imagem": png_sem_rosto(), "consentimento": True}
    status, resposta = requisitar("POST", "/moradores", corpo)
    assert status == 422
    assert resposta["erro"]["codigo"] == "NENHUM_ROSTO"


# ------------------------------------------ cenários com rosto (seção 8.1) --
@pytest.fixture
def morador_cadastrado():
    corpo = {"nome": "Voluntária de Teste", "unidade": "E2E-1", "imagem": foto("pessoa-a-1.jpg"), "consentimento": True}
    status, morador = requisitar("POST", "/moradores", corpo)
    if status == 409:  # o sistema recusou um rosto duplicado: comportamento correto
        pytest.skip(f"{morador['erro']['mensagem']} Exclua esse cadastro na tela Moradores para rodar o cenário.")
    assert status == 201, morador
    yield morador
    requisitar("DELETE", f"/moradores/{morador['moradorId']}")


def test_cenarios_com_rosto(morador_cadastrado):
    morador_id = morador_cadastrado["moradorId"]
    assert "faceRef" not in morador_cadastrado, "a referência biométrica nunca deve sair da API"

    # O mesmo rosto não pode ser cadastrado duas vezes
    status, resposta = requisitar(
        "POST",
        "/moradores",
        {"nome": "Duplicada", "unidade": "E2E-2", "imagem": foto("pessoa-a-2.jpg"), "consentimento": True},
    )
    assert status == 409, resposta

    # 1) Pessoa cadastrada e autorizada → acesso permitido e evento processado
    _, resposta = requisitar("POST", "/acessos/validar", {"imagem": foto("pessoa-a-2.jpg")})
    assert resposta["resultado"] == "AUTORIZADO", resposta
    assert resposta["morador"]["moradorId"] == morador_id
    acesso = aguardar_processamento(resposta["dataHora"][:10], resposta["acessoId"])
    assert acesso["notificacao"].startswith("Entrada de Voluntária de Teste")

    # 2) Pessoa não cadastrada → acesso negado
    _, resposta = requisitar("POST", "/acessos/validar", {"imagem": foto("pessoa-b.jpg")})
    assert (resposta["resultado"], resposta["motivo"]) == ("NEGADO", "NAO_RECONHECIDO")
    assert resposta["morador"] is None

    # 3) Cadastro inativo → reconhecida, mas acesso negado
    status, _ = requisitar("PATCH", f"/moradores/{morador_id}", {"status": "INATIVO"})
    assert status == 200
    _, resposta = requisitar("POST", "/acessos/validar", {"imagem": foto("pessoa-a-2.jpg")})
    assert (resposta["resultado"], resposta["motivo"]) == ("NEGADO", "CADASTRO_INATIVO")

    # Exclusão (LGPD): remove o cadastro e a foto do S3
    foto_url = morador_cadastrado["fotoUrl"]
    status, _ = requisitar("DELETE", f"/moradores/{morador_id}")
    assert status == 204
    status, _ = requisitar("GET", f"/moradores/{morador_id}")
    assert status == 404
    with pytest.raises(urllib.error.HTTPError):
        urllib.request.urlopen(foto_url, timeout=10)
