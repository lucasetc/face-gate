import { Camera as IconeCamera, CircleExclamationPoint, ImageUp, LoaderCircle, RotateCcw, UserPlus } from 'lucide-react'
import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react'
import { api, comoErroApi } from '../api'
import { Camera } from '../componentes/Camera'
import { useCamera } from '../hooks/useCamera'
import { arquivoParaJpeg } from '../imagem'
import type { Morador } from '../tipos'

type Campo = 'nome' | 'unidade' | 'foto' | 'consentimento' | 'geral'
type Erros = Partial<Record<Campo, string>>

/** Erros da API que dizem respeito à foto (exibidos junto da imagem). */
const CODIGOS_DA_FOTO = new Set(['NENHUM_ROSTO', 'MULTIPLOS_ROSTOS', 'ROSTO_DISTANTE', 'IMAGEM_INVALIDA', 'ROSTO_JA_CADASTRADO'])

interface Props {
  aoConcluir: (morador: Morador) => void
  aoCancelar: () => void
  aoMudarOcupado: (ocupado: boolean) => void
}

/** Fluxo 4.1 do projeto: dados + foto de referência + consentimento. */
export function NovoMorador({ aoConcluir, aoCancelar, aoMudarOcupado }: Props) {
  const { videoRef, estado: estadoCamera, capturar } = useCamera()
  const [foto, setFoto] = useState<string | null>(null)
  const [nome, setNome] = useState('')
  const [unidade, setUnidade] = useState('')
  const [consentimento, setConsentimento] = useState(false)
  const [erros, setErros] = useState<Erros>({})
  const [enviando, setEnviando] = useState(false)
  const seletorDeArquivo = useRef<HTMLInputElement>(null)
  const idNome = useId()
  const idUnidade = useId()

  useEffect(() => aoMudarOcupado(enviando), [enviando, aoMudarOcupado])

  const limparErro = (campo: Campo) => setErros((atuais) => ({ ...atuais, [campo]: undefined, geral: undefined }))

  function tirarFoto() {
    const imagem = capturar()
    if (!imagem) return
    setFoto(imagem)
    limparErro('foto')
  }

  async function aoEscolherArquivo(evento: ChangeEvent<HTMLInputElement>) {
    const arquivo = evento.target.files?.[0]
    evento.target.value = ''
    if (!arquivo) return
    try {
      setFoto(await arquivoParaJpeg(arquivo))
      limparErro('foto')
    } catch (erro) {
      setErros((atuais) => ({ ...atuais, foto: erro instanceof Error ? erro.message : 'Imagem inválida.' }))
    }
  }

  function validar(): boolean {
    const novos: Erros = {}
    if (nome.trim().length < 2) novos.nome = 'Informe o nome (mínimo de 2 caracteres).'
    if (!unidade.trim()) novos.unidade = 'Informe a unidade (ex.: Apto 101).'
    if (!foto) novos.foto = 'Tire ou envie uma foto do rosto.'
    if (!consentimento) novos.consentimento = 'Sem o consentimento, a biometria não pode ser cadastrada.'
    setErros(novos)
    return Object.keys(novos).length === 0
  }

  async function enviar(evento: FormEvent) {
    evento.preventDefault()
    if (!validar() || !foto) return
    setEnviando(true)
    try {
      aoConcluir(await api.cadastrarMorador({ nome: nome.trim(), unidade: unidade.trim(), imagem: foto, consentimento }))
    } catch (e) {
      const erro = comoErroApi(e)
      const campo: Campo =
        CODIGOS_DA_FOTO.has(erro.codigo) || erro.campo === 'imagem'
          ? 'foto'
          : erro.campo === 'nome' || erro.campo === 'unidade' || erro.campo === 'consentimento'
            ? erro.campo
            : 'geral'
      const novos: Erros = {}
      novos[campo] = erro.message
      setErros(novos)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <form className="cadastro" onSubmit={enviar} noValidate>
      <div className="cadastro__foto">
        <Camera videoRef={videoRef} estado={estadoCamera}>
          {foto && <img className="camera__previa" src={foto} alt="Foto de referência capturada" />}
          {enviando && (
            <div className="camera__sobreposicao" role="status">
              <span className="camera__varredura" aria-hidden="true" />
              <LoaderCircle className="girando" size={28} aria-hidden="true" />
              Analisando o rosto…
            </div>
          )}
        </Camera>
        <div className="cadastro__botoes-foto">
          {foto ? (
            <button type="button" className="botao botao--secundario" onClick={() => setFoto(null)} disabled={enviando}>
              <RotateCcw size={17} aria-hidden="true" /> Tirar outra
            </button>
          ) : (
            <button
              type="button"
              className="botao botao--primario"
              onClick={tirarFoto}
              disabled={estadoCamera !== 'ativa'}
            >
              <IconeCamera size={17} aria-hidden="true" /> Tirar foto
            </button>
          )}
          <button
            type="button"
            className="botao botao--secundario"
            onClick={() => seletorDeArquivo.current?.click()}
            disabled={enviando}
          >
            <ImageUp size={17} aria-hidden="true" /> Enviar arquivo
          </button>
          <input ref={seletorDeArquivo} type="file" accept="image/jpeg,image/png" hidden onChange={aoEscolherArquivo} />
        </div>
        {erros.foto ? (
          <MensagemDeErro>{erros.foto}</MensagemDeErro>
        ) : (
          <p className="campo__ajuda">Rosto de frente, bem iluminado, sem óculos escuros ou boné.</p>
        )}
      </div>

      <div className="cadastro__dados">
        <div className={`campo${erros.nome ? ' campo--erro' : ''}`}>
          <label htmlFor={idNome}>Nome completo</label>
          <input
            id={idNome}
            className="entrada"
            value={nome}
            maxLength={80}
            autoComplete="off"
            disabled={enviando}
            aria-invalid={Boolean(erros.nome)}
            aria-describedby={erros.nome ? `${idNome}-erro` : undefined}
            onChange={(evento) => {
              setNome(evento.target.value)
              limparErro('nome')
            }}
          />
          {erros.nome && <MensagemDeErro id={`${idNome}-erro`}>{erros.nome}</MensagemDeErro>}
        </div>

        <div className={`campo${erros.unidade ? ' campo--erro' : ''}`}>
          <label htmlFor={idUnidade}>Unidade</label>
          <input
            id={idUnidade}
            className="entrada"
            value={unidade}
            maxLength={20}
            placeholder="Ex.: Bloco A · Apto 101"
            autoComplete="off"
            disabled={enviando}
            aria-invalid={Boolean(erros.unidade)}
            aria-describedby={erros.unidade ? `${idUnidade}-erro` : undefined}
            onChange={(evento) => {
              setUnidade(evento.target.value)
              limparErro('unidade')
            }}
          />
          {erros.unidade && <MensagemDeErro id={`${idUnidade}-erro`}>{erros.unidade}</MensagemDeErro>}
        </div>

        <label className={`consentimento${erros.consentimento ? ' consentimento--erro' : ''}`}>
          <input
            type="checkbox"
            checked={consentimento}
            disabled={enviando}
            onChange={(evento) => {
              setConsentimento(evento.target.checked)
              limparErro('consentimento')
            }}
          />
          <span>
            <strong>Consentimento (LGPD, art. 11)</strong>
            Declaro que o morador foi informado e autorizou o uso da sua imagem facial exclusivamente para o controle de
            acesso ao condomínio, podendo pedir a exclusão a qualquer momento.
          </span>
        </label>
        {erros.consentimento && <MensagemDeErro>{erros.consentimento}</MensagemDeErro>}

        {erros.geral && <MensagemDeErro>{erros.geral}</MensagemDeErro>}

        <div className="dialogo__acoes cadastro__acoes">
          <button type="button" className="botao botao--secundario" onClick={aoCancelar} disabled={enviando}>
            Cancelar
          </button>
          <button type="submit" className="botao botao--primario" disabled={enviando}>
            {enviando ? (
              <LoaderCircle className="girando" size={18} aria-hidden="true" />
            ) : (
              <UserPlus size={18} aria-hidden="true" />
            )}
            {enviando ? 'Cadastrando…' : 'Cadastrar morador'}
          </button>
        </div>
      </div>
    </form>
  )
}

function MensagemDeErro({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p className="campo__erro" id={id} role="alert">
      <CircleExclamationPoint size={15} aria-hidden="true" /> {children}
    </p>
  )
}
