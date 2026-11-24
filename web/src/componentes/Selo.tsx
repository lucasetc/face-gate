import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

type Tom = 'sucesso' | 'perigo' | 'alerta' | 'info' | 'neutro'

/** Etiqueta de status: sempre cor + ícone + texto (não depende só da cor). */
export function Selo({ tom, icone: Icone, children }: { tom: Tom; icone?: LucideIcon; children: ReactNode }) {
  return (
    <span className={`selo selo--${tom}`}>
      {Icone && <Icone size={14} aria-hidden="true" />}
      {children}
    </span>
  )
}
