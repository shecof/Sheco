import { z } from 'zod'
import {
  architectureProjectSchema,
  architectureLimits,
  architectureDiagramLayout,
  architecturePresentation,
  architectureNoSite,
  type ArchitectureProject,
} from './projectArchitecture'
import {
  materializeArchitecturePositions,
  prepareArchitectureChange,
  vacantArchitecturePosition,
} from './architecturePlacement'

const format = 'sheco-architecture'
const maxBytes = 8 * 1024 * 1024
const clipboardSchema = z.strictObject({
  format: z.literal(format),
  version: z.literal(1),
  project: architectureProjectSchema,
})
export const isArchitectureClipboard = (text: string) => text.startsWith(`{"format":"${format}"`)

export function copyArchitectureSelection(
  project: ArchitectureProject,
  ids: string[],
  groupId?: string,
) {
  const layout = architectureDiagramLayout(project, undefined, undefined, false)
  const selected = new Set(ids)
  const group = project.groups?.find((item) => item.id === groupId)
  const objects = project.objects.filter(
    (object) => selected.has(object.id) || (group && object.groupId === group.id),
  )
  if (!objects.length && !group) return null
  const snapshot = materializeArchitecturePositions(project, layout)
  const copied: ArchitectureProject = {
    ...snapshot,
    sites: snapshot.sites.filter(
      (site) => site.id === group?.siteId || objects.some((object) => object.siteId === site.id),
    ),
    groups: group ? snapshot.groups!.filter((item) => item.id === group.id) : [],
    objects: snapshot.objects
      .filter((object) => objects.some((item) => item.id === object.id))
      .map((object) => {
        if (!object.groupId || object.groupId === group?.id) return object
        const { groupId: _groupId, ...copy } = object
        const node = layout.nodes.find((node) => node.object.id === object.id)!
        const site = layout.sites.find((site) => site.id === object.siteId)
        return { ...copy, position: { x: node.x - (site?.x ?? 0), y: node.y - (site?.y ?? 0) } }
      }),
    links: [],
  }
  const text = JSON.stringify({
    format,
    version: 1,
    project: architectureProjectSchema.parse(copied),
  })
  if (new TextEncoder().encode(text).length > maxBytes)
    throw new Error('Architecture clipboard too large')
  return text
}

export function pasteArchitectureSelection(
  project: ArchitectureProject,
  text: string,
  targetSiteId?: string,
  copyName: (name: string, ordinal: number) => string = (name, ordinal) =>
    `${name.slice(0, 100)} (${ordinal})`,
) {
  if (new TextEncoder().encode(text).length > maxBytes)
    throw new Error('Architecture clipboard too large')
  const source = clipboardSchema.parse(JSON.parse(text)).project
  if (
    project.objects.length + source.objects.length > architectureLimits.objects ||
    (project.groups?.length ?? 0) + (source.groups?.length ?? 0) > architectureLimits.groups
  )
    throw new Error('Architecture capacity exceeded')
  if (!source.objects.length && !source.groups?.length)
    throw new Error('Empty architecture clipboard')
  for (const object of source.objects) {
    for (const resourceId of [
      ...Object.keys(object.resources),
      ...(object.disks ?? []).map((disk) => disk.resourceId),
    ]) {
      if (
        !project.resources.some(
          (pool) =>
            pool.id === resourceId &&
            pool.unit === source.resources.find((pool) => pool.id === resourceId)?.unit,
        )
      )
        throw new Error('Missing architecture resource pool')
    }
  }
  const layout = architectureDiagramLayout(project, undefined, undefined, false)
  const next = materializeArchitecturePositions(project, layout)
  const sameProject = source.id === project.id
  const rootTarget = targetSiteId === architectureNoSite
  const destination =
    targetSiteId && project.sites.some((site) => site.id === targetSiteId)
      ? targetSiteId
      : undefined
  const names = new Set([...next.objects, ...(next.groups ?? [])].map((item) => item.name))
  const nameFor = (name: string) => {
    let ordinal = 1
    while (names.has(copyName(name, ordinal).slice(0, 120))) {
      if (++ordinal > 1000) throw new Error('Invalid copy name')
    }
    const value = copyName(name, ordinal).slice(0, 120)
    names.add(value)
    return value
  }
  const groups = new Map<string, string>()
  for (const sourceGroup of source.groups ?? []) {
    let siteId =
      destination ??
      (!rootTarget && sameProject && next.sites.some((site) => site.id === sourceGroup.siteId)
        ? sourceGroup.siteId
        : undefined)
    if (!siteId && sourceGroup.siteId && !rootTarget) {
      if (next.sites.length >= architectureLimits.sites)
        throw new Error('Architecture capacity exceeded')
      const sourceSite = source.sites.find((site) => site.id === sourceGroup.siteId)!
      siteId = crypto.randomUUID()
      next.sites.push({ id: siteId, name: sourceSite.name, background: sourceSite.background })
    }
    const group = {
      ...structuredClone(sourceGroup),
      id: crypto.randomUUID(),
      siteId,
      name: nameFor(sourceGroup.name),
    }
    delete group.position
    next.groups = [...(next.groups ?? []), group]
    groups.set(sourceGroup.id, group.id)
  }
  const ids: string[] = []
  for (const sourceObject of source.objects) {
    const groupId = sourceObject.groupId ? groups.get(sourceObject.groupId) : undefined
    const siteId = groupId
      ? next.groups!.find((group) => group.id === groupId)!.siteId
      : (destination ??
        (!rootTarget && sameProject && next.sites.some((site) => site.id === sourceObject.siteId)
          ? sourceObject.siteId
          : undefined))
    const copy = {
      ...structuredClone(sourceObject),
      id: crypto.randomUUID(),
      name: nameFor(sourceObject.name),
      siteId,
      groupId,
      ...(sourceObject.disks && {
        disks: sourceObject.disks.map((disk) => ({ ...disk, id: crypto.randomUUID() })),
      }),
    }
    if (!groupId) {
      const height = architecturePresentation(project).showResources ? 144 : 112
      const parent = layout.sites.find((site) => site.id === siteId)
      copy.position = vacantArchitecturePosition(
        { x: 32, y: 64, width: 288, height },
        [
          ...next.objects
            .filter((object) => object.siteId === siteId && !object.groupId && object.position)
            .map((object) => ({ ...object.position!, width: 288, height })),
          ...(siteId
            ? layout.groups
                .filter((group) => group.siteId === siteId)
                .map((group) => ({ ...group, x: group.x - parent!.x, y: group.y - parent!.y }))
            : [...layout.sites, ...layout.groups.filter((group) => !group.siteId)]),
        ],
        siteId ? { x: 32, y: 64 } : undefined,
      )
    }
    if (!siteId) delete copy.siteId
    if (!groupId) delete copy.groupId
    next.objects.push(copy)
    ids.push(copy.id)
  }
  return {
    project: architectureProjectSchema.parse(prepareArchitectureChange(project, next)),
    ids,
    groupId: [...groups.values()][0],
  }
}
