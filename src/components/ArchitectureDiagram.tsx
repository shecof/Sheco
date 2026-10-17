import { createPortal } from 'react-dom'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import {
  Database,
  Globe,
  Group,
  Pencil,
  Copy,
  Hand,
  MapPin,
  MousePointer2,
  Server,
  Trash2,
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { copyArchitectureSelection, isArchitectureClipboard } from '../shared/architectureClipboard'
import { useI18n } from '../i18n'
import { IconButton, Popover } from './ui'
import { BlockSubmenu } from '../editor/BlockMenu'
import { type ArchitectureSubject } from './ArchitectureProperties'
import {
  architectureObjectSections,
  type ArchitectureObjectSection,
} from './architecturePropertySections'
import {
  architectureDiagramLayout,
  architectureSvg,
  architectureLimits,
  architectureLabelAnchor,
  architectureLabelProjection,
  type ArchitecturePoint,
  type ArchitectureProject,
  type ArchitectureObject,
  type ArchitectureBounds,
  type ArchitectureDiagramLayout,
} from '../shared/projectArchitecture'
import {
  placeArchitectureSelection,
  architectureGrid,
  type ArchitectureGuide,
  type ArchitecturePlacementKind,
} from '../shared/architecturePlacement'

type View = ArchitecturePoint & { zoom: number }
type Gesture = {
  pointer: number
  project: ArchitectureProject
  mode: 'place' | 'label' | 'label-rotate' | 'connect' | 'reconnect' | 'marquee' | 'pan'
  kind: ArchitecturePlacementKind
  endpoint?: 'from' | 'to'
  linkId?: string
  view: View
  ids: string[]
  start: ArchitecturePoint
  svgStart: ArchitecturePoint
  moved: boolean
  additive: boolean
  previous: string[]
}
type Context = ArchitecturePoint & {
  world?: ArchitecturePoint
  siteId?: string
  groupId?: string
  subject?: ArchitectureSubject
  ids: string[]
}
const inside = (point: ArchitecturePoint, box: ArchitectureBounds) =>
  point.x >= box.x &&
  point.x <= box.x + box.width &&
  point.y >= box.y &&
  point.y <= box.y + box.height
const intersection = (a: ArchitectureBounds, b: ArchitectureBounds) =>
  a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y
const snapRotation = (angle: number) => {
  const snapped = Math.round(angle / 15) * 15
  return ((snapped + 540) % 360) - 180
}
const minZoom = 0.001,
  maxZoom = 2.5
export function ArchitectureDiagram({
  project,
  siteId,
  subject,
  onInspect,
  onCreateObject,
  onCreateGroup,
  onCreateSite,
  onConnect,
  onReconnect,
  onPlace,
  onDuplicate,
  onPaste,
  onDeleteObjects,
  onDeleteSubject,
  onUndo,
  canUndo,
  canRedo,
  onRedo,
  focusRequest,
}: {
  project: ArchitectureProject
  siteId?: string
  subject: ArchitectureSubject | null
  onInspect: (subject: ArchitectureSubject | null, point?: ArchitecturePoint) => boolean
  onCreateObject: (
    type: ArchitectureObject['type'],
    siteId: string | undefined,
    groupId?: string,
    point?: ArchitecturePoint,
    position?: ArchitecturePoint,
  ) => string | null
  onCreateGroup: (
    siteId: string | undefined,
    ids?: string[],
    point?: ArchitecturePoint,
  ) => string | null
  onCreateSite: (point?: ArchitecturePoint, position?: ArchitecturePoint) => string | null
  onConnect: (from: string, to: string) => string | null
  onReconnect: (
    baseline: ArchitectureProject,
    id: string,
    endpoint: 'from' | 'to',
    objectId: string,
  ) => boolean
  onPlace: (baseline: ArchitectureProject, next: ArchitectureProject) => boolean
  onDuplicate: (ids: string[]) => string[] | null
  onPaste: (text: string) => { ids: string[]; groupId?: string } | null
  onDeleteObjects: (ids: string[]) => boolean
  onDeleteSubject: (subject: ArchitectureSubject) => void
  onUndo: () => void
  canUndo: boolean
  canRedo: boolean
  onRedo: () => void
  focusRequest?: { id: string; sequence: number }
}) {
  const { t, language } = useI18n()
  const host = useRef<HTMLDivElement>(null)
  const contextAnchor = useRef<HTMLSpanElement>(null)
  const [size, setSize] = useState({ width: 1000, height: 650 })
  const [canvasHeight, setCanvasHeight] = useState(650)
  const [view, setView] = useState<View>({ x: 0, y: 0, zoom: 1 })
  const viewRef = useRef(view)
  const manualView = useRef(false)
  const fittedScope = useRef('')
  const previousSize = useRef(size)
  const [tool, setTool] = useState<'select' | 'hand'>('select')
  const [spaceHeld, setSpaceHeld] = useState(false)
  const spaceRef = useRef(false)
  const spacePanned = useRef(false)
  const [panning, setPanning] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null)
  const [connecting, setConnecting] = useState<string | null>(null)
  const [selectedLink, setSelectedLink] = useState<string | null>(null)
  const [pendingEndpoint, setPendingEndpoint] = useState<{
    linkId: string
    endpoint: 'from' | 'to'
  } | null>(null)
  const [connectionTarget, setConnectionTarget] = useState<string | null>(null)
  const [draftOrigin, setDraftOrigin] = useState<string | null>(null)
  const [context, setContext] = useState<Context | null>(null)
  const [keyboard, setKeyboard] = useState(false)
  const [placementGuides, setPlacementGuides] = useState<ArchitectureGuide[]>([])
  const [placementLines, setPlacementLines] = useState<
    { from: ArchitecturePoint; to: ArchitecturePoint }[]
  >([])
  const restorePlacement = useRef<() => void>(() => {})
  const placementResult = useRef<ArchitectureProject | null>(null)
  const [line, setLine] = useState<{ from: ArchitecturePoint; to: ArchitecturePoint } | null>(null)
  const [labelPreview, setLabelPreview] = useState<
    (ArchitecturePoint & { rotation: number }) | null
  >(null)
  const [marquee, setMarquee] = useState<ArchitectureBounds | null>(null)
  const gesture = useRef<Gesture | null>(null)
  const lastPointer = useRef<ArchitecturePoint | null>(null)
  const edgeFrame = useRef<number | null>(null)
  const refreshGesture = useRef<() => void>(() => {})
  useEffect(
    () => () => {
      if (edgeFrame.current !== null) cancelAnimationFrame(edgeFrame.current)
    },
    [],
  )
  const ignoreClick = useRef(false)
  const layout = useMemo(() => architectureDiagramLayout(project, siteId), [project, siteId])
  const svg = useMemo(
    () => architectureSvg(project, siteId, t, true, undefined, layout),
    [project, siteId, t, language, layout],
  )
  const selectedEdge = layout.edges.find((edge) => edge.link.id === selectedLink)
  useLayoutEffect(() => {
    const node = host.current
    if (!node) return
    const resize = () => {
      if (node.clientWidth <= 2 || node.clientHeight <= 2) return
      const height = Math.round(
        Math.max(280, Math.min(700, window.innerHeight - node.getBoundingClientRect().top - 24)),
      )
      setCanvasHeight(height)
      setSize((current) =>
        current.width === node.clientWidth && current.height === node.clientHeight
          ? current
          : { width: node.clientWidth, height: node.clientHeight },
      )
    }
    const observer = new ResizeObserver(resize)
    resize()
    observer.observe(node)
    const page = node.closest('.architecture-page')
    if (page) observer.observe(page)
    const scroller = node.closest('.content-scroll')
    scroller?.addEventListener('scroll', resize, { passive: true })
    window.addEventListener('resize', resize)
    return () => {
      observer.disconnect()
      scroller?.removeEventListener('scroll', resize)
      window.removeEventListener('resize', resize)
    }
  }, [])
  function updateView(next: View) {
    viewRef.current = next
    setView(next)
  }
  function fit() {
    const zoom = Math.max(
      minZoom,
      Math.min(
        Math.max(1, size.width - 48) / layout.width,
        Math.max(1, size.height - 144) / layout.height,
        1,
      ),
    )
    manualView.current = false
    updateView({
      x: layout.x + (layout.width - size.width / zoom) / 2,
      y: layout.y + (layout.height - size.height / zoom) / 2,
      zoom,
    })
  }
  useLayoutEffect(() => {
    const scope = `${project.id}:${siteId ?? ''}`
    if (fittedScope.current !== scope) {
      fittedScope.current = scope
      manualView.current = false
    }
    if (!manualView.current) fit()
    else {
      const old = previousSize.current,
        current = viewRef.current
      updateView({
        ...current,
        x: current.x + (old.width - size.width) / current.zoom / 2,
        y: current.y + (old.height - size.height) / current.zoom / 2,
      })
    }
    previousSize.current = size
  }, [project.id, siteId, layout.x, layout.y, layout.width, layout.height, size])
  useLayoutEffect(() => {
    const node = layout.nodes.find((node) => node.object.id === focusRequest?.id)
    if (!node) return
    const zoom = Math.max(0.75, Math.min(1.2, viewRef.current.zoom))
    manualView.current = true
    updateView({
      x: node.x + node.width / 2 - size.width / zoom / 2,
      y: node.y + node.height / 2 - size.height / zoom / 2,
      zoom,
    })
    setSelected([node.object.id])
    setSelectedLink(null)
    setContext(null)
    host.current?.focus({ preventScroll: true })
  }, [focusRequest])
  const viewBox = `${view.x} ${view.y} ${size.width / view.zoom} ${size.height / view.zoom}`
  useLayoutEffect(() => {
    const element = host.current?.querySelector('svg')
    if (!element) return
    element.setAttribute('viewBox', viewBox)
    element.setAttribute('width', '100%')
    element.setAttribute('height', '100%')
    element.setAttribute('preserveAspectRatio', 'none')
  }, [svg, viewBox])
  function zoomAt(factor: number, anchor?: ArchitecturePoint) {
    if (gesture.current?.mode === 'pan') return
    const node = host.current
    if (!node) return
    const bounds = node.getBoundingClientRect(),
      current = viewRef.current,
      x = anchor ? anchor.x - bounds.left - node.clientLeft : node.clientWidth / 2,
      y = anchor ? anchor.y - bounds.top - node.clientTop : node.clientHeight / 2,
      zoom = Math.max(minZoom, Math.min(maxZoom, current.zoom * factor))
    manualView.current = true
    updateView({
      x: current.x + x / current.zoom - x / zoom,
      y: current.y + y / current.zoom - y / zoom,
      zoom,
    })
    setContext(null)
  }
  // A non-passive listener keeps wheel/pinch gestures inside the canvas instead of scrolling
  // the page or zooming Electron's whole renderer. Read the camera ref for batched wheel input.
  useEffect(() => {
    const node = host.current
    if (!node) return
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      if (event.target instanceof Element && event.target.closest('.architecture-diagram-controls'))
        return
      if (gesture.current?.mode === 'pan') return
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? node.clientHeight : 1
      if (event.ctrlKey || event.metaKey)
        zoomAt(Math.exp(-Math.max(-500, Math.min(500, event.deltaY * unit)) * 0.002), {
          x: event.clientX,
          y: event.clientY,
        })
      else {
        const current = viewRef.current
        manualView.current = true
        updateView({
          ...current,
          x:
            current.x +
            ((event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX) * unit) / current.zoom,
          y:
            current.y +
            ((event.shiftKey && !event.deltaX ? 0 : event.deltaY) * unit) / current.zoom,
        })
        setContext(null)
      }
      refreshGesture.current()
    }
    const workspace = node.parentElement!
    workspace.addEventListener('wheel', wheel, { passive: false })
    return () => workspace.removeEventListener('wheel', wheel)
  }, [])
  function clearGesture() {
    gesture.current = null
    if (edgeFrame.current !== null) cancelAnimationFrame(edgeFrame.current)
    edgeFrame.current = null
    lastPointer.current = null
    setPanning(false)
    setLabelPreview(null)
    restorePlacement.current()
    restorePlacement.current = () => {}
    placementResult.current = null
    setPlacementGuides([])
    setPlacementLines([])
    setLine(null)
    setConnectionTarget(null)
    setDraftOrigin(null)
    setMarquee(null)
    host.current
      ?.querySelectorAll('.drop-active,.is-dragging')
      .forEach((node) => node.classList.remove('drop-active', 'is-dragging'))
  }
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !gesture.current) return
      setSelected(gesture.current.previous)
      if (gesture.current.mode === 'pan') updateView(gesture.current.view)
      ignoreClick.current = true
      clearGesture()
      setConnecting(null)
      setPendingEndpoint(null)
      event.preventDefault()
      event.stopPropagation()
    }
    const space = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || !host.current?.contains(document.activeElement)) return
      event.preventDefault()
      if (!event.repeat) spacePanned.current = false
      spaceRef.current = true
      setSpaceHeld(true)
    }
    const release = () => {
      spaceRef.current = false
      setSpaceHeld(false)
    }
    const keyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') release()
    }
    document.addEventListener('keydown', cancel, true)
    document.addEventListener('keydown', space, true)
    document.addEventListener('keyup', keyUp, true)
    window.addEventListener('blur', release)
    return () => {
      document.removeEventListener('keydown', cancel, true)
      document.removeEventListener('keydown', space, true)
      document.removeEventListener('keyup', keyUp, true)
      window.removeEventListener('blur', release)
    }
  }, [])
  useEffect(() => {
    clearGesture()
    setConnecting(null)
    setPendingEndpoint(null)
    setSelectedLink((id) => (layout.edges.some((edge) => edge.link.id === id) ? id : null))
    setSelectedGroup((id) => (layout.groups.some((group) => group.id === id) ? id : null))
    setContext(null)
    setSelected((ids) => ids.filter((id) => layout.nodes.some((node) => node.object.id === id)))
  }, [project, siteId])
  useEffect(() => {
    if (subject?.kind === 'object') setSelected([subject.id])
    else if (subject) {
      setSelected([])
      if (subject.kind === 'link') setSelectedLink(subject.id)
    }
  }, [subject?.kind, subject?.id])
  useLayoutEffect(() => {
    host.current?.querySelectorAll('[data-architecture-object]').forEach((node) => {
      node.classList.toggle(
        'selected',
        selected.includes(node.getAttribute('data-architecture-object')!),
      )
      node.classList.toggle(
        'connecting',
        node.getAttribute('data-architecture-object') === (draftOrigin ?? connecting),
      )
      node.classList.toggle(
        'connection-target',
        node.getAttribute('data-architecture-object') === connectionTarget,
      )
    })
    host.current?.querySelectorAll('[data-architecture-group]').forEach((node) => {
      node.classList.toggle(
        'selected',
        node.getAttribute('data-architecture-group') === selectedGroup,
      )
    })
    host.current
      ?.querySelectorAll(
        '[data-architecture-link],[data-architecture-link-label],[data-architecture-link-bridge]',
      )
      .forEach((node) => {
        const id =
          node.getAttribute('data-architecture-link') ??
          node.getAttribute('data-architecture-link-label') ??
          node.getAttribute('data-architecture-link-bridge')
        const link = project.links.find((link) => link.id === id)
        const incident = !!link && (selected.includes(link.from) || selected.includes(link.to))
        node.classList.toggle('selected', id === selectedLink || incident)
        node.classList.toggle('connection-muted', !!selected.length && !incident)
      })
  }, [selected, selectedGroup, connecting, draftOrigin, connectionTarget, selectedLink, svg])
  const coordinate = (client: ArchitecturePoint): ArchitecturePoint | null => {
    const node = host.current
    if (!node) return null
    const bounds = node.getBoundingClientRect(),
      camera = viewRef.current
    return {
      x: camera.x + (client.x - bounds.left - node.clientLeft) / camera.zoom,
      y: camera.y + (client.y - bounds.top - node.clientTop) / camera.zoom,
    }
  }
  const attribute = (target: EventTarget | null, key: string) =>
    target instanceof Element
      ? (target.closest(`[data-architecture-${key}]`)?.getAttribute(`data-architecture-${key}`) ??
        (key === 'link'
          ? (target
              .closest('[data-architecture-link-label]')
              ?.getAttribute('data-architecture-link-label') ??
            target
              .closest('[data-architecture-link-bridge]')
              ?.getAttribute('data-architecture-link-bridge'))
          : null))
      : null
  function connectionCandidate(
    point: ArchitecturePoint,
    from: string | null,
    request?: { linkId: string; endpoint: 'from' | 'to' } | null,
  ) {
    const target = layout.nodes.find((node) => inside(point, node))?.object.id
    const link = request && project.links.find((link) => link.id === request.linkId)
    const start = link ? (request!.endpoint === 'from' ? target : link.from) : from
    const end = link ? (request!.endpoint === 'to' ? target : link.to) : target
    return target &&
      start &&
      end &&
      start !== end &&
      !project.links.some(
        (item) => item.id !== request?.linkId && item.from === start && item.to === end,
      )
      ? target
      : null
  }
  function previewConnection(
    point: ArchitecturePoint,
    from: string | null,
    request?: { linkId: string; endpoint: 'from' | 'to' } | null,
  ) {
    const edge = request && layout.edges.find((edge) => edge.link.id === request.linkId)
    const source = layout.nodes.find((node) => node.object.id === from)
    if (edge)
      setLine({
        from: request!.endpoint === 'from' ? point : edge.points[0],
        to: request!.endpoint === 'to' ? point : edge.points.at(-1)!,
      })
    else if (source) setLine({ from: { x: source.x + source.width, y: source.y + 20 }, to: point })
    setConnectionTarget(connectionCandidate(point, from, request))
  }
  function completeConnection(from: string, to: string) {
    const id = onConnect(from, to)
    if (id) {
      setSelectedLink(id)
      setSelected([])
    }
    setConnecting(null)
    setLine(null)
    setConnectionTarget(null)
  }
  function showPlacement(next: ArchitectureDiagramLayout) {
    restorePlacement.current()
    const restores: (() => void)[] = []
    for (const kind of ['site', 'group', 'object'] as const) {
      const before =
        kind === 'site' ? layout.sites : kind === 'group' ? layout.groups : layout.nodes
      const after = kind === 'site' ? next.sites : kind === 'group' ? next.groups : next.nodes
      for (const box of before) {
        const id = 'object' in box ? box.object.id : box.id
        const moved = after.find((item) => ('object' in item ? item.object.id : item.id) === id)
        const node = host.current?.querySelector<SVGGElement>(`[data-architecture-${kind}="${id}"]`)
        if (!moved || !node) continue
        const previous = node.getAttribute('transform'),
          rect = node.querySelector('rect')
        const width = rect?.getAttribute('width'),
          height = rect?.getAttribute('height')
        node.setAttribute('transform', `translate(${moved.x - box.x} ${moved.y - box.y})`)
        if (rect) {
          rect.setAttribute('width', String(moved.width))
          rect.setAttribute('height', String(moved.height))
        }
        restores.push(() => {
          if (previous === null) node.removeAttribute('transform')
          else node.setAttribute('transform', previous)
          if (rect && width && height) {
            rect.setAttribute('width', width)
            rect.setAttribute('height', height)
          }
        })
      }
    }
    const drafts: { from: ArchitecturePoint; to: ArchitecturePoint }[] = []
    for (const edge of layout.edges) {
      const beforeFrom = layout.nodes.find((node) => node.object.id === edge.link.from)!,
        beforeTo = layout.nodes.find((node) => node.object.id === edge.link.to)!
      const afterFrom = next.nodes.find((node) => node.object.id === edge.link.from),
        afterTo = next.nodes.find((node) => node.object.id === edge.link.to)
      if (
        !afterFrom ||
        !afterTo ||
        (beforeFrom.x === afterFrom.x &&
          beforeFrom.y === afterFrom.y &&
          beforeTo.x === afterTo.x &&
          beforeTo.y === afterTo.y)
      )
        continue
      const edgeNodes =
        host.current?.querySelectorAll<SVGGElement>(
          `[data-architecture-link="${edge.link.id}"],[data-architecture-link-label="${edge.link.id}"]`,
        ) ?? []
      for (const node of edgeNodes) {
        const opacity = node.style.opacity
        node.style.opacity = '0.2'
        restores.push(() => {
          node.style.opacity = opacity
        })
      }
      drafts.push({
        from: {
          x: edge.points[0].x + afterFrom.x - beforeFrom.x,
          y: edge.points[0].y + afterFrom.y - beforeFrom.y,
        },
        to: {
          x: edge.points.at(-1)!.x + afterTo.x - beforeTo.x,
          y: edge.points.at(-1)!.y + afterTo.y - beforeTo.y,
        },
      })
    }
    setPlacementLines(drafts)
    restorePlacement.current = () => restores.forEach((restore) => restore())
  }
  const contextAt = (
    point: ArchitecturePoint,
    ids: string[] = selected,
    target?: EventTarget | null,
  ): Context => {
    const svgPoint = coordinate(point)
    const objectId = attribute(target ?? null, 'object'),
      linkId = attribute(target ?? null, 'link')
    const node = layout.nodes.find((node) => node.object.id === objectId)
    const groupId = attribute(target ?? null, 'group'),
      frameId = attribute(target ?? null, 'site')
    const group = groupId
      ? layout.groups.find((group) => group.id === groupId)
      : svgPoint
        ? [...layout.groups].reverse().find((group) => inside(svgPoint, group))
        : undefined
    const site = frameId
      ? layout.sites.find((site) => site.id === frameId)
      : svgPoint
        ? [...layout.sites].reverse().find((site) => inside(svgPoint, site))
        : undefined
    return {
      ...point,
      world: svgPoint ?? undefined,
      ids,
      siteId: node
        ? node.object.siteId
        : (group?.siteId ??
          site?.id ??
          (siteId && project.sites.some((site) => site.id === siteId) ? siteId : undefined)),
      groupId: node ? node.object.groupId : group?.id,
      subject: objectId
        ? { kind: 'object', id: objectId }
        : linkId
          ? { kind: 'link', id: linkId }
          : ids.length
            ? undefined
            : group
              ? { kind: 'group', id: group.id }
              : site
                ? { kind: 'site', id: site.id }
                : undefined,
    }
  }
  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if ((event.button !== 0 && event.button !== 1) || !(event.target instanceof Element)) return
    setContext(null)
    setKeyboard(false)
    ignoreClick.current = false
    const pan = event.button === 1 || tool === 'hand' || spaceRef.current
    const control = event.target.closest('[role="button"]')
    host.current?.focus({ preventScroll: true })
    const point = coordinate({ x: event.clientX, y: event.clientY })
    if (!point) return
    const port = attribute(event.target, 'connect'),
      object = attribute(event.target, 'object')
    const site = attribute(event.target, 'edit-site'),
      group = attribute(event.target, 'edit-group')
    const endpoint = attribute(event.target, 'endpoint') as 'from' | 'to' | null
    const linkId = attribute(event.target, 'link')
    const request = endpoint && linkId ? { endpoint, linkId } : port ? null : pendingEndpoint
    const origin = port ?? connecting
    const rotateLabel = attribute(event.target, 'label-rotate')
    const labelId = rotateLabel ?? attribute(event.target, 'link-label')
    const moveLabel = !pan && !origin && !request && labelId
    const properties = ['object', 'site', 'group'].some((kind) =>
      attribute(event.target, `properties-${kind}`),
    )
    if (properties && event.button === 0 && !spaceRef.current) return
    if (moveLabel) {
      if (!onInspect(null)) return
      setSelectedLink(labelId)
      setSelected([])
      setSelectedGroup(null)
    }
    if (
      !pan &&
      !moveLabel &&
      (properties || (!origin && !request && !object && !site && !group && control))
    ) {
      // SVG tabindex targets otherwise take native focus after pointerdown. Replacing
      // the SVG on selection then drops focus, so Delete never reaches the canvas.
      event.preventDefault()
      return
    }
    if (!pan && port) {
      setSelectedLink(null)
      setSelected([])
      setPendingEndpoint(null)
      setDraftOrigin(port)
    }
    const ids =
      object && selected.includes(object)
        ? selected
        : object
          ? [object]
          : group
            ? [group]
            : site
              ? [site]
              : []
    gesture.current = {
      pointer: event.pointerId,
      project,
      mode: pan
        ? 'pan'
        : request
          ? 'reconnect'
          : origin
            ? 'connect'
            : moveLabel
              ? rotateLabel
                ? 'label-rotate'
                : 'label'
              : object || site || group
                ? 'place'
                : 'marquee',
      kind: object ? 'object' : group ? 'group' : 'site',
      ...(request ?? {}),
      ...(moveLabel ? { linkId: labelId } : {}),
      view: viewRef.current,
      ids: origin ? [origin] : ids,
      start: { x: event.clientX, y: event.clientY },
      svgStart: point,
      moved: false,
      additive: event.shiftKey || event.metaKey || event.ctrlKey,
      previous: selected,
    }
    if (pan) {
      setPanning(true)
      if (spaceRef.current) spacePanned.current = true
    }
    lastPointer.current = { x: event.clientX, y: event.clientY }
    beginEdgePan()
    // Leave stationary label clicks on the SVG target so native double-click editing
    // still works. Capture only after a label drag crosses the movement threshold.
    if (!moveLabel) event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }
  function beginEdgePan() {
    if (edgeFrame.current !== null) return
    let previous = performance.now()
    const frame = (now: number) => {
      const current = gesture.current,
        client = lastPointer.current,
        node = host.current
      if (!current || !node || !client) {
        edgeFrame.current = null
        return
      }
      const dt = Math.min(32, now - previous) / 1000
      previous = now
      if (current.moved && current.mode !== 'pan') {
        const box = node.getBoundingClientRect(),
          margin = 36
        const velocity = (value: number, min: number, max: number) =>
          value < min + margin
            ? -Math.min(1, (min + margin - value) / margin)
            : value > max - margin
              ? Math.min(1, (value - max + margin) / margin)
              : 0
        const dx = velocity(client.x, box.left, box.right),
          dy = velocity(client.y, box.top, box.bottom)
        if (dx || dy) {
          const camera = viewRef.current
          manualView.current = true
          updateView({
            ...camera,
            x: camera.x + (dx * 520 * dt) / camera.zoom,
            y: camera.y + (dy * 520 * dt) / camera.zoom,
          })
          refreshGesture.current()
        }
      }
      edgeFrame.current = requestAnimationFrame(frame)
    }
    edgeFrame.current = requestAnimationFrame(frame)
  }
  refreshGesture.current = () => {
    if (gesture.current && lastPointer.current)
      pointerMove({
        clientX: lastPointer.current.x,
        clientY: lastPointer.current.y,
        pointerId: gesture.current.pointer,
      })
  }
  function pointerMove(
    event: Pick<PointerEvent<HTMLDivElement>, 'clientX' | 'clientY' | 'pointerId'>,
    capture = true,
  ) {
    lastPointer.current = { x: event.clientX, y: event.clientY }
    const current = gesture.current
    if (!current && (connecting || pendingEndpoint)) {
      const point = coordinate({ x: event.clientX, y: event.clientY })
      if (point) previewConnection(point, connecting, pendingEndpoint)
      return
    }
    if (
      !current ||
      current.pointer !== event.pointerId ||
      (!current.moved &&
        Math.hypot(event.clientX - current.start.x, event.clientY - current.start.y) < 6)
    )
      return
    current.moved = true
    if (
      capture &&
      (current.mode === 'label' || current.mode === 'label-rotate') &&
      !host.current?.hasPointerCapture(current.pointer)
    )
      host.current?.setPointerCapture(current.pointer)
    if (current.mode === 'pan') {
      manualView.current = true
      updateView({
        ...current.view,
        x: current.view.x - (event.clientX - current.start.x) / current.view.zoom,
        y: current.view.y - (event.clientY - current.start.y) / current.view.zoom,
      })
      return
    }
    const point = coordinate({ x: event.clientX, y: event.clientY })
    if (!point) return
    if (current.mode === 'label' || current.mode === 'label-rotate') {
      const edge = layout.edges.find((edge) => edge.link.id === current.linkId)
      if (!edge?.label) return
      manualView.current = true
      const center = { x: edge.label.x + edge.label.width / 2, y: edge.label.y + 8 }
      const rotating = current.mode === 'label-rotate'
      const position = rotating
        ? edge.link.labelPosition
        : architectureLabelProjection(edge.points, {
            x: point.x + center.x - current.svgStart.x,
            y: point.y + center.y - current.svgStart.y,
          })
      const anchor = rotating
        ? center
        : position === null || position === undefined
          ? null
          : architectureLabelAnchor(edge.points, position)
      if (!anchor) return
      const rotation = rotating
        ? snapRotation(
            (edge.label.rotation ?? 0) +
              ((Math.atan2(point.y - center.y, point.x - center.x) -
                Math.atan2(current.svgStart.y - center.y, current.svgStart.x - center.x)) *
                180) /
                Math.PI,
          )
        : (edge.link.labelRotation ??
          ('rotation' in anchor && typeof anchor.rotation === 'number' ? anchor.rotation : 0))
      placementResult.current = {
        ...current.project,
        links: current.project.links.map((link) =>
          link.id === edge.link.id
            ? {
                ...link,
                ...(rotating ? { labelRotation: rotation } : { labelPosition: position! }),
              }
            : link,
        ),
      }
      setLabelPreview({ x: anchor.x, y: anchor.y, rotation })
      restorePlacement.current()
      const node = host.current?.querySelector(`[data-architecture-link-label="${edge.link.id}"]`)
      if (!node) return
      const previous = node.getAttribute('transform')
      node.setAttribute(
        'transform',
        `translate(${anchor.x - center.x} ${anchor.y - center.y}) rotate(${rotation} ${center.x} ${center.y})`,
      )
      node.classList.add('is-dragging')
      restorePlacement.current = () => {
        if (previous === null) node.removeAttribute('transform')
        else node.setAttribute('transform', previous)
      }
    } else if (current.mode === 'marquee') {
      const box = {
        x: Math.min(point.x, current.svgStart.x),
        y: Math.min(point.y, current.svgStart.y),
        width: Math.abs(point.x - current.svgStart.x),
        height: Math.abs(point.y - current.svgStart.y),
      }
      setMarquee(box)
      const hits = layout.nodes
        .filter((node) => intersection(box, node))
        .map((node) => node.object.id)
      setSelected([...new Set([...(current.additive ? current.previous : []), ...hits])])
    } else if (current.mode === 'connect' || current.mode === 'reconnect') {
      previewConnection(
        point,
        current.ids[0] ?? null,
        current.mode === 'reconnect'
          ? { linkId: current.linkId!, endpoint: current.endpoint! }
          : null,
      )
    } else {
      manualView.current = true
      setSelectedLink(null)
      if (current.kind === 'object') setSelected(current.ids)
      const full = architectureDiagramLayout(current.project, undefined, undefined, false)
      const result = placeArchitectureSelection(
        current.project,
        full,
        current.kind,
        current.ids,
        { x: point.x - current.svgStart.x, y: point.y - current.svgStart.y },
        Math.min(24, 6 / viewRef.current.zoom),
        point,
      )
      placementResult.current = result.project
      showPlacement(architectureDiagramLayout(result.project, siteId, undefined, false))
      setPlacementGuides(result.guides)
      host.current
        ?.querySelectorAll('.drop-active')
        .forEach((node) => node.classList.remove('drop-active'))
      if (result.target)
        host.current
          ?.querySelector(`[data-architecture-${result.target.kind}="${result.target.id}"]`)
          ?.classList.add('drop-active')
    }
  }
  function pointerUp(event: PointerEvent<HTMLDivElement>) {
    const current = gesture.current
    if (!current || current.pointer !== event.pointerId) return
    // Fast releases can arrive beyond the last pointermove sample. Settle that final
    // position before committing; a released pointer must not acquire capture.
    if (
      current.project === project &&
      (lastPointer.current?.x !== event.clientX || lastPointer.current?.y !== event.clientY)
    )
      pointerMove(event, false)
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId)
    const client = { x: event.clientX, y: event.clientY },
      point = coordinate(client)
    if (current.mode === 'pan') {
      ignoreClick.current = true
      clearGesture()
      return
    }
    if (current.moved && point && current.project === project) {
      if (current.mode === 'marquee') {
        const box = {
          x: Math.min(point.x, current.svgStart.x),
          y: Math.min(point.y, current.svgStart.y),
          width: Math.abs(point.x - current.svgStart.x),
          height: Math.abs(point.y - current.svgStart.y),
        }
        const ids = [
          ...new Set([
            ...(current.additive ? current.previous : []),
            ...layout.nodes.filter((node) => intersection(box, node)).map((node) => node.object.id),
          ]),
        ]
        if (onInspect(null)) {
          setSelectedGroup(null)
          setSelectedLink(null)
          setSelected(ids)
          if (ids.length > 1) setContext(contextAt(client, ids))
        }
      } else if (current.mode === 'connect' || current.mode === 'reconnect') {
        const request =
          current.mode === 'reconnect'
            ? { linkId: current.linkId!, endpoint: current.endpoint! }
            : null
        const target = connectionCandidate(point, current.ids[0] ?? null, request)
        if (target) {
          if (request) onReconnect(current.project, request.linkId, request.endpoint, target)
          else completeConnection(current.ids[0], target)
        }
        setConnecting(null)
        setPendingEndpoint(null)
      } else if (placementResult.current) {
        onPlace(current.project, placementResult.current)
      }
    } else if (!current.moved && current.mode === 'label')
      activate(
        host.current?.querySelector(`[data-architecture-link-label="${current.linkId}"]`) ?? null,
      )
    else if (!current.moved && current.mode === 'label-rotate') {
      // A stationary rotation handle click keeps the arrow selected.
    } else if (!current.moved && current.mode === 'place')
      activate(
        host.current?.querySelector(
          current.kind === 'object'
            ? `[data-architecture-object="${current.ids[0]}"]`
            : `[data-architecture-edit-${current.kind}="${current.ids[0]}"]`,
        ) ?? null,
        current.additive,
      )
    else if (!current.moved && (current.mode === 'connect' || current.mode === 'reconnect')) {
      const target = point && layout.nodes.find((node) => inside(point, node))
      if (pendingEndpoint && target) {
        if (connectionCandidate(point!, null, pendingEndpoint))
          onReconnect(
            current.project,
            pendingEndpoint.linkId,
            pendingEndpoint.endpoint,
            target.object.id,
          )
        setPendingEndpoint(null)
      } else if (connecting && target && !attribute(event.target, 'connect'))
        completeConnection(connecting, target.object.id)
      else if (pendingEndpoint || connecting) {
        setPendingEndpoint(null)
        setConnecting(null)
      } else
        activate(
          current.mode === 'reconnect'
            ? (host.current?.querySelector(
                `[data-architecture-link="${current.linkId}"][data-architecture-endpoint="${current.endpoint}"]`,
              ) ?? null)
            : (host.current?.querySelector(`[data-architecture-connect="${current.ids[0]}"]`) ??
                null),
        )
    } else if (!current.moved && onInspect(null)) {
      setSelectedGroup(null)
      setSelected([])
      setConnecting(null)
      setSelectedLink(null)
      setPendingEndpoint(null)
    }
    ignoreClick.current = true
    clearGesture()
  }
  function activate(
    target: EventTarget | null,
    additive = false,
    client?: ArchitecturePoint,
    editLink = false,
  ) {
    const bounds =
      target instanceof Element
        ? target.getBoundingClientRect()
        : host.current!.getBoundingClientRect()
    const anchor = client ?? { x: bounds.right, y: bounds.top }
    for (const kind of ['object', 'site', 'group'] as const) {
      const id = attribute(target, `properties-${kind}`)
      if (id) {
        if (kind === 'object') {
          if (!onInspect(null)) return
          setSelected([id])
          setContext(contextAt(anchor, [id], target))
        } else onInspect({ kind, id }, anchor)
        return
      }
    }
    if (!attribute(target, 'edit-group')) setSelectedGroup(null)
    const endpoint = attribute(target, 'endpoint') as 'from' | 'to' | null
    const port = attribute(target, 'connect'),
      object = attribute(target, 'object'),
      link = attribute(target, 'link'),
      site = attribute(target, 'edit-site'),
      group = attribute(target, 'edit-group')
    if (port) {
      if (!onInspect(null)) return
      setConnecting((old) => (old === port ? null : port))
      setSelected([])
      setSelectedLink(null)
      setPendingEndpoint(null)
      return
    }
    if (endpoint && link) {
      if (!onInspect(null)) return
      setPendingEndpoint({ linkId: link, endpoint })
      setSelectedLink(link)
      setConnecting(null)
      return
    }
    if (object) {
      if (pendingEndpoint) {
        const node = layout.nodes.find((node) => node.object.id === object)
        if (
          node &&
          connectionCandidate(
            { x: node.x + node.width / 2, y: node.y + node.height / 2 },
            null,
            pendingEndpoint,
          )
        )
          onReconnect(project, pendingEndpoint.linkId, pendingEndpoint.endpoint, object)
        setPendingEndpoint(null)
        setLine(null)
        setConnectionTarget(null)
        return
      }
      if (connecting) {
        if (object !== connecting) completeConnection(connecting, object)
        return
      }
      if (additive) {
        if (onInspect(null))
          setSelected((ids) =>
            ids.includes(object) ? ids.filter((id) => id !== object) : [...ids, object],
          )
        return
      }
      if (onInspect(null)) {
        setSelected([object])
        setSelectedLink(null)
      }
    } else if (link) {
      if (onInspect(editLink ? { kind: 'link', id: link } : null, anchor)) {
        setSelectedLink(link)
        setSelected([])
        setConnecting(null)
        setPendingEndpoint(null)
      }
    } else if (group || site) {
      if (onInspect(null)) {
        setSelectedGroup(group ?? null)
        setSelected([])
        setSelectedLink(null)
      }
    }
  }
  function closeContext() {
    setContext(null)
    host.current?.focus({ preventScroll: true })
  }
  const chosen =
    context?.ids.map((id) => project.objects.find((object) => object.id === id)!).filter(Boolean) ??
    []
  const canGroup =
    chosen.length >= 2 &&
    chosen.every((object) => object.siteId === chosen[0].siteId) &&
    !chosen.every((object) => object.groupId && object.groupId === chosen[0].groupId) &&
    (project.groups?.length ?? 0) < architectureLimits.groups
  const create = (type: ArchitectureObject['type']) => {
    if (!context) return
    const id = onCreateObject(type, context.siteId, context.groupId, context, context.world)
    if (id) {
      setContext(null)
      setSelected([id])
    }
  }
  return (
    <div className="architecture-diagram-workspace">
      <div className="architecture-diagram-controls">
        <div
          className="architecture-selection-actions"
          role="toolbar"
          aria-label={t('Diagram tools')}
        >
          <IconButton
            title={t('Select elements')}
            aria-pressed={tool === 'select'}
            onClick={() => {
              clearGesture()
              setTool('select')
            }}
          >
            <MousePointer2 size={15} />
          </IconButton>
          <IconButton
            title={t('Pan canvas (Space or middle mouse button)')}
            aria-label={t('Pan canvas')}
            aria-pressed={tool === 'hand'}
            onClick={() => {
              clearGesture()
              setTool('hand')
            }}
          >
            <Hand size={15} />
          </IconButton>
          <IconButton title={t('Undo architecture change')} onClick={onUndo} disabled={!canUndo}>
            <Undo2 size={15} />
          </IconButton>
          <IconButton title={t('Redo architecture change')} onClick={onRedo} disabled={!canRedo}>
            <Redo2 size={15} />
          </IconButton>
        </div>
        <div className="architecture-canvas-view" role="group" aria-label={t('Canvas view')}>
          <IconButton title={t('Zoom out')} onClick={() => zoomAt(1 / 1.2)}>
            <ZoomOut size={15} />
          </IconButton>
          <button
            className="button"
            title={t('Fit diagram')}
            aria-label={t('Fit diagram')}
            onClick={fit}
          >
            {(Math.round(view.zoom * 1000) / 10).toLocaleString(language)}%
          </button>
          <IconButton title={t('Zoom in')} onClick={() => zoomAt(1.2)}>
            <ZoomIn size={15} />
          </IconButton>
        </div>
      </div>
      <div
        ref={host}
        tabIndex={0}
        role="group"
        aria-label={t('Architecture canvas')}
        className={`architecture-diagram ${tool === 'hand' || spaceHeld ? 'tool-hand' : 'tool-select'}${panning ? ' is-panning' : ''}${keyboard ? ' is-keyboard' : ''}`}
        style={{
          height: canvasHeight,
          backgroundImage:
            view.zoom >= 0.4
              ? 'radial-gradient(circle, var(--border-strong) 0.65px, transparent 0.8px)'
              : undefined,
          backgroundSize: `${architectureGrid * view.zoom}px ${architectureGrid * view.zoom}px`,
          backgroundPosition: `${-view.x * view.zoom}px ${-view.y * view.zoom}px`,
        }}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={() => {
          if (gesture.current) {
            setSelected(gesture.current.previous)
            if (gesture.current.mode === 'pan') updateView(gesture.current.view)
          }
          ignoreClick.current = true
          clearGesture()
        }}
        onLostPointerCapture={() => {
          if (gesture.current) {
            if (gesture.current.mode === 'pan') updateView(gesture.current.view)
            setSelected(gesture.current.previous)
            clearGesture()
          }
        }}
        onAuxClick={(event) => {
          if (event.button === 1) event.preventDefault()
        }}
        onClick={(event) => {
          host.current?.focus({ preventScroll: true })
          if (ignoreClick.current) {
            ignoreClick.current = false
            return
          }
          activate(event.target, event.shiftKey || event.metaKey || event.ctrlKey, {
            x: event.clientX,
            y: event.clientY,
          })
        }}
        onDoubleClick={(event) => {
          if (
            tool !== 'select' ||
            spaceRef.current ||
            attribute(event.target, 'endpoint') ||
            attribute(event.target, 'label-rotate') ||
            !attribute(event.target, 'link')
          )
            return
          event.preventDefault()
          activate(event.target, false, { x: event.clientX, y: event.clientY }, true)
        }}
        onContextMenu={(event) => {
          event.preventDefault()
          setKeyboard(false)
          clearGesture()
          setConnecting(null)
          setPendingEndpoint(null)
          const id = attribute(event.target, 'object')
          const frameOrLink =
            attribute(event.target, 'group') ||
            attribute(event.target, 'site') ||
            attribute(event.target, 'link')
          const ids = id
            ? selected.includes(id)
              ? selected
              : [id]
            : !frameOrLink && selected.length > 1
              ? selected
              : []
          const nextContext = contextAt({ x: event.clientX, y: event.clientY }, ids, event.target)
          if (id && !selected.includes(id)) {
            if (!onInspect(null)) return
            setSelected(ids)
          }
          if (!id && !onInspect(null)) return
          setSelected(ids)
          setSelectedGroup(nextContext.subject?.kind === 'group' ? nextContext.subject.id : null)
          setSelectedLink(nextContext.subject?.kind === 'link' ? nextContext.subject.id : null)
          setContext(nextContext)
        }}
        onCopy={(event) => {
          if (
            event.target instanceof Element &&
            event.target.closest('input,textarea,[contenteditable="true"]')
          )
            return
          const text = copyArchitectureSelection(project, selected, selectedGroup ?? undefined)
          if (!text) return
          event.preventDefault()
          event.stopPropagation()
          event.clipboardData.setData('text/plain', text)
        }}
        onPaste={(event) => {
          if (
            event.target instanceof Element &&
            event.target.closest('input,textarea,[contenteditable="true"]')
          )
            return
          const text = event.clipboardData.getData('text/plain')
          if (!isArchitectureClipboard(text)) return
          event.preventDefault()
          event.stopPropagation()
          const pasted = onPaste(text)
          if (pasted) {
            setSelected(pasted.groupId ? [] : pasted.ids)
            setSelectedGroup(pasted.groupId ?? null)
            setSelectedLink(null)
          }
        }}
        onKeyDown={(event) => {
          if (
            event.defaultPrevented ||
            (event.target instanceof Element &&
              event.target.closest('input,textarea,[contenteditable="true"]'))
          )
            return
          setKeyboard(true)
          if (
            attribute(event.target, 'label-rotate') &&
            selectedEdge?.label &&
            ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
          ) {
            event.preventDefault()
            const rotation = snapRotation(
              (selectedEdge.label.rotation ?? 0) +
                (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -15 : 15),
            )
            onPlace(project, {
              ...project,
              links: project.links.map((link) =>
                link.id === selectedEdge.link.id ? { ...link, labelRotation: rotation } : link,
              ),
            })
            return
          }
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'd') {
            event.preventDefault()
            event.stopPropagation()
            if (selected.length) {
              const ids = onDuplicate(selected)
              if (ids) setSelected(ids)
            }
            return
          }
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
            event.preventDefault()
            if (event.shiftKey) onRedo()
            else onUndo()
          } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'y') {
            event.preventDefault()
            onRedo()
          } else if (event.key === 'Escape') {
            ignoreClick.current = true
            clearGesture()
            setContext(null)
            setConnecting(null)
            setSelected([])
            setSelectedLink(null)
            setSelectedGroup(null)
            setPendingEndpoint(null)
          } else if (
            event.key === 'Enter' &&
            event.target instanceof Element &&
            event.target.closest('[role="button"]')
          ) {
            event.preventDefault()
            activate(
              event.target,
              event.shiftKey || event.metaKey || event.ctrlKey,
              undefined,
              true,
            )
          } else if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
            event.preventDefault()
            const target =
              event.target === host.current
                ? selectedGroup
                  ? host.current.querySelector(`[data-architecture-group="${selectedGroup}"]`)
                  : selectedLink
                    ? host.current.querySelector(`[data-architecture-link="${selectedLink}"]`)
                    : selected.length === 1
                      ? host.current.querySelector(`[data-architecture-object="${selected[0]}"]`)
                      : event.target
                : event.target
            const bounds =
              target instanceof Element
                ? target.getBoundingClientRect()
                : host.current!.getBoundingClientRect()
            const frameOrLink =
              attribute(target, 'group') || attribute(target, 'site') || attribute(target, 'link')
            setContext(
              contextAt(
                { x: bounds.left + bounds.width / 2, y: bounds.top + 10 },
                frameOrLink && !attribute(target, 'object') ? [] : selected,
                target,
              ),
            )
          } else if (event.key === 'Delete' || event.key === 'Backspace') {
            event.preventDefault()
            event.stopPropagation()
            if (selected.length) {
              if (onDeleteObjects(selected)) setSelected([])
            } else if (selectedLink) onDeleteSubject({ kind: 'link', id: selectedLink })
            else if (selectedGroup) onDeleteSubject({ kind: 'group', id: selectedGroup })
          }
        }}
        onKeyUp={(event) => {
          if (
            event.code === 'Space' &&
            !spacePanned.current &&
            event.target instanceof Element &&
            event.target.closest('[role="button"]')
          ) {
            event.preventDefault()
            activate(
              event.target,
              event.shiftKey || event.metaKey || event.ctrlKey,
              undefined,
              true,
            )
          }
        }}
      >
        <div className="architecture-diagram-canvas">
          <div dangerouslySetInnerHTML={{ __html: svg }} />
          {(line ||
            marquee ||
            selectedEdge ||
            placementGuides.length > 0 ||
            placementLines.length > 0) && (
            <svg
              className="architecture-connection-draft"
              viewBox={viewBox}
              preserveAspectRatio="none"
            >
              {line && <path d={`M ${line.from.x} ${line.from.y} L ${line.to.x} ${line.to.y}`} />}
              {marquee && <rect className="architecture-marquee" {...marquee} />}
              {placementLines.map((edge, index) => (
                <path
                  key={index}
                  d={`M ${edge.from.x} ${edge.from.y} L ${edge.to.x} ${edge.to.y}`}
                />
              ))}
              {placementGuides.map((guide, index) => (
                <line
                  key={index}
                  className="architecture-alignment-guide"
                  vectorEffect="non-scaling-stroke"
                  x1={guide.axis === 'x' ? guide.value : guide.from}
                  y1={guide.axis === 'y' ? guide.value : guide.from}
                  x2={guide.axis === 'x' ? guide.value : guide.to}
                  y2={guide.axis === 'y' ? guide.value : guide.to}
                />
              ))}
              {selectedEdge?.label &&
                (() => {
                  const label = selectedEdge.label
                  const center = labelPreview ?? {
                    x: label.x + label.width / 2,
                    y: label.y + 8,
                    rotation: label.rotation ?? 0,
                  }
                  const offset = 8 + 24 / view.zoom
                  return (
                    <g
                      className="architecture-label-rotate"
                      data-architecture-label-rotate={selectedEdge.link.id}
                      transform={`translate(${center.x} ${center.y}) rotate(${center.rotation})`}
                      role="button"
                      tabIndex={0}
                      aria-label={t('Rotate connection label')}
                    >
                      <line x1={0} y1={-8} x2={0} y2={-offset} strokeWidth={1 / view.zoom} />
                      <g transform={`translate(0 ${-offset}) scale(${1 / view.zoom})`}>
                        <circle r={12} fill="transparent" />
                        <circle className="architecture-rotate-dot" r={8} strokeWidth={1.5} />
                        <path d="M 3 -1 A 3.2 3.2 0 1 0 1 3 M 3 -4 L 3 -1 L 0 -1" />
                      </g>
                    </g>
                  )
                })()}
              {selectedEdge &&
                (['from', 'to'] as const).map((endpoint) => {
                  const point =
                    endpoint === 'from' ? selectedEdge.points[0] : selectedEdge.points.at(-1)!
                  return (
                    <g
                      key={endpoint}
                      className="architecture-endpoint-handle"
                      data-architecture-endpoint={endpoint}
                      data-architecture-link={selectedEdge.link.id}
                      role="button"
                      tabIndex={0}
                      aria-label={t(
                        endpoint === 'from' ? 'Change connection start' : 'Change connection end',
                      )}
                    >
                      <circle cx={point.x} cy={point.y} r={11 / view.zoom} fill="transparent" />
                      <circle
                        className="architecture-endpoint-dot"
                        cx={point.x}
                        cy={point.y}
                        r={4.5 / view.zoom}
                        strokeWidth={1.5 / view.zoom}
                      />
                    </g>
                  )
                })}
            </svg>
          )}
        </div>
      </div>
      {createPortal(
        <span
          ref={contextAnchor}
          className="architecture-context-anchor"
          aria-hidden="true"
          style={{ left: context?.x ?? 0, top: context?.y ?? 0 }}
        />,
        document.body,
      )}
      {context && (
        <Popover
          anchor={contextAnchor}
          className={'architecture-context-menu' + (keyboard ? ' is-keyboard' : '')}
          onClose={closeContext}
        >
          <div
            role="menu"
            aria-label={t('Architecture actions')}
            onKeyDown={(event) => {
              if (event.defaultPrevented) return
              const buttons = [
                  ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                    '[role="menuitem"]:not(:disabled)',
                  ),
                ],
                index = buttons.indexOf(document.activeElement as HTMLButtonElement)
              const next =
                event.key === 'ArrowDown'
                  ? (index + 1) % buttons.length
                  : event.key === 'ArrowUp'
                    ? (index + buttons.length - 1) % buttons.length
                    : event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? buttons.length - 1
                        : -1
              if (next >= 0) {
                event.preventDefault()
                buttons[next]?.focus()
              }
            }}
          >
            {context.ids.length <= 1 && context.subject?.kind !== 'link' && (
              <BlockSubmenu
                label={t('Create object')}
                icon={<Server size={15} />}
                role="menuitem"
                autoFocus
                submenuClassName="architecture-create-submenu"
              >
                {(['server', 'database', 'website'] as const).map((type) => {
                  const Icon = type === 'server' ? Server : type === 'database' ? Database : Globe
                  return (
                    <button
                      key={type}
                      role="menuitem"
                      className="menu-item"
                      disabled={project.objects.length >= architectureLimits.objects}
                      onClick={() => create(type)}
                    >
                      <Icon size={15} />
                      {t(
                        type === 'server'
                          ? 'Create server'
                          : type === 'database'
                            ? 'Create database'
                            : 'Create website',
                      )}
                    </button>
                  )
                })}
                {!context.groupId && (
                  <button
                    role="menuitem"
                    className="menu-item"
                    disabled={(project.groups?.length ?? 0) >= architectureLimits.groups}
                    onClick={() => {
                      if (onCreateGroup(context.siteId, [], context)) setContext(null)
                    }}
                  >
                    <Group size={15} />
                    {t('New group')}
                  </button>
                )}
              </BlockSubmenu>
            )}
            {canGroup && (
              <>
                <button
                  role="menuitem"
                  className="menu-item"
                  autoFocus
                  onClick={() => {
                    if (onCreateGroup(chosen[0].siteId, context.ids, context)) {
                      setContext(null)
                      setSelected([])
                    }
                  }}
                >
                  <Group size={15} />
                  {t('Group selected objects')}
                </button>
              </>
            )}
            {!context.ids.length && !context.subject && (
              <button
                role="menuitem"
                disabled={project.sites.length >= architectureLimits.sites}
                onClick={() => {
                  if (onCreateSite(context, context.world)) setContext(null)
                }}
              >
                <MapPin size={15} />
                {t('New site')}
              </button>
            )}
            {context.subject && context.ids.length <= 1 && (
              <>
                {context.subject.kind !== 'link' && <hr />}
                {context.subject.kind === 'object' ? (
                  <BlockSubmenu
                    label={t('Edit properties')}
                    icon={<Pencil size={15} />}
                    role="menuitem"
                    submenuClassName="architecture-property-submenu"
                  >
                    {Object.entries(architectureObjectSections).map(([section, label]) => (
                      <button
                        key={section}
                        role="menuitem"
                        className="menu-item"
                        onClick={() => {
                          if (
                            onInspect(
                              {
                                ...context.subject!,
                                section: section as ArchitectureObjectSection,
                              },
                              context,
                            )
                          )
                            setContext(null)
                        }}
                      >
                        {t(label)}
                      </button>
                    ))}
                  </BlockSubmenu>
                ) : (
                  <button
                    role="menuitem"
                    autoFocus={context.subject.kind === 'link'}
                    onClick={() => {
                      if (onInspect(context.subject!, context)) setContext(null)
                    }}
                  >
                    <Pencil size={15} />
                    {t('Edit properties')}
                  </button>
                )}
              </>
            )}
            {!!context.ids.length && (
              <>
                {(context.ids.length === 1 || canGroup) && <hr />}
                <button
                  role="menuitem"
                  autoFocus={context.ids.length > 1 && !canGroup}
                  disabled={
                    project.objects.length + context.ids.length > architectureLimits.objects
                  }
                  onClick={() => {
                    const ids = onDuplicate(context.ids)
                    if (ids) {
                      setSelected(ids)
                      setContext(null)
                    }
                  }}
                >
                  <Copy size={15} />
                  {t(context.ids.length === 1 ? 'Duplicate object' : 'Duplicate selected objects')}
                </button>
                <button
                  role="menuitem"
                  className="danger"
                  onClick={() => {
                    if (onDeleteObjects(context.ids)) {
                      setContext(null)
                      setSelected([])
                    }
                  }}
                >
                  <Trash2 size={15} />
                  {t(context.ids.length === 1 ? 'Delete object' : 'Delete selected objects')}
                </button>
              </>
            )}
            {context.subject && context.subject.kind !== 'object' && (
              <>
                <hr />
                <button
                  role="menuitem"
                  className="danger"
                  onClick={() => {
                    onDeleteSubject(context.subject!)
                    setContext(null)
                  }}
                >
                  <Trash2 size={15} />
                  {t(
                    context.subject.kind === 'group'
                      ? 'Delete group'
                      : context.subject.kind === 'site'
                        ? 'Delete site'
                        : 'Delete connection',
                  )}
                </button>
              </>
            )}
          </div>
        </Popover>
      )}
    </div>
  )
}
