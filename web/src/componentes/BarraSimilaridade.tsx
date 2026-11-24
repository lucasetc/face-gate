import { formatarDecimal } from '../formatos'

const percentual = (valor: number) => `${Math.min(1, Math.max(0, valor)) * 100}%`

/** Similaridade de cosseno (SFace) com a marcação do limiar de reconhecimento. */
export function BarraSimilaridade({ valor, limiar }: { valor: number; limiar: number }) {
  const reconhecido = valor >= limiar
  return (
    <div className="similaridade">
      <div className="similaridade__rotulos">
        <span>Similaridade facial</span>
        <strong>{formatarDecimal(valor)}</strong>
      </div>
      <div
        className="similaridade__trilho"
        role="meter"
        aria-label="Similaridade facial"
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={valor}
      >
        <div
          className={`similaridade__barra${reconhecido ? ' similaridade__barra--ok' : ''}`}
          style={{ width: percentual(valor) }}
        />
        <div className="similaridade__limiar" style={{ left: percentual(limiar) }} />
      </div>
      <small>
        Limiar de reconhecimento: {formatarDecimal(limiar, 3)} ({reconhecido ? 'atingido' : 'não atingido'})
      </small>
    </div>
  )
}
