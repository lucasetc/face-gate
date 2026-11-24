// Cliente da API do FaceGate. Tudo passa por /api, que o Nginx (ou o Vite, em
// desenvolvimento) encaminha para o API Gateway do LocalStack.
import type { Acesso, Morador, RespostaValidacao, SaudeLocalStack, StatusMorador, StatusSistema } from './tipos'

/** Erro da API (ou de rede) com código e mensagem prontos para exibir. */
export class ErroApi extends Error {
  readonly status: number
  readonly codigo: string
  readonly campo?: string
  readonly corpo?: unknown

  constructor(status: number, codigo: string, mensagem: string, campo?: string, corpo?: unknown) {
    super(mensagem)
    this.name = 'ErroApi'
    this.status = status
    this.codigo = codigo
    this.campo = campo
    this.corpo = corpo
  }
}

export function comoErroApi(erro: unknown): ErroApi {
  if (erro instanceof ErroApi) return erro
  return new ErroApi(0, 'ERRO_INESPERADO', erro instanceof Error ? erro.message : 'Erro inesperado.')
}

interface CorpoDeErro {
  erro?: { codigo?: string; mensagem?: string; campo?: string }
  mensagem?: string
}

async function requisitar<T>(url: string, opcoes: RequestInit = {}): Promise<T> {
  let resposta: Response
  try {
    resposta = await fetch(url, {
      ...opcoes,
      headers: opcoes.body ? { 'Content-Type': 'application/json' } : undefined,
    })
  } catch {
    throw new ErroApi(0, 'SEM_CONEXAO', 'Sem conexão com a API. O ambiente está no ar (docker compose up)?')
  }
  if (resposta.status === 204) return undefined as T

  const corpo: unknown = await resposta.json().catch(() => null)
  if (!resposta.ok) {
    const { erro, mensagem } = (corpo ?? {}) as CorpoDeErro
    throw new ErroApi(
      resposta.status,
      erro?.codigo ?? `HTTP_${resposta.status}`,
      erro?.mensagem ?? mensagem ?? mensagemPorStatus(resposta.status),
      erro?.campo,
      corpo,
    )
  }
  return corpo as T
}

function mensagemPorStatus(status: number): string {
  if (status === 502 || status === 503 || status === 504) {
    return 'O LocalStack não respondeu. Ele pode estar inicializando: aguarde alguns segundos.'
  }
  return `A API respondeu com erro ${status}.`
}

const corpoJson = (dados: unknown): RequestInit => ({ body: JSON.stringify(dados) })
const moradorUrl = (id: string) => `/api/moradores/${encodeURIComponent(id)}`

export const api = {
  listarMoradores: () => requisitar<{ moradores: Morador[] }>('/api/moradores').then((r) => r.moradores),

  cadastrarMorador: (dados: { nome: string; unidade: string; imagem: string; consentimento: boolean }) =>
    requisitar<Morador>('/api/moradores', { method: 'POST', ...corpoJson(dados) }),

  alterarStatus: (id: string, status: StatusMorador) =>
    requisitar<Morador>(moradorUrl(id), { method: 'PATCH', ...corpoJson({ status }) }),

  excluirMorador: (id: string) => requisitar<void>(moradorUrl(id), { method: 'DELETE' }),

  listarAcessos: (dia: string) =>
    requisitar<{ dia: string; acessos: Acesso[] }>(`/api/acessos?dia=${encodeURIComponent(dia)}`).then(
      (r) => r.acessos,
    ),

  statusSistema: () => requisitar<StatusSistema>('/api/sistema'),

  saudeLocalStack: () => requisitar<SaudeLocalStack>('/localstack/health'),

  /** Fail-closed também no navegador: qualquer falha resulta em acesso NEGADO. */
  async validarAcesso(imagem: string): Promise<RespostaValidacao> {
    try {
      return await requisitar<RespostaValidacao>('/api/acessos/validar', { method: 'POST', ...corpoJson({ imagem }) })
    } catch (e) {
      const erro = comoErroApi(e)
      const corpo = (erro.corpo ?? {}) as Partial<RespostaValidacao>
      return {
        resultado: 'NEGADO',
        motivo: corpo.motivo ?? (erro.status === 400 ? 'IMAGEM_INVALIDA' : 'FALHA_SERVICO'),
        mensagem: corpo.mensagem ?? erro.message,
        limiar: corpo.limiar ?? 0,
        rastreamento: corpo.rastreamento ?? [],
        similaridade: null,
        morador: null,
      }
    }
  },
}
