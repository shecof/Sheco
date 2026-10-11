import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowUpRight,
  Circle,
  Code2,
  Database,
  Diamond,
  Hand,
  LayoutGrid,
  Minus,
  MousePointer2,
  Pencil,
  Plus,
  RectangleHorizontal,
  Scan,
  Slash,
  Square,
  Trash2,
  X,
} from 'lucide-react'
import { Modal, Popover } from '../components/ui'
import { PopoverPicker } from '../components/PopoverPicker'
import { useI18n } from '../i18n'
import {
  diagramBoundary,
  diagramShapes,
  flowchartSource,
  parseFlowchart,
  type DiagramPoint,
  type DiagramPositions,
  type DiagramShape,
  type Flowchart,
} from '../shared/diagram'
import { nodeGeometry, placeNodes, renderDiagram, type Geometry } from './diagramRendering'
import { DiagramPreview } from './DiagramPreview'

type Selection = { node: string } | { edge: number } | null
type Tool = 'select' | 'hand' | 'arrow' | 'line' | DiagramShape
type View = { x: number; y: number; zoom: number }
const shapeLabels: Record<DiagramShape, string> = {
  rectangle: 'Rectangle',
  rounded: 'Rounded rectangle',
  diamond: 'Decision',
  circle: 'Circle',
  cylinder: 'Cylinder',
}
const shapeIcons = {
  rectangle: Square,
  rounded: RectangleHorizontal,
  diamond: Diamond,
  circle: Circle,
  cylinder: Database,
}
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

function Canvas({
  source,
  graph,
  positions,
  tool,
  selected,
  fitRevision,
  onSelect,
  onInspect,
  onMove,
  onPlace,
  onConnect,
  onGeometry,
  onStatus,
  onAnchorChange,
  onView,
  anchor,
}: {
  source: string
  graph: Flowchart
  positions: DiagramPositions
  tool: Tool
  selected: Selection
  fitRevision: number
  onSelect: (selection: Selection) => void
  onInspect: () => void
  onMove: (id: string, point: DiagramPoint) => void
  onPlace: (shape: DiagramShape, point: DiagramPoint) => void
  onConnect: (from: string, to: string, kind: 'arrow' | 'line') => void
  onGeometry: (positions: DiagramPositions) => void
  onStatus: (valid: boolean) => void
  onAnchorChange: (ready: boolean) => void
  onView: () => void
  anchor: React.RefObject<HTMLButtonElement | null>
}) {
  const { t } = useI18n()
  const stage = useRef<HTMLDivElement>(null)
  const root = useRef<HTMLDivElement>(null)
  const geometry = useRef<Geometry>({})
  const callbacks = useRef({ onStatus, onGeometry })
  callbacks.current = { onStatus, onGeometry }
  const [svg, setSvg] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(true)
  const [dark, setDark] = useState(document.documentElement.dataset.theme === 'dark')
  const [size, setSize] = useState({ width: 900, height: 550 })
  const [view, setView] = useState<View>({ x: 0, y: 0, zoom: 1 })
  const [anchorPoint, setAnchorPoint] = useState<DiagramPoint | null>(null)
  const [connect, setConnect] = useState<{ from: string; point: DiagramPoint } | null>(null)
  const fitted = useRef(-1)
  const gesture = useRef<{
    pointer: number
    client: DiagramPoint
    moved: boolean
    node?: string
    offset?: DiagramPoint
    pan?: View
    connection?: string
  } | null>(null)
  useEffect(() => {
    const observer = new MutationObserver(() =>
      setDark(document.documentElement.dataset.theme === 'dark'),
    )
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })
    const resize = new ResizeObserver(([entry]) =>
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height }),
    )
    if (stage.current) resize.observe(stage.current)
    return () => {
      observer.disconnect()
      resize.disconnect()
    }
  }, [])
  useEffect(() => {
    let alive = true
    setPending(true)
    setError('')
    callbacks.current.onStatus(false)
    const timer = setTimeout(() => {
      renderDiagram(source, dark).then(
        (result) => {
          if (!alive) return
          geometry.current = {}
          setSvg(result)
          setPending(false)
          callbacks.current.onStatus(true)
        },
        (error: unknown) => {
          if (!alive) return
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
  useEffect(() => {
    setConnect(null)
    gesture.current = null
  }, [tool])
  function fit() {
    const entries = graph.nodes
      .map((node) => {
        const bounds = geometry.current[node.id]
        const point = Object.hasOwn(positions, node.id) ? positions[node.id] : bounds
        return bounds && point ? { ...bounds, x: point.x, y: point.y } : null
      })
      .filter((entry) => entry !== null)
    if (!entries.length) {
      setView({ x: 0, y: 0, zoom: 1 })
      return
    }
    const left = Math.min(...entries.map((entry) => entry.x - entry.width / 2)) - 80
    const top = Math.min(...entries.map((entry) => entry.y - entry.height / 2)) - 80
    const right = Math.max(...entries.map((entry) => entry.x + entry.width / 2)) + 110
    const bottom = Math.max(...entries.map((entry) => entry.y + entry.height / 2)) + 80
    const zoom = clamp(
      Math.min(size.width / (right - left), (size.height - 70) / (bottom - top)),
      0.01,
      1.2,
    )
    setView({
      x: (left + right - size.width / zoom) / 2,
      y: (top + bottom - size.height / zoom) / 2,
      zoom,
    })
    onView()
  }
  useLayoutEffect(() => {
    const element = root.current?.querySelector('svg')
    if (!element) return
    if (!Object.keys(geometry.current).length) {
      geometry.current = nodeGeometry(element, graph)
      callbacks.current.onGeometry(
        Object.fromEntries(
          Object.entries(geometry.current).map(([id, point]) => [id, { x: point.x, y: point.y }]),
        ),
      )
    }
    placeNodes(element, graph, positions, geometry.current, false)
    element.setAttribute(
      'viewBox',
      `${view.x} ${view.y} ${size.width / view.zoom} ${size.height / view.zoom}`,
    )
    element.setAttribute('width', '100%')
    element.setAttribute('height', '100%')
    element.setAttribute('preserveAspectRatio', 'none')
    element.style.maxWidth = 'none'
    for (const [id, entry] of Object.entries(geometry.current)) {
      entry.element.classList.toggle(
        'diagram-node-selected',
        !!selected && 'node' in selected && id === selected.node,
      )
      entry.element.classList.toggle('diagram-connect-origin', connect?.from === id)
      entry.element.setAttribute('tabindex', '0')
      entry.element.setAttribute('role', 'button')
      entry.element.setAttribute(
        'aria-label',
        graph.nodes.find((node) => node.id === id)?.label ?? id,
      )
      // Ports belong to the canvas overlay, not the saved Mermaid source or document.
      if (!entry.element.querySelector('.diagram-port')) {
        for (const [cx, cy] of [
          [0, -entry.height / 2],
          [entry.width / 2, 0],
          [0, entry.height / 2],
          [-entry.width / 2, 0],
        ]) {
          const port = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
          port.setAttribute('cx', String(cx))
          port.setAttribute('cy', String(cy))
          port.setAttribute('r', '5')
          port.setAttribute('class', 'diagram-port')
          entry.element.append(port)
        }
      }
    }
    const counts = new Map<string, number>()
    graph.edges.forEach((edge, index) => {
      const pair = `${edge.from}_${edge.to}`,
        count = counts.get(pair) ?? 0
      counts.set(pair, count + 1)
      const path = element.querySelector<SVGPathElement>(
        `path.flowchart-link[data-id="L_${pair}_${count}"]`,
      )
      if (!path) return
      let hit = path.parentElement?.querySelector<SVGPathElement>(`[data-diagram-edge="${index}"]`)
      if (!hit) {
        hit = document.createElementNS('http://www.w3.org/2000/svg', 'path')
        hit.dataset.diagramEdge = String(index)
        hit.setAttribute('class', 'diagram-edge-hit')
        hit.setAttribute('tabindex', '0')
        hit.setAttribute('role', 'button')
        path.parentElement?.append(hit)
      }
      hit.setAttribute('d', path.getAttribute('d') ?? '')
      hit.setAttribute(
        'aria-label',
        `${t('Connection')}: ${edge.from} → ${edge.to}${edge.label ? ` · ${edge.label}` : ''}`,
      )
      path.classList.toggle(
        'diagram-edge-selected',
        !!selected && 'edge' in selected && index === selected.edge,
      )
    })
    if (fitted.current !== fitRevision && !pending) {
      fitted.current = fitRevision
      fit()
    }
    const selectionElement =
      selected &&
      ('node' in selected
        ? geometry.current[selected.node]?.element
        : element.querySelector(`[data-diagram-edge="${selected.edge}"]`))
    const bounds = selectionElement?.getBoundingClientRect(),
      container = stage.current?.getBoundingClientRect()
    const next =
      bounds && container
        ? {
            x: clamp(bounds.right - container.left + 8, 8, size.width - 40),
            y: clamp(bounds.top - container.top - 12, 66, size.height - 70),
          }
        : null
    onAnchorChange(!!next)
    setAnchorPoint((current) => (current?.x === next?.x && current?.y === next?.y ? current : next))
  }, [svg, positions, source, selected, view, size, fitRevision, pending, connect?.from])
  function point(clientX: number, clientY: number) {
    const matrix = root.current?.querySelector('svg')?.getScreenCTM()
    return matrix ? new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse()) : null
  }
  function zoom(factor: number) {
    setView((current) => {
      const next = clamp(current.zoom * factor, 0.01, 2.5)
      return {
        x: current.x + size.width / current.zoom / 2 - size.width / next / 2,
        y: current.y + size.height / current.zoom / 2 - size.height / next / 2,
        zoom: next,
      }
    })
    onView()
  }
  const origin =
    connect &&
    (Object.hasOwn(positions, connect.from)
      ? positions[connect.from]
      : geometry.current[connect.from])
  const originBounds = connect && geometry.current[connect.from]
  const start =
    origin && originBounds
      ? diagramBoundary(
          origin,
          connect!.point,
          originBounds.width,
          originBounds.height,
          graph.nodes.find((node) => node.id === connect!.from)!.shape,
        )
      : null
  return (
    <div
      ref={stage}
      className={`diagram-canvas tool-${tool}`}
      aria-label={t('Diagram canvas')}
      aria-busy={pending}
    >
      <div
        ref={root}
        className="diagram-canvas-svg"
        dangerouslySetInnerHTML={{ __html: svg }}
        onPointerDown={(event) => {
          if (
            pending ||
            (event.button !== 0 && event.button !== 1) ||
            !(event.target instanceof Element)
          )
            return
          const id = event.target.closest<SVGGElement>('[data-diagram-node]')?.dataset.diagramNode
          const edge =
            event.target.closest<SVGPathElement>('[data-diagram-edge]')?.dataset.diagramEdge
          const cursor = point(event.clientX, event.clientY)
          if (!cursor) return
          event.preventDefault()
          event.currentTarget.focus({ preventScroll: true })
          onView()
          if (event.button === 1 || tool === 'hand') {
            gesture.current = {
              pointer: event.pointerId,
              client: { x: event.clientX, y: event.clientY },
              moved: false,
              pan: view,
            }
          } else if (tool === 'arrow' || tool === 'line') {
            if (!id) {
              setConnect(null)
              onSelect(null)
              return
            }
            if (connect) {
              onConnect(connect.from, id, tool)
              setConnect(null)
              return
            }
            setConnect({ from: id, point: cursor })
            gesture.current = {
              pointer: event.pointerId,
              client: { x: event.clientX, y: event.clientY },
              moved: false,
              connection: id,
            }
          } else if (diagramShapes.includes(tool as DiagramShape)) {
            onPlace(tool as DiagramShape, cursor)
            return
          } else if (id && geometry.current[id]) {
            onSelect({ node: id })
            const position = Object.hasOwn(positions, id) ? positions[id] : geometry.current[id]
            gesture.current = {
              pointer: event.pointerId,
              client: { x: event.clientX, y: event.clientY },
              moved: false,
              node: id,
              offset: { x: cursor.x - position.x, y: cursor.y - position.y },
            }
          } else if (edge !== undefined) {
            onSelect({ edge: Number(edge) })
            onInspect()
            return
          } else {
            onSelect(null)
            return
          }
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          const current = gesture.current,
            cursor = point(event.clientX, event.clientY)
          if (connect && cursor) setConnect({ ...connect, point: cursor })
          if (!current || current.pointer !== event.pointerId || !cursor) return
          if (Math.hypot(event.clientX - current.client.x, event.clientY - current.client.y) > 3)
            current.moved = true
          if (!current.moved) return
          if (current.pan)
            setView({
              ...current.pan,
              x: current.pan.x - (event.clientX - current.client.x) / view.zoom,
              y: current.pan.y - (event.clientY - current.client.y) / view.zoom,
            })
          if (current.node && current.offset) {
            onMove(current.node, {
              x: clamp(cursor.x - current.offset.x, -9900, 9900),
              y: clamp(cursor.y - current.offset.y, -9900, 9900),
            })
          }
        }}
        onPointerUp={(event) => {
          const current = gesture.current
          gesture.current = null
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId)
          if (!current) return
          if (current.connection && current.moved && (tool === 'arrow' || tool === 'line')) {
            const target = document
              .elementFromPoint(event.clientX, event.clientY)
              ?.closest<SVGGElement>('[data-diagram-node]')?.dataset.diagramNode
            if (target) onConnect(current.connection, target, tool)
            setConnect(null)
          } else if (current.node && !current.moved) onInspect()
        }}
        onPointerCancel={() => {
          gesture.current = null
          setConnect(null)
        }}
        onLostPointerCapture={() => {
          gesture.current = null
        }}
        onKeyDown={(event) => {
          if (!(event.target instanceof Element)) return
          const id = event.target.closest<SVGGElement>('[data-diagram-node]')?.dataset.diagramNode
          const edge =
            event.target.closest<SVGPathElement>('[data-diagram-edge]')?.dataset.diagramEdge
          if (event.key === 'Enter' || event.key === ' ') {
            if (id) {
              event.preventDefault()
              if (tool === 'arrow' || tool === 'line') {
                if (connect) {
                  onConnect(connect.from, id, tool)
                  setConnect(null)
                } else
                  setConnect({
                    from: id,
                    point: Object.hasOwn(positions, id) ? positions[id] : geometry.current[id],
                  })
              } else {
                onSelect({ node: id })
                onInspect()
              }
            } else if (edge !== undefined) {
              event.preventDefault()
              onSelect({ edge: Number(edge) })
              onInspect()
            }
          }
          if (!id || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key))
            return
          event.preventDefault()
          onSelect({ node: id })
          onView()
          const position = Object.hasOwn(positions, id) ? positions[id] : geometry.current[id],
            step = event.shiftKey ? 20 : 5
          onMove(id, {
            x: clamp(
              position.x +
                (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0),
              -9900,
              9900,
            ),
            y: clamp(
              position.y + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0),
              -9900,
              9900,
            ),
          })
        }}
        tabIndex={-1}
      />
      {connect && start && (
        <svg
          className="diagram-connection-preview"
          viewBox={`${view.x} ${view.y} ${size.width / view.zoom} ${size.height / view.zoom}`}
          preserveAspectRatio="none"
        >
          <defs>
            <marker
              id="diagram-draft-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" />
            </marker>
          </defs>
          <path
            d={`M ${start.x} ${start.y} L ${connect.point.x} ${connect.point.y}`}
            markerEnd={tool === 'arrow' ? 'url(#diagram-draft-arrow)' : undefined}
          />
        </svg>
      )}
      {selected && anchorPoint && (
        <button
          ref={anchor}
          className="diagram-inspector-trigger"
          aria-label={t('Element settings')}
          title={t('Element settings')}
          style={{ left: anchorPoint.x, top: anchorPoint.y }}
          onClick={onInspect}
        >
          <Pencil size={15} />
        </button>
      )}
      <div className="diagram-zoom" role="group" aria-label={t('Canvas view')}>
        <button aria-label={t('Zoom out')} title={t('Zoom out')} onClick={() => zoom(1 / 1.2)}>
          <Minus size={16} />
        </button>
        <span>{Math.round(view.zoom * 100)}%</span>
        <button aria-label={t('Zoom in')} title={t('Zoom in')} onClick={() => zoom(1.2)}>
          <Plus size={16} />
        </button>
        <button aria-label={t('Fit diagram')} title={t('Fit diagram')} onClick={fit}>
          <Scan size={17} />
        </button>
      </div>
      <span className="diagram-canvas-hint">
        {t(
          tool === 'arrow' || tool === 'line'
            ? 'Drag between blocks, or click the start and end blocks.'
            : diagramShapes.includes(tool as DiagramShape)
              ? 'Click the canvas to place a block.'
              : tool === 'hand'
                ? 'Drag the canvas to move around.'
                : 'Drag to move. Click an element to edit.',
        )}
      </span>
      {pending && <span className="diagram-canvas-status">{t('Rendering diagram…')}</span>}
      {error && (
        <div className="diagram-error diagram-canvas-error" role="alert">
          <strong>{t('Check the Mermaid code')}</strong>
          <pre>{error}</pre>
        </div>
      )}
    </div>
  )
}

export function DiagramEditor({
  source: initialSource,
  positions: initialPositions,
  onClose,
  onApply,
}: {
  source: string
  positions: DiagramPositions
  onClose: () => void
  onApply: (source: string, positions: DiagramPositions) => boolean
}) {
  const { t } = useI18n()
  const [source, setSource] = useState(initialSource)
  const [positions, setPositions] = useState(initialPositions)
  const natural = useRef<DiagramPositions>({})
  const [tab, setTab] = useState<'visual' | 'code'>(
    parseFlowchart(initialSource) ? 'visual' : 'code',
  )
  const [tool, setTool] = useState<Tool>('select')
  const [shape, setShape] = useState<DiagramShape>('rectangle')
  const [menu, setMenu] = useState<'shapes' | 'layout' | null>(null)
  const shapeAnchor = useRef<HTMLButtonElement>(null),
    layoutAnchor = useRef<HTMLButtonElement>(null),
    elementAnchor = useRef<HTMLButtonElement>(null)
  const [selected, setSelected] = useState<Selection>(null)
  const [inspect, setInspect] = useState(false)
  const [anchorReady, setAnchorReady] = useState(false)
  const [fitRevision, setFitRevision] = useState(0)
  const [valid, setValid] = useState(false)
  const [conflict, setConflict] = useState(false)
  const graph = parseFlowchart(source)
  const node =
    selected && 'node' in selected
      ? graph?.nodes.find((node) => node.id === selected.node)
      : undefined
  const edge = selected && 'edge' in selected ? graph?.edges[selected.edge] : undefined
  const ShapeIcon = shapeIcons[shape]
  const snapshotPositions = () =>
    Object.fromEntries(
      (graph?.nodes ?? []).map((node) => [
        node.id,
        Object.hasOwn(positions, node.id)
          ? positions[node.id]
          : (natural.current[node.id] ?? { x: 150, y: 100 }),
      ]),
    )
  function change(next: Flowchart, nextPositions = snapshotPositions()) {
    setValid(false)
    setSource(flowchartSource(next))
    setPositions(nextPositions)
  }
  function choose(next: Tool) {
    setTool(next)
    setInspect(false)
    setMenu(null)
  }
  function remove() {
    if (!graph || !selected) return
    setInspect(false)
    setSelected(null)
    if ('node' in selected) {
      const nextPositions = snapshotPositions()
      delete nextPositions[selected.node]
      change(
        {
          ...graph,
          nodes: graph.nodes.filter((node) => node.id !== selected.node),
          edges: graph.edges.filter(
            (edge) => edge.from !== selected.node && edge.to !== selected.node,
          ),
        },
        nextPositions,
      )
    } else change({ ...graph, edges: graph.edges.filter((_, index) => index !== selected.edge) })
  }
  return createPortal(
    <Modal
      title={t('Edit diagram')}
      wide
      className="diagram-editor"
      onClose={onClose}
      headerActions={
        <div className="diagram-editor-tabs" role="tablist" aria-label={t('Diagram editor')}>
          {(['visual', 'code'] as const).map((value) => (
            <button
              type="button"
              role="tab"
              aria-selected={tab === value}
              key={value}
              onClick={() => {
                setTab(value)
                setInspect(false)
                setMenu(null)
              }}
            >
              {value === 'code' && <Code2 size={15} />}
              {t(value === 'visual' ? 'Visual editor' : 'Mermaid code')}
            </button>
          ))}
        </div>
      }
    >
      <div className={`diagram-editor-body ${tab === 'code' ? 'is-code' : ''}`} role="tabpanel">
        {tab === 'visual' && graph ? (
          <>
            <Canvas
              source={source}
              graph={graph}
              positions={positions}
              tool={tool}
              selected={selected}
              fitRevision={fitRevision}
              anchor={elementAnchor}
              onSelect={setSelected}
              onInspect={() => setInspect(true)}
              onView={() => setInspect(false)}
              onStatus={setValid}
              onAnchorChange={setAnchorReady}
              onGeometry={(value) => {
                natural.current = value
              }}
              onMove={(id, point) =>
                setPositions((current) => ({ ...natural.current, ...current, [id]: point }))
              }
              onPlace={(shape, point) => {
                if (graph.nodes.length >= 100) return
                let count = 1
                while (graph.nodes.some((node) => node.id === `N${count}`)) count++
                const id = `N${count}`
                change(
                  { ...graph, nodes: [...graph.nodes, { id, label: t('New block'), shape }] },
                  {
                    ...snapshotPositions(),
                    [id]: { x: clamp(point.x, -9800, 9800), y: clamp(point.y, -9800, 9800) },
                  },
                )
                setSelected({ node: id })
                choose('select')
                setInspect(true)
              }}
              onConnect={(from, to, kind) => {
                if (graph.edges.length >= 200) return
                change({
                  ...graph,
                  edges: [
                    ...graph.edges,
                    { from, to, label: '', ...(kind === 'line' ? { kind } : {}) },
                  ],
                })
                setSelected({ edge: graph.edges.length })
                choose('select')
                setInspect(true)
              }}
            />
            <div className="diagram-tools" role="toolbar" aria-label={t('Diagram tools')}>
              <button
                data-autofocus
                aria-label={t('Select elements')}
                title={t('Select elements')}
                aria-pressed={tool === 'select'}
                onClick={() => choose('select')}
              >
                <MousePointer2 size={19} />
              </button>
              <button
                aria-label={t('Pan canvas')}
                title={t('Pan canvas')}
                aria-pressed={tool === 'hand'}
                onClick={() => choose('hand')}
              >
                <Hand size={19} />
              </button>
              <span className="diagram-tool-divider" />
              <button
                ref={shapeAnchor}
                aria-label={t('Add diagram block')}
                title={t('Add diagram block')}
                aria-haspopup="menu"
                aria-expanded={menu === 'shapes'}
                aria-pressed={diagramShapes.includes(tool as DiagramShape)}
                disabled={!valid || graph.nodes.length >= 100}
                onClick={() => {
                  setInspect(false)
                  setMenu(menu === 'shapes' ? null : 'shapes')
                }}
              >
                <ShapeIcon size={19} />
              </button>
              <button
                aria-label={t('Draw arrow')}
                title={t('Draw arrow')}
                aria-pressed={tool === 'arrow'}
                disabled={!valid || graph.nodes.length < 1 || graph.edges.length >= 200}
                onClick={() => choose('arrow')}
              >
                <ArrowUpRight size={20} />
              </button>
              <button
                aria-label={t('Draw connection')}
                title={t('Draw connection')}
                aria-pressed={tool === 'line'}
                disabled={!valid || graph.nodes.length < 1 || graph.edges.length >= 200}
                onClick={() => choose('line')}
              >
                <Slash size={18} />
              </button>
              <span className="diagram-tool-divider" />
              <button
                ref={layoutAnchor}
                aria-label={t('Diagram layout')}
                title={t('Diagram layout')}
                aria-haspopup="dialog"
                aria-expanded={menu === 'layout'}
                disabled={!valid}
                onClick={() => {
                  setInspect(false)
                  setMenu(menu === 'layout' ? null : 'layout')
                }}
              >
                <LayoutGrid size={19} />
              </button>
            </div>
            {menu === 'shapes' && (
              <Popover
                anchor={shapeAnchor}
                onClose={() => setMenu(null)}
                className="diagram-shape-menu"
              >
                <div role="menu" aria-label={t('Block shape')}>
                  {diagramShapes.map((value) => {
                    const Icon = shapeIcons[value]
                    return (
                      <button
                        key={value}
                        role="menuitem"
                        onClick={() => {
                          setShape(value)
                          choose(value)
                        }}
                      >
                        <Icon size={19} />
                        <span>{t(shapeLabels[value])}</span>
                      </button>
                    )
                  })}
                </div>
              </Popover>
            )}
            {menu === 'layout' && (
              <Popover
                anchor={layoutAnchor}
                onClose={() => setMenu(null)}
                className="diagram-properties"
              >
                <strong>{t('Diagram layout')}</strong>
                <PopoverPicker
                  className="diagram-picker"
                  popoverClassName="diagram-picker-popover"
                  label={t('Layout direction')}
                  value={graph.direction}
                  onChange={(direction) => {
                    change({ ...graph, direction: direction as Flowchart['direction'] }, {})
                    setFitRevision((value) => value + 1)
                  }}
                  options={[
                    { value: 'TB', label: t('Top to bottom') },
                    { value: 'BT', label: t('Bottom to top') },
                    { value: 'LR', label: t('Left to right') },
                    { value: 'RL', label: t('Right to left') },
                  ]}
                />
                <button
                  className="button"
                  onClick={() => {
                    setPositions({})
                    setFitRevision((value) => value + 1)
                    setMenu(null)
                  }}
                >
                  <LayoutGrid size={16} />
                  {t('Automatic layout')}
                </button>
              </Popover>
            )}
            {inspect && anchorReady && selected && (node || edge) && (
              <Popover
                anchor={elementAnchor}
                onClose={() => setInspect(false)}
                className="diagram-properties"
                key={node?.id ?? `edge-${'edge' in selected ? selected.edge : ''}`}
              >
                <div className="diagram-properties-heading">
                  <strong>{t(node ? 'Block settings' : 'Connection settings')}</strong>
                  <button aria-label={t('Close')} onClick={() => setInspect(false)}>
                    <X size={15} />
                  </button>
                </div>
                {node ? (
                  <>
                    <label>
                      {t('Block label')}
                      <input
                        aria-label={t('Block label')}
                        maxLength={1000}
                        value={node.label}
                        onChange={(event) =>
                          change({
                            ...graph,
                            nodes: graph.nodes.map((item) =>
                              item.id === node.id ? { ...item, label: event.target.value } : item,
                            ),
                          })
                        }
                      />
                    </label>
                    <PopoverPicker
                      className="diagram-picker"
                      popoverClassName="diagram-picker-popover"
                      label={t('Block shape')}
                      value={node.shape}
                      onChange={(shape) =>
                        change({
                          ...graph,
                          nodes: graph.nodes.map((item) =>
                            item.id === node.id ? { ...item, shape: shape as DiagramShape } : item,
                          ),
                        })
                      }
                      options={diagramShapes.map((value) => {
                        const Icon = shapeIcons[value]
                        return { value, label: t(shapeLabels[value]), icon: <Icon size={15} /> }
                      })}
                    />
                  </>
                ) : edge && 'edge' in selected ? (
                  <>
                    <label>
                      {t('Connection label')}
                      <input
                        aria-label={t('Connection label')}
                        maxLength={1000}
                        value={edge.label}
                        onChange={(event) =>
                          change({
                            ...graph,
                            edges: graph.edges.map((item, index) =>
                              index === selected.edge
                                ? { ...item, label: event.target.value }
                                : item,
                            ),
                          })
                        }
                      />
                    </label>
                    <PopoverPicker
                      className="diagram-picker"
                      popoverClassName="diagram-picker-popover"
                      label={t('Connection type')}
                      value={edge.kind ?? 'arrow'}
                      options={[
                        { value: 'arrow', label: t('Arrow'), icon: <ArrowUpRight size={15} /> },
                        { value: 'line', label: t('Connection'), icon: <Minus size={15} /> },
                      ]}
                      onChange={(kind) =>
                        change({
                          ...graph,
                          edges: graph.edges.map((item, index) => {
                            if (index !== selected.edge) return item
                            const { kind: _, ...rest } = item
                            return kind === 'line' ? { ...rest, kind: 'line' } : rest
                          }),
                        })
                      }
                    />
                    <div className="diagram-connection-endpoints">
                      <span>{graph.nodes.find((node) => node.id === edge.from)?.label}</span>
                      {edge.kind === 'line' ? <Minus size={14} /> : <ArrowUpRight size={14} />}
                      <span>{graph.nodes.find((node) => node.id === edge.to)?.label}</span>
                    </div>
                  </>
                ) : null}
                <button className="button diagram-delete" onClick={remove}>
                  <Trash2 size={15} />
                  {t(node ? 'Delete diagram block' : 'Delete connection')}
                </button>
              </Popover>
            )}
          </>
        ) : tab === 'code' ? (
          <>
            <label className="diagram-code-panel">
              {t('Mermaid code')}
              <textarea
                aria-label={t('Mermaid code')}
                className="diagram-code"
                spellCheck={false}
                maxLength={50000}
                value={source}
                onChange={(event) => {
                  setValid(false)
                  setSource(event.target.value)
                  setPositions({})
                  setSelected(null)
                }}
              />
            </label>
            <DiagramPreview source={source} positions={positions} onStatus={setValid} />
          </>
        ) : (
          <p className="diagram-unsupported">
            {t(
              'The visual editor supports simple flowcharts. Edit this diagram in Mermaid code; its source is preserved.',
            )}
          </p>
        )}
      </div>
      {conflict && (
        <p className="diagram-conflict" role="alert">
          {t(
            'This diagram changed while you were editing. Close and reopen the editor to review the latest version.',
          )}
        </p>
      )}
      <footer className="diagram-editor-footer">
        <button className="button" onClick={onClose}>
          {t('Cancel')}
        </button>
        <button
          className="button primary"
          disabled={!valid}
          onClick={() => {
            if (!onApply(source, positions)) setConflict(true)
          }}
        >
          {t('Apply')}
        </button>
      </footer>
    </Modal>,
    document.body,
  )
}
