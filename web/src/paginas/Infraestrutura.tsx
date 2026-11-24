import {
  Check,
  Copy,
  Cpu,
  Database,
  HardDrive,
  Monitor,
  Network,
  ScanFace,
  Send,
  Server,
  Terminal,
  type LucideIcon,
} from 'lucide-react'
import { useState } from 'react'
import { api } from '../api'
import { FalhaAoCarregar } from '../componentes/Estados'
import { Selo } from '../componentes/Selo'
import { formatarDecimal } from '../formatos'
import { useAvisos } from '../hooks/useAvisos'
import { useConsulta } from '../hooks/useConsulta'

const ATUALIZACAO_MS = 5000

/** Serviços que o FaceGate usa (o restante do LocalStack fica desligado). */
const SERVICOS_DO_PROJETO = ['apigateway', 'lambda', 'dynamodb', 's3', 'sqs', 'logs', 'iam', 'sts']

const COMANDOS = [
  {
    rotulo: 'Rotas do API Gateway',
    comando: 'docker exec facegate-localstack awslocal apigateway get-resources --rest-api-id facegate --query "items[].path"',
  },
  {
    rotulo: 'Funções Lambda',
    comando:
      'docker exec facegate-localstack awslocal lambda list-functions --query "Functions[].[FunctionName,Runtime,Timeout]" --output table',
  },
  {
    rotulo: 'Histórico gravado no DynamoDB',
    comando: 'docker exec facegate-localstack awslocal dynamodb scan --table-name facegate-acessos --max-items 3',
  },
  {
    rotulo: 'Fotos de referência no S3',
    comando: 'docker exec facegate-localstack awslocal s3 ls s3://facegate-referencias/moradores/',
  },
  {
    rotulo: 'Notificações geradas pela Lambda de eventos (CloudWatch Logs)',
    comando:
      'docker exec facegate-localstack awslocal logs filter-log-events --log-group-name /aws/lambda/facegate-event-processor --filter-pattern NOTIFICACAO_ENVIADA --query "events[].message" --output text',
  },
  {
    rotulo: 'Script de provisionamento (init hook)',
    comando: 'docker compose logs localstack | findstr FaceGate',
  },
]

type Situacao = 'ok' | 'erro' | 'carregando'

export function Infraestrutura() {
  const sistema = useConsulta('sistema', api.statusSistema, ATUALIZACAO_MS)
  const saude = useConsulta('saude', api.saudeLocalStack, ATUALIZACAO_MS)

  const s = sistema.dados
  const servicos = saude.dados?.services ?? {}
  const situacao = (ok: boolean | undefined): Situacao =>
    ok === undefined && (sistema.carregando || saude.carregando) ? 'carregando' : ok ? 'ok' : 'erro'
  const rodando = (nome: string) => ['running', 'available'].includes(servicos[nome] ?? '')
  const apiNoAr = Boolean(s) && !sistema.erro

  return (
    <div className="pagina">
      <header className="pagina__cabecalho">
        <div className="pagina__titulo">
          <h1>Infraestrutura</h1>
          <p>
            Arquitetura da seção 3 do projeto, com o estado de cada serviço AWS emulado no LocalStack, atualizado a cada
            5 s.
          </p>
        </div>
        {saude.dados && (
          <Selo tom="info" icone={Server}>
            LocalStack {saude.dados.version} · {saude.dados.edition}
          </Selo>
        )}
      </header>

      {sistema.erro && <FalhaAoCarregar erro={sistema.erro} aoTentarNovamente={sistema.recarregar} />}

      <section className="cartao arquitetura" aria-label="Diagrama da arquitetura">
        <div className="arquitetura__linha">
          <No categoria="Terminal" nome="React + câmera" icone={Monitor} situacao="ok" detalhe="Esta aplicação" seta />
          <No
            categoria="Entrada"
            nome="API Gateway"
            icone={Network}
            situacao={situacao(s ? apiNoAr && rodando('apigateway') : undefined)}
            detalhe="API REST facegate · stage dev"
            seta
          />
          <No
            categoria="Controle"
            nome="Lambda facegate-api"
            icone={Cpu}
            situacao={situacao(s ? apiNoAr && rodando('lambda') : undefined)}
            detalhe="Python 3.13 · regras de acesso"
            seta
          />
          <No
            categoria="Biometria"
            nome="face-service"
            icone={ScanFace}
            situacao={situacao(s?.faceService.ok)}
            detalhe={s?.faceService.opencv ? `OpenCV ${s.faceService.opencv} · YuNet + SFace` : 'FastAPI + OpenCV'}
          />
        </div>

        <div className="arquitetura__barramento" aria-hidden="true">
          <span className="arquitetura__horizontal" />
          <span className="arquitetura__subida" />
          <span className="arquitetura__descida arquitetura__descida--1" />
          <span className="arquitetura__descida arquitetura__descida--2" />
          <span className="arquitetura__descida arquitetura__descida--3" />
          <span className="arquitetura__rotulo">Consultas, decisões e gravação de eventos</span>
        </div>

        <div className="arquitetura__linha">
          <No
            categoria="Armazenamento"
            nome="Amazon S3"
            icone={HardDrive}
            situacao={situacao(s?.s3.ok)}
            detalhe={s?.s3.ok ? `${s.s3.fotos} foto(s) de referência` : 'facegate-referencias'}
          />
          <No
            categoria="Banco NoSQL"
            nome="DynamoDB"
            icone={Database}
            situacao={situacao(s?.dynamodb.ok)}
            detalhe={
              s?.dynamodb.ok ? `${s.dynamodb.moradores} morador(es) · ${s.dynamodb.acessosHoje} acesso(s) hoje` : 'Moradores e acessos'
            }
          />
          <No
            categoria="Mensageria"
            nome="Amazon SQS"
            icone={Send}
            situacao={situacao(s?.sqs.ok)}
            detalhe={s?.sqs.ok ? `${s.sqs.mensagens} na fila · ${s.sqs.mensagensDlq} na DLQ` : 'facegate-eventos'}
            seta
            assincrono
          />
          <No
            categoria="Notificações"
            nome="Lambda de eventos"
            icone={Cpu}
            situacao={situacao(s ? s.lambda.estado === 'Active' : undefined)}
            detalhe={s?.lambda.estado ? `facegate-event-processor · ${s.lambda.estado}` : 'facegate-event-processor'}
          />
        </div>

        <p className="arquitetura__legenda">
          <span>
            <span className="legenda legenda--sincrono" /> Fluxo síncrono: solicitação, reconhecimento e resposta
          </span>
          <span>
            <span className="legenda legenda--assincrono" /> Fluxo assíncrono: o SQS aciona a Lambda de notificações
          </span>
        </p>
      </section>

      <div className="grade-dupla">
        <section className="cartao">
          <header className="cartao__cabecalho">
            <h2>
              <Server size={18} aria-hidden="true" /> LocalStack
            </h2>
          </header>
          <div className="cartao__corpo">
            <dl className="dados-chave">
              <div>
                <dt>Versão</dt>
                <dd>{saude.dados ? `${saude.dados.version} (${saude.dados.edition})` : '—'}</dd>
              </div>
              <div>
                <dt>Região</dt>
                <dd>{s?.regiao ?? '—'}</dd>
              </div>
              <div>
                <dt>Endpoint</dt>
                <dd>
                  <code>http://localhost:4566</code>
                </dd>
              </div>
              <div>
                <dt>Limiar facial</dt>
                <dd>{s ? formatarDecimal(s.limiarSimilaridade, 3) : '—'}</dd>
              </div>
            </dl>
            <ul className="servicos" aria-label="Serviços emulados">
              {SERVICOS_DO_PROJETO.map((nome) => {
                const estado = servicos[nome]
                const ok = rodando(nome)
                return (
                  <li key={nome}>
                    <span>{nome}</span>
                    <Selo tom={ok ? 'sucesso' : estado ? 'alerta' : 'neutro'}>{estado ?? '…'}</Selo>
                  </li>
                )
              })}
            </ul>
          </div>
        </section>

        <section className="cartao">
          <header className="cartao__cabecalho">
            <h2>
              <Terminal size={18} aria-hidden="true" /> Comandos para a demonstração
            </h2>
          </header>
          <div className="cartao__corpo comandos">
            {COMANDOS.map(({ rotulo, comando }) => (
              <Comando key={rotulo} rotulo={rotulo} comando={comando} />
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}

function No({
  categoria,
  nome,
  icone: Icone,
  situacao,
  detalhe,
  seta = false,
  assincrono = false,
}: {
  categoria: string
  nome: string
  icone: LucideIcon
  situacao: Situacao
  detalhe: string
  seta?: boolean
  assincrono?: boolean
}) {
  const descricao = { ok: 'em funcionamento', erro: 'com problema', carregando: 'verificando' }[situacao]
  return (
    <div className={`no${seta ? ' no--seta' : ''}${assincrono ? ' no--assincrono' : ''}`}>
      <div className="no__topo">
        <span className="no__categoria">{categoria}</span>
        <span className={`no__ponto no__ponto--${situacao}`} role="img" aria-label={descricao} />
      </div>
      <div className="no__nome">
        <Icone size={18} aria-hidden="true" /> {nome}
      </div>
      <div className="no__detalhe">{detalhe}</div>
    </div>
  )
}

function Comando({ rotulo, comando }: { rotulo: string; comando: string }) {
  const [copiado, setCopiado] = useState(false)
  const avisar = useAvisos()

  async function copiar() {
    try {
      await navigator.clipboard.writeText(comando)
      setCopiado(true)
      window.setTimeout(() => setCopiado(false), 2000)
    } catch {
      avisar('Não foi possível copiar. Selecione o texto manualmente.', 'erro')
    }
  }

  return (
    <div className="comando">
      <span className="comando__rotulo">{rotulo}</span>
      <div className="comando__linha">
        <code>{comando}</code>
        <button type="button" className="botao-icone" onClick={() => void copiar()} aria-label={`Copiar: ${rotulo}`}>
          {copiado ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
        </button>
      </div>
    </div>
  )
}
