import DOMPurify from 'dompurify'
import {
  diagramConnection,
  parseFlowchart,
  type DiagramPoint,
  type DiagramPositions,
  type Flowchart,
} from '../shared/diagram'

export type Geometry = Record<
  string,
  DiagramPoint & { width: number; height: number; element: SVGGElement }
>
let renderSequence = 0
let renderQueue = Promise.resolve()
export async function renderDiagram(source: string, dark: boolean) {
  // Mermaid has global configuration and a rendering queue. Keep theme changes and
  // temporary measuring SVGs within one job, including concurrent node views.
  const result = renderQueue.then(async () => {
    const { default: mermaid } = await import('mermaid')
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      suppressErrorRendering: true,
      maxTextSize: 50000,
      maxEdges: 200,
      theme: dark ? 'dark' : 'neutral',
      htmlLabels: false,
      flowchart: { htmlLabels: false, useMaxWidth: false },
      fontFamily: 'system-ui, sans-serif',
      look: 'classic',
      secure: [
        'secure',
        'securityLevel',
        'startOnLoad',
        'maxTextSize',
        'maxEdges',
        'suppressErrorRendering',
        'theme',
        'themeCSS',
        'themeVariables',
        'htmlLabels',
        'flowchart',
        'fontFamily',
        'layout',
        'look',
      ],
    })
    const container = document.createElement('div')
    container.style.cssText =
      'position:absolute;left:-100000px;top:0;visibility:hidden;pointer-events:none'
    document.body.append(container)
    try {
      const { svg } = await mermaid.render(`shecoDiagram${++renderSequence}`, source, container)
      const document = new DOMParser().parseFromString(svg, 'image/svg+xml')
      const graph = parseFlowchart(source)
      // Mermaid's SVG-only labels can leave escaped entities as visible text.
      // Write decoded flowchart labels as text nodes, never as markup.
      function decodeLabel(element: Element, value: string) {
        const text = element.querySelector('g.label text')
        if (!text || !/&(?:#\d+|quot|lt|gt|amp);/.test(text.textContent ?? '')) return
        const words = value.match(/.{1,18}(?:\s|$)|\S{1,18}/gu) ?? ['']
        text.replaceChildren()
        text.setAttribute('y', '0')
        text.setAttribute('text-anchor', 'middle')
        text.setAttribute('dominant-baseline', 'central')
        element.querySelector('g.label')?.setAttribute('transform', 'translate(0,0)')
        words.forEach((word, index) => {
          const line = document.createElementNS('http://www.w3.org/2000/svg', 'tspan')
          line.setAttribute('x', '0')
          line.setAttribute('y', String((index - (words.length - 1) / 2) * 19))
          line.textContent = word.trim()
          text.append(line)
        })
      }
      for (const element of document.querySelectorAll<SVGGElement>('g.node')) {
        const node = graph?.nodes.find((node) =>
          new RegExp(`flowchart-${node.id}-\\d+$`).test(element.id),
        )
        if (node) decodeLabel(element, node.label)
      }
      const edgeCounts = new Map<string, number>()
      for (const edge of graph?.edges ?? []) {
        const pair = `${edge.from}_${edge.to}`
        const count = edgeCounts.get(pair) ?? 0
        edgeCounts.set(pair, count + 1)
        const element = document.querySelector(
          `g.edgeLabel:has(g.label[data-id="L_${pair}_${count}"])`,
        )
        if (element) decodeLabel(element, edge.label)
      }
      return DOMPurify.sanitize(new XMLSerializer().serializeToString(document.documentElement), {
        USE_PROFILES: { svg: true, svgFilters: true },
        FORBID_TAGS: ['foreignObject', 'script', 'a', 'image', 'use'],
        FORBID_ATTR: ['href', 'xlink:href'],
      })
    } finally {
      container.remove()
    }
  })
  renderQueue = result.then(
    () => {},
    () => {},
  )
  return result
}

export function nodeGeometry(svg: SVGSVGElement, graph: Flowchart): Geometry {
  const result: Geometry = Object.create(null)
  for (const element of svg.querySelectorAll<SVGGElement>('g.node')) {
    const node = graph.nodes.find((node) =>
      new RegExp(`flowchart-${node.id}-\\d+$`).test(element.id),
    )
    const translate = /translate\(\s*([\d.e+-]+)[ ,]+([\d.e+-]+)\s*\)/.exec(
      element.getAttribute('transform') ?? '',
    )
    if (!node || !translate) continue
    const bounds = element.getBBox()
    result[node.id] = {
      element,
      x: Number(translate[1]),
      y: Number(translate[2]),
      width: bounds.width,
      height: bounds.height,
    }
    element.dataset.diagramNode = node.id
  }
  return result
}

export function placeNodes(
  svg: SVGSVGElement,
  graph: Flowchart,
  positions: DiagramPositions,
  geometry: Geometry,
  fit = true,
) {
  if (graph.nodes.some((node) => !geometry[node.id])) return
  svg.dataset.naturalViewBox ??= svg.getAttribute('viewBox') ?? ''
  const paths = [...svg.querySelectorAll<SVGPathElement>('g.edgePaths path.flowchart-link')]
  const labels = [...svg.querySelectorAll<SVGGElement>('g.edgeLabels > g.edgeLabel')]
  const point = (id: string) => (Object.hasOwn(positions, id) ? positions[id] : geometry[id])
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity
  for (const node of graph.nodes) {
    const bounds = geometry[node.id],
      position = point(node.id)
    bounds.element.setAttribute('transform', `translate(${position.x}, ${position.y})`)
    left = Math.min(left, position.x - bounds.width / 2 - 32)
    top = Math.min(top, position.y - bounds.height / 2 - 32)
    right = Math.max(right, position.x + bounds.width / 2 + 32)
    bottom = Math.max(bottom, position.y + bounds.height / 2 + 32)
  }
  const edgeCounts = new Map<string, number>()
  graph.edges.forEach((edge) => {
    const pair = `${edge.from}_${edge.to}`
    const count = edgeCounts.get(pair) ?? 0
    edgeCounts.set(pair, count + 1)
    const id = `L_${pair}_${count}`
    const path = paths.find((path) => path.dataset.id === id)
    const label = labels.find(
      (label) => label.querySelector('g.label')?.getAttribute('data-id') === id,
    )
    const from = point(edge.from),
      to = point(edge.to)
    const startNode = graph.nodes.find((node) => node.id === edge.from)!
    const endNode = graph.nodes.find((node) => node.id === edge.to)!
    const self = edge.from === edge.to
    const points = diagramConnection(
      {
        ...from,
        width: geometry[edge.from].width,
        height: geometry[edge.from].height,
        shape: startNode.shape,
      },
      {
        ...to,
        width: geometry[edge.to].width,
        height: geometry[edge.to].height,
        shape: endNode.shape,
      },
      graph.nodes
        .filter((node) => node.id !== edge.from && node.id !== edge.to)
        .map((node) => ({
          ...point(node.id),
          width: geometry[node.id].width,
          height: geometry[node.id].height,
          shape: node.shape,
        })),
    )
    let labelPoint = points[0]
    let longest = -1
    points.slice(1).forEach((end, index) => {
      const start = points[index]
      const length = Math.abs(end.x - start.x) + Math.abs(end.y - start.y)
      if (length > longest) {
        longest = length
        labelPoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }
      }
    })
    path?.setAttribute(
      'd',
      self
        ? `M ${from.x + geometry[edge.from].width / 2} ${from.y} C ${from.x + geometry[edge.from].width / 2 + 90} ${from.y - 90}, ${from.x + geometry[edge.from].width / 2 + 90} ${from.y + 90}, ${from.x + geometry[edge.from].width / 2} ${from.y + 8}`
        : points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' '),
    )
    if (path) {
      path.style.strokeDasharray = 'none'
      path.style.strokeDashoffset = '0'
    }
    if (self) labelPoint = { x: from.x + geometry[edge.from].width / 2 + 65, y: from.y }
    label?.setAttribute('transform', `translate(${labelPoint.x}, ${labelPoint.y})`)
    if (label) {
      const bounds = label.getBBox()
      left = Math.min(left, labelPoint.x + bounds.x - 16)
      top = Math.min(top, labelPoint.y + bounds.y - 16)
      right = Math.max(right, labelPoint.x + bounds.x + bounds.width + 16)
      bottom = Math.max(bottom, labelPoint.y + bounds.y + bounds.height + 16)
    }
    if (self) {
      right = Math.max(right, from.x + geometry[edge.from].width / 2 + 100)
      top = Math.min(top, from.y - 100)
      bottom = Math.max(bottom, from.y + 100)
    }
  })
  if (!fit) return
  if (!graph.nodes.length) {
    svg.setAttribute('viewBox', svg.dataset.naturalViewBox)
    svg.style.maxWidth = `${svg.dataset.naturalViewBox.split(/\s+/)[2]}px`
    return
  }
  svg.setAttribute(
    'viewBox',
    `${left} ${top} ${Math.max(200, right - left)} ${Math.max(120, bottom - top)}`,
  )
  svg.removeAttribute('height')
  svg.setAttribute('width', '100%')
  svg.style.maxWidth = `${Math.max(200, right - left)}px`
}
