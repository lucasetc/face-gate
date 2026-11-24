// Conversão de quadros da câmera e de arquivos em JPEG leve para enviar à API.

/** Maior lado da imagem enviada: suficiente para o reconhecimento e leve (~100 KB). */
const LADO_MAXIMO_PX = 960
const QUALIDADE_JPEG = 0.9

export function quadroParaJpeg(fonte: CanvasImageSource, largura: number, altura: number): string {
  const escala = Math.min(1, LADO_MAXIMO_PX / Math.max(largura, altura))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(largura * escala)
  canvas.height = Math.round(altura * escala)
  const contexto = canvas.getContext('2d')
  if (!contexto) throw new Error('Este navegador não permite processar imagens.')
  contexto.drawImage(fonte, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', QUALIDADE_JPEG)
}

export async function arquivoParaJpeg(arquivo: File): Promise<string> {
  if (!arquivo.type.startsWith('image/')) throw new Error('Selecione um arquivo de imagem (JPEG ou PNG).')
  const bitmap = await createImageBitmap(arquivo)
  try {
    return quadroParaJpeg(bitmap, bitmap.width, bitmap.height)
  } finally {
    bitmap.close()
  }
}
