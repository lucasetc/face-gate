import { X } from 'lucide-react'
import { useEffect, useId, useRef, type ReactNode } from 'react'

interface Props {
  aberto: boolean
  aoFechar: () => void
  titulo: string
  descricao?: string
  largura?: 'normal' | 'larga'
  /** Impede o fechamento (ex.: enquanto os dados são enviados). */
  bloqueado?: boolean
  children: ReactNode
}

/**
 * Janela modal baseada no <dialog> nativo: foco, Esc e acessibilidade prontos.
 * Fecha pelo botão X, pela tecla Esc ou pelas ações do conteúdo. O clique fora da
 * janela é ignorado de propósito, para não perder um formulário por acidente.
 */
export function Dialogo({ aberto, aoFechar, titulo, descricao, largura = 'normal', bloqueado = false, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const idTitulo = useId()

  useEffect(() => {
    const dialogo = ref.current
    if (!dialogo) return
    if (aberto && !dialogo.open) dialogo.showModal()
    if (!aberto && dialogo.open) dialogo.close()
  }, [aberto])

  const fechar = () => {
    if (!bloqueado) aoFechar()
  }

  return (
    <dialog
      ref={ref}
      className={`dialogo dialogo--${largura}`}
      aria-labelledby={idTitulo}
      onCancel={(evento) => {
        evento.preventDefault() // a tecla Esc passa pela mesma regra do botão Fechar
        fechar()
      }}
      onClose={() => aberto && aoFechar()}
    >
      {aberto && (
        <div className="dialogo__conteudo">
          <header className="dialogo__cabecalho">
            <div>
              <h2 id={idTitulo}>{titulo}</h2>
              {descricao && <p>{descricao}</p>}
            </div>
            <button type="button" className="botao-icone" onClick={fechar} disabled={bloqueado} aria-label="Fechar">
              <X size={20} aria-hidden="true" />
            </button>
          </header>
          {children}
        </div>
      )}
    </dialog>
  )
}
