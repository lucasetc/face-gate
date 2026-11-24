import { ListClock, ScanFace, Server, Users, type LucideIcon } from 'lucide-react'
import { useEffect, type ComponentType } from 'react'
import { api } from './api'
import { ProvedorAvisos } from './componentes/Avisos'
import { Logo } from './componentes/Logo'
import { useConsulta } from './hooks/useConsulta'
import { ROTAS, useRota, type Rota } from './hooks/useRota'
import { Historico } from './paginas/Historico'
import { Infraestrutura } from './paginas/Infraestrutura'
import { Moradores } from './paginas/Moradores'
import { Portaria } from './paginas/Portaria'

const PAGINAS: Record<Rota, { titulo: string; icone: LucideIcon; Pagina: ComponentType }> = {
  portaria: { titulo: 'Portaria', icone: ScanFace, Pagina: Portaria },
  moradores: { titulo: 'Moradores', icone: Users, Pagina: Moradores },
  historico: { titulo: 'Histórico', icone: ListClock, Pagina: Historico },
  infraestrutura: { titulo: 'Infraestrutura', icone: Server, Pagina: Infraestrutura },
}

export function App() {
  const rota = useRota()
  const { titulo, Pagina } = PAGINAS[rota]

  useEffect(() => {
    document.title = `${titulo} · FaceGate`
    window.scrollTo(0, 0)
  }, [titulo])

  return (
    <ProvedorAvisos>
      <div className="app">
        <aside className="lateral">
          <a className="marca" href="#/portaria" aria-label="FaceGate, ir para a Portaria">
            <Logo className="marca__logo" />
            <span>
              <span className="marca__nome">FACEGATE</span>
              <span className="marca__sub">Portaria inteligente</span>
            </span>
          </a>

          <nav className="navegacao" aria-label="Seções">
            {ROTAS.map((chave) => {
              const { titulo: rotulo, icone: Icone } = PAGINAS[chave]
              return (
                <a key={chave} href={`#/${chave}`} aria-current={rota === chave ? 'page' : undefined}>
                  <Icone size={19} aria-hidden="true" /> {rotulo}
                </a>
              )
            })}
          </nav>

          <div className="lateral__rodape">
            <StatusLocalStack />
            <p className="creditos">Projeto acadêmico · Computação em Nuvem · 2026/2</p>
          </div>
        </aside>

        <main className="principal">
          <Pagina />
        </main>
      </div>
    </ProvedorAvisos>
  )
}

/** Indicador permanente de conexão com o LocalStack (consulta /_localstack/health). */
function StatusLocalStack() {
  const saude = useConsulta('saude-localstack', api.saudeLocalStack, 10_000)
  const situacao = saude.dados && !saude.erro ? 'ok' : saude.carregando ? 'carregando' : 'erro'
  const titulo = {
    ok: `LocalStack ${saude.dados?.version ?? ''}`,
    carregando: 'Conectando…',
    erro: 'LocalStack fora do ar',
  }[situacao]
  const detalhe = {
    ok: `${saude.dados?.edition ?? ''} · us-east-1`,
    carregando: 'Verificando os serviços',
    erro: 'Execute: docker compose up',
  }[situacao]

  return (
    <a
      className={`status-ls status-ls--${situacao}`}
      href="#/infraestrutura"
      aria-label={`${titulo}. ${detalhe}. Ver a infraestrutura`}
    >
      <span className="status-ls__ponto" aria-hidden="true" />
      <span>
        <strong>{titulo}</strong>
        <small>{detalhe}</small>
      </span>
    </a>
  )
}
