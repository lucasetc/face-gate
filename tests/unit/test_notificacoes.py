"""Notificações geradas pela Lambda de eventos (consumidora da fila SQS)."""

import pytest

from notificacoes import montar_notificacao, validar_evento

EVENTO = {
    "tipo": "ACESSO_AVALIADO",
    "acessoId": "a1",
    "dia": "2026-11-23",
    "dataHora": "2026-11-23T14:05:09.123456-03:00",
    "resultado": "AUTORIZADO",
    "motivo": "RECONHECIDO",
    "moradorId": "m1",
    "nome": "Ana",
    "unidade": "101",
}


def test_acesso_autorizado_avisa_a_unidade_do_morador():
    notificacao = montar_notificacao(EVENTO)
    assert notificacao["canal"] == "MORADOR"
    assert notificacao["destino"] == "Unidade 101"
    assert notificacao["mensagem"] == "Entrada de Ana registrada às 14:05."


def test_acesso_negado_alerta_a_administracao():
    evento = {**EVENTO, "resultado": "NEGADO", "motivo": "CADASTRO_INATIVO"}
    notificacao = montar_notificacao(evento)
    assert notificacao["canal"] == "ADMINISTRACAO"
    assert "Ana (101)" in notificacao["mensagem"]
    assert "cadastro inativo" in notificacao["mensagem"]


def test_pessoa_nao_identificada():
    evento = {k: v for k, v in EVENTO.items() if k not in ("moradorId", "nome", "unidade")}
    evento.update(resultado="NEGADO", motivo="NAO_RECONHECIDO")
    assert "pessoa não identificada" in montar_notificacao(evento)["mensagem"]


def test_evento_sem_dados_biometricos_e_valido():
    assert validar_evento(dict(EVENTO)) == EVENTO


@pytest.mark.parametrize(
    "evento",
    [
        None,
        [],
        {**EVENTO, "acessoId": ""},
        {k: v for k, v in EVENTO.items() if k != "dataHora"},
        {**EVENTO, "tipo": "OUTRO"},
    ],
)
def test_evento_invalido_e_rejeitado_para_ir_a_dlq(evento):
    with pytest.raises(ValueError):
        validar_evento(evento)
