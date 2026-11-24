"""Funções puras do face-service (não dependem dos modelos ONNX)."""

import base64

import cv2
import numpy as np
import pytest

from app.biometria import (
    LADO_MAXIMO_PX,
    ErroCaptura,
    codificar_embedding,
    decodificar_embedding,
    decodificar_imagem,
    melhor_candidato,
    normalizar,
)


def imagem_base64(largura=64, altura=48, formato=".png"):
    ok, dados = cv2.imencode(formato, np.full((altura, largura, 3), 127, dtype=np.uint8))
    assert ok
    return base64.b64encode(dados.tobytes()).decode()


def test_decodifica_png_e_jpeg_inclusive_data_url():
    assert decodificar_imagem(imagem_base64()).shape == (48, 64, 3)
    assert decodificar_imagem("data:image/jpeg;base64," + imagem_base64(formato=".jpg")).shape == (48, 64, 3)


def test_imagem_grande_e_reduzida_mantendo_a_proporcao():
    imagem = decodificar_imagem(imagem_base64(largura=2560, altura=1440))
    assert imagem.shape[:2] == (720, LADO_MAXIMO_PX)


@pytest.mark.parametrize("valor", ["", "@@@", base64.b64encode(b"isto nao e imagem").decode()])
def test_imagem_invalida(valor):
    with pytest.raises(ErroCaptura) as erro:
        decodificar_imagem(valor)
    assert erro.value.codigo == "IMAGEM_INVALIDA"


def test_embedding_ida_e_volta_preserva_o_vetor_normalizado():
    vetor = np.random.default_rng(1).normal(size=128).astype(np.float32)
    texto = codificar_embedding(vetor)
    assert len(texto) == 684  # 128 float32 = 512 bytes em base64
    np.testing.assert_allclose(decodificar_embedding(texto), normalizar(vetor), rtol=1e-6)
    assert np.linalg.norm(decodificar_embedding(texto)) == pytest.approx(1.0, abs=1e-5)


def test_embedding_com_tamanho_errado_e_rejeitado():
    with pytest.raises(ValueError):
        decodificar_embedding(base64.b64encode(b"\x00" * 100).decode())


def test_melhor_candidato_e_o_mais_parecido():
    rng = np.random.default_rng(7)
    ana, bruno = normalizar(rng.normal(size=128)), normalizar(rng.normal(size=128))
    # "Foto nova" da Ana: a mesma assinatura com um pequeno ruído (norma ≈ 0,23)
    captura = normalizar(ana + rng.normal(scale=0.02, size=128))
    candidato_id, similaridade = melhor_candidato(captura, [("bruno", bruno), ("ana", ana)])
    assert candidato_id == "ana"
    assert similaridade > 0.9


def test_galeria_vazia_nao_tem_candidato():
    assert melhor_candidato(normalizar(np.ones(128)), []) is None
