import { describe, expect, it } from 'vitest'
import {
  architectureBalances,
  architectureAllocations,
  architectureObjectDraft,
  architectureDiagramLayout,
  architectureSegmentIntersects,
  moveArchitectureObject,
  moveArchitectureObjects,
  groupArchitectureObjects,
  architecturePresentation,
  architectureMermaid,
  architectureProjectSchema,
  architectureScope,
  architectureSvg,
  createArchitectureProject,
  projectArchitecturePluginSchema,
  removeArchitectureObjects,
  removeArchitectureSite,
  removeArchitectureGroup,
  type ArchitectureObject,
} from '../src/shared/projectArchitecture'
import { seedWorkspace } from '../src/shared/seed'
import { workspaceSchema } from '../src/shared/model'
import { projectArchitectureTab, projectArchitectureSettingsTab } from '../src/shared/plugins'
import { architectureRasterSize } from '../src/components/architectureImageExport'

function fixture() {
  const project = createArchitectureProject('Delivery')
  project.resources[0].capacity = 400
  project.resources[1].capacity = 200
  project.sites = [
    { id: crypto.randomUUID(), name: 'Moscow 1' },
    { id: crypto.randomUUID(), name: 'Novosibirsk 1' },
  ]
  const object = (siteId: string, name: string, cpu: number): ArchitectureObject => ({
    id: crypto.randomUUID(),
    siteId,
    name,
    type: 'server',
    os: 'Debian',
    resources: { cpu, ram: 20 },
    parameters: [{ name: 'IP', value: '192.0.2.10' }],
  })
  project.objects = [
    object(project.sites[0].id, 'Web', 100),
    object(project.sites[1].id, 'Replica', 40),
  ]
  project.links = [
    {
      id: crypto.randomUUID(),
      from: project.objects[0].id,
      to: project.objects[1].id,
      label: 'Replication',
    },
  ]
  return project
}
describe('project architecture', () => {
  it('validates site-local server groups and bounded background choices while retaining older snapshots', () => {
    const project = fixture()
    expect(architectureProjectSchema.parse(project).groups).toBeUndefined()
    project.sites[0].background = 'blue'
    project.groups = [
      {
        id: crypto.randomUUID(),
        siteId: project.sites[0].id,
        name: 'API cluster',
        background: 'green',
      },
    ]
    project.objects[0].groupId = project.groups[0].id
    expect(architectureProjectSchema.parse(JSON.parse(JSON.stringify(project)))).toEqual(project)
    const invalid = structuredClone(project)
    invalid.groups![0].siteId = project.sites[1].id
    expect(architectureProjectSchema.safeParse(invalid).success).toBe(false)
    invalid.groups![0].siteId = project.sites[0].id
    for (const type of ['server', 'database', 'website'] as const) {
      invalid.objects[0].type = type
      expect(architectureProjectSchema.parse(JSON.parse(JSON.stringify(invalid)))).toEqual(invalid)
    }
    invalid.groups!.push(invalid.groups![0])
    expect(architectureProjectSchema.safeParse(invalid).success).toBe(false)
    expect(
      architectureProjectSchema.safeParse({
        ...project,
        sites: [{ ...project.sites[0], background: 'url(https://example.com)' }],
      }).success,
    ).toBe(false)
    expect(
      architectureProjectSchema.safeParse({
        ...project,
        groups: Array.from({ length: 101 }, () => ({
          ...project.groups![0],
          id: crypto.randomUUID(),
        })),
      }).success,
    ).toBe(false)
  })
  it('moves servers into/out of groups and clears membership across sites without changing allocations or links', () => {
    const project = fixture()
    project.groups = [{ id: crypto.randomUUID(), siteId: project.sites[0].id, name: 'API cluster' }]
    const grouped = moveArchitectureObject(
      project,
      project.objects[0].id,
      project.sites[0].id,
      undefined,
      project.groups[0].id,
    )
    expect(grouped.objects.find((object) => object.id === project.objects[0].id)!.groupId).toBe(
      project.groups[0].id,
    )
    const ungrouped = moveArchitectureObject(
      grouped,
      project.objects[0].id,
      project.sites[0].id,
      undefined,
      null,
    )
    expect(
      ungrouped.objects.find((object) => object.id === project.objects[0].id)!.groupId,
    ).toBeUndefined()
    const moved = moveArchitectureObject(grouped, project.objects[0].id, project.sites[1].id)
    expect(
      moved.objects.find((object) => object.id === project.objects[0].id)!.groupId,
    ).toBeUndefined()
    expect(moved.links).toEqual(project.links)
    expect(architectureBalances(moved)).toEqual(architectureBalances(project))
    expect(() =>
      moveArchitectureObject(
        project,
        project.objects[1].id,
        project.sites[1].id,
        undefined,
        project.groups![0].id,
      ),
    ).toThrow()
    const removed = removeArchitectureGroup(grouped, project.groups[0].id)
    expect(removed.groups).toEqual([])
    expect(removed.objects.every((object) => !object.groupId)).toBe(true)
    expect(removed.links).toEqual(project.links)
    expect(architectureBalances(removed)).toEqual(architectureBalances(project))
    const deleted = removeArchitectureSite(grouped, project.sites[0].id)
    expect(deleted.groups).toEqual([])
    expect(architectureProjectSchema.safeParse(deleted).success).toBe(true)
  })
  it('groups servers, databases and websites together while preserving types, data, allocations and links', () => {
    const project = fixture()
    const first = project.objects[0]
    project.objects = (['server', 'database', 'website'] as const).map((type, index) => ({
      ...first,
      id: crypto.randomUUID(),
      name: type + index,
      type,
      disks: [{ id: crypto.randomUUID(), name: 'System', resourceId: 'nvme', capacity: 10 }],
    }))
    project.links = [
      {
        id: crypto.randomUUID(),
        from: project.objects[0].id,
        to: project.objects[1].id,
        label: 'SQL',
      },
    ]
    const grouped = groupArchitectureObjects(
      project,
      project.objects.map((object) => object.id),
      'Services',
    )
    const groupId = grouped.groups![0].id
    expect(grouped.objects.map((object) => object.type)).toEqual(['server', 'database', 'website'])
    expect(grouped.objects.every((object) => object.groupId === groupId)).toBe(true)
    expect(architectureBalances(grouped)).toEqual(architectureBalances(project))
    expect(grouped.links).toEqual(project.links)
    expect(architectureProjectSchema.parse(JSON.parse(JSON.stringify(grouped)))).toEqual(grouped)
    const removed = removeArchitectureGroup(grouped, groupId)
    expect(removed.objects.map(({ groupId, position, ...object }) => object)).toEqual(
      project.objects,
    )
    expect(removed.links).toEqual(project.links)
    expect(() => groupArchitectureObjects(project, [project.objects[0].id], 'Invalid')).toThrow()
    expect(() =>
      groupArchitectureObjects(project, [project.objects[0].id, project.objects[0].id], 'Invalid'),
    ).toThrow()
  })
  it('renders nested and empty group frames with background exports, scoped membership and clear arrow routes', () => {
    const project = fixture()
    project.sites[0].background = 'blue'
    project.groups = [
      {
        id: crypto.randomUUID(),
        siteId: project.sites[0].id,
        name: 'API cluster',
        background: 'green',
      },
      { id: crypto.randomUUID(), siteId: project.sites[1].id, name: 'Empty', background: 'pink' },
    ]
    project.objects[0].groupId = project.groups[0].id
    const layout = architectureDiagramLayout(project)
    expect(layout.groups).toHaveLength(2)
    const group = layout.groups[0],
      node = layout.nodes.find((node) => node.object.id === project.objects[0].id)!
    expect(node.x).toBeGreaterThan(group.x)
    expect(node.y).toBeGreaterThan(group.y + 34)
    expect(node.y + node.height).toBeLessThan(group.y + group.height)
    for (const edge of layout.edges)
      for (let i = 1; i < edge.points.length; i++)
        for (const obstacle of layout.nodes)
          expect(architectureSegmentIntersects(edge.points[i - 1], edge.points[i], obstacle)).toBe(
            false,
          )
    expect(architectureScope(project, project.sites[0].id).groups).toEqual([project.groups[0]])
    const svg = architectureSvg(project)
    expect(svg).toContain('fill="#e8eff6"')
    expect(svg).toContain('fill="#f4f8f2"')
    expect(svg).toContain('data-architecture-group')
    expect(svg).not.toContain('data-architecture-add-server')
    expect(architectureSvg(project, undefined, undefined, true)).not.toContain(
      'data-architecture-add-server',
    )
    expect(architectureMermaid(project)).toContain('subgraph g0["API cluster"]')
    expect(architectureMermaid(project)).toContain('style g0 fill:#f4f8f2')
  })
  it('groups selected servers atomically within one site and moves a selection without losing data', () => {
    const project = fixture()
    project.objects.push({ ...project.objects[0], id: crypto.randomUUID(), name: 'API 2' })
    const ids = [project.objects[0].id, project.objects[2].id]
    const grouped = groupArchitectureObjects(project, ids, 'API group')
    expect(grouped.groups).toHaveLength(1)
    expect(
      grouped.objects
        .filter((object) => ids.includes(object.id))
        .every((object) => object.groupId === grouped.groups![0].id),
    ).toBe(true)
    expect(architectureBalances(grouped)).toEqual(architectureBalances(project))
    expect(grouped.links).toEqual(project.links)
    expect(project.groups).toBeUndefined()
    const moved = moveArchitectureObjects(
      grouped,
      ids,
      project.sites[1].id,
      project.objects[1].id,
      null,
    )
    expect(moved.objects.map((object) => object.id)).toEqual([
      ids[0],
      ids[1],
      project.objects[1].id,
    ])
    expect(
      moved.objects.every((object) => object.siteId === project.sites[1].id && !object.groupId),
    ).toBe(true)
    expect(moved.links).toEqual(project.links)
    expect(architectureBalances(moved)).toEqual(architectureBalances(project))
    expect(() =>
      groupArchitectureObjects(project, [ids[0], project.objects[1].id], 'Invalid'),
    ).toThrow()
    project.objects[2].type = 'website'
    expect(
      architectureProjectSchema.safeParse(groupArchitectureObjects(project, ids, 'Mixed')).success,
    ).toBe(true)
    expect(() =>
      moveArchitectureObjects(project, [crypto.randomUUID()], project.sites[0].id),
    ).toThrow()
  })
  it('preserves optional per-project presentation settings and honors them in layout and exports', () => {
    const project = fixture()
    expect(architecturePresentation(project)).toEqual({
      showTitle: true,
      showResources: true,
      showBalances: true,
    })
    const normal = architectureDiagramLayout(project)
    project.presentation = { showTitle: false, showResources: false, showBalances: false }
    expect(architectureProjectSchema.parse(JSON.parse(JSON.stringify(project)))).toEqual(project)
    expect(architectureDiagramLayout(project).height).toBeLessThan(normal.height)
    expect(architectureSvg(project)).not.toContain('data-architecture-title=')
    expect(architectureSvg(project)).not.toContain('CPU 100')
    expect(architectureMermaid(project)).not.toContain('CPU: 100')
    expect(architectureSvg(project)).toContain('IP: 192.0.2.10')
    expect(
      architectureProjectSchema.safeParse({
        ...project,
        presentation: { ...project.presentation, showTitle: 'yes' },
      }).success,
    ).toBe(false)
  })
  it('converts legacy storage only in the opened draft and sums multiple disks from the same pool', () => {
    const project = fixture()
    const original = structuredClone(project.objects[0])
    project.objects[0].resources.nvme = 200
    const draft = architectureObjectDraft(project, project.objects[0])
    expect(draft.disks).toHaveLength(1)
    expect(draft.resources.nvme).toBeUndefined()
    expect(project.objects[0].resources.nvme).toBe(200)
    draft.disks!.push({
      id: crypto.randomUUID(),
      resourceId: 'nvme',
      name: 'Logs',
      capacity: 125.5,
    })
    const next = { ...project, objects: [draft, project.objects[1]] }
    expect(architectureAllocations(draft).nvme).toBe(325.5)
    expect(architectureBalances(next).find((resource) => resource.id === 'nvme')!.used).toBe(325.5)
    expect(architectureProjectSchema.safeParse(next).success).toBe(true)
    draft.disks![1].resourceId = 'ram'
    expect(architectureProjectSchema.safeParse(next).success).toBe(false)
    expect(original.resources.cpu).toBe(draft.resources.cpu)
  })
  it('keeps every label visible with multiple grouped servers and links that skip the middle site', () => {
    const project = fixture()
    project.sites.push({ id: crypto.randomUUID(), name: 'Warehouse' })
    project.groups = [
      { id: crypto.randomUUID(), siteId: project.sites[0].id, name: 'API servers' },
      { id: crypto.randomUUID(), siteId: project.sites[2].id, name: 'Archive' },
    ]
    const server = project.objects[0]
    project.objects = [
      { ...server, groupId: project.groups[0].id },
      { ...server, id: crypto.randomUUID(), name: 'API 2', groupId: project.groups[0].id },
      { ...server, id: crypto.randomUUID(), name: 'Website', type: 'website' },
      { ...project.objects[1], type: 'database' },
      {
        ...server,
        id: crypto.randomUUID(),
        name: 'Archive',
        siteId: project.sites[2].id,
        groupId: project.groups[1].id,
      },
    ]
    project.links = [
      [2, 0, 'HTTPS'],
      [2, 1, 'HTTPS'],
      [0, 3, 'PostgreSQL'],
      [1, 3, 'PostgreSQL'],
      [3, 4, 'Backup'],
      [2, 4, 'HTTPS archive'],
    ].map(([from, to, label]) => ({
      id: crypto.randomUUID(),
      from: project.objects[from as number].id,
      to: project.objects[to as number].id,
      label: label as string,
    }))
    for (const showResources of [true, false]) {
      const layout = architectureDiagramLayout(project, undefined, showResources)
      for (const edge of layout.edges) {
        expect(edge.label, edge.link.label).not.toBeNull()
        for (let i = 1; i < edge.points.length; i++)
          for (const node of layout.nodes)
            expect(architectureSegmentIntersects(edge.points[i - 1], edge.points[i], node)).toBe(
              false,
            )
      }
    }
  })
  it('rejects duplicate, dangling and oversized disk lists while retaining old snapshots', () => {
    const project = fixture()
    const disk = { id: crypto.randomUUID(), resourceId: 'ssd', capacity: 0, name: '' }
    project.objects[0].disks = [disk, disk]
    expect(architectureProjectSchema.safeParse(project).success).toBe(false)
    project.objects[0].disks = [{ ...disk, resourceId: 'missing' }]
    expect(architectureProjectSchema.safeParse(project).success).toBe(false)
    project.objects[0].disks = Array.from({ length: 51 }, () => ({
      ...disk,
      id: crypto.randomUUID(),
    }))
    expect(architectureProjectSchema.safeParse(project).success).toBe(false)
  })
  it('moves and reorders an object without changing its metadata, links or project resource balance', () => {
    const project = fixture()
    project.objects[0].disks = [
      { id: crypto.randomUUID(), resourceId: 'ssd', name: 'System', capacity: 50 },
    ]
    const next = moveArchitectureObject(
      project,
      project.objects[0].id,
      project.sites[1].id,
      project.objects[1].id,
    )
    expect(next.objects[0]).toEqual({ ...project.objects[0], siteId: project.sites[1].id })
    expect(next.links).toEqual(project.links)
    expect(architectureBalances(next)).toEqual(architectureBalances(project))
    expect(architectureProjectSchema.safeParse(next).success).toBe(true)
    expect(project.objects[0].siteId).toBe(project.sites[0].id)
    expect(() =>
      moveArchitectureObject(project, project.objects[0].id, crypto.randomUUID()),
    ).toThrow()
  })
  it('routes skipping, reverse and adjacent links around every card with distinct attachment points', () => {
    const project = fixture()
    project.sites.push({ id: crypto.randomUUID(), name: 'Warehouse' })
    project.objects.push(
      { ...project.objects[0], id: crypto.randomUUID(), name: 'Website', type: 'website' },
      {
        ...project.objects[1],
        id: crypto.randomUUID(),
        name: 'Archive',
        siteId: project.sites[2].id,
      },
    )
    project.links = [
      [0, 1, 'PostgreSQL'],
      [2, 0, 'HTTPS'],
      [2, 3, 'Archive HTTPS'],
      [1, 3, 'Backup'],
      [3, 1, 'Restore'],
      [3, 2, 'Response'],
    ].map(([from, to, label]) => ({
      id: crypto.randomUUID(),
      from: project.objects[from as number].id,
      to: project.objects[to as number].id,
      label: label as string,
    }))
    const layout = architectureDiagramLayout(project)
    const ports = new Set<string>()
    for (const edge of layout.edges) {
      for (const [id, point] of [
        [edge.link.from, edge.points[0]],
        [edge.link.to, edge.points.at(-1)!],
      ] as const) {
        const key = `${id}:${point.x}:${point.y}`
        expect(ports.has(key)).toBe(false)
        ports.add(key)
      }
      edge.points.slice(1).forEach((point, index) => {
        for (const node of layout.nodes)
          expect(architectureSegmentIntersects(edge.points[index], point, node)).toBe(false)
      })
      expect(edge.label).not.toBeNull()
      if (edge.label) {
        const label = edge.label
        const box = label.vertical
          ? {
              x: label.x + label.width / 2 - 8,
              y: label.y + 8 - label.width / 2,
              width: 20,
              height: label.width,
            }
          : { ...label, height: 16 }
        for (const node of layout.nodes)
          expect(
            box.x < node.x + node.width &&
              box.x + box.width > node.x &&
              box.y < node.y + node.height &&
              box.y + box.height > node.y,
          ).toBe(false)
      }
    }
    const svg = architectureSvg(project, undefined, undefined, true)
    expect(svg).not.toContain('data-architecture-add=')
    expect(svg).toContain('architecture-port-dot')
    expect(svg).toContain('data-architecture-icon="website"')
    expect(architectureSvg(project)).not.toContain('data-architecture-add=')
    expect(architectureDiagramLayout(project, undefined, false).height).toBeLessThan(layout.height)
  })
  it('bounds raster dimensions and memory for large diagrams while preserving readable normal exports', () => {
    expect(architectureRasterSize(1000, 500)).toEqual({ width: 2000, height: 1000 })
    const huge = architectureRasterSize(1200, 100000)
    expect(huge.width * huge.height).toBeLessThanOrEqual(16_000_000)
    expect(huge.height).toBeLessThanOrEqual(8192)
    for (const value of [0, -1, NaN, Infinity])
      expect(() => architectureRasterSize(value, 100)).toThrow()
  })
  it('opens legacy snapshots with an empty disabled plugin and preserves existing pages', () => {
    const original = seedWorkspace('Legacy', false)
    const legacy = JSON.parse(JSON.stringify(original))
    delete legacy.plugins.projectArchitecture
    const parsed = workspaceSchema.parse(legacy)
    expect(parsed.plugins.projectArchitecture).toEqual({ enabled: false, projects: [] })
    expect(parsed.pages).toEqual(original.pages)
  })
  it('round-trips projects, custom disk names, object metadata and reusable tabs', () => {
    const w = seedWorkspace('Architecture', false)
    const project = fixture()
    project.resources.push({ id: 'archive', name: 'HDD Archive', unit: 'GB', capacity: 1000 })
    project.objects[0].resources.archive = 500
    w.plugins.projectArchitecture = { enabled: true, projects: [project] }
    w.ui.tabs.push(projectArchitectureTab, projectArchitectureSettingsTab)
    w.ui.activeId = projectArchitectureTab
    expect(
      workspaceSchema.parse(JSON.parse(JSON.stringify(w))).plugins.projectArchitecture,
    ).toEqual(w.plugins.projectArchitecture)
    w.plugins.projectArchitecture.enabled = false
    expect(workspaceSchema.safeParse(w).success).toBe(false)
    w.ui.tabs = [projectArchitectureSettingsTab]
    w.ui.activeId = projectArchitectureSettingsTab
    expect(workspaceSchema.parse(w).plugins.projectArchitecture.projects).toEqual([project])
  })
  it('counts allocations once globally and scopes site usage without changing free capacity', () => {
    const project = fixture()
    const cpu = architectureBalances(project, project.sites[0].id)[0]
    expect(cpu).toMatchObject({ used: 140, scopedUsed: 100, remaining: 260 })
    expect(architectureBalances(project)[1]).toMatchObject({
      used: 40,
      scopedUsed: 40,
      remaining: 160,
    })
  })
  it('retains zero and fractional values and reports over-allocation without rejecting a plan', () => {
    const project = fixture()
    project.objects[0].resources.cpu = 400.5
    project.objects[1].resources.cpu = 0
    expect(architectureProjectSchema.safeParse(project).success).toBe(true)
    expect(architectureBalances(project)[0].remaining).toBe(-0.5)
    for (const value of [-1, Infinity, NaN, 1_000_000_001]) {
      project.objects[0].resources.cpu = value
      expect(architectureProjectSchema.safeParse(project).success).toBe(false)
    }
  })
  it('rejects duplicate identities, dangling allocations, missing sites and invalid connections', () => {
    const changes = [
      (p: ReturnType<typeof fixture>) => p.sites.push(p.sites[0]),
      (p: ReturnType<typeof fixture>) => p.resources.push(p.resources[0]),
      (p: ReturnType<typeof fixture>) => p.objects.push(p.objects[0]),
      (p: ReturnType<typeof fixture>) => (p.objects[0].resources.unknown = 1),
      (p: ReturnType<typeof fixture>) => (p.objects[0].siteId = crypto.randomUUID()),
      (p: ReturnType<typeof fixture>) => (p.links[0].to = crypto.randomUUID()),
      (p: ReturnType<typeof fixture>) => (p.links[0].to = p.links[0].from),
      (p: ReturnType<typeof fixture>) => p.links.push({ ...p.links[0], id: crypto.randomUUID() }),
    ]
    for (const change of changes) {
      const project = fixture()
      change(project)
      expect(architectureProjectSchema.safeParse(project).success).toBe(false)
    }
    expect(
      projectArchitecturePluginSchema.safeParse({
        enabled: true,
        projects: Array(31).fill(fixture()),
      }).success,
    ).toBe(false)
  })
  it('deletes objects and their connections atomically and releases resources', () => {
    const project = fixture()
    const next = removeArchitectureObjects(project, new Set([project.objects[0].id]))
    expect(architectureProjectSchema.safeParse(next).success).toBe(true)
    expect(next.links).toEqual([])
    expect(architectureBalances(next)[0]).toMatchObject({ used: 40, remaining: 360 })
    expect(project.objects).toHaveLength(2)
    expect(project.links).toHaveLength(1)
  })
  it('deletes a site with only its objects and affected cross-site connections', () => {
    const project = fixture()
    const next = removeArchitectureSite(project, project.sites[1].id)
    expect(next.objects.map((object) => object.id)).toEqual([project.objects[0].id])
    expect(next.sites).toEqual([project.sites[0]])
    expect(next.links).toEqual([])
    expect(architectureProjectSchema.safeParse(next).success).toBe(true)
  })
  it('scopes diagrams and exports to one site including an empty or missing site', () => {
    const project = fixture()
    expect(architectureScope(project).links).toHaveLength(1)
    expect(architectureScope(project, project.sites[0].id).links).toEqual([])
    const source = architectureMermaid(project, project.sites[0].id)
    expect(source).toContain('Moscow 1')
    expect(source).toContain('Web')
    expect(source).not.toContain('Replica')
    expect(source).not.toContain('Replication')
    expect(architectureSvg(project, project.sites[0].id)).not.toContain('Novosibirsk 1')
    expect(architectureScope(project, crypto.randomUUID()).objects).toEqual([])
    project.sites.push({ id: crypto.randomUUID(), name: 'Warehouse' })
    expect(architectureSvg(project, project.sites[2].id)).toContain('No objects yet.')
  })
  it('escapes user-controlled SVG text/attributes and Mermaid directives, keeping rich details', () => {
    const project = fixture()
    project.name = '<script>alert(1)</script>'
    project.sites[0].name = '"]\n%%{init: bad}%%\n<script>'
    project.objects[0].name = '"><script>alert(1)</script>'
    project.objects[0].parameters[0].value = '<img onerror="alert(1)">\x00'
    project.links[0].label = '"]\nclassDef injected'
    const svg = architectureSvg(project)
    expect(svg).not.toContain('<script>')
    expect(svg).not.toContain('<img ')
    expect(svg).toContain('&lt;script&gt;')
    expect(svg).not.toContain('\x00')
    const source = architectureMermaid(project)
    expect(source).not.toContain('%%{')
    expect(source).not.toContain('<script>')
    expect(source).not.toMatch(/^classDef injected/m)
    expect(source).toContain('IP:')
    expect(source).toContain('RAM: 20 GB')
  })
})
