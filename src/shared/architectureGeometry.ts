import type {
  ArchitectureBounds,
  ArchitectureGroup,
  ArchitectureObject,
  ArchitectureProject,
  ArchitectureDiagramLayout,
} from './projectArchitecture'

export const architectureGrid = 16
const boxesIntersect = (a: ArchitectureBounds, b: ArchitectureBounds) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
export function architectureGeometry(
  project: ArchitectureProject,
  showResources = project.presentation?.showResources ?? true,
): ArchitectureDiagramLayout {
  const layout: ArchitectureDiagramLayout = {
    x: 0,
    y: 0,
    width: 640,
    height: 240,
    sites: [],
    groups: [],
    nodes: [],
    edges: [],
  }
  const nodeHeight = showResources ? 144 : 112
  const overlap = (a: ArchitectureBounds, b: ArchitectureBounds) =>
    boxesIntersect(a, {
      ...b,
      x: b.x - 16,
      y: b.y - 16,
      width: b.width + 32,
      height: b.height + 32,
    })
  const localNodes = (objects: ArchitectureObject[], padding: number, top: number) => {
    const occupied = objects
      .filter((object) => object.position)
      .map((object) => ({ ...object.position!, width: 288, height: nodeHeight }))
    return objects.map((object) => {
      const point = object.position ? { ...object.position } : { x: padding, y: top }
      if (!object.position) {
        while (occupied.some((box) => overlap({ ...point, width: 288, height: nodeHeight }, box)))
          point.y += architectureGrid
        occupied.push({ ...point, width: 288, height: nodeHeight })
      }
      return { object, ...point, width: 288, height: nodeHeight }
    })
  }
  const groupFrames = (
    groups: ArchitectureGroup[],
    origin: { x: number; y: number },
    top: number,
  ) => {
    let cursor = top
    return groups.map((group) => {
      const members = localNodes(
        project.objects.filter((object) => object.groupId === group.id),
        16,
        48,
      )
      const relative = group.position ?? { x: group.siteId ? 16 : 32, y: cursor }
      const width = Math.max(320, ...members.map((node) => node.x + node.width + 16))
      const height = Math.max(96, ...members.map((node) => node.y + node.height + 16))
      cursor = Math.max(cursor, relative.y + height + 32)
      const frame = { ...group, x: origin.x + relative.x, y: origin.y + relative.y, width, height }
      layout.nodes.push(
        ...members.map((node) => ({ ...node, x: frame.x + node.x, y: frame.y + node.y })),
      )
      return frame
    })
  }
  let rowY = (project.presentation?.showTitle ?? true) ? 96 : 32
  for (let start = 0; start < project.sites.length; start += 3) {
    const heights: number[] = []
    for (const [index, site] of project.sites.slice(start, start + 3).entries()) {
      const point = site.position ?? { x: 32 + index * 416, y: rowY }
      const ungrouped = localNodes(
        project.objects.filter((object) => object.siteId === site.id && !object.groupId),
        32,
        64,
      )
      const groups = groupFrames(
        (project.groups ?? []).filter((group) => group.siteId === site.id),
        point,
        Math.max(64, ...ungrouped.map((node) => node.y + node.height + 32)),
      )
      layout.groups.push(...groups)
      layout.nodes.push(
        ...ungrouped.map((node) => ({ ...node, x: point.x + node.x, y: point.y + node.y })),
      )
      const width = Math.max(
        352,
        ...ungrouped.map((node) => node.x + node.width + 32),
        ...groups.map((group) => group.x - point.x + group.width + 16),
      )
      const height = Math.max(
        160,
        ...ungrouped.map((node) => node.y + node.height + 16),
        ...groups.map((group) => group.y - point.y + group.height + 16),
      )
      layout.sites.push({ ...site, ...point, width, height })
      heights.push(height)
    }
    rowY += Math.max(...heights) + 64
  }
  const freeTop = Math.max(
    (project.presentation?.showTitle ?? true) ? 96 : 32,
    ...layout.sites.map((site) => site.y + site.height + 64),
  )
  const free = localNodes(
    project.objects.filter((object) => !object.siteId && !object.groupId),
    32,
    freeTop,
  )
  layout.nodes.push(...free)
  layout.groups.push(
    ...groupFrames(
      (project.groups ?? []).filter((group) => !group.siteId),
      { x: 0, y: 0 },
      Math.max(freeTop, ...free.map((node) => node.y + node.height + 32)),
    ),
  )
  return layout
}

// Text and allocations have fixed-size cards and do not invalidate geometry.
export const architectureGeometryKey = (project: ArchitectureProject) =>
  JSON.stringify([
    project.presentation?.showTitle ?? true,
    project.presentation?.showResources ?? true,
    project.sites.map(({ id, position }) => [id, position]),
    (project.groups ?? []).map(({ id, siteId, position }) => [id, siteId, position]),
    project.objects.map(({ id, siteId, groupId, position }) => [id, siteId, groupId, position]),
  ])
