"""Montagem das notificações a partir dos eventos de acesso (funções puras)."""

from __future__ import annotations

from datetime import datetime

CAMPOS_OBRIGATORIOS = ("tipo", "acessoId", "dia", "dataHora", "resultado", "motivo")

DESCRICAO_DOS_MOTIVOS = {
    "NAO_RECONHECIDO": "pessoa não reconhecida",
    "CADASTRO_INATIVO": "cadastro inativo",
    "NENHUM_ROSTO": "nenhum rosto detectado",
    "MULTIPLOS_ROSTOS": "mais de um rosto na imagem",
    "ROSTO_DISTANTE": "rosto muito distante da câmera",
    "IMAGEM_INVALIDA": "imagem inválida",
    "FALHA_SERVICO": "falha no serviço de reconhecimento",
}


def validar_evento(evento: object) -> dict:
    """Garante o formato esperado. Mensagens inválidas falham e acabam na DLQ."""
    if not isinstance(evento, dict):
        raise ValueError("o evento deve ser um objeto JSON")
    faltando = [campo for campo in CAMPOS_OBRIGATORIOS if not evento.get(campo)]
    if faltando:
        raise ValueError(f"campos obrigatórios ausentes: {', '.join(faltando)}")
    if evento["tipo"] != "ACESSO_AVALIADO":
        raise ValueError(f"tipo de evento desconhecido: {evento['tipo']}")
    return evento


def montar_notificacao(evento: dict) -> dict:
    """Acesso autorizado avisa a unidade do morador; acesso negado alerta a administração."""
    hora = datetime.fromisoformat(evento["dataHora"]).strftime("%H:%M")
    if evento["resultado"] == "AUTORIZADO":
        return {
            "canal": "MORADOR",
            "destino": f"Unidade {evento.get('unidade', '?')}",
            "mensagem": f"Entrada de {evento.get('nome', 'morador')} registrada às {hora}.",
        }
    pessoa = f"{evento['nome']} ({evento.get('unidade', '?')})" if evento.get("nome") else "pessoa não identificada"
    motivo = DESCRICAO_DOS_MOTIVOS.get(evento["motivo"], evento["motivo"].lower())
    return {
        "canal": "ADMINISTRACAO",
        "destino": "Administração do condomínio",
        "mensagem": f"Alerta: acesso negado às {hora} para {pessoa} ({motivo}).",
    }
