import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n'
import { parseFlowchart, type DiagramPositions } from '../shared/diagram'
import { nodeGeometry, placeNodes, renderDiagram, type Geometry } from './diagramRendering'

export function DiagramPreview({
  source,
  positions,
  onStatus,
  scale,
}: {
  source: string
  positions: DiagramPositions
  onStatus?: (valid: boolean) => void
  scale?: number
}) {
  const { t } = useI18n()
  const [dark, setDark] = useState(document.documentElement.dataset.theme === 'dark')
  useEffect(() => {
    const observer = new MutationObserver(() =>
      setDark(document.documentElement.dataset.theme === 'dark'),
    )
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })
    return () => observer.disconnect()
  }, [])
  const root = useRef<HTMLDivElement>(null)
  const [availableWidth, setAvailableWidth] = useState(0)
  useLayoutEffect(() => {
    const element = root.current
    if (!element || scale === undefined) return
    const observer = new ResizeObserver(() => setAvailableWidth(element.clientWidth))
    observer.observe(element)
    setAvailableWidth(element.clientWidth)
    return () => observer.disconnect()
  }, [scale === undefined])
  const geometry = useRef<Geometry>({})
  const callbacks = useRef({ onStatus })
  callbacks.current = { onStatus }
  const [svg, setSvg] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(true)
  const graph = parseFlowchart(source)
  useEffect(() => {
    let alive = true
    setPending(true)
    setError('')
    callbacks.current.onStatus?.(false)
    const timer = setTimeout(() => {
      renderDiagram(source, dark).then(
        (result) => {
          if (!alive) return
          geometry.current = {}
          setSvg(result)
          setPending(false)
          callbacks.current.onStatus?.(true)
        },
        (error: unknown) => {
          if (!alive) return
          setSvg('')
          setError(
            error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000),
          )
          setPending(false)
        },
      )
    }, 150)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [source, dark])
  useLayoutEffect(() => {
    const element = root.current?.querySelector('svg')
    if (!element) return
    if (graph) {
      if (!Object.keys(geometry.current).length) {
        geometry.current = nodeGeometry(element, graph)
      }
      placeNodes(element, graph, positions, geometry.current)
    }
    if (scale !== undefined && availableWidth > 0) {
      const width = element.viewBox.baseVal.width
      if (width > 0) {
        element.style.width = `${Math.min(width, availableWidth) * scale}px`
        element.style.maxWidth = 'none'
        element.removeAttribute('height')
      }
    }
  }, [svg, positions, source, scale, availableWidth])
  return (
    <div className="diagram-preview" aria-busy={pending}>
      {pending && <span className="diagram-message">{t('Rendering diagram…')}</span>}
      {error && (
        <div className="diagram-error" role="alert">
          <strong>{t('Check the Mermaid code')}</strong>
          <pre>{error}</pre>
        </div>
      )}
      <div
        ref={root}
        className="diagram-svg"
        style={{ visibility: pending ? 'hidden' : undefined }}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </div>
  )
}
