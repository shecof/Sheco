import { describe, expect, it } from 'vitest'
import {
  architectureBalances,
  architectureDiagramLayout,
  architectureMermaid,
  architectureNoSite,
  architectureProjectSchema,
  architectureScope,
  architectureSegmentIntersects,
  architectureSvg,
  createArchitectureProject,
  duplicateArchitectureObjects,
  groupArchitectureObjects,
  removeArchitectureGroup,
  type ArchitectureObject,
} from '../src/shared/projectArchitecture'
import {
  architectureGrid,
  materializeArchitecturePositions,
  placeArchitectureSelection,
  prepareArchitectureChange,
} from '../src/shared/architecturePlacement'

function fixture() {
  const project = createArchitectureProject('Placement')
  project.sites = [
    { id: crypto.randomUUID(), name: 'Moscow' },
    { id: crypto.randomUUID(), name: 'Novosibirsk' },
  ]
  const node = (name: string, siteId?: string): ArchitectureObject => ({
    id: crypto.randomUUID(),
    name,
    type: 'server',
    ...(siteId && { siteId }),
    os: 'Debian',
    resources: { cpu: 4, ram: 8 },
    disks: [{ id: crypto.randomUUID(), name: 'System', resourceId: 'nvme', capacity: 20 }],
    parameters: [{ name: 'Environment', value: 'Production' }],
  })
  project.objects = [
    node('api-1', project.sites[0].id),
    node('api-2', project.sites[0].id),
    node('db', project.sites[1].id),
  ]
  project.links = [
    {
      id: crypto.randomUUID(),
      from: project.objects[0].id,
      to: project.objects[2].id,
      label: 'SQL',
    },
  ]
  return project
}
const geometry = (project: ReturnType<typeof fixture>) =>
  architectureDiagramLayout(project, undefined, undefined, false)
describe('architecture placement and unassigned objects', () => {
  it('groups root objects, scopes/exports them once, and preserves members when removing the group', () => {
    const project = fixture()
    project.objects.slice(0, 2).forEach((object) => delete object.siteId)
    const ids = project.objects.slice(0, 2).map((object) => object.id)
    const grouped = groupArchitectureObjects(project, ids, 'Free services')
    const group = grouped.groups!.at(-1)!
    expect(group.siteId).toBeUndefined()
    expect(architectureProjectSchema.parse(JSON.parse(JSON.stringify(grouped)))).toEqual(grouped)
    expect(architectureScope(grouped, architectureNoSite).groups).toEqual([group])
    expect(architectureScope(grouped, project.sites[0].id).groups).toEqual([])
    const layout = geometry(grouped)
    expect(layout.groups).toHaveLength(1)
    expect(layout.nodes).toHaveLength(project.objects.length)
    expect(new Set(layout.nodes.map((node) => node.object.id)).size).toBe(project.objects.length)
    expect(architectureBalances(grouped)).toEqual(architectureBalances(project))
    expect(grouped.links).toEqual(project.links)
    expect(architectureMermaid(grouped, architectureNoSite)).toContain(
      'subgraph g0["Free services"]',
    )
    expect(architectureSvg(grouped, architectureNoSite)).toContain('Free services')
    const removed = removeArchitectureGroup(grouped, group.id)
    expect(removed.objects.every((object) => !object.groupId)).toBe(true)
    expect(removed.links).toEqual(project.links)
    for (const id of ids) {
      const before = layout.nodes.find((node) => node.object.id === id)!
      const after = geometry(removed).nodes.find((node) => node.object.id === id)!
      expect({ x: after.x, y: after.y }).toEqual({ x: before.x, y: before.y })
    }
    const invalid = structuredClone(grouped)
    invalid.objects[0].siteId = project.sites[0].id
    expect(architectureProjectSchema.safeParse(invalid).success).toBe(false)
  })
  it('moves a root group and drops objects into and out of it without losing links or allocations', () => {
    const project = fixture()
    project.objects.slice(0, 2).forEach((object) => delete object.siteId)
    const grouped = groupArchitectureObjects(
      project,
      project.objects.slice(0, 2).map((o) => o.id),
      'Root',
    )
    const group = geometry(grouped).groups[0]
    const moved = placeArchitectureSelection(grouped, geometry(grouped), 'group', [group.id], {
      x: -640,
      y: 320,
    }).project
    expect(geometry(moved).groups[0].x).toBeLessThan(group.x)
    const target = geometry(moved).groups[0]
    const added = placeArchitectureSelection(
      moved,
      geometry(moved),
      'object',
      [project.objects[2].id],
      { x: 0, y: 0 },
      0,
      { x: target.x + 100, y: target.y + 70 },
    ).project
    expect(added.objects[2]).toMatchObject({ groupId: group.id })
    expect(added.objects[2].siteId).toBeUndefined()
    const detached = placeArchitectureSelection(
      added,
      geometry(added),
      'object',
      [project.objects[2].id],
      { x: -1200, y: -1200 },
      0,
      { x: -2000, y: -2000 },
    ).project
    expect(detached.objects[2].groupId).toBeUndefined()
    expect(detached.objects[2].siteId).toBeUndefined()
    expect(detached.links).toEqual(project.links)
    expect(architectureBalances(detached)).toEqual(architectureBalances(project))
  })
  it('supports objects without a site, with scoped accounting and both exports', () => {
    const project = fixture(),
      object = { ...project.objects[0], id: crypto.randomUUID(), name: 'Independent' }
    delete object.siteId
    project.objects.push(object)
    project.links.push({
      id: crypto.randomUUID(),
      from: object.id,
      to: project.objects[0].id,
      label: 'HTTPS',
    })
    expect(architectureProjectSchema.parse(project)).toEqual(project)
    expect(architectureScope(project).objects).toHaveLength(4)
    expect(architectureScope(project, architectureNoSite).objects).toEqual([object])
    expect(architectureScope(project, project.sites[0].id).objects).toHaveLength(2)
    const balance = architectureBalances(project, architectureNoSite).find(
      (resource) => resource.id === 'cpu',
    )!
    expect(balance.scopedUsed).toBe(4)
    expect(balance.used).toBe(16)
    expect(architectureMermaid(project)).toContain('Independent')
    expect(architectureSvg(project)).toContain('Independent')
    expect(architectureSvg(project, project.sites[0].id)).not.toContain('Independent')
    expect(geometry(project).nodes).toHaveLength(4)
  })
  it('keeps old snapshots readable and validates new coordinates and real site references', () => {
    const project = fixture()
    expect(architectureProjectSchema.parse(project)).toEqual(project)
    project.sites[0].position = { x: -160, y: 320 }
    project.objects[0].position = { x: 32, y: 64 }
    expect(architectureProjectSchema.parse(JSON.parse(JSON.stringify(project)))).toEqual(project)
    project.objects[0].position.x = Infinity
    expect(architectureProjectSchema.safeParse(project).success).toBe(false)
    project.objects[0].position.x = 1_000_001
    expect(architectureProjectSchema.safeParse(project).success).toBe(false)
    delete project.objects[0].position
    project.objects[0].siteId = crypto.randomUUID()
    expect(architectureProjectSchema.safeParse(project).success).toBe(false)
  })
  it('snaps frame moves, carries children, and preserves resources and connection identity', () => {
    const project = fixture(),
      layout = geometry(project),
      source = structuredClone(project)
    const placed = placeArchitectureSelection(
      project,
      layout,
      'site',
      [project.sites[0].id],
      { x: -39, y: 49 },
      0,
    ).project
    const moved = geometry(placed)
    expect(placed.sites[0].position).toEqual({ x: -0, y: 144 })
    expect(moved.nodes[0].x - layout.nodes[0].x).toBe(-32)
    expect(moved.nodes[0].y - layout.nodes[0].y).toBe(48)
    expect(placed.links).toEqual(project.links)
    expect(architectureBalances(placed)).toEqual(architectureBalances(project))
    expect(project).toEqual(source)
    expect(architectureProjectSchema.safeParse(placed).success).toBe(true)
  })
  it('swaps sites and objects, and exposes edge alignment guides', () => {
    const project = fixture(),
      layout = geometry(project),
      a = layout.sites[0],
      b = layout.sites[1]
    const swapped = placeArchitectureSelection(
      project,
      layout,
      'site',
      [a.id],
      { x: b.x - a.x, y: b.y - a.y },
      0,
    ).project
    expect(swapped.sites[0].position).toEqual({ x: b.x, y: b.y })
    expect(swapped.sites[1].position).toEqual({ x: a.x, y: a.y })
    const first = layout.nodes[0],
      second = layout.nodes[1]
    const objects = placeArchitectureSelection(
      project,
      layout,
      'object',
      [first.object.id],
      { x: second.x - first.x, y: second.y - first.y },
      0,
    ).project
    expect(geometry(objects).nodes.find((node) => node.object.id === first.object.id)?.y).toBe(
      second.y,
    )
    expect(geometry(objects).nodes.find((node) => node.object.id === second.object.id)?.y).toBe(
      first.y,
    )
    const aligned = placeArchitectureSelection(
      project,
      layout,
      'site',
      [a.id],
      { x: b.x - a.x + 3, y: b.height + 64 },
      6,
    )
    expect(aligned.guides.some((guide) => guide.axis === 'x' && guide.value === b.x)).toBe(true)
    expect(aligned.project.sites[0].position!.x % architectureGrid).toBe(0)
  })
  it('moves objects out of a site and into another container with grid positions', () => {
    const project = fixture(),
      layout = geometry(project),
      object = layout.nodes[0]
    const free = placeArchitectureSelection(
      project,
      layout,
      'object',
      [object.object.id],
      { x: -640, y: 0 },
      0,
      { x: -500, y: object.y },
    ).project
    expect(free.objects[0].siteId).toBeUndefined()
    expect(Math.abs(free.objects[0].position!.x % architectureGrid)).toBe(0)
    const freeLayout = geometry(free),
      node = freeLayout.nodes.find((node) => node.object.id === object.object.id)!,
      target = freeLayout.sites[1]
    const returned = placeArchitectureSelection(
      free,
      freeLayout,
      'object',
      [node.object.id],
      { x: target.x + 32 - node.x, y: target.y + 64 - node.y },
      0,
      { x: target.x + 40, y: target.y + 80 },
    ).project
    expect(returned.objects[0].siteId).toBe(target.id)
    expect(returned.links).toEqual(project.links)
    expect(architectureProjectSchema.safeParse(returned).success).toBe(true)
  })
  it('duplicates configuration with fresh object/disk IDs, independent budgets, and no external arrows', () => {
    const project = fixture(),
      before = structuredClone(project),
      result = duplicateArchitectureObjects(project, [project.objects[0].id])
    const copy = result.project.objects.at(-1)!
    expect(result.ids).toEqual([copy.id])
    expect(copy.id).not.toBe(project.objects[0].id)
    expect(copy.disks![0].id).not.toBe(project.objects[0].disks![0].id)
    expect(copy.parameters).toEqual(project.objects[0].parameters)
    expect(copy.resources).toEqual(project.objects[0].resources)
    expect(copy.os).toBe('Debian')
    expect(result.project.links).toEqual(project.links)
    expect(
      architectureBalances(result.project).find((resource) => resource.id === 'cpu')!.used,
    ).toBe(16)
    expect(project).toEqual(before)
    const root = {
      ...project.objects[0],
      id: crypto.randomUUID(),
      siteId: undefined,
      position: { x: 64, y: -96 },
    }
    const freeCopy = duplicateArchitectureObjects(
      { ...project, objects: [...project.objects, root] },
      [root.id],
    )
    const layout = geometry(freeCopy.project),
      copied = layout.nodes.find((node) => node.object.id === freeCopy.ids[0])!
    expect(
      layout.sites.some(
        (site) =>
          copied.x < site.x + site.width &&
          copied.x + copied.width > site.x &&
          copied.y < site.y + site.height &&
          copied.y + copied.height > site.y,
      ),
    ).toBe(false)
  })
  it.each(['server', 'database', 'website'] as const)(
    'moves a %s into a group across sites without changing its type, metadata or accounting',
    (type) => {
      const project = fixture()
      project.objects[2].type = type
      project.groups = [{ id: crypto.randomUUID(), siteId: project.sites[0].id, name: 'Services' }]
      const layout = geometry(project),
        source = layout.nodes[2],
        target = layout.groups[0]
      const cursor = { x: target.x + 40, y: target.y + 25 }
      const result = placeArchitectureSelection(
        project,
        layout,
        'object',
        [source.object.id],
        { x: cursor.x - source.x - 40, y: cursor.y - source.y - 25 },
        0,
        cursor,
      )
      const moved = result.project.objects.find((object) => object.id === source.object.id)!
      expect(result.target).toEqual({ kind: 'group', id: target.id })
      expect(moved).toMatchObject({
        ...source.object,
        siteId: project.sites[0].id,
        groupId: target.id,
        position: expect.any(Object),
      })
      expect(architectureProjectSchema.parse(JSON.parse(JSON.stringify(result.project)))).toEqual(
        result.project,
      )
      expect(architectureBalances(result.project)).toEqual(architectureBalances(project))
      expect(result.project.links).toEqual(project.links)
      const ungrouped = removeArchitectureGroup(result.project, target.id)
      expect(ungrouped.objects.find((object) => object.id === source.object.id)).toMatchObject({
        type,
        siteId: project.sites[0].id,
      })
      expect(
        ungrouped.objects.find((object) => object.id === source.object.id)!.groupId,
      ).toBeUndefined()
      expect(ungrouped.links).toEqual(project.links)
    },
  )
  it('keeps group contents local while moving and retains world locations when removing a group', () => {
    const project = fixture(),
      grouped = groupArchitectureObjects(
        project,
        project.objects.slice(0, 2).map((object) => object.id),
        'API',
      )
    const before = geometry(grouped),
      group = before.groups[0]
    const moved = placeArchitectureSelection(
      grouped,
      before,
      'group',
      [group.id],
      { x: 48, y: 32 },
      0,
    ).project
    const after = geometry(moved)
    expect(
      after.nodes.find((node) => node.object.id === project.objects[0].id)!.x -
        before.nodes.find((node) => node.object.id === project.objects[0].id)!.x,
    ).toBe(48)
    const ungrouped = removeArchitectureGroup(moved, group.id)
    expect(
      geometry(ungrouped).nodes.find((node) => node.object.id === project.objects[0].id),
    ).toMatchObject({
      x: after.nodes.find((node) => node.object.id === project.objects[0].id)!.x,
      y: after.nodes.find((node) => node.object.id === project.objects[0].id)!.y,
    })
    expect(ungrouped.links).toEqual(project.links)
    expect(architectureBalances(ungrouped)).toEqual(architectureBalances(project))
  })
  it('renders persisted negative positions and routes shifted sites without losing endpoints', () => {
    const project = fixture(),
      frozen = materializeArchitecturePositions(project, geometry(project))
    frozen.sites[0].position = { x: -320, y: 416 }
    frozen.sites[1].position = { x: 448, y: -160 }
    const layout = architectureDiagramLayout(frozen)
    expect(layout.x).toBeLessThan(-320)
    expect(layout.y).toBeLessThan(-160)
    expect(architectureSvg(frozen)).toContain(`viewBox="${layout.x} ${layout.y}`)
    for (const edge of layout.edges)
      for (let index = 1; index < edge.points.length; index++)
        expect(
          layout.nodes.some((node) =>
            architectureSegmentIntersects(edge.points[index - 1], edge.points[index], node),
          ),
        ).toBe(false)
  })
  it('routes through multiple bends around manually placed cards and narrow gaps', () => {
    const project = fixture()
    project.sites = []
    const positions = [
      { x: 0, y: 0 },
      { x: 1008, y: 0 },
      { x: 160, y: -208 },
      { x: 160, y: 160 },
      { x: 336, y: -48 },
      { x: 656, y: 80 },
    ]
    project.objects = positions.map((position, index) => ({
      ...project.objects[0],
      id: crypto.randomUUID(),
      name: `card-${index}`,
      siteId: undefined,
      disks: [],
      position,
    }))
    project.links = [
      {
        id: crypto.randomUUID(),
        from: project.objects[0].id,
        to: project.objects[1].id,
        label: 'route',
      },
    ]
    for (const layout of [
      architectureDiagramLayout(project),
      architectureDiagramLayout({
        ...project,
        objects: project.objects
          .slice(0, 2)
          .map((object, index) => ({ ...object, position: { x: index * 304, y: 0 } })),
      }),
    ]) {
      for (const edge of layout.edges)
        for (let index = 1; index < edge.points.length; index++)
          expect(
            layout.nodes.some((node) =>
              architectureSegmentIntersects(edge.points[index - 1], edge.points[index], node),
            ),
          ).toBe(false)
    }
  })
})

describe('architecture audit regressions', () => {
  const overlaps = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
    a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
  const noOverlaps = (project: ReturnType<typeof fixture>) => {
    const layout = geometry(project)
    expect(
      layout.sites.some((site, i) =>
        layout.sites.slice(i + 1).some((other) => overlaps(site, other)),
      ),
    ).toBe(false)
    expect(
      layout.nodes.some((node, i) =>
        layout.nodes.slice(i + 1).some((other) => overlaps(node, other)),
      ),
    ).toBe(false)
  }
  it('keeps copies within their site and settles neighbours when a site grows', () => {
    const base = fixture(),
      project = materializeArchitecturePositions(base, geometry(base))
    project.sites[0].position = { x: 32, y: 96 }
    project.sites[1].position = { x: 448, y: 96 }
    project.objects[0].position = { x: 32, y: 64 }
    project.objects[1].position = { x: 32, y: 240 }
    project.objects[2].position = { x: 32, y: 64 }
    const copied = duplicateArchitectureObjects(project, [project.objects[0].id]).project
    noOverlaps(copied)
    expect(geometry(copied).sites[0].width).toBe(352)
    const expanded = structuredClone(copied)
    expanded.objects[1].position = { x: 336, y: 64 }
    const settled = prepareArchitectureChange(copied, expanded)
    noOverlaps(settled)
    expect(settled.links).toEqual(project.links)
  })
  it('checks a third site and root objects after swapping unequal sites', () => {
    const project = fixture()
    project.sites[0].position = { x: 32, y: 96 }
    project.sites[1].position = { x: 768, y: 96 }
    project.objects[0].position = { x: 32, y: 64 }
    project.objects[1].position = { x: 336, y: 64 }
    project.objects[2].position = { x: 32, y: 64 }
    project.sites.push({ id: crypto.randomUUID(), name: 'Third', position: { x: 1184, y: 96 } })
    project.objects.push(
      { ...project.objects[2], id: crypto.randomUUID(), siteId: project.sites[2].id },
      {
        ...project.objects[2],
        id: crypto.randomUUID(),
        siteId: undefined,
        position: { x: 1600, y: 96 },
      },
    )
    const moved = placeArchitectureSelection(
      project,
      geometry(project),
      'site',
      [project.sites[0].id],
      { x: 736, y: 0 },
      0,
    ).project
    noOverlaps(moved)
    const layout = geometry(moved),
      root = layout.nodes.find((node) => !node.object.siteId)!
    expect(layout.sites.some((site) => overlaps(root, site))).toBe(false)
  })
  it('places excluded members outside the remaining group and keeps accounting', () => {
    const original = fixture(),
      project = groupArchitectureObjects(
        original,
        original.objects.slice(0, 2).map((object) => object.id),
        'API',
      )
    const next = structuredClone(project)
    delete next.objects[0].groupId
    delete next.objects[0].position
    const settled = prepareArchitectureChange(project, next),
      layout = geometry(settled)
    expect(
      overlaps(
        layout.nodes.find((node) => node.object.id === next.objects[0].id)!,
        layout.groups[0],
      ),
    ).toBe(false)
    expect(architectureBalances(settled)).toEqual(architectureBalances(project))
  })
  it('keeps long return links separate across connected sites', () => {
    const project = createArchitectureProject('Connected sites')
    project.presentation = { showTitle: false, showResources: true, showBalances: false }
    project.sites = Array.from({ length: 20 }, (_, index) => ({
      id: crypto.randomUUID(),
      name: 'Site ' + index,
    }))
    project.objects = project.sites.flatMap((site, index) =>
      Array.from({ length: 5 }, (_, child) => ({
        id: crypto.randomUUID(),
        siteId: site.id,
        name: `server-${index}-${child}`,
        type: 'server' as const,
        os: 'Debian',
        resources: {},
        parameters: [],
      })),
    )
    const objectCount = project.objects.length
    project.links = Array.from({ length: objectCount * 2 }, (_, index) => ({
      id: crypto.randomUUID(),
      from: project.objects[index % objectCount].id,
      to: project.objects[
        ((index % objectCount) + (Math.floor(index / objectCount) + 1) * 7) % objectCount
      ].id,
      label: 'HTTPS ' + index,
    }))
    const layout = architectureDiagramLayout(project)
    const tracks = new Map<string, { id: string; min: number; max: number }[]>()
    for (const edge of layout.edges)
      for (let index = 1; index < edge.points.length; index++) {
        const a = edge.points[index - 1],
          b = edge.points[index],
          vertical = a.x === b.x,
          key = (vertical ? 'x' : 'y') + (vertical ? a.x : a.y),
          axis = vertical ? 'y' : 'x'
        const segment = {
          id: edge.link.id,
          min: Math.min(a[axis], b[axis]),
          max: Math.max(a[axis], b[axis]),
        }
        for (const other of tracks.get(key) ?? [])
          if (other.id !== segment.id)
            expect(
              Math.min(segment.max, other.max) - Math.max(segment.min, other.min),
            ).toBeLessThanOrEqual(0.01)
        if (!tracks.has(key)) tracks.set(key, [])
        tracks.get(key)!.push(segment)
        expect(layout.nodes.some((node) => architectureSegmentIntersects(a, b, node))).toBe(false)
      }
    expect(layout.edges.every((edge) => edge.label)).toBe(true)
  }, 10000)
  it('renders every nonempty label above cards, centered within its own route', () => {
    const project = fixture()
    project.objects = Array.from({ length: 50 }, (_, index) => ({
      ...project.objects[index % 3],
      id: crypto.randomUUID(),
      position: { x: 32 + (index % 5) * 384, y: 64 + Math.floor(index / 5) * 176 },
      siteId: undefined,
    }))
    project.links = Array.from({ length: 100 }, (_, index) => ({
      id: crypto.randomUUID(),
      from: project.objects[index % 50].id,
      to: project.objects[((index % 50) + (Math.floor(index / 50) + 1) * 7) % 50].id,
      label: 'HTTPS ' + index,
    }))
    const layout = architectureDiagramLayout(project),
      svg = architectureSvg(project, undefined, undefined, false, undefined, layout)
    expect(layout.edges.filter((edge) => edge.label)).toHaveLength(100)
    expect(svg.match(/data-architecture-link-label=/g)).toHaveLength(100)
    expect(svg.lastIndexOf('data-architecture-object=')).toBeLessThan(
      svg.indexOf('data-architecture-link-label='),
    )
    for (const edge of layout.edges) {
      const label = edge.label!
      const center = { x: label.x + label.width / 2, y: label.y + 8 }
      expect(
        edge.points.slice(1).some((point, index) => {
          const a = edge.points[index]
          return a.x === point.x
            ? center.x === a.x &&
                center.y >= Math.min(a.y, point.y) &&
                center.y <= Math.max(a.y, point.y)
            : center.y === a.y &&
                center.x >= Math.min(a.x, point.x) &&
                center.x <= Math.max(a.x, point.x)
        }),
      ).toBe(true)
    }
    const renamed = {
      ...project,
      objects: project.objects.map((object, index) =>
        index ? object : { ...object, name: 'Renamed', os: 'FreeBSD' },
      ),
    }
    const cached = architectureDiagramLayout(renamed)
    expect(cached.edges).toEqual(layout.edges)
    expect(cached.nodes[0].object.name).toBe('Renamed')
    cached.edges[0].points[0].x += 500
    expect(architectureDiagramLayout(project).edges[0].points).toEqual(layout.edges[0].points)
  })
})
