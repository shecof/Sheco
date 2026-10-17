import { describe, it, expect } from 'vitest'
import {
  copyArchitectureSelection,
  pasteArchitectureSelection,
} from '../src/shared/architectureClipboard'
import { architectureRouteBridges } from '../src/shared/architectureRouting'
import {
  createArchitectureProject,
  architectureProjectSchema,
  architectureSvg,
  architectureMermaid,
  architectureDiagramLayout,
  architectureBalances,
  architectureLinkAppearance,
  projectArchitecturePluginSchema,
  architectureLabelAnchor,
  architectureLabelProjection,
  architectureLabelBounds,
} from '../src/shared/projectArchitecture'
import { createPage } from '../src/shared/model'
import { seedWorkspace } from '../src/shared/seed'

function fixture() {
  const project = createArchitectureProject('Clipboard')
  project.sites = [{ id: crypto.randomUUID(), name: 'Site' }]
  project.groups = [
    { id: crypto.randomUUID(), siteId: project.sites[0].id, name: 'Group', background: 'green' },
  ]
  project.objects = ['API', 'DB'].map((name, index) => ({
    id: crypto.randomUUID(),
    name,
    type: index ? ('database' as const) : ('server' as const),
    siteId: project.sites[0].id,
    groupId: project.groups![0].id,
    os: 'Debian',
    resources: { cpu: 4, ram: 8 },
    disks: [{ id: crypto.randomUUID(), resourceId: 'nvme', name: 'System', capacity: 20 }],
    parameters: [{ name: 'Key', value: 'value' }],
  }))
  project.links = [
    {
      id: crypto.randomUUID(),
      from: project.objects[0].id,
      to: project.objects[1].id,
      label: 'SQL',
    },
  ]
  return project
}

describe('architecture interaction data', () => {
  it('projects dragged labels onto the complete route and follows normalized positions after rerouting', () => {
    const points = [
      { x: -100, y: 50 },
      { x: 0, y: 50 },
      { x: 0, y: 250 },
      { x: 300, y: 250 },
    ]
    expect(architectureLabelProjection(points, { x: -50, y: 70 })).toBeCloseTo(50 / 600)
    expect(architectureLabelProjection(points, { x: 30, y: 150 })).toBeCloseTo(200 / 600)
    expect(architectureLabelAnchor(points, 200 / 600)).toEqual({ x: 0, y: 150, rotation: 90 })
    expect(architectureLabelAnchor(points, 0)).toEqual({ x: -100, y: 50, rotation: 0 })
    expect(architectureLabelAnchor(points, 1)).toEqual({ x: 300, y: 250, rotation: 0 })
    expect(architectureLabelProjection(points, { x: 500, y: 250 })).toBe(1)
    expect(architectureLabelProjection([points[0], points[0]], points[0])).toBeNull()
    expect(architectureLabelAnchor([], 0.5)).toBeNull()
    expect(
      architectureLabelAnchor(
        [
          { x: 0, y: 0 },
          { x: 400, y: 0 },
        ],
        0.25,
      ),
    ).toEqual({ x: 100, y: 0, rotation: 0 })
  })
  it('round-trips bounded manual label placement and arbitrary rotation without rerouting or cropping exports', () => {
    const project = fixture()
    const original = architectureDiagramLayout(project)
    for (const rotation of [-180, -90, -32.5, 0, 45, 90, 180]) {
      project.links[0] = { ...project.links[0], labelPosition: 0.35, labelRotation: rotation }
      const parsed = architectureProjectSchema.parse(JSON.parse(JSON.stringify(project)))
      expect(parsed.links[0]).toMatchObject({ labelPosition: 0.35, labelRotation: rotation })
      const layout = architectureDiagramLayout(parsed)
      expect(layout.edges[0].points).toEqual(original.edges[0].points)
      const label = layout.edges[0].label!
      const anchor = architectureLabelAnchor(layout.edges[0].points, 0.35)!
      expect(label.x + label.width / 2).toBeCloseTo(anchor.x)
      expect(label.y + 8).toBeCloseTo(anchor.y)
      expect(label.rotation).toBe(rotation)
      const bounds = architectureLabelBounds(label)
      expect(bounds.x).toBeGreaterThanOrEqual(layout.x)
      expect(bounds.y).toBeGreaterThanOrEqual(layout.y)
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(layout.x + layout.width)
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(layout.y + layout.height)
      if (rotation) expect(architectureSvg(parsed)).toContain(`transform="rotate(${rotation} `)
    }
    for (const patch of [
      { labelPosition: -0.01 },
      { labelPosition: 1.01 },
      { labelPosition: Infinity },
      { labelRotation: -181 },
      { labelRotation: 181 },
      { labelRotation: NaN },
    ])
      expect(
        architectureProjectSchema.safeParse({
          ...project,
          links: [{ ...project.links[0], ...patch }],
        }).success,
      ).toBe(false)
    delete project.links[0].labelPosition
    delete project.links[0].labelRotation
    expect(architectureDiagramLayout(project).edges[0].label).toEqual(original.edges[0].label)
  })
  it('round-trips a two-way connection through validation and both exports without rerouting', () => {
    const project = fixture()
    const before = architectureDiagramLayout(project)
    project.links[0].bidirectional = true
    const parsed = architectureProjectSchema.parse(JSON.parse(JSON.stringify(project)))
    expect(parsed.links[0].bidirectional).toBe(true)
    expect(architectureDiagramLayout(parsed).edges[0].points).toEqual(before.edges[0].points)
    expect(architectureSvg(parsed)).toContain('marker-start="url(#architecture-arrow)"')
    expect(architectureSvg(parsed)).toContain('orient="auto-start-reverse"')
    expect(architectureMermaid(parsed)).toContain('<-->|"SQL"|')
    expect(architectureSvg(parsed, undefined, undefined, true)).not.toContain('<title>API\n')
    expect(
      architectureProjectSchema.safeParse({
        ...project,
        links: [{ ...project.links[0], bidirectional: 'yes' }],
      }).success,
    ).toBe(false)
  })
  it('preserves independent arrow ends and all line styles across snapshots and SVG/Mermaid exports', () => {
    const project = fixture()
    const points = architectureDiagramLayout(project).edges[0].points
    for (const startArrow of ['none', 'arrow'] as const)
      for (const endArrow of ['none', 'arrow'] as const)
        for (const lineStyle of ['solid', 'dashed', 'dotted'] as const) {
          project.links[0] = { ...project.links[0], startArrow, endArrow, lineStyle }
          const parsed = architectureProjectSchema.parse(JSON.parse(JSON.stringify(project)))
          expect(architectureLinkAppearance(parsed.links[0])).toEqual({
            startArrow,
            endArrow,
            lineStyle,
          })
          expect(architectureDiagramLayout(parsed).edges[0].points).toEqual(points)
          const svg = architectureSvg(parsed)
          expect(svg.includes('marker-start="url(#architecture-arrow)"')).toBe(
            startArrow === 'arrow',
          )
          expect(svg.includes('marker-end="url(#architecture-arrow)"')).toBe(endArrow === 'arrow')
          expect(svg).toContain(
            `stroke-dasharray="${lineStyle === 'solid' ? '' : lineStyle === 'dashed' ? '6 4' : '1 4'}"`,
          )
          const mermaid = architectureMermaid(parsed)
          expect(mermaid).toContain(
            `${startArrow === 'arrow' && endArrow === 'arrow' ? '<-->' : startArrow === 'arrow' || endArrow === 'arrow' ? '-->' : '---'}|"SQL"|`,
          )
          expect(mermaid.includes('linkStyle 0')).toBe(lineStyle !== 'solid')
        }
    expect(
      architectureProjectSchema.safeParse({
        ...project,
        links: [{ ...project.links[0], lineStyle: 'url(x)' }],
      }).success,
    ).toBe(false)
    expect(
      architectureProjectSchema.safeParse({
        ...project,
        links: [{ ...project.links[0], startArrow: 'unknown' }],
      }).success,
    ).toBe(false)
  })
  it('keeps long inline label bounds inside full-scope exports without numeric substitutions', () => {
    const project = fixture()
    project.links[0].label = 'Long connection label near boundaries'
    const layout = architectureDiagramLayout(project)
    for (const { label } of layout.edges) {
      expect(label!.text).toContain('Long connection')
      const box = label!.vertical
        ? {
            x: label!.x + label!.width / 2 - 8,
            y: label!.y + 8 - label!.width / 2,
            width: 16,
            height: label!.width,
          }
        : { ...label!, height: 16 }
      expect(box.x).toBeGreaterThanOrEqual(layout.x)
      expect(box.y).toBeGreaterThanOrEqual(layout.y)
      expect(box.x + box.width).toBeLessThanOrEqual(layout.x + layout.width)
      expect(box.y + box.height).toBeLessThanOrEqual(layout.y + layout.height)
    }
    expect(architectureSvg(project)).not.toContain('text-anchor="middle" font-size="11"')
  })
  it('adds jump curves to crossings, excluding endpoints, parallel routes and nearby cards', () => {
    const paths = [
      [
        { x: 0, y: 40 },
        { x: 100, y: 40 },
      ],
      [
        { x: 50, y: 0 },
        { x: 50, y: 80 },
      ],
    ]
    const result = architectureRouteBridges(paths)
    expect(result[0].bridges).toHaveLength(1)
    expect(result[0].path).toContain('A 5 5')
    expect(result[1].bridges).toEqual([])
    expect(
      architectureRouteBridges([
        paths[0],
        [
          { x: 0, y: 0 },
          { x: 0, y: 80 },
        ],
      ])[0].bridges,
    ).toEqual([])
    expect(
      architectureRouteBridges([
        paths[0],
        [
          { x: 0, y: 50 },
          { x: 100, y: 50 },
        ],
      ])[0].bridges,
    ).toEqual([])
    expect(
      architectureRouteBridges(paths, [{ x: 40, y: 30, width: 20, height: 20 }])[0].bridges,
    ).toEqual([])
  })
  it('keeps jumps away from both arrowheads, including arrowheads on other routes', () => {
    const vertical = [
      { x: 90, y: 0 },
      { x: 90, y: 80 },
    ]
    for (const horizontal of [
      [
        { x: 0, y: 40 },
        { x: 100, y: 40 },
      ],
      [
        { x: 100, y: 40 },
        { x: 0, y: 40 },
      ],
    ])
      expect(architectureRouteBridges([horizontal, vertical])[0].bridges).toEqual([])
    expect(
      architectureRouteBridges([
        [
          { x: 0, y: 40 },
          { x: 100, y: 40 },
        ],
        [
          { x: 50, y: 0 },
          { x: 50, y: 80 },
        ],
        [
          { x: 50, y: 35 },
          { x: 80, y: 35 },
        ],
      ])[0].bridges,
    ).toEqual([])
  })
  it('keeps the underpass continuous and chooses a lift clear of nearby horizontal lines', () => {
    const routes = [
      [
        { x: 0, y: 40 },
        { x: 100, y: 40 },
      ],
      [
        { x: 50, y: 0 },
        { x: 50, y: 80 },
      ],
      [
        { x: 0, y: 44 },
        { x: 100, y: 44 },
      ],
    ]
    const result = architectureRouteBridges(routes)
    expect(result[0].bridges[0]).toContain('A 5 5 0 0 1')
    expect(result[2].bridges[0]).toContain('A 5 5 0 0 0')
    expect(result[1].path).toBe('M 50 0 L 50 80')
    expect(result[1].strokePath).toBe(result[1].path)
    expect(result[0].path.match(/M /g)).toHaveLength(1)
    expect(result[2].path.match(/M /g)).toHaveLength(1)
    const reversed = architectureRouteBridges([[...routes[0]].reverse(), [...routes[1]].reverse()])
    expect(reversed[0].bridges[0]).toContain('A 5 5 0 0 0')
    const y = [...reversed[1].path.matchAll(/[ML] 50 ([\d.]+)/g)].map((match) => Number(match[1]))
    expect(y[0]).toBe(80)
    expect(y.at(-1)).toBe(0)
    expect(y).toEqual([...y].sort((a, b) => b - a))
    expect(routes[1]).toEqual([
      { x: 50, y: 0 },
      { x: 50, y: 80 },
    ])
  })
  it('pastes a copied object after its source is deleted with fresh object/disk IDs and independent allocations', () => {
    const project = fixture()
    const text = copyArchitectureSelection(project, [project.objects[0].id])!
    const target = { ...project, objects: [project.objects[1]], links: [] }
    const result = pasteArchitectureSelection(target, text)
    const copy = result.project.objects.at(-1)!
    expect(copy.id).not.toBe(project.objects[0].id)
    expect(copy.disks![0].id).not.toBe(project.objects[0].disks![0].id)
    expect(copy.resources).toEqual(project.objects[0].resources)
    expect(copy.parameters).toEqual(project.objects[0].parameters)
    expect(copy.groupId).toBeUndefined()
    expect(result.project.links).toEqual([])
    expect(architectureBalances(result.project)[0].used).toBe(8)
    expect(project.objects).toHaveLength(2)
  })
  it('copies a whole group with independent membership and resources, including across diagrams', () => {
    const project = fixture()
    const text = copyArchitectureSelection(project, [], project.groups![0].id)!
    for (const target of [project, createArchitectureProject('Other diagram')]) {
      const result = pasteArchitectureSelection(target, text)
      expect(result.groupId).not.toBe(project.groups![0].id)
      const group = result.project.groups!.find((group) => group.id === result.groupId)!
      expect(group.background).toBe('green')
      expect(result.project.objects.filter((object) => object.groupId === group.id)).toHaveLength(2)
      expect(result.project.links).toEqual(target.links)
      expect(architectureProjectSchema.safeParse(result.project).success).toBe(true)
    }
  })
  it('copies root groups and individual members across diagrams without creating a site', () => {
    const project = fixture()
    delete project.groups![0].siteId
    project.objects.forEach((object) => delete object.siteId)
    const text = copyArchitectureSelection(project, [], project.groups![0].id)!
    for (const target of [project, createArchitectureProject('Other')]) {
      const result = pasteArchitectureSelection(target, text)
      const group = result.project.groups!.at(-1)!
      expect(group.siteId).toBeUndefined()
      expect(group.id).not.toBe(project.groups![0].id)
      expect(result.project.sites.map(({ position: _position, ...site }) => site)).toEqual(
        target.sites,
      )
      expect(
        result.project.objects
          .slice(-2)
          .every((object) => !object.siteId && object.groupId === group.id),
      ).toBe(true)
      expect(result.project.links).toEqual(target.links)
      expect(architectureProjectSchema.safeParse(result.project).success).toBe(true)
    }
    const single = copyArchitectureSelection(project, [project.objects[0].id])!
    const pasted = pasteArchitectureSelection(createArchitectureProject('Single'), single).project
    expect(pasted.groups ?? []).toEqual([])
    expect(pasted.objects[0].groupId).toBeUndefined()
    expect(pasted.sites).toEqual([])
  })
  it('rejects malformed, oversized, unknown-resource and over-limit clipboard data without mutating the project', () => {
    const project = fixture()
    const text = copyArchitectureSelection(project, [project.objects[0].id])!
    const before = JSON.stringify(project)
    expect(() => pasteArchitectureSelection(project, '{bad')).toThrow()
    expect(() => pasteArchitectureSelection(project, 'x'.repeat(8 * 1024 * 1024 + 1))).toThrow()
    expect(() =>
      pasteArchitectureSelection(
        { ...project, resources: project.resources.filter((resource) => resource.id !== 'cpu') },
        text,
      ),
    ).toThrow()
    const full = {
      ...project,
      objects: Array.from({ length: 500 }, () => ({
        ...project.objects[0],
        id: crypto.randomUUID(),
      })),
      links: [],
    }
    expect(() => pasteArchitectureSelection(full, text)).toThrow()
    expect(JSON.stringify(project)).toBe(before)
  })
  it('applies validated plugin defaults only when creating a new architecture page', () => {
    const workspace = seedWorkspace('Defaults', false)
    expect(
      projectArchitecturePluginSchema.parse({ enabled: true, projects: [] }).defaults,
    ).toBeUndefined()
    const old = createPage(workspace, 'Old', null, 'architecture')
    workspace.plugins.projectArchitecture.defaults = {
      showTitle: false,
      showBalances: false,
      showResources: true,
    }
    const page = createPage(workspace, 'New', null, 'architecture')
    expect(page.architecture!.presentation).toEqual(workspace.plugins.projectArchitecture.defaults)
    expect(old.architecture!.presentation).toBeUndefined()
    expect(
      projectArchitecturePluginSchema.safeParse({
        ...workspace.plugins.projectArchitecture,
        defaults: { showTitle: 'yes' },
      }).success,
    ).toBe(false)
  })
})
