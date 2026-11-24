"""Acesso aos recursos AWS do FaceGate: DynamoDB, S3 e SQS (e Lambda, para o painel).

No LocalStack, o endpoint dos serviços chega pela variável AWS_ENDPOINT_URL, que o
boto3 lê automaticamente. Por isso este código é idêntico ao que rodaria na AWS.
"""

from __future__ import annotations

import json
import os

import boto3
from boto3.dynamodb.conditions import Key
from botocore.config import Config
from botocore.exceptions import ClientError

TABELA_MORADORES = os.environ.get("TABELA_MORADORES", "facegate-moradores")
TABELA_ACESSOS = os.environ.get("TABELA_ACESSOS", "facegate-acessos")
BUCKET_FOTOS = os.environ.get("BUCKET_FOTOS", "facegate-referencias")
FILA_EVENTOS = os.environ.get("FILA_EVENTOS", "facegate-eventos")
FILA_DLQ = os.environ.get("FILA_DLQ", "facegate-eventos-dlq")
LAMBDA_PROCESSADOR = os.environ.get("LAMBDA_PROCESSADOR", "facegate-event-processor")
# Endpoint do S3 "visto" pelo navegador, usado nas URLs pré-assinadas das fotos.
# No LocalStack é http://localhost:4566; na AWS real fica vazio (endpoint padrão).
S3_ENDPOINT_PUBLICO = os.environ.get("S3_ENDPOINT_PUBLICO") or None
VALIDADE_URL_FOTO_S = 900  # as URLs das fotos expiram em 15 minutos

# Clientes criados uma única vez, fora do handler: são reaproveitados entre invocações.
_dynamodb = boto3.resource("dynamodb")
_moradores = _dynamodb.Table(TABELA_MORADORES)
_acessos = _dynamodb.Table(TABELA_ACESSOS)
_s3 = boto3.client("s3")
_s3_publico = (
    boto3.client("s3", endpoint_url=S3_ENDPOINT_PUBLICO, config=Config(s3={"addressing_style": "path"}))
    if S3_ENDPOINT_PUBLICO
    else _s3
)
_sqs = boto3.client("sqs")
_lambda = boto3.client("lambda")
_urls_das_filas: dict[str, str] = {}

CAMPOS_PUBLICOS = ("moradorId", "nome", "unidade", "status", "fotoKey", "consentimentoEm", "criadoEm", "atualizadoEm")


class RegistroInexistente(Exception):
    """O item solicitado não existe no DynamoDB."""


# =============================================================================
# DynamoDB · moradores
# =============================================================================


def listar_moradores() -> list[dict]:
    """Scan com projeção: nunca lê a referência biométrica (faceRef)."""
    return _paginar(
        _moradores.scan,
        ProjectionExpression=", ".join(f"#{campo}" for campo in CAMPOS_PUBLICOS),
        ExpressionAttributeNames={f"#{campo}": campo for campo in CAMPOS_PUBLICOS},
    )


def galeria_facial() -> list[dict]:
    """Referências biométricas de TODOS os moradores (inclusive inativos).

    Inativos também entram: a pessoa pode ser reconhecida e, mesmo assim, ter o
    acesso negado por falta de permissão (reconhecer ≠ autorizar).
    """
    itens = _paginar(_moradores.scan, ProjectionExpression="moradorId, faceRef")
    return [{"id": item["moradorId"], "embedding": item["faceRef"]} for item in itens if item.get("faceRef")]


def obter_morador(morador_id: str) -> dict | None:
    return _moradores.get_item(Key={"moradorId": morador_id}).get("Item")


def criar_morador(item: dict) -> None:
    _moradores.put_item(Item=item, ConditionExpression="attribute_not_exists(moradorId)")


def atualizar_morador(morador_id: str, campos: dict) -> dict:
    try:
        resposta = _moradores.update_item(
            Key={"moradorId": morador_id},
            UpdateExpression="SET " + ", ".join(f"#{campo} = :{campo}" for campo in campos),
            ConditionExpression="attribute_exists(moradorId)",
            ExpressionAttributeNames={f"#{campo}": campo for campo in campos},
            ExpressionAttributeValues={f":{campo}": valor for campo, valor in campos.items()},
            ReturnValues="ALL_NEW",
        )
    except ClientError as erro:
        if erro.response["Error"]["Code"] == "ConditionalCheckFailedException":
            raise RegistroInexistente(morador_id) from erro
        raise
    return resposta["Attributes"]


def excluir_morador(morador_id: str) -> None:
    _moradores.delete_item(Key={"moradorId": morador_id})


# =============================================================================
# DynamoDB · acessos (PK = dia, SK = dataHora)
# =============================================================================


def registrar_acesso(item: dict) -> None:
    _acessos.put_item(Item=item)


def listar_acessos(dia: str) -> list[dict]:
    """Query (e não Scan): lê apenas a partição do dia, já ordenada pelo horário."""
    return _paginar(_acessos.query, KeyConditionExpression=Key("dia").eq(dia), ScanIndexForward=False)


# =============================================================================
# S3 · fotos de referência (bucket privado)
# =============================================================================


def salvar_foto(chave: str, dados: bytes, tipo: str) -> None:
    _s3.put_object(Bucket=BUCKET_FOTOS, Key=chave, Body=dados, ContentType=tipo, ServerSideEncryption="AES256")


def excluir_foto(chave: str) -> None:
    _s3.delete_object(Bucket=BUCKET_FOTOS, Key=chave)


def url_foto(chave: str) -> str:
    """URL pré-assinada de curta duração: o bucket continua privado."""
    return _s3_publico.generate_presigned_url(
        "get_object", Params={"Bucket": BUCKET_FOTOS, "Key": chave}, ExpiresIn=VALIDADE_URL_FOTO_S
    )


# =============================================================================
# SQS · eventos de acesso
# =============================================================================


def publicar_evento(evento: dict) -> str:
    """Publica um evento resumido (sem imagem nem embedding) na fila."""
    resposta = _sqs.send_message(
        QueueUrl=_url_da_fila(FILA_EVENTOS),
        MessageBody=json.dumps(evento, ensure_ascii=False),
        MessageAttributes={"tipo": {"DataType": "String", "StringValue": evento["tipo"]}},
    )
    return resposta["MessageId"]


def _url_da_fila(nome: str) -> str:
    if nome not in _urls_das_filas:
        _urls_das_filas[nome] = _sqs.get_queue_url(QueueName=nome)["QueueUrl"]
    return _urls_das_filas[nome]


# =============================================================================
# Painel de infraestrutura
# =============================================================================


def resumo_infraestrutura(hoje: str) -> dict:
    """Um pequeno retrato de cada serviço. Uma falha isolada não derruba o painel."""
    return {
        "dynamodb": _seguro(
            lambda: {
                "tabelas": [TABELA_MORADORES, TABELA_ACESSOS],
                "moradores": _contar(_moradores.scan),
                "acessosHoje": _contar(_acessos.query, KeyConditionExpression=Key("dia").eq(hoje)),
            }
        ),
        "s3": _seguro(lambda: {"bucket": BUCKET_FOTOS, "fotos": _contar_fotos()}),
        "sqs": _seguro(_estado_das_filas),
        "lambda": _seguro(
            lambda: {
                "processador": LAMBDA_PROCESSADOR,
                "estado": _lambda.get_function_configuration(FunctionName=LAMBDA_PROCESSADOR)["State"],
            }
        ),
    }


def _estado_das_filas() -> dict:
    atributos = ["ApproximateNumberOfMessages", "ApproximateNumberOfMessagesNotVisible"]
    fila = _sqs.get_queue_attributes(QueueUrl=_url_da_fila(FILA_EVENTOS), AttributeNames=atributos)
    dlq = _sqs.get_queue_attributes(QueueUrl=_url_da_fila(FILA_DLQ), AttributeNames=atributos)
    return {
        "fila": FILA_EVENTOS,
        "mensagens": int(fila["Attributes"]["ApproximateNumberOfMessages"]),
        "emProcessamento": int(fila["Attributes"]["ApproximateNumberOfMessagesNotVisible"]),
        "dlq": FILA_DLQ,
        "mensagensDlq": int(dlq["Attributes"]["ApproximateNumberOfMessages"]),
    }


def _contar_fotos() -> int:
    paginas = _s3.get_paginator("list_objects_v2").paginate(Bucket=BUCKET_FOTOS, Prefix="moradores/")
    return sum(pagina.get("KeyCount", 0) for pagina in paginas)


def _seguro(consulta) -> dict:
    try:
        return {"ok": True, **consulta()}
    except Exception as erro:  # noqa: BLE001 - o painel mostra o serviço com problema
        return {"ok": False, "erro": type(erro).__name__}


# =============================================================================
# Utilidades de paginação do DynamoDB (cada página tem no máximo 1 MB)
# =============================================================================


def _paginar(operacao, **parametros) -> list[dict]:
    itens: list[dict] = []
    while True:
        pagina = operacao(**parametros)
        itens.extend(pagina.get("Items", []))
        if "LastEvaluatedKey" not in pagina:
            return itens
        parametros["ExclusiveStartKey"] = pagina["LastEvaluatedKey"]


def _contar(operacao, **parametros) -> int:
    total = 0
    while True:
        pagina = operacao(Select="COUNT", **parametros)
        total += pagina["Count"]
        if "LastEvaluatedKey" not in pagina:
            return total
        parametros["ExclusiveStartKey"] = pagina["LastEvaluatedKey"]
