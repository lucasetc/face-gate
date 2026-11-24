import { CircleCheck, CircleX, Info, X } from 'lucide-react'
import { useCallback, useRef, useState, type ReactNode } from 'react'
import { ContextoAvisos, type Avisar, type TipoAviso } from '../hooks/useAvisos'

interface Aviso {
  id: number
  mensagem: string
  tipo: TipoAviso
}

const ICONES = { sucesso: CircleCheck, erro: CircleX, info: Info }
const DURACAO_MS = 4500

/** Provedor dos avisos rápidos (toasts), anunciados também a leitores de tela. */
export function ProvedorAvisos({ children }: { children: ReactNode }) {
  const [avisos, setAvisos] = useState<Aviso[]>([])
  const proximoId = useRef(0)

  const remover = useCallback((id: number) => setAvisos((lista) => lista.filter((aviso) => aviso.id !== id)), [])

  const avisar = useCallback<Avisar>(
    (mensagem, tipo = 'sucesso') => {
      const id = ++proximoId.current
      setAvisos((lista) => [...lista.slice(-2), { id, mensagem, tipo }])
      window.setTimeout(() => remover(id), DURACAO_MS)
    },
    [remover],
  )

  return (
    <ContextoAvisos value={avisar}>
      {children}
      <div className="avisos" role="status" aria-live="polite">
        {avisos.map((aviso) => {
          const Icone = ICONES[aviso.tipo]
          return (
            <div key={aviso.id} className={`aviso aviso--${aviso.tipo}`}>
              <Icone size={20} aria-hidden="true" />
              <span>{aviso.mensagem}</span>
              <button type="button" className="botao-icone" onClick={() => remover(aviso.id)} aria-label="Dispensar">
                <X size={16} aria-hidden="true" />
              </button>
            </div>
          )
        })}
      </div>
    </ContextoAvisos>
  )
}
