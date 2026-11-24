"""Regras de negócio do FaceGate: funções puras, sem AWS e sem rede.

Ficam isoladas aqui para serem fáceis de ler, explicar e testar.
Princípio central do projeto: reconhecer a pessoa NÃO é o mesmo que autorizá-la.
"""

from __future__ import annotations

import base64
import binascii
import re
from dataclasses import dataclass
from datetime import date

AUTORIZADO = "AUTORIZADO"
NEGADO = "NEGADO"

STATUS_ATIVO = "ATIVO"
STATUS_INATIVO = "INATIVO"

FALHA_SERVICO = "FALHA_SERVICO"
PROBLEMAS_DE_CAPTURA = ("NENHUM_ROSTO", "MULTIPLOS_ROSTOS", "ROSTO_DISTANTE", "IMAGEM_INVALIDA")

MENSAGENS = {
    "RECONHECIDO": "Bem-vindo(a)! O portão foi liberado.",
    "NAO_RECONHECIDO": "Pessoa não reconhecida entre os moradores cadastrados.",
    "CADASTRO_INATIVO": "Morador reconhecido, mas o cadastro está inativo.",
    "NENHUM_ROSTO": "Nenhum rosto detectado. Posicione o rosto dentro da moldura.",
    "MULTIPLOS_ROSTOS": "Mais de um rosto na imagem. Apenas uma pessoa por vez.",
    "ROSTO_DISTANTE": "Rosto muito distante. Aproxime-se da câmera.",
    "IMAGEM_INVALIDA": "Imagem inválida ou corrompida. Tente novamente.",
    FALHA_SERVICO: "Falha no serviço de reconhecimento. Por segurança, o acesso foi negado.",
}

TAMANHO_MAXIMO_IMAGEM = 4 * 1024 * 1024  # 4 MB: abaixo do limite de 6 MB de payload da Lambda


class ErroValidacao(ValueError):
    """Dados de entrada inválidos (vira HTTP 400)."""

    def __init__(self, mensagem: str, campo: str | None = None) -> None:
        super().__init__(mensagem)
        self.mensagem = mensagem
        self.campo = campo


# =============================================================================
# Decisão de acesso
# =============================================================================


@dataclass(frozen=True)
class ResultadoBiometria:
    """Resposta do face-service já interpretada pela Lambda."""

    erro: str | None = None  # problema de captura ou FALHA_SERVICO
    candidato_id: str | None = None  # morador mais parecido da galeria
    similaridade: float | None = None  # similaridade de cosseno com esse morador
    embedding: str | None = None  # assinatura da imagem analisada (usada no cadastro)
    tempo_ms: float | None = None  # tempo de processamento no face-service


@dataclass(frozen=True)
class Decisao:
    resultado: str
    motivo: str

    @property
    def autorizado(self) -> bool:
        return self.resultado == AUTORIZADO

    @property
    def mensagem(self) -> str:
        return MENSAGENS[self.motivo]


def reconheceu(biometria: ResultadoBiometria, limiar: float) -> bool:
    """A comparação facial superou o limiar configurado?"""
    return (
        biometria.erro is None
        and biometria.candidato_id is not None
        and biometria.similaridade is not None
        and biometria.similaridade >= limiar
    )


def decidir_acesso(biometria: ResultadoBiometria, morador: dict | None, limiar: float) -> Decisao:
    """Regra inicial de autorização (seção 4.4 do projeto).

    Autoriza somente quando TODAS as condições forem verdadeiras:
      (1) exatamente um rosto válido foi detectado;
      (2) a similaridade superou o limiar configurado e testado;
      (3) a identidade está cadastrada e ATIVA;
      (4) não houve erro em nenhuma consulta.
    Na dúvida ou em caso de falha, o acesso é NEGADO (fail-closed).
    """
    if biometria.erro is not None:  # condições (1) e (4)
        motivo = biometria.erro if biometria.erro in PROBLEMAS_DE_CAPTURA else FALHA_SERVICO
        return Decisao(NEGADO, motivo)
    if not reconheceu(biometria, limiar) or morador is None:  # condição (2)
        return Decisao(NEGADO, "NAO_RECONHECIDO")
    if morador.get("status") != STATUS_ATIVO:  # condição (3)
        return Decisao(NEGADO, "CADASTRO_INATIVO")
    return Decisao(AUTORIZADO, "RECONHECIDO")


# =============================================================================
# Validação de entradas
# =============================================================================


@dataclass(frozen=True)
class Imagem:
    base64: str  # conteúdo em base64, sem o prefixo "data:image/...;base64,"
    dados: bytes
    tipo: str  # image/jpeg ou image/png
    extensao: str  # jpg ou png


@dataclass(frozen=True)
class NovoMorador:
    nome: str
    unidade: str
    imagem: Imagem


def validar_imagem(valor: object) -> Imagem:
    """Aceita JPEG ou PNG em base64 (com ou sem prefixo data URL)."""
    if not isinstance(valor, str) or not valor.strip():
        raise ErroValidacao("Envie a foto no campo 'imagem' (JPEG ou PNG em base64).", "imagem")
    texto = valor.strip()
    if texto.startswith("data:"):
        texto = texto.partition(",")[2]
    try:
        dados = base64.b64decode(texto, validate=True)
    except (binascii.Error, ValueError):
        raise ErroValidacao("A imagem não está em base64 válido.", "imagem") from None
    if len(dados) > TAMANHO_MAXIMO_IMAGEM:
        raise ErroValidacao("A imagem excede o limite de 4 MB.", "imagem")
    if dados.startswith(b"\xff\xd8\xff"):
        return Imagem(texto, dados, "image/jpeg", "jpg")
    if dados.startswith(b"\x89PNG\r\n\x1a\n"):
        return Imagem(texto, dados, "image/png", "png")
    raise ErroValidacao("Formato não suportado: envie uma foto JPEG ou PNG.", "imagem")


def _texto(valor: object, campo: str, rotulo: str, minimo: int, maximo: int) -> str:
    if not isinstance(valor, str):
        raise ErroValidacao(f"Informe {rotulo}.", campo)
    texto = re.sub(r"\s+", " ", valor).strip()
    if not minimo <= len(texto) <= maximo:
        raise ErroValidacao(f"{rotulo.capitalize()} deve ter entre {minimo} e {maximo} caracteres.", campo)
    return texto


def validar_nome(valor: object) -> str:
    return _texto(valor, "nome", "o nome", 2, 80)


def validar_unidade(valor: object) -> str:
    return _texto(valor, "unidade", "a unidade", 1, 20)


def validar_status(valor: object) -> str:
    if valor not in (STATUS_ATIVO, STATUS_INATIVO):
        raise ErroValidacao("O status deve ser ATIVO ou INATIVO.", "status")
    return str(valor)


def validar_novo_morador(corpo: dict) -> NovoMorador:
    nome = validar_nome(corpo.get("nome"))
    unidade = validar_unidade(corpo.get("unidade"))
    if corpo.get("consentimento") is not True:
        raise ErroValidacao(
            "É obrigatório o consentimento do morador para o uso da imagem facial (LGPD).",
            "consentimento",
        )
    return NovoMorador(nome=nome, unidade=unidade, imagem=validar_imagem(corpo.get("imagem")))


def validar_atualizacao(corpo: dict) -> dict:
    """PATCH parcial: aceita apenas nome, unidade e/ou status."""
    validadores = {"nome": validar_nome, "unidade": validar_unidade, "status": validar_status}
    desconhecidos = sorted(set(corpo) - set(validadores))
    if desconhecidos:
        raise ErroValidacao(f"Campos não permitidos: {', '.join(desconhecidos)}.")
    campos = {campo: validar(corpo[campo]) for campo, validar in validadores.items() if campo in corpo}
    if not campos:
        raise ErroValidacao("Informe ao menos um campo: nome, unidade ou status.")
    return campos


def validar_dia(valor: str | None, hoje: str) -> str:
    """Dia do histórico no formato AAAA-MM-DD (padrão: hoje)."""
    if not valor:
        return hoje
    try:
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", valor):
            raise ValueError
        date.fromisoformat(valor)
    except ValueError:
        raise ErroValidacao("Data inválida: use o formato AAAA-MM-DD.", "dia") from None
    return valor
