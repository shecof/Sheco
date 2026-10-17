import type {
  ArchitectureBounds,
  ArchitectureDiagramLayout,
  ArchitecturePoint,
  ArchitectureProject,
} from './projectArchitecture'

import {
  architectureGeometry,
  architectureGeometryKey,
  architectureGrid,
} from './architectureGeometry'
export { architectureGrid } from './architectureGeometry'
export const snapArchitecturePoint = (point: ArchitecturePoint): ArchitecturePoint => ({
  x: Math.max(
    -990_000,
    Math.min(990_000, Math.round(point.x / architectureGrid) * architectureGrid),
  ),
  y: Math.max(
    -990_000,
    Math.min(990_000, Math.round(point.y / architectureGrid) * architectureGrid),
  ),
})
export type ArchitectureGuide = { axis: 'x' | 'y'; value: number; from: number; to: number }
export type ArchitecturePlacementKind = 'object' | 'site' | 'group'
const inside = (point: ArchitecturePoint, box: ArchitectureBounds) =>
  point.x >= box.x &&
  point.x <= box.x + box.width &&
  point.y >= box.y &&
  point.y <= box.y + box.height
const intersects = (a: ArchitectureBounds, b: ArchitectureBounds, gap = 0) =>
  a.x < b.x + b.width + gap &&
  a.x + a.width + gap > b.x &&
  a.y < b.y + b.height + gap &&
  a.y + a.height + gap > b.y
const sameParent = (
  a: ArchitectureProject['objects'][number],
  b: { siteId?: string; groupId?: string },
) => a.siteId === b.siteId && a.groupId === b.groupId
const union = (boxes: ArchitectureBounds[]): ArchitectureBounds => {
  const x = Math.min(...boxes.map((box) => box.x)),
    y = Math.min(...boxes.map((box) => box.y))
  return {
    x,
    y,
    width: Math.max(...boxes.map((box) => box.x + box.width)) - x,
    height: Math.max(...boxes.map((box) => box.y + box.height)) - y,
  }
}
export function materializeArchitecturePositions(
  project: ArchitectureProject,
  layout: ArchitectureDiagramLayout,
): ArchitectureProject {
  const sites = new Map(layout.sites.map((site) => [site.id, site]))
  const groups = new Map(layout.groups.map((group) => [group.id, group]))
  const nodes = new Map(layout.nodes.map((node) => [node.object.id, node]))
  return {
    ...project,
    sites: project.sites.map((site) => {
      const point = sites.get(site.id)
      return point ? { ...site, position: { x: point.x, y: point.y } } : site
    }),
    ...(project.groups && {
      groups: project.groups.map((group) => {
        const point = groups.get(group.id),
          parent = group.siteId ? sites.get(group.siteId) : undefined
        return point
          ? { ...group, position: { x: point.x - (parent?.x ?? 0), y: point.y - (parent?.y ?? 0) } }
          : group
      }),
    }),
    objects: project.objects.map((object) => {
      const point = nodes.get(object.id),
        parent = object.groupId
          ? groups.get(object.groupId)
          : object.siteId
            ? sites.get(object.siteId)
            : undefined
      return point
        ? { ...object, position: { x: point.x - (parent?.x ?? 0), y: point.y - (parent?.y ?? 0) } }
        : object
    }),
  }
}

// Settle complete containers from the inside out. Growing a group or a site must
// move its neighbours as well; checking only the dragged card misses that case.
export function prepareArchitectureChange(
  baseline: ArchitectureProject,
  proposed: ArchitectureProject,
): ArchitectureProject {
  if (architectureGeometryKey(baseline) === architectureGeometryKey(proposed)) return proposed
  const before = materializeArchitecturePositions(baseline, architectureGeometry(baseline))
  let next: ArchitectureProject = {
    ...proposed,
    sites: proposed.sites.map((site) => ({
      ...site,
      position: site.position ?? before.sites.find((old) => old.id === site.id)?.position,
    })),
    groups: proposed.groups?.map((group) => ({
      ...group,
      position:
        group.position ??
        before.groups?.find((old) => old.id === group.id && old.siteId === group.siteId)?.position,
    })),
    objects: proposed.objects.map((object) => ({
      ...object,
      position:
        object.position ??
        before.objects.find((old) => old.id === object.id && sameParent(old, object))?.position,
    })),
  }
  next = materializeArchitecturePositions(next, architectureGeometry(next))
  type Item = ArchitectureBounds & { id: string; kind: ArchitecturePlacementKind }
  const pack = (
    items: Item[],
    origin: ArchitecturePoint,
    minimum?: ArchitecturePoint,
    maximumX = Infinity,
  ) => {
    const occupied: ArchitectureBounds[] = []
    for (const item of items.sort((a, b) => a.y - b.y || a.x - b.x)) {
      const point = vacantArchitecturePosition(item, occupied, minimum, Math.max(item.x, maximumX))
      occupied.push({ ...item, ...point })
      const position = { x: point.x - origin.x, y: point.y - origin.y }
      if (item.kind === 'object')
        next.objects = next.objects.map((object) =>
          object.id === item.id ? { ...object, position } : object,
        )
      else if (item.kind === 'group')
        next.groups = next.groups!.map((group) =>
          group.id === item.id ? { ...group, position } : group,
        )
      else
        next.sites = next.sites.map((site) => (site.id === item.id ? { ...site, position } : site))
    }
  }
  let geometry = architectureGeometry(next)
  for (const group of geometry.groups)
    pack(
      geometry.nodes
        .filter((node) => node.object.groupId === group.id)
        .map((node) => ({ ...node, id: node.object.id, kind: 'object' })),
      group,
      { x: group.x + 16, y: group.y + 48 },
      group.x + group.width - 304,
    )
  geometry = architectureGeometry(next)
  for (const site of geometry.sites)
    pack(
      [
        ...geometry.groups
          .filter((group) => group.siteId === site.id)
          .map((group): Item => ({ ...group, kind: 'group' })),
        ...geometry.nodes
          .filter((node) => node.object.siteId === site.id && !node.object.groupId)
          .map((node): Item => ({ ...node, id: node.object.id, kind: 'object' })),
      ],
      site,
      { x: site.x + 16, y: site.y + 64 },
      site.x + site.width - 336,
    )
  geometry = architectureGeometry(next)
  pack(
    [
      ...geometry.sites.map((site): Item => ({ ...site, kind: 'site' })),
      ...geometry.groups
        .filter((group) => !group.siteId)
        .map((group): Item => ({ ...group, kind: 'group' })),
      ...geometry.nodes
        .filter((node) => !node.object.siteId && !node.object.groupId)
        .map((node): Item => ({ ...node, id: node.object.id, kind: 'object' })),
    ],
    { x: 0, y: 0 },
  )
  return next
}
function align(box: ArchitectureBounds, peers: ArchitectureBounds[], tolerance: number) {
  const point = snapArchitecturePoint(box)
  for (const axis of ['x', 'y'] as const) {
    const length = axis === 'x' ? 'width' : 'height'
    const proposed = point[axis]
    let best = tolerance + 0.001
    for (const peer of peers)
      for (const end of [false, true]) {
        const value = peer[axis] + (end ? peer[length] : 0) - (end ? box[length] : 0)
        if (Math.abs(value - proposed) <= best) {
          best = Math.abs(value - proposed)
          point[axis] = value
        }
      }
  }
  return point
}
function guides(box: ArchitectureBounds, peers: ArchitectureBounds[]): ArchitectureGuide[] {
  const result: ArchitectureGuide[] = []
  for (const axis of ['x', 'y'] as const) {
    const length = axis === 'x' ? 'width' : 'height',
      other = axis === 'x' ? 'y' : 'x',
      span = axis === 'x' ? 'height' : 'width'
    let best: ArchitectureBounds | undefined,
      end = false,
      distance = Infinity
    for (const peer of peers)
      for (const edge of [false, true]) {
        if (
          Math.abs(box[axis] + (edge ? box[length] : 0) - peer[axis] - (edge ? peer[length] : 0)) >
          0.01
        )
          continue
        const delta = Math.abs(box[other] - peer[other])
        if (delta < distance) {
          best = peer
          end = edge
          distance = delta
        }
      }
    if (best)
      result.push({
        axis,
        value: box[axis] + (end ? box[length] : 0),
        from: Math.min(box[other], best[other]) - 16,
        to: Math.max(box[other] + box[span], best[other] + best[span]) + 16,
      })
  }
  return result
}
export function vacantArchitecturePosition(
  box: ArchitectureBounds,
  peers: ArchitectureBounds[],
  minimum?: ArchitecturePoint,
  maximumX = Infinity,
) {
  const valid = (point: ArchitecturePoint) =>
    point.x <= maximumX &&
    (!minimum || (point.x >= minimum.x && point.y >= minimum.y)) &&
    !peers.some((peer) => intersects({ ...box, ...point }, peer, 16))
  if (valid(box)) return { x: box.x, y: box.y }
  const hits = peers.filter((peer) => intersects(box, peer, 16))
  const candidates = hits
    .flatMap((peer) => [
      { x: peer.x - box.width - 16, y: box.y },
      { x: peer.x + peer.width + 16, y: box.y },
      { x: box.x, y: peer.y - box.height - 16 },
      { x: box.x, y: peer.y + peer.height + 16 },
    ])
    .map(snapArchitecturePoint)
    .sort((a, b) => Math.hypot(a.x - box.x, a.y - box.y) - Math.hypot(b.x - box.x, b.y - box.y))
  const closest = candidates.find(valid)
  if (closest) return closest
  const point = snapArchitecturePoint({
    x: Math.min(maximumX, Math.max(minimum?.x ?? -990_000, box.x)),
    y: Math.max(minimum?.y ?? -990_000, box.y),
  })
  for (let index = 0; index < 2000 && !valid(point); index++) point.y += architectureGrid
  return point
}
export function placeArchitectureSelection(
  project: ArchitectureProject,
  layout: ArchitectureDiagramLayout,
  kind: ArchitecturePlacementKind,
  ids: string[],
  delta: ArchitecturePoint,
  tolerance = 6,
  dropPoint?: ArchitecturePoint,
) {
  const next = materializeArchitecturePositions(project, layout)
  if (kind === 'site' || kind === 'group') {
    const source = (kind === 'site' ? layout.sites : layout.groups).find(
      (frame) => frame.id === ids[0],
    )
    if (!source) throw new Error('Missing architecture frame')
    const peers = (
      kind === 'site'
        ? layout.sites
        : layout.groups.filter(
            (group) => group.siteId === ('siteId' in source ? source.siteId : undefined),
          )
    ).filter((frame) => frame.id !== source.id)
    let point = align({ ...source, x: source.x + delta.x, y: source.y + delta.y }, peers, tolerance)
    const parent =
      kind === 'group'
        ? layout.sites.find((site) => site.id === ('siteId' in source ? source.siteId : undefined))
        : undefined
    const minimum = parent ? { x: parent.x + 16, y: parent.y + 64 } : undefined
    if (minimum) point = { x: Math.max(minimum.x, point.x), y: Math.max(minimum.y, point.y) }
    const center = { x: point.x + source.width / 2, y: point.y + source.height / 2 }
    const swap = peers.find(
      (peer) =>
        (Math.abs(point.x - peer.x) < 32 && Math.abs(point.y - peer.y) < 32) ||
        (inside(center, peer) &&
          Math.abs(center.x - peer.x - peer.width / 2) < peer.width / 4 &&
          Math.abs(center.y - peer.y - peer.height / 2) < peer.height / 4),
    )
    if (swap && kind === 'site') {
      next.sites = next.sites.map((site) =>
        site.id === source.id
          ? { ...site, position: { x: swap.x, y: swap.y } }
          : site.id === swap.id
            ? { ...site, position: { x: source.x, y: source.y } }
            : site,
      )
      return {
        project: prepareArchitectureChange(project, next),
        guides: [] as ArchitectureGuide[],
        target: { kind: 'site' as const, id: swap.id },
      }
    }
    const occupied = parent
      ? [
          ...peers,
          ...layout.nodes.filter(
            (node) => node.object.siteId === parent.id && !node.object.groupId,
          ),
        ]
      : [
          ...layout.sites.filter((site) => site.id !== source.id),
          ...layout.groups.filter((group) => !group.siteId && group.id !== source.id),
          ...layout.nodes.filter((node) => !node.object.siteId && !node.object.groupId),
        ]
    point = vacantArchitecturePosition({ ...source, ...point }, occupied, minimum)
    if (kind === 'site')
      next.sites = next.sites.map((site) =>
        site.id === source.id ? { ...site, position: point } : site,
      )
    else
      next.groups = next.groups!.map((group) =>
        group.id === source.id
          ? { ...group, position: { x: point.x - (parent?.x ?? 0), y: point.y - (parent?.y ?? 0) } }
          : group,
      )
    return {
      project: prepareArchitectureChange(project, next),
      guides: guides({ ...source, ...point }, peers),
      target: undefined,
    }
  }
  const nodes = layout.nodes.filter((node) => ids.includes(node.object.id))
  if (nodes.length !== new Set(ids).size || !nodes.length)
    throw new Error('Missing architecture objects')
  const original = union(nodes),
    peers = layout.nodes.filter((node) => !ids.includes(node.object.id))
  let point = align(
    { ...original, x: original.x + delta.x, y: original.y + delta.y },
    peers,
    tolerance,
  )
  const cursor = dropPoint ?? { x: point.x + original.width / 2, y: point.y + original.height / 2 }
  const group = layout.groups.find((group) => inside(cursor, group))
  const site = group
    ? layout.sites.find((site) => site.id === group.siteId)
    : layout.sites.find((site) => inside(cursor, site))
  const parent = group ?? site
  const destination = { siteId: site?.id, groupId: group?.id }
  const minimum = parent
    ? { x: parent.x + (group ? 16 : 32), y: parent.y + (group ? 48 : 64) }
    : undefined
  if (minimum) point = { x: Math.max(point.x, minimum.x), y: Math.max(point.y, minimum.y) }
  const occupied = peers.filter((node) => sameParent(node.object, destination))
  const swap =
    nodes.length === 1 && sameParent(nodes[0].object, destination)
      ? occupied.find((node) =>
          inside({ x: point.x + original.width / 2, y: point.y + original.height / 2 }, node),
        )
      : undefined
  if (swap) {
    next.objects = next.objects.map((object) =>
      object.id === nodes[0].object.id
        ? { ...object, position: { x: swap.x - (parent?.x ?? 0), y: swap.y - (parent?.y ?? 0) } }
        : object.id === swap.object.id
          ? {
              ...object,
              position: { x: original.x - (parent?.x ?? 0), y: original.y - (parent?.y ?? 0) },
            }
          : object,
    )
    return {
      project: prepareArchitectureChange(project, next),
      guides: [] as ArchitectureGuide[],
      target: { kind: 'object' as const, id: swap.object.id },
    }
  }
  point = vacantArchitecturePosition(
    { ...original, ...point },
    group
      ? occupied
      : site
        ? [...occupied, ...layout.groups.filter((frame) => frame.siteId === site.id)]
        : [...occupied, ...layout.sites, ...layout.groups.filter((frame) => !frame.siteId)],
    minimum,
  )
  const offset = { x: point.x - original.x, y: point.y - original.y }
  next.objects = next.objects.map((object) => {
    const node = nodes.find((node) => node.object.id === object.id)
    if (!node) return object
    const moved = {
      ...object,
      ...destination,
      position: {
        x: node.x + offset.x - (parent?.x ?? 0),
        y: node.y + offset.y - (parent?.y ?? 0),
      },
    }
    if (!site) delete moved.siteId
    if (!group) delete moved.groupId
    return moved
  })
  return {
    project: prepareArchitectureChange(project, next),
    guides: guides({ ...original, ...point }, peers),
    target: parent
      ? { kind: group ? ('group' as const) : ('site' as const), id: parent.id }
      : undefined,
  }
}
