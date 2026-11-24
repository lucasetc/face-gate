import { useCallback, useEffect, useRef, useState } from 'react'
import { quadroParaJpeg } from '../imagem'

export type EstadoCamera = 'iniciando' | 'ativa' | 'negada' | 'indisponivel'

const navegadorTemCamera = () => typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia)

/** Liga a webcam enquanto o componente estiver na tela e permite capturar um quadro. */
export function useCamera() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [estado, setEstado] = useState<EstadoCamera>(() => (navegadorTemCamera() ? 'iniciando' : 'indisponivel'))

  useEffect(() => {
    if (!navegadorTemCamera()) return
    let fluxo: MediaStream | undefined
    let cancelado = false

    // Só a altura é sugerida: fixar também a largura faria o navegador recortar o quadro
    // de câmeras 4:3 para 16:9, podendo cortar o topo da cabeça.
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'user', height: { ideal: 720 } }, audio: false })
      .then(async (novoFluxo) => {
        if (cancelado) {
          novoFluxo.getTracks().forEach((faixa) => faixa.stop())
          return
        }
        fluxo = novoFluxo
        const video = videoRef.current
        if (video) {
          video.srcObject = novoFluxo
          await video.play().catch(() => undefined)
        }
        setEstado('ativa')
      })
      .catch((erro: unknown) => {
        if (cancelado) return
        const bloqueada =
          erro instanceof DOMException && (erro.name === 'NotAllowedError' || erro.name === 'SecurityError')
        setEstado(bloqueada ? 'negada' : 'indisponivel')
      })

    // Ao sair da tela, desliga a câmera (a luz da webcam apaga)
    return () => {
      cancelado = true
      fluxo?.getTracks().forEach((faixa) => faixa.stop())
    }
  }, [])

  /** Captura o quadro atual como JPEG (data URL), já reduzido para envio. */
  const capturar = useCallback((): string | null => {
    const video = videoRef.current
    if (!video || estado !== 'ativa' || video.videoWidth === 0) return null
    return quadroParaJpeg(video, video.videoWidth, video.videoHeight)
  }, [estado])

  return { videoRef, estado, capturar }
}
