import { useSyncExternalStore } from 'react'

export const ROTAS = ['portaria', 'moradores', 'historico', 'infraestrutura'] as const
export type Rota = (typeof ROTAS)[number]

function rotaAtual(): Rota {
  const nome = window.location.hash.replace(/^#\/?/, '')
  return (ROTAS as readonly string[]).includes(nome) ? (nome as Rota) : 'portaria'
}

function assinar(aoMudar: () => void) {
  window.addEventListener('hashchange', aoMudar)
  return () => window.removeEventListener('hashchange', aoMudar)
}

/** Roteamento mínimo por hash (#/moradores): sem biblioteca e sem configuração no servidor. */
export function useRota(): Rota {
  return useSyncExternalStore(assinar, rotaAtual)
}
