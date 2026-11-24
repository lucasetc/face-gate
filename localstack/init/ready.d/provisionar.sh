#!/bin/bash
# =============================================================================
#  FaceGate · Provisionamento da infraestrutura AWS no LocalStack
#
#  Init hook: o LocalStack executa este script automaticamente quando fica
#  pronto (estágio READY). Cada seção cria um serviço da arquitetura usando o
#  awslocal, a AWS CLI apontada para o LocalStack.
#
#  O script é idempotente: rodá-lo de novo só atualiza o código das Lambdas e
#  a definição da API. Útil depois de editar uma Lambda:
#    docker compose exec localstack bash /etc/localstack/init/ready.d/provisionar.sh
# =============================================================================
set -euo pipefail

REGIAO="${AWS_DEFAULT_REGION:-us-east-1}"
CONTA="000000000000"                      # conta padrão do LocalStack
BASE="/opt/facegate"                      # pastas do projeto montadas no contêiner

BUCKET="facegate-referencias"
TABELA_MORADORES="facegate-moradores"
TABELA_ACESSOS="facegate-acessos"
FILA="facegate-eventos"
FILA_DLQ="facegate-eventos-dlq"
LAMBDA_API="facegate-api"
LAMBDA_PROCESSADOR="facegate-event-processor"
RUNTIME="python3.13"
API_ID="facegate"                         # ID fixo (tag _custom_id_ do LocalStack)
STAGE="dev"
LIMIAR="${LIMIAR_SIMILARIDADE:-0.363}"

log() { echo "[FaceGate] $*"; }
trap 'log "✖ Falha na linha $LINENO. Veja a mensagem de erro acima."' ERR

log "Provisionando a infraestrutura AWS no LocalStack ($REGIAO)..."

# -----------------------------------------------------------------------------
# 1. IAM: um papel de execução por Lambda, com privilégio mínimo
#    (o LocalStack Community não aplica IAM, mas as políticas documentam o
#    acesso e deixam o projeto pronto para a AWS real)
# -----------------------------------------------------------------------------
criar_papel() {
  local papel="$1" politica="$2"
  if ! awslocal iam get-role --role-name "$papel" >/dev/null 2>&1; then
    awslocal iam create-role --role-name "$papel" \
      --assume-role-policy-document "file://$BASE/infra/iam/confianca-lambda.json" >/dev/null
  fi
  awslocal iam put-role-policy --role-name "$papel" --policy-name "${papel}-politica" \
    --policy-document "file://$BASE/infra/iam/$politica"
  log "✔ IAM       papel $papel"
}
criar_papel facegate-api-papel politica-api.json
criar_papel facegate-processador-papel politica-processador.json

# -----------------------------------------------------------------------------
# 2. S3: fotos de referência (bucket privado e criptografado)
# -----------------------------------------------------------------------------
if ! awslocal s3api head-bucket --bucket "$BUCKET" >/dev/null 2>&1; then
  awslocal s3api create-bucket --bucket "$BUCKET" >/dev/null
fi
awslocal s3api put-public-access-block --bucket "$BUCKET" --public-access-block-configuration \
  "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
awslocal s3api put-bucket-encryption --bucket "$BUCKET" --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
log "✔ S3        bucket $BUCKET (privado, criptografado)"

# -----------------------------------------------------------------------------
# 3. DynamoDB
#    moradores: PK moradorId
#    acessos:   PK dia + SK dataHora → o histórico de um dia sai com Query,
#               já em ordem cronológica, sem varrer a tabela inteira (Scan)
# -----------------------------------------------------------------------------
if ! awslocal dynamodb describe-table --table-name "$TABELA_MORADORES" >/dev/null 2>&1; then
  awslocal dynamodb create-table --table-name "$TABELA_MORADORES" \
    --attribute-definitions AttributeName=moradorId,AttributeType=S \
    --key-schema AttributeName=moradorId,KeyType=HASH \
    --billing-mode PAY_PER_REQUEST >/dev/null
fi
log "✔ DynamoDB  tabela $TABELA_MORADORES"

if ! awslocal dynamodb describe-table --table-name "$TABELA_ACESSOS" >/dev/null 2>&1; then
  awslocal dynamodb create-table --table-name "$TABELA_ACESSOS" \
    --attribute-definitions AttributeName=dia,AttributeType=S AttributeName=dataHora,AttributeType=S \
    --key-schema AttributeName=dia,KeyType=HASH AttributeName=dataHora,KeyType=RANGE \
    --billing-mode PAY_PER_REQUEST >/dev/null
  awslocal dynamodb wait table-exists --table-name "$TABELA_ACESSOS"
  # Retenção (LGPD): cada registro expira sozinho no instante gravado em "expiraEm"
  awslocal dynamodb update-time-to-live --table-name "$TABELA_ACESSOS" \
    --time-to-live-specification "Enabled=true,AttributeName=expiraEm" >/dev/null
fi
log "✔ DynamoDB  tabela $TABELA_ACESSOS (com TTL)"

# -----------------------------------------------------------------------------
# 4. SQS: fila de eventos + fila de mensagens mortas (DLQ) após 3 tentativas
# -----------------------------------------------------------------------------
DLQ_URL=$(awslocal sqs create-queue --queue-name "$FILA_DLQ" \
  --attributes MessageRetentionPeriod=1209600 --query QueueUrl --output text)
DLQ_ARN=$(awslocal sqs get-queue-attributes --queue-url "$DLQ_URL" \
  --attribute-names QueueArn --query Attributes.QueueArn --output text)
FILA_URL=$(awslocal sqs create-queue --queue-name "$FILA" --query QueueUrl --output text)
FILA_ARN=$(awslocal sqs get-queue-attributes --queue-url "$FILA_URL" \
  --attribute-names QueueArn --query Attributes.QueueArn --output text)
cat > /tmp/facegate-fila.json <<EOF
{
  "VisibilityTimeout": "60",
  "RedrivePolicy": "{\"deadLetterTargetArn\":\"$DLQ_ARN\",\"maxReceiveCount\":\"3\"}"
}
EOF
awslocal sqs set-queue-attributes --queue-url "$FILA_URL" --attributes file:///tmp/facegate-fila.json
log "✔ SQS       filas $FILA e $FILA_DLQ (DLQ após 3 tentativas)"

# -----------------------------------------------------------------------------
# 5. Lambda: código empacotado direto da pasta lambdas/ (só stdlib + boto3)
# -----------------------------------------------------------------------------
implantar_lambda() {
  local nome="$1" pasta="$2" papel="$3" timeout="$4" memoria="$5" ambiente="$6" descricao="$7"
  local pacote="/tmp/$nome.zip"
  rm -f "$pacote"
  (cd "$BASE/lambdas/$pasta" && python3 -m zipfile -c "$pacote" ./*.py)

  if awslocal lambda get-function --function-name "$nome" >/dev/null 2>&1; then
    awslocal lambda update-function-code --function-name "$nome" --zip-file "fileb://$pacote" >/dev/null
    awslocal lambda wait function-updated-v2 --function-name "$nome"
    awslocal lambda update-function-configuration --function-name "$nome" \
      --timeout "$timeout" --memory-size "$memoria" --environment "$ambiente" >/dev/null
    awslocal lambda wait function-updated-v2 --function-name "$nome"
  else
    awslocal lambda create-function --function-name "$nome" --description "$descricao" \
      --runtime "$RUNTIME" --handler handler.lambda_handler --zip-file "fileb://$pacote" \
      --role "arn:aws:iam::$CONTA:role/$papel" \
      --timeout "$timeout" --memory-size "$memoria" --environment "$ambiente" >/dev/null
  fi
  awslocal lambda wait function-active-v2 --function-name "$nome"
  log "✔ Lambda    $nome ($RUNTIME)"
}

AMBIENTE_API=$(cat <<EOF
{"Variables": {
  "TABELA_MORADORES": "$TABELA_MORADORES",
  "TABELA_ACESSOS": "$TABELA_ACESSOS",
  "BUCKET_FOTOS": "$BUCKET",
  "FILA_EVENTOS": "$FILA",
  "FILA_DLQ": "$FILA_DLQ",
  "LAMBDA_PROCESSADOR": "$LAMBDA_PROCESSADOR",
  "FACE_SERVICE_URL": "http://face-service:8000",
  "LIMIAR_SIMILARIDADE": "$LIMIAR",
  "RETENCAO_ACESSOS_DIAS": "90",
  "S3_ENDPOINT_PUBLICO": "http://localhost:4566"
}}
EOF
)
AMBIENTE_PROCESSADOR="{\"Variables\": {\"TABELA_ACESSOS\": \"$TABELA_ACESSOS\"}}"

implantar_lambda "$LAMBDA_API" api facegate-api-papel 30 512 "$AMBIENTE_API" \
  "API do FaceGate: cadastro, validacao de acesso e historico"
implantar_lambda "$LAMBDA_PROCESSADOR" event_processor facegate-processador-papel 10 256 "$AMBIENTE_PROCESSADOR" \
  "Consome a fila de eventos e gera notificacoes"

# A fila aciona a Lambda de eventos (lotes de até 10, com falha parcial por mensagem)
QTD_GATILHOS=$(awslocal lambda list-event-source-mappings --function-name "$LAMBDA_PROCESSADOR" \
  --event-source-arn "$FILA_ARN" --query 'length(EventSourceMappings)' --output text)
if [ "$QTD_GATILHOS" = "0" ]; then
  awslocal lambda create-event-source-mapping --function-name "$LAMBDA_PROCESSADOR" \
    --event-source-arn "$FILA_ARN" --batch-size 10 --maximum-batching-window-in-seconds 0 \
    --function-response-types ReportBatchItemFailures >/dev/null
fi
log "✔ Lambda    gatilho SQS $FILA → $LAMBDA_PROCESSADOR"

# -----------------------------------------------------------------------------
# 6. API Gateway (REST): rotas definidas no contrato OpenAPI infra/openapi.yaml
# -----------------------------------------------------------------------------
LAMBDA_API_URI="arn:aws:apigateway:$REGIAO:lambda:path/2015-03-31/functions/arn:aws:lambda:$REGIAO:$CONTA:function:$LAMBDA_API/invocations"

if ! awslocal apigateway get-rest-api --rest-api-id "$API_ID" >/dev/null 2>&1; then
  awslocal apigateway create-rest-api --name facegate-api \
    --description "Portaria inteligente FaceGate" --tags "_custom_id_=$API_ID" >/dev/null
fi
sed "s|\${LAMBDA_API_URI}|$LAMBDA_API_URI|g" "$BASE/infra/openapi.yaml" > /tmp/facegate-openapi.yaml
awslocal apigateway put-rest-api --rest-api-id "$API_ID" --mode overwrite \
  --body fileb:///tmp/facegate-openapi.yaml >/dev/null
awslocal apigateway create-deployment --rest-api-id "$API_ID" --stage-name "$STAGE" \
  --description "Implantado pelo init hook" >/dev/null

# Autoriza o API Gateway a invocar a Lambda
awslocal lambda remove-permission --function-name "$LAMBDA_API" \
  --statement-id apigateway-facegate >/dev/null 2>&1 || true
awslocal lambda add-permission --function-name "$LAMBDA_API" --statement-id apigateway-facegate \
  --action lambda:InvokeFunction --principal apigateway.amazonaws.com \
  --source-arn "arn:aws:execute-api:$REGIAO:$CONTA:$API_ID/*" >/dev/null
log "✔ API GW    API REST '$API_ID' (stage $STAGE) → $LAMBDA_API"

# -----------------------------------------------------------------------------
# 7. Aquecimento: a 1ª invocação baixa a imagem do runtime e sobe os
#    contêineres das Lambdas. Assim, o primeiro uso real já é rápido.
# -----------------------------------------------------------------------------
log "… aquecendo as Lambdas (na primeira execução o runtime $RUNTIME é baixado)"
if curl -sf -o /dev/null --max-time 180 "http://localhost:4566/_aws/execute-api/$API_ID/$STAGE/sistema"; then
  log "✔ Aquecida  $LAMBDA_API (via API Gateway)"
else
  log "⚠ Não foi possível aquecer $LAMBDA_API agora; ela será iniciada no primeiro uso"
fi
echo '{"Records": []}' > /tmp/facegate-aquecimento.json
if awslocal lambda invoke --function-name "$LAMBDA_PROCESSADOR" \
  --payload fileb:///tmp/facegate-aquecimento.json /tmp/facegate-aquecimento-saida.json >/dev/null 2>&1; then
  log "✔ Aquecida  $LAMBDA_PROCESSADOR"
else
  log "⚠ Não foi possível aquecer $LAMBDA_PROCESSADOR agora; ela será iniciada no primeiro uso"
fi

log "================================================================"
log " Infraestrutura pronta em ${SECONDS}s"
log " Aplicação: http://localhost:${FACEGATE_PORTA:-8088}"
log " API:       http://localhost:4566/_aws/execute-api/$API_ID/$STAGE"
log "================================================================"
