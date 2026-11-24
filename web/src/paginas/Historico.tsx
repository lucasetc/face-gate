import { BellRing, Hourglass, ListClock, ScanFace, ShieldCheck, ShieldX, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { api } from '../api'
import { Esqueleto, FalhaAoCarregar, Vazio } from '../componentes/Estados'
import { Selo } from '../componentes/Selo'
import { formatarDecimal, formatarDia, formatarHora, hojeIso, ROTULO_MOTIVO, segundosEntre } from '../formatos'
import { useConsulta } from '../hooks/useConsulta'
import type { Acesso } from '../tipos'

/** Enquanto o dia exibido é hoje, a tabela se atualiza sozinha. */
const ATUALIZACAO_MS = 3000

export function Historico() {
  const hoje = hojeIso()
  const [dia, setDia] = useState(hoje)
  const ehHoje = dia === hoje
  const consulta = useConsulta(`acessos:${dia}`, () => api.listarAcessos(dia), ehHoje ? ATUALIZACAO_MS : 0)

  const acessos = consulta.dados ?? []
  const autorizados = acessos.filter((a) => a.resultado === 'AUTORIZADO').length
  const naFila = acessos.filter((a) => !a.processadoEm).length

  return (
    <div className="pagina">
      <header className="pagina__cabecalho">
        <div className="pagina__titulo">
          <h1>Histórico de acessos</h1>
          <p>Cada tentativa é gravada no DynamoDB. A notificação chega depois, pela fila SQS.</p>
        </div>
        <div className="filtro-dia">
          <label htmlFor="dia-historico">Dia</label>
          <input
            id="dia-historico"
            type="date"
            className="entrada"
            value={dia}
            max={hoje}
            onChange={(evento) => evento.target.value && setDia(evento.target.value)}
          />
          {ehHoje ? (
            <span className="ao-vivo">
              <span className="ponto-ao-vivo" aria-hidden="true" /> Ao vivo
            </span>
          ) : (
            <button type="button" className="botao botao--secundario" onClick={() => setDia(hoje)}>
              Hoje
            </button>
          )}
        </div>
      </header>

      <div className="indicadores">
        <Indicador rotulo="Tentativas" valor={acessos.length} icone={ScanFace} />
        <Indicador rotulo="Autorizadas" valor={autorizados} icone={ShieldCheck} tom="sucesso" />
        <Indicador rotulo="Negadas" valor={acessos.length - autorizados} icone={ShieldX} tom="perigo" />
        <Indicador rotulo="Aguardando a fila" valor={naFila} icone={Hourglass} tom="alerta" />
      </div>

      {consulta.erro && <FalhaAoCarregar erro={consulta.erro} aoTentarNovamente={consulta.recarregar} />}

      <section className="cartao">
        {consulta.carregando ? (
          <div className="cartao__corpo">
            <Esqueleto linhas={4} altura={44} />
          </div>
        ) : acessos.length === 0 ? (
          <Vazio
            icone={ListClock}
            titulo={`Nenhuma tentativa em ${formatarDia(dia)}`}
            acao={
              ehHoje && (
                <a className="botao botao--primario" href="#/portaria">
                  Abrir a portaria
                </a>
              )
            }
          >
            As solicitações feitas na Portaria aparecem aqui em tempo real.
          </Vazio>
        ) : (
          <div className="tabela-rolagem">
            <table className="tabela">
              <caption className="visualmente-oculto">Tentativas de acesso em {formatarDia(dia)}</caption>
              <thead>
                <tr>
                  <th scope="col">Horário</th>
                  <th scope="col">Pessoa</th>
                  <th scope="col">Resultado</th>
                  <th scope="col">Motivo</th>
                  <th scope="col">Similaridade</th>
                  <th scope="col">Notificação (SQS → Lambda)</th>
                </tr>
              </thead>
              <tbody>
                {acessos.map((acesso) => (
                  <LinhaAcesso key={acesso.acessoId} acesso={acesso} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

function LinhaAcesso({ acesso }: { acesso: Acesso }) {
  const autorizado = acesso.resultado === 'AUTORIZADO'
  return (
    <tr>
      <td className="tabela__hora">{formatarHora(acesso.dataHora)}</td>
      <td>
        {acesso.nome ? (
          <span className="tabela__pessoa">
            <strong>{acesso.nome}</strong>
            <span>Unidade {acesso.unidade}</span>
          </span>
        ) : (
          <span className="texto-suave">Não identificado</span>
        )}
      </td>
      <td>
        <Selo tom={autorizado ? 'sucesso' : 'perigo'} icone={autorizado ? ShieldCheck : ShieldX}>
          {autorizado ? 'Autorizado' : 'Negado'}
        </Selo>
      </td>
      <td>{ROTULO_MOTIVO[acesso.motivo] ?? acesso.motivo}</td>
      <td className="tabela__numero">
        {typeof acesso.similaridade === 'number' ? formatarDecimal(acesso.similaridade) : '—'}
      </td>
      <td>
        {acesso.processadoEm ? (
          <span className="tabela__notificacao">
            <Selo tom="info" icone={BellRing}>
              Processada em {formatarDecimal(segundosEntre(acesso.dataHora, acesso.processadoEm), 1)} s
            </Selo>
            <small title={acesso.notificacao}>{acesso.notificacao}</small>
          </span>
        ) : (
          <Selo tom="alerta" icone={Hourglass}>
            Na fila…
          </Selo>
        )}
      </td>
    </tr>
  )
}

function Indicador({
  rotulo,
  valor,
  icone: Icone,
  tom = 'neutro',
}: {
  rotulo: string
  valor: number
  icone: LucideIcon
  tom?: 'neutro' | 'sucesso' | 'perigo' | 'alerta'
}) {
  return (
    <div className={`cartao indicador indicador--${tom}`}>
      <span className="indicador__icone">
        <Icone size={20} aria-hidden="true" />
      </span>
      <span className="indicador__rotulo">{rotulo}</span>
      <strong className="indicador__valor">{valor}</strong>
    </div>
  )
}
