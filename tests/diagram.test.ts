import { describe, expect, it } from 'vitest'
import {
  defaultDiagramSource,
  diagramAttrsSchema,
  flowchartSource,
  parseFlowchart,
  diagramBoundary,
  diagramConnection,
  defaultDiagramScale,
} from '../src/shared/diagram'
import { markdown } from '../src/shared/export'
import { plainText } from '../src/shared/model'
import { validateEditorDocument } from '../src/editor/documentSchema'

describe('Mermaid diagrams', () => {
  it('edits ordinary declarations, chained arrows, all visual shapes and labels without losing comments', () => {
    const source =
      'flowchart LR\n%% Useful context\nA[Start]-->B{Choose}; B -->|Yes| C(Finish)\nD((Circle))\nE[(Database)]'
    const graph = parseFlowchart(source)!
    expect(graph.nodes.map((node) => node.shape)).toEqual([
      'rectangle',
      'diamond',
      'rounded',
      'circle',
      'cylinder',
    ])
    expect(graph.edges).toEqual([
      { from: 'A', to: 'B', label: '' },
      { from: 'B', to: 'C', label: 'Yes' },
    ])
    graph.nodes[0].label = 'Текст "цитаты" [скобки] # и | <теги>'
    graph.edges[0].label = 'Да | нет'
    expect(parseFlowchart(flowchartSource(graph))).toEqual(graph)
  })
  it('preserves later declarations and entity semicolons', () => {
    const graph = parseFlowchart('graph TD\nA --> B --> C\nB["A#91;B#93;"]')!
    expect(graph.direction).toBe('TB')
    expect(graph.nodes[1].label).toBe('A[B]')
    expect(parseFlowchart(defaultDiagramSource)?.nodes).toHaveLength(3)
  })
  it('refuses visual rewrites of richer syntax and other diagram types', () => {
    for (const source of [
      'sequenceDiagram\nA->>B: Hello',
      'flowchart TB\nsubgraph X\nA-->B\nend',
      'flowchart TB\nA --> B\nstyle A fill:red',
      'flowchart TB\nA -.-> B',
      'flowchart TB\nA---oB',
      'flowchart TB\nA---xB',
      'flowchart TB\n%%{init: {}}%%\nA-->B',
      'flowchart TB\nA[unfinished',
    ])
      expect(parseFlowchart(source)).toBeNull()
  })
  it('retains ordinary connections independently of directed arrows', () => {
    const graph = parseFlowchart('flowchart LR\nA[Start] ---|Together| B[Next] --> C[End]')!
    expect(graph.edges).toEqual([
      { from: 'A', to: 'B', label: 'Together', kind: 'line' },
      { from: 'B', to: 'C', label: '' },
    ])
    const source = flowchartSource(graph)
    expect(source).toContain('A ---|Together| B')
    expect(source).toContain('B --> C')
    expect(parseFlowchart(source)).toEqual(graph)
  })
  it('bounds stored code and positions and rejects malformed fields', () => {
    expect(diagramAttrsSchema.parse({ source: defaultDiagramSource }).positions).toEqual({})
    expect(diagramAttrsSchema.parse({ source: defaultDiagramSource }).scale).toBe(
      defaultDiagramScale,
    )
    for (const attrs of [
      { source: 123 },
      { source: 'x'.repeat(50001) },
      { source: '', positions: { A: { x: Infinity, y: 0 } } },
      { source: '', positions: { A: { x: -10001, y: 0 } } },
      { source: '', positions: { A: { x: 0, y: 10001 } } },
      { source: '', positions: { A: { x: 0, y: 0, extra: 1 } } },
      { source: '', scale: 0.24 },
      { source: '', scale: 2.01 },
      { source: '', scale: Infinity },
      { source: '', scale: '65%' },
    ]) {
      expect(diagramAttrsSchema.safeParse(attrs).success).toBe(false)
      expect(() =>
        validateEditorDocument({ type: 'doc', content: [{ type: 'mermaid', attrs }] }),
      ).toThrow()
    }
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'mermaid',
          attrs: { source: defaultDiagramSource, positions: { A: { x: -180, y: -120 } } },
        },
      ],
    }
    expect(() => validateEditorDocument(doc)).not.toThrow()
  })
  it('exports exact fenced Mermaid code and makes labels searchable', () => {
    const source = defaultDiagramSource + '\n%% ``` preserved'
    const node = { type: 'mermaid', attrs: { source, positions: { A: { x: 150, y: 100 } } } }
    expect(markdown(node)).toBe('````mermaid\n' + source + '\n````\n\n')
    expect(plainText(node)).toBe(source)
  })
  it('routes straight connections to shape boundaries', () => {
    expect(diagramBoundary({ x: 100, y: 100 }, { x: 300, y: 100 }, 100, 80, 'rectangle')).toEqual({
      x: 150,
      y: 100,
    })
    expect(diagramBoundary({ x: 0, y: 0 }, { x: 100, y: 100 }, 100, 100, 'diamond')).toEqual({
      x: 25,
      y: 25,
    })
  })
  it('keeps slightly offset blocks connected on one straight axis, including diamond boundaries', () => {
    const from = { x: 100, y: 100, width: 100, height: 60, shape: 'rectangle' as const }
    const to = { x: 108, y: 260, width: 100, height: 100, shape: 'diamond' as const }
    expect(diagramConnection(from, to)).toEqual([
      { x: 104, y: 130 },
      { x: 104, y: 214 },
    ])
    expect(diagramConnection(to, from)).toEqual([
      { x: 104, y: 214 },
      { x: 104, y: 130 },
    ])
    expect(diagramConnection(from, { ...to, x: 300, y: 108 })).toEqual([
      { x: 150, y: 104 },
      { x: 254, y: 104 },
    ])
  })
  it('uses right-angle bends between displaced blocks in every direction', () => {
    const from = { x: 100, y: 100, width: 100, height: 60, shape: 'rectangle' as const }
    for (const [x, y] of [
      [300, 280],
      [-200, 260],
      [220, -200],
      [-200, -180],
    ]) {
      const points = diagramConnection(from, { ...from, x, y, shape: 'circle' })
      expect(points).toHaveLength(4)
      points.slice(1).forEach((point, index) => {
        const before = points[index]
        expect(point.x === before.x || point.y === before.y).toBe(true)
      })
      expect(points[0].x === from.x || points[0].y === from.y).toBe(true)
      expect(points.at(-1)!.x === x || points.at(-1)!.y === y).toBe(true)
    }
  })
  it('routes skipped connections around intervening blocks in a row or column', () => {
    const node = { x: 100, y: 100, width: 100, height: 60, shape: 'rectangle' as const }
    for (const vertical of [true, false]) {
      const obstacle = { ...node, x: vertical ? 100 : 280, y: vertical ? 280 : 100 }
      const end = { ...node, x: vertical ? 100 : 460, y: vertical ? 460 : 100 }
      const points = diagramConnection(node, end, [obstacle])
      expect(points.length).toBeGreaterThan(2)
      points.slice(1).forEach((point, i) => {
        const before = points[i]
        expect(point.x === before.x || point.y === before.y).toBe(true)
        const crosses =
          point.x === before.x
            ? point.x > obstacle.x - 50 &&
              point.x < obstacle.x + 50 &&
              Math.max(point.y, before.y) > obstacle.y - 30 &&
              Math.min(point.y, before.y) < obstacle.y + 30
            : point.y > obstacle.y - 30 &&
              point.y < obstacle.y + 30 &&
              Math.max(point.x, before.x) > obstacle.x - 50 &&
              Math.min(point.x, before.x) < obstacle.x + 50
        expect(crosses).toBe(false)
      })
    }
  })
  it('prefers a short elbow over an outside detour when perpendicular ports are clear', () => {
    const from = { x: 100, y: 100, width: 100, height: 60, shape: 'rectangle' as const }
    const to = { ...from, x: 440, y: -180 }
    const obstacle = { ...from, x: 280 }
    expect(diagramConnection(from, to, [obstacle])).toEqual([
      { x: 100, y: 70 },
      { x: 100, y: -180 },
      { x: 390, y: -180 },
    ])
  })
})
