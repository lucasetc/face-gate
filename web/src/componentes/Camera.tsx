import { CameraOff, LoaderCircle } from 'lucide-react'
import type { ReactNode, RefObject } from 'react'
import type { EstadoCamera } from '../hooks/useCamera'

interface Props {
  videoRef: RefObject<HTMLVideoElement | null>
  estado: EstadoCamera
  /** Conteúdo sobreposto à imagem (ex.: "Verificando…" ou a foto capturada). */
  children?: ReactNode
}

export function Camera({ videoRef, estado, children }: Props) {
  return (
    <div className="camera">
      <video ref={videoRef} className="camera__video" playsInline muted autoPlay aria-label="Imagem da câmera" />
      {estado === 'ativa' && <MolduraDoRosto />}
      {estado === 'iniciando' && (
        <div className="camera__aviso" role="status">
          <LoaderCircle className="girando" size={28} aria-hidden="true" />
          Iniciando a câmera…
        </div>
      )}
      {(estado === 'negada' || estado === 'indisponivel') && (
        <div className="camera__aviso camera__aviso--erro" role="alert">
          <CameraOff size={30} aria-hidden="true" />
          <strong>{estado === 'negada' ? 'Acesso à câmera bloqueado' : 'Nenhuma câmera disponível'}</strong>
          <span>
            {estado === 'negada'
              ? 'Libere a câmera no ícone da barra de endereço e recarregue a página, ou envie uma foto.'
              : 'Conecte uma webcam ou envie uma foto do rosto.'}
          </span>
        </div>
      )}
      {children}
    </div>
  )
}

/** Moldura-guia: ajuda a pessoa a centralizar o rosto na distância certa. */
function MolduraDoRosto() {
  return (
    <svg className="camera__moldura" viewBox="0 0 400 300" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <ellipse cx="200" cy="146" rx="74" ry="96" />
      <path d="M118 52V34h22M282 52V34h-22M118 240v18h22M282 240v18h-22" />
    </svg>
  )
}
