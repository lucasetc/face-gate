"""Motor biométrico do FaceGate (modelos do OpenCV Zoo: YuNet + SFace).

Responsabilidades:
  1. Detectar o rosto na imagem (YuNet) e verificar a qualidade da captura.
  2. Gerar a assinatura biométrica (embedding de 128 números) com o SFace.
  3. Comparar a assinatura com uma galeria de referências (similaridade de cosseno).

Este módulo NÃO decide autorização: devolve apenas a identidade provável e a
pontuação. Quem aplica o limiar e as regras de permissão é a Lambda facegate-api.
"""

from __future__ import annotations

import base64
import binascii
import threading
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

MODELO_DETECTOR = "face_detection_yunet_2023mar.onnx"
MODELO_RECONHECEDOR = "face_recognition_sface_2021dec.onnx"

DIMENSAO_EMBEDDING = 128  # o SFace gera vetores de 128 posições (float32)
TAMANHO_MAXIMO_BYTES = 5 * 1024 * 1024
LADO_MAXIMO_PX = 1280  # imagens maiores são reduzidas antes da análise (desempenho)
LARGURA_MINIMA_ROSTO_PX = 80  # abaixo disso a pessoa está longe demais da câmera
CONFIANCA_MINIMA = 0.85  # pontuação mínima do YuNet para considerar um rosto


class ErroCaptura(Exception):
    """Problema com a imagem enviada (não é uma falha do serviço)."""

    def __init__(self, codigo: str, mensagem: str) -> None:
        super().__init__(mensagem)
        self.codigo = codigo
        self.mensagem = mensagem


# -----------------------------------------------------------------------------
# Funções puras (não dependem dos modelos): simples de testar
# -----------------------------------------------------------------------------


def decodificar_imagem(imagem_base64: str) -> np.ndarray:
    """Converte base64 (aceita data URL) em uma imagem BGR do OpenCV."""
    texto = imagem_base64.strip()
    if texto.startswith("data:"):
        texto = texto.partition(",")[2]
    try:
        dados = base64.b64decode(texto, validate=True)
    except (binascii.Error, ValueError) as erro:
        raise ErroCaptura("IMAGEM_INVALIDA", "A imagem não está em base64 válido.") from erro
    if not dados:
        raise ErroCaptura("IMAGEM_INVALIDA", "Nenhuma imagem foi enviada.")
    if len(dados) > TAMANHO_MAXIMO_BYTES:
        raise ErroCaptura("IMAGEM_INVALIDA", "A imagem excede o limite de 5 MB.")
    imagem = cv2.imdecode(np.frombuffer(dados, dtype=np.uint8), cv2.IMREAD_COLOR)
    if imagem is None:
        raise ErroCaptura("IMAGEM_INVALIDA", "Formato de imagem não suportado (use JPEG ou PNG).")
    return reduzir(imagem)


def reduzir(imagem: np.ndarray) -> np.ndarray:
    """Limita o maior lado da imagem a LADO_MAXIMO_PX, mantendo a proporção."""
    altura, largura = imagem.shape[:2]
    maior_lado = max(altura, largura)
    if maior_lado <= LADO_MAXIMO_PX:
        return imagem
    escala = LADO_MAXIMO_PX / maior_lado
    tamanho = (round(largura * escala), round(altura * escala))
    return cv2.resize(imagem, tamanho, interpolation=cv2.INTER_AREA)


def normalizar(vetor: np.ndarray) -> np.ndarray:
    """Deixa o vetor com comprimento 1: o cosseno vira um simples produto escalar."""
    vetor = np.asarray(vetor, dtype=np.float32).ravel()
    norma = float(np.linalg.norm(vetor))
    return vetor / norma if norma > 0 else vetor


def codificar_embedding(vetor: np.ndarray) -> str:
    """Serializa o embedding (128 float32) em base64: 684 caracteres."""
    return base64.b64encode(normalizar(vetor).tobytes()).decode("ascii")


def decodificar_embedding(texto: str) -> np.ndarray:
    try:
        dados = base64.b64decode(texto, validate=True)
    except (binascii.Error, ValueError) as erro:
        raise ValueError("embedding em base64 inválido") from erro
    if len(dados) != DIMENSAO_EMBEDDING * 4:
        raise ValueError("embedding com tamanho inválido")
    return normalizar(np.frombuffer(dados, dtype=np.float32))


def melhor_candidato(
    embedding: np.ndarray, galeria: list[tuple[str, np.ndarray]]
) -> tuple[str, float] | None:
    """Retorna (id, similaridade de cosseno) da referência mais parecida."""
    if not galeria:
        return None
    referencias = np.stack([vetor for _, vetor in galeria])
    similaridades = referencias @ normalizar(embedding)
    indice = int(np.argmax(similaridades))
    return galeria[indice][0], float(similaridades[indice])


# -----------------------------------------------------------------------------
# Motor com os modelos ONNX
# -----------------------------------------------------------------------------


@dataclass(frozen=True)
class Rosto:
    caixa: tuple[int, int, int, int]  # x, y, largura, altura (px)
    confianca: float
    embedding: np.ndarray


class MotorBiometrico:
    """Carrega os modelos uma única vez e analisa imagens sob demanda."""

    def __init__(self, pasta_modelos: Path) -> None:
        self._detector = cv2.FaceDetectorYN.create(
            str(pasta_modelos / MODELO_DETECTOR), "", (320, 320), CONFIANCA_MINIMA, 0.3, 5000
        )
        self._reconhecedor = cv2.FaceRecognizerSF.create(
            str(pasta_modelos / MODELO_RECONHECEDOR), ""
        )
        # Os objetos do OpenCV guardam estado (ex.: tamanho da entrada): uma análise por vez.
        self._trava = threading.Lock()

    def extrair_rosto(self, imagem: np.ndarray) -> Rosto:
        """Exige exatamente um rosto válido e devolve sua assinatura biométrica."""
        altura, largura = imagem.shape[:2]
        with self._trava:
            self._detector.setInputSize((largura, altura))
            _, deteccoes = self._detector.detect(imagem)
            deteccoes = [] if deteccoes is None else list(deteccoes)
            validos = [d for d in deteccoes if d[2] >= LARGURA_MINIMA_ROSTO_PX]

            if not deteccoes:
                raise ErroCaptura("NENHUM_ROSTO", "Nenhum rosto detectado na imagem.")
            if not validos:
                raise ErroCaptura("ROSTO_DISTANTE", "O rosto está muito pequeno na imagem.")
            if len(validos) > 1:
                raise ErroCaptura(
                    "MULTIPLOS_ROSTOS", f"{len(validos)} rostos detectados: apenas uma pessoa por vez."
                )

            deteccao = validos[0]
            alinhado = self._reconhecedor.alignCrop(imagem, deteccao)
            embedding = self._reconhecedor.feature(alinhado)

        x, y, w, h = (int(round(float(v))) for v in deteccao[:4])
        return Rosto(caixa=(x, y, w, h), confianca=float(deteccao[-1]), embedding=normalizar(embedding))
