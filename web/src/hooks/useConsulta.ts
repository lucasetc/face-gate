import { useCallback, useEffect, useRef, useState } from 'react'
import { comoErroApi, type ErroApi } from '../api'

export interface Consulta<T> {
  dados: T | undefined
  erro: ErroApi | null
  carregando: boolean
  recarregar: () => Promise<void>
}

interface Estado<T> {
  chave?: string
  dados?: T
  erro: ErroApi | null
}

/**
 * Busca dados na API e, opcionalmente, atualiza a cada `intervaloMs`.
 * - `chave` identifica a consulta: quando muda (ex.: outro dia), busca de novo.
 * - Respostas fora de ordem são descartadas: só vale a mais recente.
 * - A atualização automática pausa enquanto a aba do navegador está oculta.
 */
export function useConsulta<T>(chave: string, buscar: () => Promise<T>, intervaloMs = 0): Consulta<T> {
  const [estado, setEstado] = useState<Estado<T>>({ erro: null })
  const buscaAtual = useRef(buscar)
  const chaveAtual = useRef(chave)
  const sequencia = useRef(0)

  useEffect(() => {
    buscaAtual.current = buscar
    chaveAtual.current = chave
  })

  const recarregar = useCallback(async () => {
    const minhaVez = ++sequencia.current
    const chaveDaBusca = chaveAtual.current
    try {
      const dados = await buscaAtual.current()
      if (minhaVez === sequencia.current) setEstado({ chave: chaveDaBusca, dados, erro: null })
    } catch (erro) {
      if (minhaVez !== sequencia.current) return
      setEstado((anterior) => ({
        chave: chaveDaBusca,
        dados: anterior.chave === chaveDaBusca ? anterior.dados : undefined,
        erro: comoErroApi(erro),
      }))
    }
  }, [])

  useEffect(() => {
    void recarregar()
  }, [chave, recarregar])

  useEffect(() => {
    if (!intervaloMs) return
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void recarregar()
    }, intervaloMs)
    return () => window.clearInterval(id)
  }, [intervaloMs, recarregar])

  const atual = estado.chave === chave
  return {
    dados: atual ? estado.dados : undefined,
    erro: atual ? estado.erro : null,
    carregando: !atual,
    recarregar,
  }
}
