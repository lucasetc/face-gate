import { createContext, useContext } from 'react'

export type TipoAviso = 'sucesso' | 'erro' | 'info'
export type Avisar = (mensagem: string, tipo?: TipoAviso) => void

export const ContextoAvisos = createContext<Avisar>(() => undefined)

/** Exibe avisos rápidos (toasts) no canto da tela. */
export const useAvisos = () => useContext(ContextoAvisos)
