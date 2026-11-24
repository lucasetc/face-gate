export type EstadoPortao = 'fechado' | 'verificando' | 'aberto' | 'negado'

const DESCRICAO: Record<EstadoPortao, string> = {
  fechado: 'Portão fechado',
  verificando: 'Portão fechado, verificando identidade',
  aberto: 'Portão aberto',
  negado: 'Portão fechado, acesso negado',
}

/** Simulação visual do portão (não há fechadura real: seção 9 do projeto). */
export function Portao({ estado }: { estado: EstadoPortao }) {
  return (
    <div className={`portao portao--${estado}`} role="img" aria-label={DESCRICAO[estado]}>
      <span className="portao__luz" />
      <div className="portao__vao">
        <div className="portao__folha portao__folha--esquerda" />
        <div className="portao__folha portao__folha--direita" />
      </div>
      <div className="portao__piso" />
    </div>
  )
}
