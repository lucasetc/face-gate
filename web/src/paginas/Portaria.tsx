import { Activity, DoorOpen, ImageUp, Info, Keyboard, LoaderCircle, ScanFace, ShieldX, type LucideIcon } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { api } from '../api'
import { BarraSimilaridade } from '../componentes/BarraSimilaridade'
import { Camera } from '../componentes/Camera'
import { Portao, type EstadoPortao } from '../componentes/Portao'
import { Rastreamento } from '../componentes/Rastreamento'
import { Selo } from '../componentes/Selo'
import { DICA_MOTIVO, formatarMs, iniciais } from '../formatos'
import { useAvisos } from '../hooks/useAvisos'
import { useCamera } from '../hooks/useCamera'
import { arquivoParaJpeg } from '../imagem'
import type { RespostaValidacao } from '../tipos'

/** Tempo que o resultado fica na tela antes de o terminal voltar a aguardar. */
const TEMPO_DO_RESULTADO_MS = 6000

type Fase = 'aguardando' | 'verificando' | 'resultado'

interface Tentativa {
  resposta: RespostaValidacao
  totalMs: number
  numero: number
}

export function Portaria() {
  const { videoRef, estado: estadoCamera, capturar } = useCamera()
  const [fase, setFase] = useState<Fase>('aguardando')
  const [ultima, setUltima] = useState<Tentativa | null>(null)
  const [disparos, setDisparos] = useState(0)
  const seletorDeArquivo = useRef<HTMLInputElement>(null)
  const avisar = useAvisos()

  const enviar = useCallback(async (imagem: string) => {
    setFase('verificando')
    const inicio = performance.now()
    const resposta = await api.validarAcesso(imagem) // nunca lança: falhas viram NEGADO
    setUltima((anterior) => ({ resposta, totalMs: performance.now() - inicio, numero: (anterior?.numero ?? 0) + 1 }))
    setFase('resultado')
  }, [])

  const solicitarAcesso = useCallback(() => {
    if (fase === 'verificando') return
    const imagem = capturar()
    if (!imagem) {
      avisar('A câmera ainda não está pronta. Aguarde ou use uma foto.', 'erro')
      return
    }
    setDisparos((n) => n + 1) // efeito de "flash" da captura
    void enviar(imagem)
  }, [fase, capturar, enviar, avisar])

  // Depois de alguns segundos o portão fecha e o terminal volta a aguardar
  useEffect(() => {
    if (fase !== 'resultado') return
    const id = window.setTimeout(() => setFase('aguardando'), TEMPO_DO_RESULTADO_MS)
    return () => window.clearTimeout(id)
  }, [fase, ultima])

  // Atalho: barra de espaço (exceto quando o foco está em um controle)
  useEffect(() => {
    const aoTeclar = (evento: KeyboardEvent) => {
      if (evento.code !== 'Space' || evento.repeat) return
      const alvo = evento.target as HTMLElement | null
      if (alvo?.closest('button, a, input, textarea, select, dialog')) return
      evento.preventDefault()
      solicitarAcesso()
    }
    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [solicitarAcesso])

  async function aoEscolherArquivo(evento: ChangeEvent<HTMLInputElement>) {
    const arquivo = evento.target.files?.[0]
    evento.target.value = ''
    if (!arquivo || fase === 'verificando') return
    try {
      await enviar(await arquivoParaJpeg(arquivo))
    } catch (erro) {
      setFase('aguardando')
      avisar(erro instanceof Error ? erro.message : 'Não foi possível ler a imagem.', 'erro')
    }
  }

  const resultado = fase === 'resultado' ? ultima?.resposta : undefined
  const estadoDoPortao: EstadoPortao =
    fase === 'verificando'
      ? 'verificando'
      : resultado
        ? resultado.resultado === 'AUTORIZADO'
          ? 'aberto'
          : 'negado'
        : 'fechado'
  const verificando = fase === 'verificando'

  return (
    <div className="pagina">
      <header className="pagina__cabecalho">
        <div className="pagina__titulo">
          <h1>Portaria</h1>
          <p>Terminal de entrada: a câmera identifica o morador e o sistema decide se o portão abre.</p>
        </div>
      </header>

      <div className="portaria">
        <section className="terminal" aria-label="Terminal da portaria">
          <div className="terminal__topo">
            <span>
              <span className="ponto-ao-vivo" aria-hidden="true" /> Câmera da portaria
            </span>
            <span>Entrada principal</span>
          </div>

          <Camera videoRef={videoRef} estado={estadoCamera}>
            {verificando && (
              <div className="camera__sobreposicao" role="status">
                <span className="camera__varredura" aria-hidden="true" />
                <LoaderCircle className="girando" size={30} aria-hidden="true" />
                Verificando identidade…
              </div>
            )}
            {disparos > 0 && <span key={disparos} className="camera__flash" aria-hidden="true" />}
          </Camera>

          <button
            type="button"
            className="botao botao--primario botao--grande botao--bloco"
            onClick={solicitarAcesso}
            disabled={verificando || estadoCamera !== 'ativa'}
          >
            {verificando ? (
              <LoaderCircle className="girando" size={22} aria-hidden="true" />
            ) : (
              <ScanFace size={22} aria-hidden="true" />
            )}
            {verificando ? 'Verificando…' : 'Solicitar acesso'}
          </button>

          <div className="terminal__rodape">
            <span>
              <Keyboard size={15} aria-hidden="true" /> Atalho: barra de espaço
            </span>
            <button
              type="button"
              className="botao botao--fantasma botao--pequeno"
              onClick={() => seletorDeArquivo.current?.click()}
              disabled={verificando}
            >
              <ImageUp size={15} aria-hidden="true" /> Usar uma foto
            </button>
            <input
              ref={seletorDeArquivo}
              type="file"
              accept="image/jpeg,image/png"
              hidden
              onChange={aoEscolherArquivo}
            />
          </div>
        </section>

        <div className="portaria__lado">
          <section className="cartao cartao--portao" aria-live="polite">
            <Portao estado={estadoDoPortao} />
            <Situacao fase={fase} resultado={resultado} />
            {fase === 'resultado' && (
              <div key={ultima?.numero} className="contagem" aria-hidden="true">
                <span />
              </div>
            )}
          </section>

          <section className="cartao">
            <header className="cartao__cabecalho">
              <h2>
                <Activity size={18} aria-hidden="true" /> Caminho da última requisição
              </h2>
              {ultima && <span className="texto-suave">{formatarMs(ultima.totalMs)} no total</span>}
            </header>
            <div className="cartao__corpo">
              {ultima ? (
                <Rastreamento etapas={ultima.resposta.rastreamento} totalMs={ultima.totalMs} />
              ) : (
                <p className="texto-suave">
                  Faça uma solicitação para ver, etapa por etapa, por quais serviços AWS (emulados no LocalStack) a
                  requisição passou e quanto tempo levou em cada um.
                </p>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

function Situacao({ fase, resultado }: { fase: Fase; resultado?: RespostaValidacao }) {
  if (fase === 'verificando') {
    return (
      <Cabecalho
        tom="verificando"
        icone={LoaderCircle}
        girar
        titulo="Verificando identidade…"
        texto="Comparando o rosto com os moradores cadastrados."
      />
    )
  }
  if (!resultado) {
    return (
      <Cabecalho
        tom="aguardando"
        icone={ScanFace}
        titulo="Aguardando identificação"
        texto="Posicione o rosto dentro da moldura e toque em Solicitar acesso."
      />
    )
  }

  const autorizado = resultado.resultado === 'AUTORIZADO'
  const dica = autorizado ? undefined : DICA_MOTIVO[resultado.motivo]
  return (
    <div className="situacao__detalhes">
      <Cabecalho
        tom={autorizado ? 'autorizado' : 'negado'}
        icone={autorizado ? DoorOpen : ShieldX}
        titulo={autorizado ? 'Acesso autorizado' : 'Acesso negado'}
        texto={resultado.mensagem}
      />
      {resultado.morador && (
        <div className="pessoa">
          <span className="pessoa__inicial" aria-hidden="true">
            {iniciais(resultado.morador.nome)}
          </span>
          <span className="pessoa__dados">
            <strong>{resultado.morador.nome}</strong>
            <span>Unidade {resultado.morador.unidade}</span>
          </span>
          {resultado.motivo === 'CADASTRO_INATIVO' && <Selo tom="alerta">Cadastro inativo</Selo>}
        </div>
      )}
      {typeof resultado.similaridade === 'number' && resultado.limiar > 0 && (
        <BarraSimilaridade valor={resultado.similaridade} limiar={resultado.limiar} />
      )}
      {dica && (
        <p className="dica">
          <Info size={16} aria-hidden="true" /> {dica}
        </p>
      )}
    </div>
  )
}

function Cabecalho({
  tom,
  icone: Icone,
  titulo,
  texto,
  girar = false,
}: {
  tom: 'aguardando' | 'verificando' | 'autorizado' | 'negado'
  icone: LucideIcon
  titulo: string
  texto: string
  girar?: boolean
}) {
  return (
    <div className={`situacao situacao--${tom}`}>
      <span className="situacao__icone">
        <Icone size={26} className={girar ? 'girando' : undefined} aria-hidden="true" />
      </span>
      <div>
        <h2>{titulo}</h2>
        <p>{texto}</p>
      </div>
    </div>
  )
}
