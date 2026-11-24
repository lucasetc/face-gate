// Tipos dos dados trocados com a API (espelham os itens do DynamoDB).

export type StatusMorador = 'ATIVO' | 'INATIVO'
export type Resultado = 'AUTORIZADO' | 'NEGADO'
export type Motivo =
  | 'RECONHECIDO'
  | 'NAO_RECONHECIDO'
  | 'CADASTRO_INATIVO'
  | 'NENHUM_ROSTO'
  | 'MULTIPLOS_ROSTOS'
  | 'ROSTO_DISTANTE'
  | 'IMAGEM_INVALIDA'
  | 'FALHA_SERVICO'

export interface Morador {
  moradorId: string
  nome: string
  unidade: string
  status: StatusMorador
  fotoUrl: string | null
  consentimentoEm: string
  criadoEm: string
  atualizadoEm: string
}

export interface EtapaRastreamento {
  servico: string // dynamodb | face-service | lambda | sqs
  descricao: string
  ms: number
  ok: boolean
}

export interface RespostaValidacao {
  acessoId?: string
  dataHora?: string
  resultado: Resultado
  motivo: Motivo
  mensagem: string
  morador?: Pick<Morador, 'moradorId' | 'nome' | 'unidade'> | null
  similaridade?: number | null
  limiar: number
  rastreamento: EtapaRastreamento[]
}

export interface Acesso {
  acessoId: string
  dia: string
  dataHora: string
  resultado: Resultado
  motivo: Motivo
  moradorId?: string
  nome?: string
  unidade?: string
  similaridade?: number
  notificacao?: string // preenchida pela Lambda de eventos (via SQS)
  processadoEm?: string
}

interface Parte {
  ok: boolean
  erro?: string
}

export interface StatusSistema {
  regiao: string
  limiarSimilaridade: number
  faceService: { ok: boolean; opencv?: string; modelos?: Record<string, string> }
  dynamodb: Parte & { tabelas?: string[]; moradores?: number; acessosHoje?: number }
  s3: Parte & { bucket?: string; fotos?: number }
  sqs: Parte & { fila?: string; mensagens?: number; emProcessamento?: number; dlq?: string; mensagensDlq?: number }
  lambda: Parte & { processador?: string; estado?: string }
}

export interface SaudeLocalStack {
  edition: string
  version: string
  services: Record<string, string>
}
