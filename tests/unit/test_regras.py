"""Regras de autorização (seção 4.4) e cenários mínimos de teste (seção 8.1)."""

import base64

import pytest

import regras
from regras import ResultadoBiometria

LIMIAR = 0.363
ATIVO = {"moradorId": "m1", "nome": "Ana", "unidade": "101", "status": "ATIVO"}
INATIVO = {**ATIVO, "status": "INATIVO"}

JPEG = base64.b64encode(b"\xff\xd8\xff\xe0" + b"\x00" * 32).decode()
PNG = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"\x00" * 32).decode()


def reconhecido(similaridade=0.8):
    return ResultadoBiometria(candidato_id="m1", similaridade=similaridade)


# ----------------------------------------------------------- seção 8.1 ------
def test_pessoa_cadastrada_e_autorizada_tem_acesso_permitido():
    decisao = regras.decidir_acesso(reconhecido(), ATIVO, LIMIAR)
    assert decisao.autorizado
    assert decisao.motivo == "RECONHECIDO"


def test_pessoa_nao_cadastrada_tem_acesso_negado():
    decisao = regras.decidir_acesso(reconhecido(similaridade=0.12), None, LIMIAR)
    assert (decisao.resultado, decisao.motivo) == ("NEGADO", "NAO_RECONHECIDO")


def test_cadastro_inativo_e_reconhecido_mas_negado():
    decisao = regras.decidir_acesso(reconhecido(), INATIVO, LIMIAR)
    assert (decisao.resultado, decisao.motivo) == ("NEGADO", "CADASTRO_INATIVO")


def test_falha_do_servico_nega_o_acesso():
    decisao = regras.decidir_acesso(ResultadoBiometria(erro="FALHA_SERVICO"), ATIVO, LIMIAR)
    assert (decisao.resultado, decisao.motivo) == ("NEGADO", "FALHA_SERVICO")


# ------------------------------------------------- detalhes da regra 4.4 -----
@pytest.mark.parametrize("codigo", ["NENHUM_ROSTO", "MULTIPLOS_ROSTOS", "ROSTO_DISTANTE", "IMAGEM_INVALIDA"])
def test_exige_exatamente_um_rosto_valido(codigo):
    decisao = regras.decidir_acesso(ResultadoBiometria(erro=codigo), ATIVO, LIMIAR)
    assert (decisao.resultado, decisao.motivo) == ("NEGADO", codigo)


def test_erro_desconhecido_e_tratado_como_falha_de_servico():
    decisao = regras.decidir_acesso(ResultadoBiometria(erro="ALGO_INESPERADO"), ATIVO, LIMIAR)
    assert decisao.motivo == "FALHA_SERVICO"


def test_similaridade_exatamente_no_limiar_autoriza():
    assert regras.decidir_acesso(reconhecido(similaridade=LIMIAR), ATIVO, LIMIAR).autorizado


def test_similaridade_logo_abaixo_do_limiar_nega():
    decisao = regras.decidir_acesso(reconhecido(similaridade=LIMIAR - 0.001), ATIVO, LIMIAR)
    assert decisao.motivo == "NAO_RECONHECIDO"


def test_galeria_vazia_nega():
    decisao = regras.decidir_acesso(ResultadoBiometria(), None, LIMIAR)
    assert decisao.motivo == "NAO_RECONHECIDO"


def test_morador_excluido_entre_as_consultas_nega():
    decisao = regras.decidir_acesso(reconhecido(), None, LIMIAR)
    assert decisao.motivo == "NAO_RECONHECIDO"


def test_toda_decisao_tem_mensagem_amigavel():
    for motivo in regras.MENSAGENS:
        assert regras.Decisao(regras.NEGADO, motivo).mensagem


# --------------------------------------------------------------- validações --
def test_imagem_jpeg_e_png_sao_aceitas_inclusive_como_data_url():
    assert regras.validar_imagem(JPEG).tipo == "image/jpeg"
    assert regras.validar_imagem(f"data:image/png;base64,{PNG}").extensao == "png"


@pytest.mark.parametrize("valor", [None, "", "   ", "não é base64!", base64.b64encode(b"GIF89a").decode()])
def test_imagem_invalida_e_recusada(valor):
    with pytest.raises(regras.ErroValidacao) as erro:
        regras.validar_imagem(valor)
    assert erro.value.campo == "imagem"


def test_imagem_acima_do_limite_e_recusada():
    grande = base64.b64encode(b"\xff\xd8\xff" + b"\x00" * regras.TAMANHO_MAXIMO_IMAGEM).decode()
    with pytest.raises(regras.ErroValidacao, match="4 MB"):
        regras.validar_imagem(grande)


def test_cadastro_exige_consentimento():
    with pytest.raises(regras.ErroValidacao) as erro:
        regras.validar_novo_morador({"nome": "Ana", "unidade": "101", "imagem": JPEG, "consentimento": False})
    assert erro.value.campo == "consentimento"


def test_cadastro_normaliza_espacos_do_nome():
    novo = regras.validar_novo_morador(
        {"nome": "  Ana   Maria ", "unidade": " Bloco A - 101 ", "imagem": JPEG, "consentimento": True}
    )
    assert (novo.nome, novo.unidade) == ("Ana Maria", "Bloco A - 101")


@pytest.mark.parametrize("nome", ["A", "x" * 81, None, 123])
def test_nome_fora_do_tamanho_e_recusado(nome):
    with pytest.raises(regras.ErroValidacao):
        regras.validar_nome(nome)


def test_atualizacao_aceita_apenas_campos_permitidos():
    assert regras.validar_atualizacao({"status": "INATIVO"}) == {"status": "INATIVO"}
    with pytest.raises(regras.ErroValidacao, match="faceRef"):
        regras.validar_atualizacao({"faceRef": "abc"})
    with pytest.raises(regras.ErroValidacao):
        regras.validar_atualizacao({})
    with pytest.raises(regras.ErroValidacao):
        regras.validar_atualizacao({"status": "BLOQUEADO"})


def test_dia_do_historico():
    assert regras.validar_dia(None, hoje="2026-11-23") == "2026-11-23"
    assert regras.validar_dia("2026-01-31", hoje="2026-11-23") == "2026-01-31"
    for invalido in ("2026-13-01", "23/11/2026", "2026-02-30"):
        with pytest.raises(regras.ErroValidacao):
            regras.validar_dia(invalido, hoje="2026-11-23")
