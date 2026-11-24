import { CloudOff, RefreshCw, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import type { ErroApi } from '../api'

/** Mensagem para quando ainda não há dados (com uma ação sugerida). */
export function Vazio({
  icone: Icone,
  titulo,
  children,
  acao,
}: {
  icone: LucideIcon
  titulo: string
  children?: ReactNode
  acao?: ReactNode
}) {
  return (
    <div className="estado">
      <span className="estado__icone">
        <Icone size={26} aria-hidden="true" />
      </span>
      <h3>{titulo}</h3>
      {children && <p>{children}</p>}
      {acao}
    </div>
  )
}

/** Faixa de erro com opção de tentar novamente. */
export function FalhaAoCarregar({ erro, aoTentarNovamente }: { erro: ErroApi; aoTentarNovamente: () => void }) {
  return (
    <div className="faixa-erro" role="alert">
      <CloudOff size={20} aria-hidden="true" />
      <span>{erro.message}</span>
      <button type="button" className="botao botao--secundario botao--pequeno" onClick={aoTentarNovamente}>
        <RefreshCw size={14} aria-hidden="true" /> Tentar novamente
      </button>
    </div>
  )
}

/** Blocos "esqueleto" exibidos enquanto os dados carregam. */
export function Esqueleto({ linhas = 3, altura = 56 }: { linhas?: number; altura?: number }) {
  return (
    <div className="esqueletos" aria-busy="true" aria-label="Carregando">
      {Array.from({ length: linhas }, (_, indice) => (
        <div key={indice} className="esqueleto" style={{ height: altura }} />
      ))}
    </div>
  )
}
