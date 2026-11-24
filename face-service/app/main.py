"""face-service: API HTTP do motor biométrico (FastAPI).

Um único endpoint de negócio, POST /v1/analisar, que:
  - detecta exatamente um rosto e gera sua assinatura biométrica (embedding);
  - se receber uma galeria de referências, informa a mais parecida e a similaridade.

O serviço não guarda estado nem decide autorização (isso é papel da Lambda).
"""

from __future__ import annotations

import logging
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path

import cv2
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .biometria import (
    MODELO_DETECTOR,
    MODELO_RECONHECEDOR,
    ErroCaptura,
    MotorBiometrico,
    codificar_embedding,
    decodificar_embedding,
    decodificar_imagem,
    melhor_candidato,
)

PASTA_MODELOS = Path(os.environ.get("PASTA_MODELOS", "/app/modelos"))
logger = logging.getLogger("uvicorn.error")


# ---------------------------------------------------------------- contratos --
class Referencia(BaseModel):
    id: str = Field(..., max_length=64)
    embedding: str = Field(..., description="Assinatura biométrica: 128 float32 em base64")


class PedidoAnalise(BaseModel):
    imagem: str = Field(..., description="Imagem JPEG ou PNG em base64 (aceita data URL)")
    galeria: list[Referencia] = Field(
        default_factory=list, max_length=10_000, description="Referências para comparar (opcional)"
    )


class RostoDetectado(BaseModel):
    caixa: list[int] = Field(..., description="x, y, largura e altura em pixels")
    confianca: float


class Candidato(BaseModel):
    id: str
    similaridade: float = Field(..., description="Similaridade de cosseno (quanto maior, mais parecido)")


class RespostaAnalise(BaseModel):
    rosto: RostoDetectado
    embedding: str
    candidato: Candidato | None
    comparados: int
    tempoMs: float


class ErroCapturaResposta(BaseModel):
    codigo: str = Field(..., examples=["NENHUM_ROSTO"])
    mensagem: str


# -------------------------------------------------------------- aplicação --
@asynccontextmanager
async def ciclo_de_vida(app: FastAPI):
    # Os modelos ONNX são carregados uma única vez, na inicialização.
    app.state.motor = MotorBiometrico(PASTA_MODELOS)
    logger.info("Modelos carregados: %s e %s (OpenCV %s)", MODELO_DETECTOR, MODELO_RECONHECEDOR, cv2.__version__)
    yield


app = FastAPI(
    title="FaceGate · face-service",
    version="1.0.0",
    description="Detecção (YuNet) e reconhecimento facial (SFace) com OpenCV. Não decide autorização.",
    lifespan=ciclo_de_vida,
)


@app.get("/saude", summary="Verifica se o serviço e os modelos estão prontos")
def saude() -> dict:
    return {
        "status": "ok",
        "opencv": cv2.__version__,
        "modelos": {"deteccao": MODELO_DETECTOR, "reconhecimento": MODELO_RECONHECEDOR},
    }


@app.post(
    "/v1/analisar",
    response_model=RespostaAnalise,
    responses={422: {"model": ErroCapturaResposta, "description": "Problema na imagem (ex.: nenhum rosto)"}},
    summary="Detecta o rosto, gera a assinatura e compara com a galeria",
)
def analisar(pedido: PedidoAnalise):
    inicio = time.perf_counter()
    try:
        imagem = decodificar_imagem(pedido.imagem)
        rosto = app.state.motor.extrair_rosto(imagem)
    except ErroCaptura as erro:
        return JSONResponse(status_code=422, content={"codigo": erro.codigo, "mensagem": erro.mensagem})

    galeria = []
    for referencia in pedido.galeria:
        try:
            galeria.append((referencia.id, decodificar_embedding(referencia.embedding)))
        except ValueError:
            logger.warning("Referência %s ignorada: embedding inválido", referencia.id)

    melhor = melhor_candidato(rosto.embedding, galeria)
    return RespostaAnalise(
        rosto=RostoDetectado(caixa=list(rosto.caixa), confianca=round(rosto.confianca, 4)),
        embedding=codificar_embedding(rosto.embedding),
        candidato=Candidato(id=melhor[0], similaridade=round(melhor[1], 4)) if melhor else None,
        comparados=len(galeria),
        tempoMs=round((time.perf_counter() - inicio) * 1000, 1),
    )
