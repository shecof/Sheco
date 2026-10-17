export function architectureRasterSize(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0)
    throw new Error('Invalid diagram dimensions')
  const scale = Math.min(2, 8192 / width, 8192 / height, Math.sqrt(16_000_000 / (width * height)))
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  }
}

export async function architectureImageBlob(
  svg: string,
  format: 'png' | 'jpg',
  signal: AbortSignal,
): Promise<Blob> {
  const documentSvg = new DOMParser().parseFromString(svg, 'image/svg+xml')
  if (documentSvg.querySelector('parsererror')) throw new Error('Invalid diagram SVG')
  const root = documentSvg.documentElement
  const size = architectureRasterSize(
    Number(root.getAttribute('width')),
    Number(root.getAttribute('height')),
  )
  root.setAttribute('width', String(size.width))
  root.setAttribute('height', String(size.height))
  signal.throwIfAborted()
  const url = URL.createObjectURL(
    new Blob([new XMLSerializer().serializeToString(root)], { type: 'image/svg+xml' }),
  )
  const image = new Image()
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error('Diagram export timed out')), 15000)
      const aborted = () => finish(signal.reason ?? new DOMException('Aborted', 'AbortError'))
      const finish = (error?: unknown) => {
        clearTimeout(timer)
        signal.removeEventListener('abort', aborted)
        image.onload = null
        image.onerror = null
        error ? reject(error) : resolve()
      }
      image.onload = () => finish()
      image.onerror = () => finish(new Error('Could not render the diagram'))
      signal.addEventListener('abort', aborted, { once: true })
      image.src = url
    })
    signal.throwIfAborted()
    const canvas = document.createElement('canvas')
    canvas.width = size.width
    canvas.height = size.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Image export unavailable')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, size.width, size.height)
    context.drawImage(image, 0, 0, size.width, size.height)
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the diagram'))),
        format === 'jpg' ? 'image/jpeg' : 'image/png',
        0.92,
      ),
    )
    signal.throwIfAborted()
    return blob
  } finally {
    image.src = ''
    URL.revokeObjectURL(url)
  }
}
