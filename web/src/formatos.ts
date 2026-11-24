// Formatação de datas, números e textos exibidos na interface (pt-BR).
import type { Motivo } from './tipos'

/** Fuso de Palmas-TO: UTC-3, sem horário de verão. */
export const FUSO = 'America/Araguaina'

/** O backend grava microssegundos; o Date do JavaScript aceita só milissegundos. */
export function paraData(iso: string): Date {
  return new Date(iso.replace(/(\.\d{3})\d+/, '$1'))
}

const formatoHora = new Intl.DateTimeFormat('pt-BR', {
  timeZone: FUSO,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})
const formatoData = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, dateStyle: 'short' })
const formatoDiaIso = new Intl.DateTimeFormat('en-CA', {
  timeZone: FUSO,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export const formatarHora = (iso: string) => formatoHora.format(paraData(iso))
export const formatarData = (iso: string) => formatoData.format(paraData(iso))

/** Data de hoje no fuso do condomínio, no formato AAAA-MM-DD. */
export const hojeIso = () => formatoDiaIso.format(new Date())

/** "2026-11-23" → "23/11/2026" (sem conversão de fuso). */
export const formatarDia = (dia: string) => dia.split('-').reverse().join('/')

export const formatarDecimal = (valor: number, casas = 2) =>
  valor.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })

export const formatarMs = (ms: number) => (ms < 1000 ? `${Math.round(ms)} ms` : `${formatarDecimal(ms / 1000, 1)} s`)

/** Segundos decorridos entre dois instantes ISO. */
export const segundosEntre = (inicio: string, fim: string) =>
  (paraData(fim).getTime() - paraData(inicio).getTime()) / 1000

export const iniciais = (nome: string) =>
  nome
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((parte) => parte[0]?.toUpperCase())
    .join('')

/** Remove acentos e caixa para buscas ("João" encontra "joao"). */
export const normalizarBusca = (texto: string) =>
  texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()

export const ROTULO_MOTIVO: Record<Motivo, string> = {
  RECONHECIDO: 'Reconhecido',
  NAO_RECONHECIDO: 'Não reconhecido',
  CADASTRO_INATIVO: 'Cadastro inativo',
  NENHUM_ROSTO: 'Nenhum rosto',
  MULTIPLOS_ROSTOS: 'Vários rostos',
  ROSTO_DISTANTE: 'Rosto distante',
  IMAGEM_INVALIDA: 'Imagem inválida',
  FALHA_SERVICO: 'Falha no serviço',
}

export const DICA_MOTIVO: Partial<Record<Motivo, string>> = {
  NAO_RECONHECIDO: 'Se você é morador, procure a administração para fazer o cadastro.',
  CADASTRO_INATIVO: 'Procure a administração para regularizar o cadastro.',
  NENHUM_ROSTO: 'Centralize o rosto na moldura, com boa iluminação e sem obstruções.',
  MULTIPLOS_ROSTOS: 'Peça para as outras pessoas saírem do enquadramento.',
  ROSTO_DISTANTE: 'Aproxime-se da câmera até o rosto preencher a moldura.',
  IMAGEM_INVALIDA: 'Tente capturar a imagem novamente.',
  FALHA_SERVICO: 'O portão permanece fechado por segurança. Tente novamente em instantes.',
}
