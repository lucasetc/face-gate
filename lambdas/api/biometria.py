"""Cliente HTTP do face-service (FastAPI + OpenCV), apenas com a biblioteca padrão.

Nunca lança exceção para o chamador: qualquer falha de rede, timeout ou resposta
inesperada vira FALHA_SERVICO, e a regra de decisão nega o acesso (fail-closed).
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request

from regras import FALHA_SERVICO, ResultadoBiometria

FACE_SERVICE_URL = os.environ.get("FACE_SERVICE_URL", "http://face-service:8000").rstrip("/")
TIMEOUT_S = float(os.environ.get("FACE_SERVICE_TIMEOUT", "10"))


def _requisitar(caminho: str, corpo: dict | None = None, timeout: float = TIMEOUT_S) -> dict:
    dados = None if corpo is None else json.dumps(corpo).encode("utf-8")
    pedido = urllib.request.Request(
        f"{FACE_SERVICE_URL}{caminho}",
        data=dados,
        headers={"Content-Type": "application/json"},
        method="GET" if corpo is None else "POST",
    )
    with urllib.request.urlopen(pedido, timeout=timeout) as resposta:
        return json.load(resposta)


def analisar(imagem_base64: str, galeria: list[dict]) -> ResultadoBiometria:
    """Detecta o rosto, gera a assinatura e compara com a galeria de referências."""
    try:
        dados = _requisitar("/v1/analisar", {"imagem": imagem_base64, "galeria": galeria})
    except urllib.error.HTTPError as erro:
        # 422 = problema na imagem (ex.: NENHUM_ROSTO); demais códigos = falha do serviço
        codigo = _codigo_de_captura(erro) if erro.code == 422 else None
        return ResultadoBiometria(erro=codigo or FALHA_SERVICO)
    except (OSError, ValueError):  # conexão recusada, DNS, timeout ou JSON inválido
        return ResultadoBiometria(erro=FALHA_SERVICO)

    candidato = dados.get("candidato") or {}
    return ResultadoBiometria(
        candidato_id=candidato.get("id"),
        similaridade=candidato.get("similaridade"),
        embedding=dados.get("embedding"),
        tempo_ms=dados.get("tempoMs"),
    )


def _codigo_de_captura(erro: urllib.error.HTTPError) -> str | None:
    try:
        return json.load(erro).get("codigo")
    except (OSError, ValueError, AttributeError):
        return None


def saude() -> dict | None:
    """Estado do face-service (None se estiver fora do ar)."""
    try:
        return _requisitar("/saude", timeout=2)
    except (OSError, ValueError):
        return None
