import { z } from 'zod'

export const diagramShapes = ['rectangle', 'rounded', 'diamond', 'circle', 'cylinder'] as const
export type DiagramShape = (typeof diagramShapes)[number]
export type DiagramPoint = { x: number; y: number }
export type DiagramPositions = Record<string, DiagramPoint>
export const defaultDiagramScale = 0.65
export const diagramScaleSchema = z.number().finite().min(0.25).max(2)
export type Flowchart = {
  direction: 'TB' | 'BT' | 'LR' | 'RL'
  nodes: { id: string; label: string; shape: DiagramShape }[]
  edges: { from: string; to: string; label: string; kind?: 'line' }[]
  comments: string[]
}
export const diagramAttrsSchema = z.object({
  source: z.string().max(50000),
  scale: diagramScaleSchema.default(defaultDiagramScale),
  positions: z
    .record(
      z.string().regex(/^[A-Za-z_][\w-]{0,99}$/),
      z
        .object({
          x: z.number().finite().min(-10000).max(10000),
          y: z.number().finite().min(-10000).max(10000),
        })
        .strict(),
    )
    .refine((value) => Object.keys(value).length <= 100)
    .default({}),
})
const decode = (value: string) =>
  value.replace(/#(quot|\d+);/g, (_, code: string) =>
    code === 'quot' ? '"' : String.fromCodePoint(Math.min(Number(code), 0x10ffff)),
  )
const encode = (value: string) =>
  value.replace(/["#|\[\]{}()<>\r\n]/g, (char) => `#${char.codePointAt(0)};`)

// Deliberately accept only syntax the visual editor can reproduce without losing
// styling, subgraphs, directives, or other Mermaid features. All other code still renders.
export function parseFlowchart(source: string): Flowchart | null {
  const lines = source.trim().split(/\r?\n/)
  const header = /^(?:flowchart|graph)\s+(TB|TD|BT|LR|RL)\s*;?\s*$/.exec(lines.shift() ?? '')
  if (!header) return null
  const graph: Flowchart = {
    direction: header[1] === 'TD' ? 'TB' : (header[1] as Flowchart['direction']),
    nodes: [],
    edges: [],
    comments: [],
  }
  const nodes = new Map<string, Flowchart['nodes'][number]>()
  const shapes: [string, string, DiagramShape][] = [
    ['[(', ')]', 'cylinder'],
    ['((', '))', 'circle'],
    ['[', ']', 'rectangle'],
    ['(', ')', 'rounded'],
    ['{', '}', 'diamond'],
  ]
  for (const line of lines) {
    if (line.trim().startsWith('%%')) {
      if (line.includes('%%{')) return null
      graph.comments.push(line)
      continue
    }
    // Semicolons inside labels are retained by the scanner below.
    let index = 0
    const skip = () => {
      while (/\s/.test(line[index] ?? '') && index < line.length) index++
    }
    const node = (): string | null => {
      skip()
      const match = /^[A-Za-z_](?:\w|-(?!-)){0,99}/.exec(line.slice(index))
      if (!match) return null
      const id = match[0]
      index += id.length
      skip()
      const shape = shapes.find(([open]) => line.slice(index).startsWith(open))
      let label = id
      if (shape) {
        index += shape[0].length
        const quoted = line[index] === '"'
        if (quoted) index++
        const end = line.indexOf(quoted ? '"' + shape[1] : shape[1], index)
        if (end < 0) return null
        label = decode(line.slice(index, end))
        index = end + shape[1].length + (quoted ? 1 : 0)
      }
      if (shape || !nodes.has(id)) nodes.set(id, { id, label, shape: shape?.[2] ?? 'rectangle' })
      return id
    }
    while (index < line.length) {
      skip()
      if (index >= line.length) break
      let from = node()
      if (!from) return null
      skip()
      while (/^(-->|---)/.test(line.slice(index))) {
        const kind = line.slice(index).startsWith('---') ? 'line' : undefined
        index += 3
        // Mermaid treats an adjacent o/x as a circle/cross arrowhead, not a node ID.
        if (kind && /^[ox]/.test(line.slice(index))) return null
        skip()
        let label = ''
        if (line[index] === '|') {
          const end = line.indexOf('|', index + 1)
          if (end < 0) return null
          label = decode(line.slice(index + 1, end))
          index = end + 1
        }
        const to = node()
        if (!to) return null
        graph.edges.push({ from, to, label, ...(kind ? { kind } : {}) })
        from = to
        skip()
      }
      if (index < line.length && line[index++] !== ';') return null
      if (nodes.size > 100 || graph.edges.length > 200) return null
    }
  }
  graph.nodes = [...nodes.values()]
  return graph
}
export function flowchartSource(graph: Flowchart): string {
  const wrappers: Record<DiagramShape, [string, string]> = {
    rectangle: ['[', ']'],
    rounded: ['(', ')'],
    diamond: ['{', '}'],
    circle: ['((', '))'],
    cylinder: ['[(', ')]'],
  }
  return [
    `flowchart ${graph.direction}`,
    ...graph.comments,
    ...graph.nodes.map((node) => {
      const [open, close] = wrappers[node.shape]
      return `  ${node.id}${open}"${encode(node.label)}"${close}`
    }),
    ...graph.edges.map(
      (edge) =>
        `  ${edge.from} ${edge.kind === 'line' ? '---' : '-->'}${edge.label ? `|${encode(edge.label)}|` : ''} ${edge.to}`,
    ),
  ].join('\n')
}
export const defaultDiagramSource =
  'flowchart TB\n  A["Start"]\n  B{"Decision"}\n  C["Finish"]\n  A --> B\n  B -->|Yes| C'

export function diagramBoundary(
  point: DiagramPoint,
  toward: DiagramPoint,
  width: number,
  height: number,
  shape: DiagramShape,
): DiagramPoint {
  const dx = toward.x - point.x,
    dy = toward.y - point.y
  if (!dx && !dy) return point
  const scale =
    shape === 'diamond'
      ? 1 / (Math.abs(dx) / (width / 2) + Math.abs(dy) / (height / 2))
      : shape === 'circle'
        ? 1 / Math.sqrt((dx / (width / 2)) ** 2 + (dy / (height / 2)) ** 2)
        : Math.min(
            width / 2 / Math.abs(dx || Number.EPSILON),
            height / 2 / Math.abs(dy || Number.EPSILON),
          )
  return { x: point.x + dx * scale, y: point.y + dy * scale }
}

type DiagramBounds = DiagramPoint & { width: number; height: number; shape: DiagramShape }

// Attach almost aligned blocks on a shared axis, without changing their saved positions.
// For other placements, use cardinal attachment points and right-angle bends.
export function diagramConnection(
  from: DiagramBounds,
  to: DiagramBounds,
  obstacles: DiagramBounds[] = [],
): DiagramPoint[] {
  const dx = to.x - from.x,
    dy = to.y - from.y
  const verticalGap = Math.abs(dy) - (from.height + to.height) / 2
  const horizontalGap = Math.abs(dx) - (from.width + to.width) / 2
  const vertical =
    verticalGap >= 0
      ? horizontalGap < 0 || Math.abs(dy) >= Math.abs(dx)
      : horizontalGap < 0 && Math.abs(dy) >= Math.abs(dx)
  const along = vertical ? 'x' : 'y'
  const across = vertical ? 'y' : 'x'
  const size = vertical ? 'width' : 'height'
  const depth = vertical ? 'height' : 'width'
  const aligned = Math.abs(to[along] - from[along]) <= Math.min(16, from[size] / 4, to[size] / 4)
  const axis = (from[along] + to[along]) / 2
  const sign = to[across] >= from[across] ? 1 : -1
  const attach = (node: DiagramBounds, direction: number): DiagramPoint => {
    const offset = aligned ? axis - node[along] : 0
    const fraction = Math.abs(offset) / (node[size] / 2)
    const inset =
      node.shape === 'diamond'
        ? 1 - fraction
        : node.shape === 'circle'
          ? Math.sqrt(1 - fraction ** 2)
          : 1
    return {
      ...{ x: node.x, y: node.y },
      [along]: node[along] + offset,
      [across]: node[across] + ((direction * node[depth]) / 2) * inset,
    }
  }
  const start = attach(from, sign),
    end = attach(to, -sign)
  const midpoint = (start[across] + end[across]) / 2
  const points = aligned
    ? [start, end]
    : [start, { ...start, [across]: midpoint }, { ...end, [across]: midpoint }, end]
  const simplify = (points: DiagramPoint[]) =>
    points
      .filter((point, i) => !i || point.x !== points[i - 1].x || point.y !== points[i - 1].y)
      .filter(
        (point, i, all) =>
          !i ||
          i === all.length - 1 ||
          !(
            (point.x === all[i - 1].x && point.x === all[i + 1].x) ||
            (point.y === all[i - 1].y && point.y === all[i + 1].y)
          ),
      )
  const blocked = (points: DiagramPoint[], nodes: DiagramBounds[], padding: number) =>
    points.slice(1).some((end, index) => {
      const start = points[index]
      return nodes.some((node) => {
        const left = node.x - node.width / 2 - padding,
          right = node.x + node.width / 2 + padding,
          top = node.y - node.height / 2 - padding,
          bottom = node.y + node.height / 2 + padding
        return start.x === end.x
          ? start.x > left + 0.01 &&
              start.x < right - 0.01 &&
              Math.max(start.y, end.y) > top + 0.01 &&
              Math.min(start.y, end.y) < bottom - 0.01
          : start.y > top + 0.01 &&
              start.y < bottom - 0.01 &&
              Math.max(start.x, end.x) > left + 0.01 &&
              Math.min(start.x, end.x) < right - 0.01
      })
    })
  const direct = simplify(points)
  if (!blocked(direct, obstacles, 12)) return direct
  let best = direct,
    bestScore = Infinity
  const consider = (points: DiagramPoint[]) => {
    const candidate = simplify(points)
    if (blocked(candidate, obstacles, 12) || blocked(candidate, [from, to], 0)) return
    const score = candidate
      .slice(1)
      .reduce(
        (length, point, index) =>
          length + Math.abs(point.x - candidate[index].x) + Math.abs(point.y - candidate[index].y),
        (candidate.length - 2) * 12,
      )
    if (score < bestScore) {
      best = candidate
      bestScore = score
    }
  }
  // A single elbow with perpendicular ports is often the shortest clear route.
  for (const fromVertical of [true, false]) {
    const fromAxis = fromVertical ? 'y' : 'x',
      toAxis = fromVertical ? 'x' : 'y'
    const fromSize = fromVertical ? 'height' : 'width',
      toSize = fromVertical ? 'width' : 'height'
    for (const fromSide of [-1, 1])
      for (const toSide of [-1, 1]) {
        const start = {
          x: from.x,
          y: from.y,
          [fromAxis]: from[fromAxis] + (fromSide * from[fromSize]) / 2,
        }
        const end = { x: to.x, y: to.y, [toAxis]: to[toAxis] + (toSide * to[toSize]) / 2 }
        const fromStub = { ...start, [fromAxis]: start[fromAxis] + fromSide * 20 }
        const toStub = { ...end, [toAxis]: end[toAxis] + toSide * 20 }
        consider([start, fromStub, { ...fromStub, [fromAxis]: toStub[fromAxis] }, toStub, end])
      }
  }
  // Try both orientations and outward attachment sides. External rails provide a
  // clear detour when a connection skips over a block in a row/column.
  for (const vertical of [true, false]) {
    const across = vertical ? 'y' : 'x'
    const depth = vertical ? 'height' : 'width'
    const nodes = [from, to, ...obstacles]
    const outer = [
      Math.min(...nodes.map((node) => node[across] - node[depth] / 2)) - 24,
      Math.max(...nodes.map((node) => node[across] + node[depth] / 2)) + 24,
    ]
    for (const fromSide of [-1, 1])
      for (const toSide of [-1, 1]) {
        const start = {
          x: from.x,
          y: from.y,
          [across]: from[across] + (fromSide * from[depth]) / 2,
        }
        const end = { x: to.x, y: to.y, [across]: to[across] + (toSide * to[depth]) / 2 }
        const fromStub = { ...start, [across]: start[across] + fromSide * 20 }
        const toStub = { ...end, [across]: end[across] + toSide * 20 }
        for (const rail of [(fromStub[across] + toStub[across]) / 2, ...outer]) {
          consider([
            start,
            fromStub,
            { ...fromStub, [across]: rail },
            { ...toStub, [across]: rail },
            toStub,
            end,
          ])
        }
      }
  }
  return best
}
