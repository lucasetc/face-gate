"""Lambda facegate-event-processor: consome a fila SQS facegate-eventos.

Para cada evento de acesso:
  1. valida a mensagem;
  2. marca o acesso como processado no DynamoDB, de forma idempotente
     (o SQS entrega "pelo menos uma vez", então duplicatas são ignoradas);
  3. "envia" a notificação. No protótipo, o envio é um log estruturado
     no CloudWatch Logs; em produção seria um e-mail, SMS ou push.

Mensagens com falha voltam para a fila (ReportBatchItemFailures). Após 3
tentativas, o SQS as move para a fila de mensagens mortas facegate-eventos-dlq.
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timedelta, timezone

import boto3
from botocore.exceptions import ClientError

from notificacoes import montar_notificacao, validar_evento

FUSO_HORARIO = timezone(timedelta(hours=-3), "BRT")  # Palmas-TO: UTC-3
_acessos = boto3.resource("dynamodb").Table(os.environ.get("TABELA_ACESSOS", "facegate-acessos"))

logger = logging.getLogger()
logger.setLevel(logging.INFO)


def lambda_handler(event, context):
    falhas = []
    for registro in event.get("Records", []):
        try:
            processar(registro)
        except Exception:
            logger.exception("Falha ao processar a mensagem %s", registro.get("messageId"))
            falhas.append({"itemIdentifier": registro["messageId"]})
    # Só as mensagens com falha voltam para a fila; as demais são removidas.
    return {"batchItemFailures": falhas}


def processar(registro: dict) -> None:
    evento = validar_evento(json.loads(registro["body"]))
    notificacao = montar_notificacao(evento)
    try:
        _acessos.update_item(
            Key={"dia": evento["dia"], "dataHora": evento["dataHora"]},
            UpdateExpression="SET notificacao = :mensagem, processadoEm = :agora",
            ConditionExpression="attribute_exists(acessoId) AND attribute_not_exists(processadoEm)",
            ExpressionAttributeValues={
                ":mensagem": notificacao["mensagem"],
                ":agora": datetime.now(FUSO_HORARIO).isoformat(timespec="milliseconds"),
            },
        )
    except ClientError as erro:
        if erro.response["Error"]["Code"] == "ConditionalCheckFailedException":
            log("EVENTO_IGNORADO", acessoId=evento["acessoId"], razao="já processado ou inexistente")
            return
        raise
    log("NOTIFICACAO_ENVIADA", acessoId=evento["acessoId"], resultado=evento["resultado"], **notificacao)


def log(evento: str, **dados) -> None:
    logger.info(json.dumps({"evento": evento, **dados}, ensure_ascii=False))
