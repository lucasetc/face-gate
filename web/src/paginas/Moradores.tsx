import { LoaderCircle, Plus, Search, Trash, UserCheck, Users, UserX } from 'lucide-react'
import { useMemo, useState } from 'react'
import { api, comoErroApi } from '../api'
import { Dialogo } from '../componentes/Dialogo'
import { Esqueleto, FalhaAoCarregar, Vazio } from '../componentes/Estados'
import { Selo } from '../componentes/Selo'
import { formatarData, iniciais, normalizarBusca } from '../formatos'
import { useAvisos } from '../hooks/useAvisos'
import { useConsulta } from '../hooks/useConsulta'
import type { Morador } from '../tipos'
import { NovoMorador } from './NovoMorador'

// As URLs das fotos expiram em 15 min: a lista é renovada a cada 5 min.
const ATUALIZACAO_MS = 5 * 60_000

export function Moradores() {
  const consulta = useConsulta('moradores', api.listarMoradores, ATUALIZACAO_MS)
  const [busca, setBusca] = useState('')
  const [cadastroAberto, setCadastroAberto] = useState(false)
  const [cadastroOcupado, setCadastroOcupado] = useState(false)
  const [paraExcluir, setParaExcluir] = useState<Morador | null>(null)
  const [excluindo, setExcluindo] = useState(false)
  const [alterando, setAlterando] = useState<string | null>(null)
  const avisar = useAvisos()

  const moradores = useMemo(() => consulta.dados ?? [], [consulta.dados])
  const filtrados = useMemo(() => {
    const termo = normalizarBusca(busca.trim())
    if (!termo) return moradores
    return moradores.filter((m) => normalizarBusca(`${m.nome} ${m.unidade}`).includes(termo))
  }, [moradores, busca])
  const ativos = moradores.filter((m) => m.status === 'ATIVO').length

  async function alternarStatus(morador: Morador) {
    const novoStatus = morador.status === 'ATIVO' ? 'INATIVO' : 'ATIVO'
    setAlterando(morador.moradorId)
    try {
      await api.alterarStatus(morador.moradorId, novoStatus)
      await consulta.recarregar()
      avisar(novoStatus === 'ATIVO' ? `Acesso de ${morador.nome} liberado.` : `Acesso de ${morador.nome} bloqueado.`)
    } catch (erro) {
      avisar(comoErroApi(erro).message, 'erro')
    } finally {
      setAlterando(null)
    }
  }

  async function excluir() {
    if (!paraExcluir) return
    setExcluindo(true)
    try {
      await api.excluirMorador(paraExcluir.moradorId)
      avisar(`${paraExcluir.nome} foi excluído(a), com a foto e a biometria.`)
      setParaExcluir(null)
      await consulta.recarregar()
    } catch (erro) {
      avisar(comoErroApi(erro).message, 'erro')
    } finally {
      setExcluindo(false)
    }
  }

  function aoCadastrar(morador: Morador) {
    setCadastroAberto(false)
    avisar(`${morador.nome} cadastrado(a) com acesso liberado.`)
    void consulta.recarregar()
  }

  return (
    <div className="pagina">
      <header className="pagina__cabecalho">
        <div className="pagina__titulo">
          <h1>Moradores</h1>
          <p>
            {consulta.dados
              ? `${moradores.length} cadastrado(s) · ${ativos} com acesso liberado`
              : 'Pessoas autorizadas a entrar no condomínio.'}
          </p>
        </div>
        <button type="button" className="botao botao--primario" onClick={() => setCadastroAberto(true)}>
          <Plus size={18} aria-hidden="true" /> Novo morador
        </button>
      </header>

      {consulta.erro && <FalhaAoCarregar erro={consulta.erro} aoTentarNovamente={consulta.recarregar} />}

      <section className="cartao">
        {moradores.length > 0 && (
          <div className="barra-ferramentas">
            <label className="busca">
              <Search size={17} aria-hidden="true" />
              <span className="visualmente-oculto">Buscar morador</span>
              <input
                type="search"
                className="entrada"
                placeholder="Buscar por nome ou unidade"
                value={busca}
                onChange={(evento) => setBusca(evento.target.value)}
              />
            </label>
          </div>
        )}

        {consulta.carregando && !consulta.dados ? (
          <div className="cartao__corpo">
            <Esqueleto linhas={3} altura={64} />
          </div>
        ) : moradores.length === 0 ? (
          <Vazio
            icone={Users}
            titulo="Nenhum morador cadastrado"
            acao={
              <button type="button" className="botao botao--primario" onClick={() => setCadastroAberto(true)}>
                <Plus size={18} aria-hidden="true" /> Cadastrar o primeiro morador
              </button>
            }
          >
            Cadastre um morador com uma foto de referência para que ele seja reconhecido na portaria.
          </Vazio>
        ) : filtrados.length === 0 ? (
          <Vazio icone={Search} titulo="Nenhum resultado">
            Nenhum morador corresponde a “{busca}”.
          </Vazio>
        ) : (
          <ul className="lista-moradores">
            {filtrados.map((morador) => (
              <LinhaMorador
                key={morador.moradorId}
                morador={morador}
                alterando={alterando === morador.moradorId}
                aoAlternar={() => void alternarStatus(morador)}
                aoExcluir={() => setParaExcluir(morador)}
              />
            ))}
          </ul>
        )}
      </section>

      <Dialogo
        aberto={cadastroAberto}
        aoFechar={() => setCadastroAberto(false)}
        titulo="Novo morador"
        descricao="A foto vira uma referência biométrica (embedding) e é guardada com acesso restrito."
        largura="larga"
        bloqueado={cadastroOcupado}
      >
        <NovoMorador
          aoConcluir={aoCadastrar}
          aoCancelar={() => setCadastroAberto(false)}
          aoMudarOcupado={setCadastroOcupado}
        />
      </Dialogo>

      <Dialogo
        aberto={paraExcluir !== null}
        aoFechar={() => setParaExcluir(null)}
        titulo="Excluir morador?"
        bloqueado={excluindo}
      >
        {paraExcluir && (
          <>
            <p className="texto-dialogo">
              O cadastro de <strong>{paraExcluir.nome}</strong> (unidade {paraExcluir.unidade}) será removido
              definitivamente, junto com a foto no S3 e a referência biométrica no DynamoDB. É o direito de exclusão
              previsto na LGPD. Essa ação não pode ser desfeita.
            </p>
            <div className="dialogo__acoes">
              <button
                type="button"
                className="botao botao--secundario"
                onClick={() => setParaExcluir(null)}
                disabled={excluindo}
              >
                Cancelar
              </button>
              <button type="button" className="botao botao--perigo" onClick={() => void excluir()} disabled={excluindo}>
                {excluindo ? (
                  <LoaderCircle className="girando" size={18} aria-hidden="true" />
                ) : (
                  <Trash size={18} aria-hidden="true" />
                )}
                Excluir definitivamente
              </button>
            </div>
          </>
        )}
      </Dialogo>
    </div>
  )
}

function LinhaMorador({
  morador,
  alterando,
  aoAlternar,
  aoExcluir,
}: {
  morador: Morador
  alterando: boolean
  aoAlternar: () => void
  aoExcluir: () => void
}) {
  const ativo = morador.status === 'ATIVO'
  return (
    <li className={`morador${ativo ? '' : ' morador--inativo'}`}>
      <Avatar key={morador.fotoUrl ?? 'sem-foto'} morador={morador} />
      <div className="morador__info">
        <strong className="morador__nome">{morador.nome}</strong>
        <span className="morador__detalhe">
          Unidade {morador.unidade} · cadastrado em {formatarData(morador.criadoEm)}
        </span>
      </div>
      <Selo tom={ativo ? 'sucesso' : 'neutro'} icone={ativo ? UserCheck : UserX}>
        {ativo ? 'Ativo' : 'Inativo'}
      </Selo>
      <button
        type="button"
        role="switch"
        aria-checked={ativo}
        aria-label={`Acesso de ${morador.nome}`}
        className="interruptor"
        onClick={aoAlternar}
        disabled={alterando}
      >
        <span className="interruptor__trilho" aria-hidden="true" />
        <span className="interruptor__texto" aria-hidden="true">
          {alterando ? 'Salvando…' : ativo ? 'Acesso liberado' : 'Acesso bloqueado'}
        </span>
      </button>
      <button
        type="button"
        className="botao-icone botao-icone--perigo"
        onClick={aoExcluir}
        aria-label={`Excluir ${morador.nome}`}
        title="Excluir cadastro (LGPD)"
      >
        <Trash size={18} aria-hidden="true" />
      </button>
    </li>
  )
}

function Avatar({ morador }: { morador: Morador }) {
  const [falhou, setFalhou] = useState(false)
  if (!morador.fotoUrl || falhou) {
    return (
      <span className="avatar" aria-hidden="true">
        {iniciais(morador.nome)}
      </span>
    )
  }
  return <img className="avatar" src={morador.fotoUrl} alt="" loading="lazy" onError={() => setFalhou(true)} />
}
