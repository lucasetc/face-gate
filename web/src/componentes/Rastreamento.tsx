import { CircleCheck, CircleX, Cpu, Database, Network, ScanFace, Send, type LucideIcon } from 'lucide-react'
import { formatarMs } from '../formatos'
import type { EtapaRastreamento } from '../tipos'

const SERVICOS: Record<string, { nome: string; icone: LucideIcon }> = {
  apigateway: { nome: 'API Gateway', icone: Network },
  dynamodb: { nome: 'DynamoDB', icone: Database },
  'face-service': { nome: 'face-service', icone: ScanFace },
  lambda: { nome: 'Lambda', icone: Cpu },
  sqs: { nome: 'SQS', icone: Send },
}

interface Props {
  etapas: EtapaRastreamento[]
  /** Tempo total medido no navegador (inclui API Gateway e rede). */
  totalMs: number
}

/** Mostra por quais serviços AWS a requisição passou e quanto tempo levou em cada um. */
export function Rastreamento({ etapas, totalMs }: Props) {
  const somaDasEtapas = etapas.reduce((soma, etapa) => soma + etapa.ms, 0)
  const lista: EtapaRastreamento[] = [
    {
      servico: 'apigateway',
      descricao: 'Entrada HTTP, invocação da Lambda e rede',
      ms: Math.max(0, totalMs - somaDasEtapas),
      ok: true,
    },
    ...etapas,
  ]
  const maior = Math.max(...lista.map((etapa) => etapa.ms), 1)

  return (
    <ol className="rastreio">
      {lista.map((etapa, indice) => {
        const servico = SERVICOS[etapa.servico] ?? { nome: etapa.servico, icone: Cpu }
        const Icone = servico.icone
        return (
          <li key={indice} className={`rastreio__etapa${etapa.ok ? '' : ' rastreio__etapa--erro'}`}>
            <span className={`rastreio__icone rastreio__icone--${etapa.servico}`}>
              <Icone size={16} aria-hidden="true" />
            </span>
            <span className="rastreio__texto">
              <strong>{servico.nome}</strong>
              <span>{etapa.descricao}</span>
            </span>
            <span className="rastreio__tempo">{formatarMs(etapa.ms)}</span>
            {etapa.ok ? (
              <CircleCheck className="rastreio__ok" size={18} aria-label="Concluída" />
            ) : (
              <CircleX className="rastreio__falha" size={18} aria-label="Falhou" />
            )}
            <span className="rastreio__barra" style={{ width: `${(etapa.ms / maior) * 100}%` }} aria-hidden="true" />
          </li>
        )
      })}
    </ol>
  )
}
