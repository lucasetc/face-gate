"""Lambda facegate-api: atende todas as rotas do API Gateway (integração proxy).

Caminho de uma requisição:
    API Gateway → lambda_handler → função da rota → regras / biometria / repositorio

Camadas:
    handler.py     HTTP: rotas, leitura do corpo e formato das respostas
    regras.py      regras de negócio puras (decisão de acesso e validações)
    biometria.py   cliente do face-service (FastAPI + OpenCV)
    repositorio.py DynamoDB, S3 e SQS
"""

from __future__ import annotations

import base64
import json
import logging
import os
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import biometria
import regras
import repositorio

FUSO_HORARIO = timezone(timedelta(hours=-3), "BRT")  # Palmas-TO: UTC-3, sem horário de verão
LIMIAR = float(os.environ.get("LIMIAR_SIMILARIDADE", "0.363"))
RETENCAO_ACESSOS_DIAS = int(os.environ.get("RETENCAO_ACESSOS_DIAS", "90"))

logger = logging.getLogger()
logger.setLevel(logging.INFO)


class ErroApi(Exception):
    """Erro de negócio com status HTTP definido."""

    def __init__(self, status: int, codigo: str, mensagem: str) -> None:
        super().__init__(mensagem)
        self.status = status
        self.codigo = codigo
        self.mensagem = mensagem


# =============================================================================
# Ponto de entrada
# =============================================================================


def lambda_handler(event, context):
    rota = (event.get("httpMethod"), event.get("resource"))
    acao = ROTAS.get(rota)
    if acao is None:
        return resposta(404, _erro("ROTA_INEXISTENTE", "Rota não encontrada."))
    try:
        return acao(event)
    except regras.ErroValidacao as erro:
        return resposta(400, _erro("DADOS_INVALIDOS", erro.mensagem, campo=erro.campo))
    except repositorio.RegistroInexistente:
        return resposta(404, _erro("MORADOR_NAO_ENCONTRADO", "Morador não encontrado."))
    except ErroApi as erro:
        return resposta(erro.status, _erro(erro.codigo, erro.mensagem))
    except Exception:
        logger.exception("Erro inesperado em %s %s", *rota)
        return resposta(500, _erro("ERRO_INTERNO", "Erro interno. Tente novamente."))


# =============================================================================
# Acessos
# =============================================================================


def validar_acesso(event):
    """POST /acessos/validar: fluxo 4.2 do projeto (sempre devolve uma decisão)."""
    imagem = regras.validar_imagem(ler_corpo(event).get("imagem"))
    rastreio = Rastreamento()
    try:
        return resposta(200, _avaliar_acesso(imagem, rastreio))
    except Exception:
        # Fail-closed: se a infraestrutura falhar, o portão continua fechado.
        logger.exception("Falha de infraestrutura ao avaliar o acesso")
        falha = regras.Decisao(regras.NEGADO, regras.FALHA_SERVICO)
        return resposta(
            503,
            {
                "resultado": falha.resultado,
                "motivo": falha.motivo,
                "mensagem": falha.mensagem,
                "limiar": LIMIAR,
                "rastreamento": rastreio.etapas,
            },
        )


def _avaliar_acesso(imagem: regras.Imagem, rastreio: Rastreamento) -> dict:
    momento = agora()

    # 1. Reconhecimento: o face-service compara a captura com TODAS as referências
    with rastreio.etapa("dynamodb", "Carregar referências faciais"):
        galeria = repositorio.galeria_facial()
    with rastreio.etapa("face-service", "Detectar e comparar o rosto (YuNet + SFace)") as etapa:
        resultado = biometria.analisar(imagem.base64, galeria)
        etapa["ok"] = resultado.erro != regras.FALHA_SERVICO

    # 2. Permissão: o cadastro só é consultado se a similaridade superou o limiar
    morador = None
    if regras.reconheceu(resultado, LIMIAR):
        with rastreio.etapa("dynamodb", "Consultar cadastro e permissão"):
            morador = repositorio.obter_morador(resultado.candidato_id)

    # 3. Decisão (regra 4.4): reconhecer não é o mesmo que autorizar
    with rastreio.etapa("lambda", "Aplicar as regras de autorização"):
        decisao = regras.decidir_acesso(resultado, morador, LIMIAR)

    # 4. Registro da tentativa no histórico
    acesso = {
        "dia": momento.date().isoformat(),
        "dataHora": momento.isoformat(timespec="microseconds"),
        "acessoId": str(uuid.uuid4()),
        "resultado": decisao.resultado,
        "motivo": decisao.motivo,
        "expiraEm": int((momento + timedelta(days=RETENCAO_ACESSOS_DIAS)).timestamp()),  # TTL (LGPD)
    }
    if morador:
        acesso.update(moradorId=morador["moradorId"], nome=morador["nome"], unidade=morador["unidade"])
    if resultado.similaridade is not None:
        acesso["similaridade"] = Decimal(str(round(resultado.similaridade, 4)))
    with rastreio.etapa("dynamodb", "Registrar a tentativa no histórico"):
        repositorio.registrar_acesso(acesso)

    # 5. Evento assíncrono: uma falha aqui não pode atrasar nem impedir a resposta
    evento = {"tipo": "ACESSO_AVALIADO", **{c: v for c, v in acesso.items() if c not in ("similaridade", "expiraEm")}}
    with rastreio.etapa("sqs", "Publicar evento na fila de notificações") as etapa:
        try:
            repositorio.publicar_evento(evento)
        except Exception:
            etapa["ok"] = False
            logger.exception("Não foi possível publicar o evento %s no SQS", acesso["acessoId"])

    log(
        "ACESSO_AVALIADO",
        acessoId=acesso["acessoId"],
        resultado=decisao.resultado,
        motivo=decisao.motivo,
        similaridade=resultado.similaridade,
    )
    return {
        "acessoId": acesso["acessoId"],
        "dataHora": acesso["dataHora"],
        "resultado": decisao.resultado,
        "motivo": decisao.motivo,
        "mensagem": decisao.mensagem,
        "morador": _resumo_morador(morador),
        "similaridade": resultado.similaridade,
        "limiar": LIMIAR,
        "rastreamento": rastreio.etapas,
    }


def listar_acessos(event):
    """GET /acessos?dia=AAAA-MM-DD: histórico de um dia (padrão: hoje)."""
    parametros = event.get("queryStringParameters") or {}
    dia = regras.validar_dia(parametros.get("dia"), hoje=agora().date().isoformat())
    return resposta(200, {"dia": dia, "acessos": repositorio.listar_acessos(dia)})


# =============================================================================
# Moradores
# =============================================================================


def listar_moradores(event):
    moradores = sorted(repositorio.listar_moradores(), key=lambda m: (m["nome"].casefold(), m["unidade"]))
    return resposta(200, {"moradores": [publico(m) for m in moradores]})


def obter_morador(event):
    morador = repositorio.obter_morador(id_da_rota(event))
    if morador is None:
        raise repositorio.RegistroInexistente()
    return resposta(200, publico(morador))


def cadastrar_morador(event):
    """POST /moradores: fluxo 4.1 do projeto."""
    dados = regras.validar_novo_morador(ler_corpo(event))

    resultado = biometria.analisar(dados.imagem.base64, repositorio.galeria_facial())
    if resultado.erro == regras.FALHA_SERVICO or (resultado.erro is None and not resultado.embedding):
        raise ErroApi(503, regras.FALHA_SERVICO, "Serviço de reconhecimento indisponível. Tente novamente.")
    if resultado.erro:
        raise ErroApi(422, resultado.erro, regras.MENSAGENS[resultado.erro])
    if regras.reconheceu(resultado, LIMIAR):
        existente = repositorio.obter_morador(resultado.candidato_id)
        if existente:
            raise ErroApi(
                409,
                "ROSTO_JA_CADASTRADO",
                f"Este rosto já está cadastrado para {existente['nome']} ({existente['unidade']}).",
            )

    momento = agora().isoformat(timespec="seconds")
    morador_id = str(uuid.uuid4())
    morador = {
        "moradorId": morador_id,
        "nome": dados.nome,
        "unidade": dados.unidade,
        "status": regras.STATUS_ATIVO,
        "faceRef": resultado.embedding,
        "fotoKey": f"moradores/{morador_id}.{dados.imagem.extensao}",
        "consentimentoEm": momento,
        "criadoEm": momento,
        "atualizadoEm": momento,
    }
    repositorio.salvar_foto(morador["fotoKey"], dados.imagem.dados, dados.imagem.tipo)
    try:
        repositorio.criar_morador(morador)
    except Exception:
        repositorio.excluir_foto(morador["fotoKey"])  # compensação: não deixa foto órfã no S3
        raise
    log("MORADOR_CADASTRADO", moradorId=morador_id, unidade=dados.unidade)
    return resposta(201, publico(morador))


def atualizar_morador(event):
    """PATCH /moradores/{id}: altera nome, unidade e/ou status (ativar/desativar)."""
    campos = regras.validar_atualizacao(ler_corpo(event))
    campos["atualizadoEm"] = agora().isoformat(timespec="seconds")
    morador = repositorio.atualizar_morador(id_da_rota(event), campos)
    log("MORADOR_ATUALIZADO", moradorId=morador["moradorId"], campos=sorted(campos))
    return resposta(200, publico(morador))


def excluir_morador(event):
    """DELETE /moradores/{id}: exclusão definitiva (LGPD) do cadastro, da biometria e da foto."""
    morador_id = id_da_rota(event)
    morador = repositorio.obter_morador(morador_id)
    if morador is None:
        raise repositorio.RegistroInexistente(morador_id)
    if morador.get("fotoKey"):
        repositorio.excluir_foto(morador["fotoKey"])  # primeiro a foto: repetir a exclusão é seguro
    repositorio.excluir_morador(morador_id)
    log("MORADOR_EXCLUIDO", moradorId=morador_id)
    return resposta(204)


# =============================================================================
# Sistema (painel de infraestrutura)
# =============================================================================


def status_sistema(event):
    face_service = biometria.saude()
    return resposta(
        200,
        {
            "regiao": os.environ.get("AWS_REGION", "us-east-1"),
            "limiarSimilaridade": LIMIAR,
            "faceService": {"ok": face_service is not None, **(face_service or {})},
            **repositorio.resumo_infraestrutura(hoje=agora().date().isoformat()),
        },
    )


ROTAS = {
    ("GET", "/sistema"): status_sistema,
    ("GET", "/moradores"): listar_moradores,
    ("POST", "/moradores"): cadastrar_morador,
    ("GET", "/moradores/{id}"): obter_morador,
    ("PATCH", "/moradores/{id}"): atualizar_morador,
    ("DELETE", "/moradores/{id}"): excluir_morador,
    ("POST", "/acessos/validar"): validar_acesso,
    ("GET", "/acessos"): listar_acessos,
}


# =============================================================================
# Utilidades
# =============================================================================


class Rastreamento:
    """Cronometra cada etapa da validação; o painel da Portaria exibe o resultado."""

    def __init__(self) -> None:
        self.etapas: list[dict] = []

    @contextmanager
    def etapa(self, servico: str, descricao: str):
        registro = {"servico": servico, "descricao": descricao, "ok": True}
        inicio = time.perf_counter()
        try:
            yield registro
        except Exception:
            registro["ok"] = False
            raise
        finally:
            registro["ms"] = round((time.perf_counter() - inicio) * 1000, 1)
            self.etapas.append(registro)


def agora() -> datetime:
    return datetime.now(FUSO_HORARIO)


def log(evento: str, **dados) -> None:
    """Log estruturado (JSON) no CloudWatch Logs. Nunca registra imagens nem embeddings."""
    logger.info(json.dumps({"evento": evento, **dados}, ensure_ascii=False, default=str))


def publico(morador: dict) -> dict:
    """Dados exibíveis do morador: nunca expõe a referência biométrica (faceRef)."""
    dados = {campo: morador.get(campo) for campo in repositorio.CAMPOS_PUBLICOS if campo != "fotoKey"}
    dados["fotoUrl"] = repositorio.url_foto(morador["fotoKey"]) if morador.get("fotoKey") else None
    return dados


def _resumo_morador(morador: dict | None) -> dict | None:
    if not morador:
        return None
    return {"moradorId": morador["moradorId"], "nome": morador["nome"], "unidade": morador["unidade"]}


def ler_corpo(event) -> dict:
    corpo = event.get("body") or "{}"
    if event.get("isBase64Encoded"):
        corpo = base64.b64decode(corpo).decode("utf-8")
    try:
        dados = json.loads(corpo)
    except json.JSONDecodeError:
        raise regras.ErroValidacao("O corpo da requisição deve ser um JSON válido.") from None
    if not isinstance(dados, dict):
        raise regras.ErroValidacao("O corpo da requisição deve ser um objeto JSON.")
    return dados


def id_da_rota(event) -> str:
    return (event.get("pathParameters") or {}).get("id", "")


def resposta(status: int, corpo: dict | None = None) -> dict:
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store"},
        "body": "" if corpo is None else json.dumps(corpo, ensure_ascii=False, default=_para_json),
    }


def _erro(codigo: str, mensagem: str, campo: str | None = None) -> dict:
    erro = {"codigo": codigo, "mensagem": mensagem}
    if campo:
        erro["campo"] = campo
    return {"erro": erro}


def _para_json(valor):
    """O DynamoDB devolve números como Decimal; o JSON precisa de int/float."""
    if isinstance(valor, Decimal):
        return int(valor) if valor == valor.to_integral_value() else float(valor)
    raise TypeError(f"Tipo não serializável: {type(valor).__name__}")
