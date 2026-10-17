import { z } from 'zod'
import {
  materializeArchitecturePositions,
  prepareArchitectureChange,
  vacantArchitecturePosition,
} from './architecturePlacement'
import { architectureGeometry, architectureGeometryKey } from './architectureGeometry'
import { routeArchitectureObstacles, architectureRouteBridges } from './architectureRouting'

const id = z.string().uuid()
const resourceId = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/)
const amount = z.number().finite().min(0).max(1_000_000_000)
const positionSchema = z.strictObject({
  x: z.number().finite().min(-1_000_000).max(1_000_000),
  y: z.number().finite().min(-1_000_000).max(1_000_000),
})
export const architectureNoSite = 'unassigned'
export const architectureLimits = {
  projects: 30,
  sites: 100,
  groups: 100,
  objects: 500,
  resources: 20,
  disks: 50,
  links: 1000,
}
export const architectureObjectTypes = ['server', 'database', 'website'] as const
export const architectureTypeLabels = { server: 'Server', database: 'Database', website: 'Website' }
export const architectureBackgrounds = [
  'default',
  'blue',
  'green',
  'purple',
  'amber',
  'pink',
  'peach',
] as const
export type ArchitectureBackground = (typeof architectureBackgrounds)[number]
export const architectureBackgroundLabels = {
  default: 'Default background',
  blue: 'Blue',
  green: 'Green',
  purple: 'Purple',
  amber: 'Yellow',
  pink: 'Pink',
  peach: 'Orange',
} as const
export function architectureBackgroundFill(
  background?: ArchitectureBackground,
  themed = false,
  soft = false,
) {
  const fallback = {
    default: '#fafafa',
    blue: '#e8eff6',
    green: '#e7f1e2',
    purple: '#eeebf5',
    amber: '#f7f0dd',
    pink: '#f6e8e8',
    peach: '#f7ecdf',
  }[background ?? 'default']
  if (soft && background && background !== 'default') {
    const softColor = {
      blue: '#f4f7fa',
      green: '#f4f8f2',
      purple: '#f7f6fa',
      amber: '#fbf8ef',
      pink: '#fbf5f5',
      peach: '#fbf7f1',
    }[background]
    return themed
      ? `color-mix(in srgb, var(--tag-${background}-bg) 35%, var(--canvas) 65%)`
      : softColor
  }
  return themed
    ? `var(--${!background || background === 'default' ? 'subtle' : `tag-${background}-bg`}, ${fallback})`
    : fallback
}
const siteSchema = z.strictObject({
  id,
  name: z.string().trim().min(1).max(120),
  background: z.enum(architectureBackgrounds).optional(),
  position: positionSchema.optional(),
})
const groupSchema = siteSchema.extend({ siteId: id.optional() })
export const architecturePresentationSchema = z.strictObject({
  showTitle: z.boolean(),
  showResources: z.boolean(),
  showBalances: z.boolean(),
})
const resourceSchema = z.strictObject({
  id: resourceId,
  name: z.string().trim().min(1).max(80),
  unit: z.enum(['cores', 'GB']),
  capacity: amount,
})
export const architectureObjectSchema = z.strictObject({
  id,
  siteId: id.optional(),
  position: positionSchema.optional(),
  groupId: id.optional(),
  name: z.string().trim().min(1).max(120),
  type: z.enum(architectureObjectTypes),
  os: z.string().trim().max(120).default(''),
  resources: z
    .record(resourceId, amount)
    .refine((r) => Object.keys(r).length <= architectureLimits.resources),
  disks: z
    .array(
      z.strictObject({
        id,
        resourceId,
        name: z.string().trim().max(80).default(''),
        capacity: amount,
      }),
    )
    .max(architectureLimits.disks)
    .optional(),
  parameters: z
    .array(
      z.strictObject({
        name: z.string().trim().min(1).max(80),
        value: z.string().max(1000),
      }),
    )
    .max(30)
    .default([]),
})
export const architectureProjectSchema = z
  .strictObject({
    id,
    name: z.string().trim().min(1).max(120),
    resources: z.array(resourceSchema).min(1).max(architectureLimits.resources),
    sites: z.array(siteSchema).max(architectureLimits.sites),
    groups: z.array(groupSchema).max(architectureLimits.groups).optional(),
    presentation: architecturePresentationSchema.optional(),
    objects: z.array(architectureObjectSchema).max(architectureLimits.objects),
    links: z
      .array(
        z.strictObject({
          id,
          from: id,
          to: id,
          label: z.string().trim().max(120),
          bidirectional: z.boolean().optional(),
          startArrow: z.enum(['none', 'arrow']).optional(),
          endArrow: z.enum(['none', 'arrow']).optional(),
          lineStyle: z.enum(['solid', 'dashed', 'dotted']).optional(),
          labelPosition: z.number().finite().min(0).max(1).optional(),
          labelRotation: z.number().finite().min(-180).max(180).optional(),
        }),
      )
      .max(architectureLimits.links),
  })
  .superRefine((project, ctx) => {
    for (const key of ['resources', 'sites', 'objects', 'links'] as const) {
      if (new Set(project[key].map((item) => item.id)).size !== project[key].length)
        ctx.addIssue({ code: 'custom', path: [key], message: 'Duplicate architecture identifiers' })
    }
    const sites = new Set(project.sites.map((site) => site.id))
    const resources = new Set(project.resources.map((resource) => resource.id))
    const objects = new Set(project.objects.map((object) => object.id))
    if (
      new Set(project.groups?.map((group) => group.id)).size !== (project.groups?.length ?? 0) ||
      project.groups?.some((group) => group.siteId && !sites.has(group.siteId))
    )
      ctx.addIssue({ code: 'custom', path: ['groups'], message: 'Invalid architecture groups' })
    project.objects.forEach((object, index) => {
      if (
        object.groupId &&
        !project.groups?.some(
          (group) => group.id === object.groupId && group.siteId === object.siteId,
        )
      )
        ctx.addIssue({
          code: 'custom',
          path: ['objects', index, 'groupId'],
          message: 'Invalid architecture group membership',
        })
      if (object.siteId && !sites.has(object.siteId))
        ctx.addIssue({
          code: 'custom',
          path: ['objects', index, 'siteId'],
          message: 'Missing architecture site',
        })
      if (Object.keys(object.resources).some((key) => !resources.has(key)))
        ctx.addIssue({
          code: 'custom',
          path: ['objects', index, 'resources'],
          message: 'Missing architecture resource',
        })
      if (
        new Set(object.disks?.map((disk) => disk.id)).size !== (object.disks?.length ?? 0) ||
        object.disks?.some(
          (disk) =>
            !project.resources.some(
              (resource) =>
                resource.id === disk.resourceId &&
                resource.unit === 'GB' &&
                !['cpu', 'ram'].includes(resource.id),
            ),
        )
      )
        ctx.addIssue({
          code: 'custom',
          path: ['objects', index, 'disks'],
          message: 'Invalid architecture disks',
        })
    })
    const pairs = new Set<string>()
    project.links.forEach((link, index) => {
      const pair = `${link.from}:${link.to}`
      if (
        !objects.has(link.from) ||
        !objects.has(link.to) ||
        link.from === link.to ||
        pairs.has(pair)
      )
        ctx.addIssue({
          code: 'custom',
          path: ['links', index],
          message: 'Invalid architecture connection',
        })
      pairs.add(pair)
    })
  })
export const projectArchitecturePluginSchema = z
  .strictObject({
    enabled: z.boolean().default(false),
    projects: z.array(architectureProjectSchema).max(architectureLimits.projects).default([]),
    defaults: architecturePresentationSchema.optional(),
  })
  .superRefine((plugin, ctx) => {
    if (new Set(plugin.projects.map((project) => project.id)).size !== plugin.projects.length)
      ctx.addIssue({
        code: 'custom',
        path: ['projects'],
        message: 'Duplicate architecture projects',
      })
    if (new TextEncoder().encode(JSON.stringify(plugin)).length > 8 * 1024 * 1024)
      ctx.addIssue({ code: 'custom', message: 'Architecture library exceeds 8 MB' })
  })
  .default(() => ({ enabled: false, projects: [] }))

export type ArchitectureProject = z.infer<typeof architectureProjectSchema>
export type ArchitectureObject = z.infer<typeof architectureObjectSchema>
export type ArchitectureResource = z.infer<typeof resourceSchema>
export type ArchitectureDisk = NonNullable<ArchitectureObject['disks']>[number]
export type ArchitectureGroup = z.infer<typeof groupSchema>
export function architectureLinkAppearance(link: ArchitectureProject['links'][number]) {
  return {
    startArrow: link.startArrow ?? (link.bidirectional ? 'arrow' : 'none'),
    endArrow: link.endArrow ?? 'arrow',
    lineStyle: link.lineStyle ?? 'solid',
  } as const
}
const architectureLineDash = (style: 'solid' | 'dashed' | 'dotted') =>
  style === 'dashed' ? '6 4' : style === 'dotted' ? '1 4' : ''
export const architecturePresentation = (project: ArchitectureProject) =>
  project.presentation ?? { showTitle: true, showResources: true, showBalances: true }
export function architectureAllocations(object: ArchitectureObject): Record<string, number> {
  const allocations = { ...object.resources }
  for (const disk of object.disks ?? [])
    allocations[disk.resourceId] = (allocations[disk.resourceId] ?? 0) + disk.capacity
  return allocations
}
export function architectureDiskPools(project: ArchitectureProject) {
  return project.resources.filter(
    (resource) => resource.unit === 'GB' && !['cpu', 'ram'].includes(resource.id),
  )
}
// Upgrade only the opened form. Cancel leaves old snapshots untouched; Save keeps
// the same totals while allowing several independently named disks from one pool.
export function architectureObjectDraft(
  project: ArchitectureProject,
  object: ArchitectureObject,
): ArchitectureObject {
  const diskIds = new Set(architectureDiskPools(project).map((resource) => resource.id))
  return {
    ...structuredClone(object),
    resources: Object.fromEntries(
      Object.entries(object.resources).filter(([key]) => !diskIds.has(key)),
    ),
    disks: [
      ...(object.disks ?? []).map((disk) => ({ ...disk })),
      ...Object.entries(object.resources)
        .filter(([key, capacity]) => diskIds.has(key) && capacity > 0)
        .map(([resourceId, capacity]) => ({
          id: crypto.randomUUID(),
          resourceId,
          capacity,
          name: '',
        })),
    ],
  }
}
export function moveArchitectureObject(
  project: ArchitectureProject,
  objectId: string,
  siteId: string | undefined,
  beforeId?: string,
  groupId?: string | null,
): ArchitectureProject {
  const object = project.objects.find((object) => object.id === objectId)
  if (!object || (siteId && !project.sites.some((site) => site.id === siteId)))
    throw new Error('Missing architecture destination')
  const destinationGroup =
    groupId === undefined
      ? object.siteId === siteId
        ? object.groupId
        : undefined
      : (groupId ?? undefined)
  if (
    destinationGroup &&
    !project.groups?.some((group) => group.id === destinationGroup && group.siteId === siteId)
  )
    throw new Error('Invalid architecture group destination')
  const moved = { ...object, siteId }
  if (!siteId) delete moved.siteId
  if (object.siteId !== siteId || object.groupId !== destinationGroup) delete moved.position
  delete moved.groupId
  if (destinationGroup) moved.groupId = destinationGroup
  const objects = project.objects.filter((object) => object.id !== objectId)
  const before = objects.findIndex((object) => object.id === beforeId && object.siteId === siteId)
  const last = objects.reduce(
    (last, object, index) => (object.siteId === siteId ? index : last),
    -1,
  )
  objects.splice(before >= 0 ? before : last >= 0 ? last + 1 : objects.length, 0, moved)
  return { ...project, objects }
}
export function moveArchitectureObjects(
  project: ArchitectureProject,
  ids: string[],
  siteId: string | undefined,
  beforeId?: string,
  groupId?: string | null,
): ArchitectureProject {
  const ordered = project.objects.filter((object) => ids.includes(object.id))
  if (!ordered.length || ordered.length !== new Set(ids).size)
    throw new Error('Missing architecture objects')
  return ordered.reduce(
    (next, object) => moveArchitectureObject(next, object.id, siteId, beforeId, groupId),
    project,
  )
}
export function groupArchitectureObjects(
  project: ArchitectureProject,
  ids: string[],
  name: string,
): ArchitectureProject {
  const members = project.objects.filter((object) => ids.includes(object.id))
  if (
    members.length < 2 ||
    members.length !== new Set(ids).size ||
    members.some((object) => object.siteId !== members[0].siteId) ||
    (project.groups?.length ?? 0) >= architectureLimits.groups
  )
    throw new Error('Choose objects in the same scope')
  const layout = architectureDiagramLayout(project, undefined, undefined, false)
  const next = materializeArchitecturePositions(project, layout)
  const site = layout.sites.find((site) => site.id === members[0].siteId)
  const selected = layout.nodes.filter((node) => ids.includes(node.object.id))
  const top = Math.min(...selected.map((node) => node.y))
  const group = {
    id: crypto.randomUUID(),
    name,
    ...(site && { siteId: site.id }),
    position: {
      x: site ? 16 : 32,
      y: Math.max(
        site ? 64 : Math.max(32, ...layout.sites.map((site) => site.y + site.height + 32)),
        ...layout.nodes
          .filter((node) => node.object.siteId === site?.id && !ids.includes(node.object.id))
          .map((node) => node.y + node.height - (site?.y ?? 0) + 32),
        ...layout.groups
          .filter((group) => group.siteId === site?.id)
          .map((group) => group.y + group.height - (site?.y ?? 0) + 32),
      ),
    },
  }
  return architectureProjectSchema.parse({
    ...next,
    groups: [...(next.groups ?? []), group],
    objects: next.objects.map((object) =>
      ids.includes(object.id)
        ? {
            ...object,
            groupId: group.id,
            position: {
              x: 16,
              y: 48 + selected.find((node) => node.object.id === object.id)!.y - top,
            },
          }
        : object,
    ),
  })
}
export function duplicateArchitectureObjects(
  project: ArchitectureProject,
  ids: string[],
  copyName: (name: string, ordinal: number) => string = (name, ordinal) => `${name} (${ordinal})`,
) {
  const originals = project.objects.filter((object) => ids.includes(object.id))
  if (
    !originals.length ||
    originals.length !== new Set(ids).size ||
    project.objects.length + originals.length > architectureLimits.objects
  )
    throw new Error('Invalid architecture duplication')
  const layout = architectureDiagramLayout(project, undefined, undefined, false)
  const next = materializeArchitecturePositions(project, layout)
  const copies = originals.map((source) => {
    const object = next.objects.find((object) => object.id === source.id)!
    let ordinal = 1
    while (next.objects.some((item) => item.name === copyName(object.name, ordinal))) ordinal++
    const parent = object.groupId
      ? layout.groups.find((group) => group.id === object.groupId)
      : layout.sites.find((site) => site.id === object.siteId)
    const height = architecturePresentation(project).showResources ? 144 : 112
    const peers = next.objects
      .filter((peer) => peer.siteId === object.siteId && peer.groupId === object.groupId)
      .map((peer) => ({ ...peer.position!, width: 288, height }))
    const frames = object.groupId
      ? []
      : object.siteId
        ? layout.groups.filter((group) => group.siteId === object.siteId)
        : [...layout.sites, ...layout.groups.filter((group) => !group.siteId)]
    const position = vacantArchitecturePosition(
      { ...object.position!, y: object.position!.y + 32, width: 288, height },
      [
        ...peers,
        ...frames.map((frame) => ({
          ...frame,
          x: frame.x - (parent?.x ?? 0),
          y: frame.y - (parent?.y ?? 0),
        })),
      ],
      parent ? { x: object.groupId ? 16 : 32, y: object.groupId ? 48 : 64 } : undefined,
      parent ? parent.width - 288 - (object.groupId ? 16 : 32) : undefined,
    )
    const copy = {
      ...structuredClone(object),
      id: crypto.randomUUID(),
      name: copyName(object.name, ordinal).slice(0, 120),
      position,
      ...(object.disks && {
        disks: object.disks.map((disk) => ({ ...disk, id: crypto.randomUUID() })),
      }),
    }
    next.objects.push(copy)
    return copy.id
  })
  return {
    project: architectureProjectSchema.parse(prepareArchitectureChange(project, next)),
    ids: copies,
  }
}
export function createArchitectureProject(name: string): ArchitectureProject {
  return architectureProjectSchema.parse({
    id: crypto.randomUUID(),
    name,
    resources: [
      { id: 'cpu', name: 'CPU', unit: 'cores', capacity: 0 },
      { id: 'ram', name: 'RAM', unit: 'GB', capacity: 0 },
      ...['NVMe', 'SSD', 'HDD'].map((name) => ({
        id: name.toLowerCase(),
        name,
        unit: 'GB',
        capacity: 0,
      })),
    ],
    sites: [],
    objects: [],
    links: [],
  })
}
export function architectureBalances(project: ArchitectureProject, siteId?: string) {
  return project.resources.map((resource) => {
    const used = project.objects.reduce(
      (sum, object) => sum + (architectureAllocations(object)[resource.id] ?? 0),
      0,
    )
    const scopedUsed = project.objects
      .filter(
        (object) =>
          !siteId || (siteId === architectureNoSite ? !object.siteId : object.siteId === siteId),
      )
      .reduce((sum, object) => sum + (architectureAllocations(object)[resource.id] ?? 0), 0)
    return { ...resource, used, scopedUsed, remaining: resource.capacity - used }
  })
}
export function removeArchitectureObjects(
  project: ArchitectureProject,
  ids: Set<string>,
): ArchitectureProject {
  return {
    ...project,
    objects: project.objects.filter((object) => !ids.has(object.id)),
    links: project.links.filter((link) => !ids.has(link.from) && !ids.has(link.to)),
  }
}
export function removeArchitectureSite(
  project: ArchitectureProject,
  siteId: string,
): ArchitectureProject {
  return {
    ...removeArchitectureObjects(
      project,
      new Set(
        project.objects.filter((object) => object.siteId === siteId).map((object) => object.id),
      ),
    ),
    sites: project.sites.filter((site) => site.id !== siteId),
    ...(project.groups && { groups: project.groups.filter((group) => group.siteId !== siteId) }),
  }
}
export function removeArchitectureGroup(
  project: ArchitectureProject,
  groupId: string,
): ArchitectureProject {
  const layout = architectureDiagramLayout(project, undefined, undefined, false)
  return {
    ...project,
    groups: project.groups?.filter((group) => group.id !== groupId),
    objects: project.objects.map((object) => {
      if (object.groupId !== groupId) return object
      const next = { ...object }
      if (object.position) {
        const node = layout.nodes.find((node) => node.object.id === object.id)!
        const site = layout.sites.find((site) => site.id === object.siteId)
        next.position = { x: node.x - (site?.x ?? 0), y: node.y - (site?.y ?? 0) }
      }
      delete next.groupId
      return next
    }),
  }
}

export function architectureScope(project: ArchitectureProject, siteId?: string) {
  const sites = project.sites.filter((site) => !siteId || site.id === siteId)
  const objects = project.objects.filter(
    (object) =>
      !siteId || (siteId === architectureNoSite ? !object.siteId : object.siteId === siteId),
  )
  const ids = new Set(objects.map((object) => object.id))
  return {
    sites,
    groups: (project.groups ?? []).filter(
      (group) =>
        !siteId || (siteId === architectureNoSite ? !group.siteId : group.siteId === siteId),
    ),
    objects,
    links: project.links.filter((link) => ids.has(link.from) && ids.has(link.to)),
  }
}
const mermaidText = (value: string) =>
  value
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '�')
    .replace(/[&"'#<>\[\]{}()|;\r\n%\\]/g, (char) => `#${char.codePointAt(0)};`)
export function architectureMermaid(
  project: ArchitectureProject,
  siteId?: string,
  translate: (key: string) => string = (key) => key,
): string {
  const scope = architectureScope(project, siteId)
  const nodeIds = new Map(scope.objects.map((object, index) => [object.id, `n${index}`]))
  const node = (object: ArchitectureObject, indent: string) => {
    const showResources = architecturePresentation(project).showResources
    const resources = (showResources ? project.resources : [])
      .filter((resource) => object.resources[resource.id])
      .map(
        (resource) =>
          `${resource.name}: ${object.resources[resource.id]} ${translate(resource.unit)}`,
      )
    const label = [
      object.name,
      translate(architectureTypeLabels[object.type]),
      object.os,
      ...resources,
      ...(showResources ? (object.disks ?? []) : []).map(
        (disk) =>
          `${disk.name || project.resources.find((resource) => resource.id === disk.resourceId)?.name}: ${disk.capacity} ${translate('GB')}`,
      ),
      ...object.parameters.map((parameter) => `${parameter.name}: ${parameter.value}`),
    ]
      .filter(Boolean)
      .map(mermaidText)
      .join('<br/>')
    return `${indent}${nodeIds.get(object.id)}${object.type === 'database' ? '[("' : '["'}${label}${object.type === 'database' ? '")]' : '"]'}`
  }
  return [
    'flowchart LR',
    ...scope.objects
      .filter((object) => !object.siteId && !object.groupId)
      .map((object) => node(object, '  ')),
    ...scope.groups
      .filter((group) => !group.siteId)
      .flatMap((group) => [
        `  subgraph g${scope.groups.indexOf(group)}["${mermaidText(group.name)}"]`,
        ...scope.objects
          .filter((object) => object.groupId === group.id)
          .map((object) => node(object, '    ')),
        '  end',
      ]),
    ...scope.sites.flatMap((site, index) => [
      `  subgraph s${index}["${mermaidText(site.name)}"]`,
      ...scope.objects
        .filter((object) => object.siteId === site.id && !object.groupId)
        .map((object) => node(object, '    ')),
      ...scope.groups
        .filter((group) => group.siteId === site.id)
        .flatMap((group) => [
          `    subgraph g${scope.groups.indexOf(group)}["${mermaidText(group.name)}"]`,
          ...scope.objects
            .filter((object) => object.groupId === group.id)
            .map((object) => node(object, '      ')),
          '    end',
        ]),
      '  end',
    ]),
    ...scope.links.map((link) => {
      const appearance = architectureLinkAppearance(link)
      const reverse = appearance.startArrow === 'arrow' && appearance.endArrow === 'none'
      const arrow =
        appearance.startArrow === 'arrow' && appearance.endArrow === 'arrow'
          ? '<-->'
          : appearance.endArrow === 'arrow' || reverse
            ? '-->'
            : '---'
      return `  ${nodeIds.get(reverse ? link.to : link.from)} ${arrow}${link.label ? `|"${mermaidText(link.label)}"|` : ''} ${nodeIds.get(reverse ? link.from : link.to)}`
    }),
    ...scope.links.flatMap((link, index) => {
      const style = architectureLinkAppearance(link).lineStyle
      return style === 'solid'
        ? []
        : [
            `  linkStyle ${index} stroke-dasharray:${architectureLineDash(style)},stroke-linecap:round`,
          ]
    }),
    ...scope.sites.flatMap((site, index) =>
      site.background && site.background !== 'default'
        ? [`  style s${index} fill:${architectureBackgroundFill(site.background)}`]
        : [],
    ),
    ...scope.groups.flatMap((group, index) =>
      group.background && group.background !== 'default'
        ? [`  style g${index} fill:${architectureBackgroundFill(group.background, false, true)}`]
        : [],
    ),
  ].join('\n')
}

const xml = (value: string) =>
  value
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '�')
    .replace(
      /[&<>"']/g,
      (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!,
    )
const shorten = (value: string, limit: number) =>
  value.length > limit ? value.slice(0, limit - 1) + '…' : value
export type ArchitecturePoint = { x: number; y: number }
export type ArchitectureBounds = ArchitecturePoint & { width: number; height: number }
export type ArchitectureLabel = ArchitecturePoint & {
  width: number
  text: string
  textOffset?: number
  rotation?: number
  vertical?: boolean
}
export type ArchitectureDiagramLayout = {
  x: number
  y: number
  width: number
  height: number
  sites: (ArchitectureBounds & z.infer<typeof siteSchema>)[]
  groups: (ArchitectureBounds & ArchitectureGroup)[]
  nodes: (ArchitectureBounds & { object: ArchitectureObject })[]
  edges: {
    link: ArchitectureProject['links'][number]
    points: ArchitecturePoint[]
    path?: string
    strokePath?: string
    bridges?: string[]
    label: ArchitectureLabel | null
  }[]
}
const simplifyRoute = (points: ArchitecturePoint[]) =>
  points
    .filter(
      (point, index) =>
        !index || point.x !== points[index - 1].x || point.y !== points[index - 1].y,
    )
    .filter(
      (point, index, all) =>
        !index ||
        index === all.length - 1 ||
        !(
          (point.x === all[index - 1].x && point.x === all[index + 1].x) ||
          (point.y === all[index - 1].y && point.y === all[index + 1].y)
        ),
    )
export function architectureSegmentIntersects(
  from: ArchitecturePoint,
  to: ArchitecturePoint,
  box: ArchitectureBounds,
  padding = 0,
): boolean {
  const left = box.x - padding,
    right = box.x + box.width + padding,
    top = box.y - padding,
    bottom = box.y + box.height + padding
  return from.x === to.x
    ? from.x > left + 0.001 &&
        from.x < right - 0.001 &&
        Math.max(from.y, to.y) > top + 0.001 &&
        Math.min(from.y, to.y) < bottom - 0.001
    : from.y > top + 0.001 &&
        from.y < bottom - 0.001 &&
        Math.max(from.x, to.x) > left + 0.001 &&
        Math.min(from.x, to.x) < right - 0.001
}
const boxesIntersect = (a: ArchitectureBounds, b: ArchitectureBounds) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
// A small session cache excludes text/allocations: editing a name must not route
// 1,000 connections again. Rebind current data and never expose cached arrays.
type CachedDiagram = { layout: ArchitectureDiagramLayout; bytes: number }
const diagramCache = new Map<string, CachedDiagram>()
const routeCache = new Map<string, CachedDiagram>()
function cacheDiagram(
  cache: Map<string, CachedDiagram>,
  key: string,
  layout: ArchitectureDiagramLayout,
) {
  const bytes = JSON.stringify(layout).length * 2 + key.length * 2
  if (bytes > 8 * 1024 * 1024) return
  cache.set(key, { layout: structuredClone(layout), bytes })
  while (
    cache.size > 4 ||
    [...cache.values()].reduce((sum, item) => sum + item.bytes, 0) > 8 * 1024 * 1024
  )
    cache.delete(cache.keys().next().value!)
}
export function architectureDiagramLayout(
  project: ArchitectureProject,
  siteId?: string,
  showResources = architecturePresentation(project).showResources,
  route = true,
): ArchitectureDiagramLayout {
  if (!route) return calculateArchitectureDiagramLayout(project, siteId, showResources, false)
  const routeKey = JSON.stringify([
    project.id,
    architectureGeometryKey(project),
    siteId,
    showResources,
    project.links.map(({ id, from, to }) => [id, from, to]),
  ])
  const key = JSON.stringify([
    routeKey,
    project.links.map((link) => [
      link.label,
      link.bidirectional,
      link.startArrow,
      link.endArrow,
      link.lineStyle,
      link.labelPosition,
      link.labelRotation,
    ]),
  ])
  let cached = diagramCache.get(key)?.layout
  if (!cached) {
    let routes = routeCache.get(routeKey)?.layout
    if (!routes) {
      routes = calculateArchitectureDiagramLayout(project, siteId, showResources)
      cacheDiagram(routeCache, routeKey, routes)
    }
    cached = structuredClone(routes)
    const links = new Map(project.links.map((link) => [link.id, link]))
    cached.edges = cached.edges.map((edge) => ({
      ...edge,
      link: links.get(edge.link.id)!,
      label: null,
    }))
    placeArchitectureLabels(cached)
    cacheDiagram(diagramCache, key, cached)
  }
  const layout = structuredClone(cached)
  const objects = new Map(project.objects.map((object) => [object.id, object]))
  layout.nodes = layout.nodes.map((node) => ({ ...node, object: objects.get(node.object.id)! }))
  layout.sites = layout.sites.map((frame) => ({
    ...frame,
    ...project.sites.find((site) => site.id === frame.id)!,
  }))
  layout.groups = layout.groups.map((frame) => ({
    ...frame,
    ...project.groups?.find((group) => group.id === frame.id)!,
  }))
  return layout
}
export function architectureSegmentsOverlap(
  a: ArchitecturePoint,
  b: ArchitecturePoint,
  c: ArchitecturePoint,
  d: ArchitecturePoint,
) {
  const axis =
    a.x === b.x && c.x === d.x && Math.abs(a.x - c.x) < 0.01
      ? 'y'
      : a.y === b.y && c.y === d.y && Math.abs(a.y - c.y) < 0.01
        ? 'x'
        : null
  return (
    axis !== null &&
    Math.min(Math.max(a[axis], b[axis]), Math.max(c[axis], d[axis])) -
      Math.max(Math.min(a[axis], b[axis]), Math.min(c[axis], d[axis])) >
      0.01
  )
}
function calculateArchitectureDiagramLayout(
  project: ArchitectureProject,
  siteId?: string,
  showResources = architecturePresentation(project).showResources,
  route = true,
): ArchitectureDiagramLayout {
  const scope = architectureScope(project, siteId)
  const layout = architectureGeometry(project, showResources)
  const nodeHeight = showResources ? 144 : 112
  const shown = new Set(scope.objects.map((object) => object.id))
  layout.nodes = layout.nodes.filter((node) => shown.has(node.object.id))
  layout.sites = layout.sites.filter((site) => scope.sites.some((item) => item.id === site.id))
  layout.groups = layout.groups.filter((group) => scope.groups.some((item) => item.id === group.id))
  const bounds = [...layout.sites, ...layout.nodes, ...layout.groups]
  if (bounds.length) {
    layout.x = Math.min(...bounds.map((box) => box.x)) - 32
    layout.y =
      Math.min(...bounds.map((box) => box.y)) -
      (architecturePresentation(project).showTitle ? 96 : 32)
    layout.width = Math.max(
      400,
      Math.max(...bounds.map((box) => box.x + box.width)) - layout.x + 32,
    )
    layout.height = Math.max(
      240,
      Math.max(...bounds.map((box) => box.y + box.height)) - layout.y + 32,
    )
  }
  if (!route) return layout
  const nodes = new Map(layout.nodes.map((node) => [node.object.id, node]))
  type Side = 'left' | 'right' | 'top' | 'bottom'
  const ends = scope.links.map((link) => {
    const from = nodes.get(link.from)!,
      to = nodes.get(link.to)!
    const vertical =
      from.x === to.x &&
      from.object.siteId === to.object.siteId &&
      Math.abs(from.y - to.y) === nodeHeight + 50
    const fromSide: Side = vertical
      ? from.y < to.y
        ? 'bottom'
        : 'top'
      : from.x === to.x || from.x < to.x
        ? 'right'
        : 'left'
    const toSide: Side = vertical
      ? from.y < to.y
        ? 'top'
        : 'bottom'
      : from.x === to.x
        ? 'right'
        : from.x < to.x
          ? 'left'
          : 'right'
    return { link, from, to, fromSide, toSide }
  })
  const portCounts = new Map<string, number>(),
    portUsed = new Map<string, number>()
  ends.forEach(({ link, fromSide, toSide }) => {
    for (const key of [`${link.from}:${fromSide}`, `${link.to}:${toSide}`])
      portCounts.set(key, (portCounts.get(key) ?? 0) + 1)
  })
  const port = (node: (typeof layout.nodes)[number], side: Side) => {
    const key = `${node.object.id}:${side}`,
      index = portUsed.get(key) ?? 0,
      count = portCounts.get(key) ?? 1
    portUsed.set(key, index + 1)
    const vertical = side === 'top' || side === 'bottom'
    const offset =
      (vertical ? 36 : 24) +
      ((vertical ? node.width - 72 : node.height - 48) * (index + 0.5)) / count
    const point = vertical
      ? { x: node.x + offset, y: node.y + (side === 'bottom' ? node.height : 0) }
      : { x: node.x + (side === 'right' ? node.width : 0), y: node.y + offset }
    let reach = 18
    for (const other of layout.nodes) {
      if (other.object.id === node.object.id) continue
      const crossing = vertical
        ? point.x > other.x - 6 && point.x < other.x + other.width + 6
        : point.y > other.y - 6 && point.y < other.y + other.height + 6
      if (!crossing) continue
      const distance =
        side === 'left'
          ? point.x - other.x - other.width
          : side === 'right'
            ? other.x - point.x
            : side === 'top'
              ? point.y - other.y - other.height
              : other.y - point.y
      if (distance > 0) reach = Math.min(reach, distance / 2)
    }
    const stub = {
      x: point.x + (side === 'left' ? -reach : side === 'right' ? reach : 0),
      y: point.y + (side === 'top' ? -reach : side === 'bottom' ? reach : 0),
    }
    return { point, stub }
  }
  const obstacles: ArchitectureBounds[] = [
    ...layout.nodes,
    ...[...layout.sites, ...layout.groups].map((site) => ({
      x: site.x + 12,
      y: site.y + 8,
      width: site.width - 24,
      height: 34,
    })),
  ]
  const xTracks = [
    ...new Set(
      obstacles.flatMap((box) => [
        box.x - 18,
        box.x - 30,
        box.x + box.width + 18,
        box.x + box.width + 30,
      ]),
    ),
  ]
  const yTracks = [
    ...new Set(
      obstacles.flatMap((box) => [
        box.y - 18,
        box.y - 30,
        box.y + box.height + 18,
        box.y + box.height + 30,
      ]),
    ),
  ]
  const occupied: [ArchitecturePoint, ArchitecturePoint][] = []
  const ports = ends.map((edge) => ({
    ...edge,
    start: port(edge.from, edge.fromSide),
    end: port(edge.to, edge.toSide),
  }))
  for (const { link, start, end, fromSide, toSide } of ports) {
    const a = start.stub,
      b = end.stub
    const nearby = (tracks: number[], first: number, second: number) =>
      [...new Set(tracks)]
        .sort(
          (a, b) =>
            Math.abs(a - first) + Math.abs(a - second) - Math.abs(b - first) - Math.abs(b - second),
        )
        .slice(0, 24)
    const reserved = [
      ...occupied,
      ...ports
        .filter((edge) => edge.link.id !== link.id)
        .flatMap((edge): [ArchitecturePoint, ArchitecturePoint][] => [
          [edge.start.point, edge.start.stub],
          [edge.end.point, edge.end.stub],
        ]),
    ]
    const reservedRows = new Map<number, [ArchitecturePoint, ArchitecturePoint][]>(),
      reservedColumns = new Map<number, [ArchitecturePoint, ArchitecturePoint][]>()
    for (const segment of reserved) {
      const [c, d] = segment,
        cache = c.x === d.x ? reservedColumns : reservedRows,
        key = c.x === d.x ? c.x : c.y
      if (!cache.has(key)) cache.set(key, [])
      cache.get(key)!.push(segment)
    }
    const shared = (c: ArchitecturePoint, d: ArchitecturePoint) =>
      (c.x === d.x ? reservedColumns.get(c.x) : reservedRows.get(c.y))?.some(([e, f]) =>
        architectureSegmentsOverlap(c, d, e, f),
      ) ?? false
    const candidates: ArchitecturePoint[][] = [
      [a, { x: a.x, y: b.y }, b],
      [a, { x: b.x, y: a.y }, b],
      ...(!['top', 'bottom'].includes(fromSide) && !['top', 'bottom'].includes(toSide)
        ? nearby(yTracks, a.y, b.y)
            .slice(0, 12)
            .flatMap((y) =>
              [8, 16, 24].map((offset) => {
                const x1 = a.x + (fromSide === 'left' ? -offset : offset),
                  x2 = b.x + (toSide === 'left' ? -offset : offset)
                return [a, { x: x1, y: a.y }, { x: x1, y }, { x: x2, y }, { x: x2, y: b.y }, b]
              }),
            )
        : []),
      ...[
        ...nearby(
          [
            ...xTracks,
            ...occupied.filter(([c, d]) => c.x === d.x).flatMap(([c]) => [c.x - 8, c.x + 8]),
          ],
          a.x,
          b.x,
        ),
        layout.x + 8,
        layout.x + layout.width - 8,
      ].map((x) => [a, { x, y: a.y }, { x, y: b.y }, b]),
      ...[
        ...nearby(
          [
            ...yTracks,
            ...occupied.filter(([c, d]) => c.y === d.y).flatMap(([c]) => [c.y - 8, c.y + 8]),
          ],
          a.y,
          b.y,
        ),
        layout.y + 60,
        layout.y + layout.height - 12,
      ].map((y) => [a, { x: a.x, y }, { x: b.x, y }, b]),
    ]
    let best: ArchitecturePoint[] | null = null,
      score = Infinity
    for (const middle of candidates) {
      const path = simplifyRoute(middle)
      if (
        path
          .slice(1)
          .some((point, index) =>
            obstacles.some((box) => architectureSegmentIntersects(path[index], point, box, 6)),
          )
      )
        continue
      const full = simplifyRoute([start.point, ...path, end.point])
      if (full.slice(1).some((point, index) => shared(full[index], point))) continue
      let cost = (full.length - 2) * 12
      full.slice(1).forEach((point, index) => {
        const previous = full[index]
        cost += Math.abs(point.x - previous.x) + Math.abs(point.y - previous.y)
      })
      if (cost < score) {
        best = full
        score = cost
      }
    }
    if (!best) {
      const detour = routeArchitectureObstacles(a, b, obstacles, reserved)
      if (detour) best = simplifyRoute([start.point, ...detour, end.point])
    }
    // Imported overlapping cards may have no clear corridor. Keep output bounded.
    const points =
      best ??
      simplifyRoute([
        start.point,
        a,
        { x: a.x, y: layout.y + layout.height - 12 },
        { x: b.x, y: layout.y + layout.height - 12 },
        b,
        end.point,
      ])
    const segments = points
      .slice(1)
      .map((point, index) => [points[index], point] as [ArchitecturePoint, ArchitecturePoint])
    segments.forEach((segment) => occupied.push(segment))
    layout.edges.push({ link, points, label: null })
  }
  const bridges = architectureRouteBridges(
    layout.edges.map((edge) => edge.points),
    obstacles,
  )
  layout.edges.forEach((edge, index) => Object.assign(edge, bridges[index]))
  return layout
}
// A normalized distance follows the connection when its endpoints or route move.
export function architectureLabelAnchor(points: ArchitecturePoint[], position: number) {
  const lengths = points
    .slice(1)
    .map((b, index) => Math.hypot(b.x - points[index].x, b.y - points[index].y))
  let remaining = lengths.reduce((sum, length) => sum + length, 0) * position
  for (const [index, length] of lengths.entries()) {
    if (!length) continue
    if (remaining <= length || index === lengths.length - 1) {
      const a = points[index],
        b = points[index + 1]
      const fraction = Math.max(0, Math.min(1, remaining / length))
      return {
        x: a.x + (b.x - a.x) * fraction,
        y: a.y + (b.y - a.y) * fraction,
        rotation: a.y === b.y ? 0 : 90,
      }
    }
    remaining -= length
  }
  return null
}
export function architectureLabelProjection(points: ArchitecturePoint[], point: ArchitecturePoint) {
  let total = 0,
    nearest = Infinity,
    distance = 0,
    offset = 0
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1],
      b = points[index]
    const dx = b.x - a.x,
      dy = b.y - a.y
    const length = Math.hypot(dx, dy)
    if (!length) continue
    const fraction = Math.max(
      0,
      Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (length * length)),
    )
    const gap = Math.hypot(point.x - a.x - dx * fraction, point.y - a.y - dy * fraction)
    if (gap < nearest) {
      nearest = gap
      distance = offset + length * fraction
    }
    offset += length
    total += length
  }
  return total ? distance / total : null
}
export function architectureLabelBounds(label: ArchitectureLabel): ArchitectureBounds {
  const radians = ((label.rotation ?? (label.vertical ? 90 : 0)) * Math.PI) / 180
  const cos = Math.abs(Math.cos(radians)),
    sin = Math.abs(Math.sin(radians))
  const width = label.width * cos + 16 * sin,
    height = label.width * sin + 16 * cos
  return {
    x: label.x + label.width / 2 - width / 2,
    y: label.y + 8 - height / 2,
    width,
    height,
  }
}
type LabelMetrics = { width: number; offset: number }
const labelMetricsCache = new Map<string, LabelMetrics>()
function architectureLabelMetrics(texts: string[]): Map<string, LabelMetrics> {
  const unique = [...new Set(texts)]
  const result = new Map<string, LabelMetrics>()
  const missing = unique.filter((text) => {
    const cached = labelMetricsCache.get(text)
    if (cached) result.set(text, cached)
    return !cached
  })
  if (missing.length && typeof document !== 'undefined' && document.body) {
    // Measure the same SVG font/glyph bounds used by the canvas and exports.
    // Batch new strings in one hidden SVG to avoid a layout pass per connection.
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('aria-hidden', 'true')
    svg.setAttribute('text-rendering', 'geometricPrecision')
    svg.style.cssText =
      'position:fixed;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none;font:12px system-ui,sans-serif'
    const nodes = missing.map((text) => {
      const node = document.createElementNS(svg.namespaceURI, 'text') as SVGTextElement
      node.textContent = text
      svg.append(node)
      return node
    })
    document.body.append(svg)
    try {
      nodes.forEach((node, index) => {
        const box = node.getBBox()
        if (box.width <= 0) return
        const metrics = { width: box.width, offset: -box.x }
        result.set(missing[index], metrics)
        labelMetricsCache.set(missing[index], metrics)
      })
      while (labelMetricsCache.size > 2048)
        labelMetricsCache.delete(labelMetricsCache.keys().next().value!)
    } finally {
      svg.remove()
    }
  }
  // Non-DOM consumers use labels only for deterministic layout estimates.
  for (const text of unique)
    if (!result.has(text)) result.set(text, { width: text.length * 6.8, offset: 0 })
  return result
}
function placeArchitectureLabels(layout: ArchitectureDiagramLayout) {
  const metrics = architectureLabelMetrics(
    layout.edges.filter((edge) => edge.link.label).map((edge) => shorten(edge.link.label, 36)),
  )
  const obstacles: ArchitectureBounds[] = [
    ...layout.nodes,
    ...[...layout.sites, ...layout.groups].map((frame) => ({
      x: frame.x + 12,
      y: frame.y + 8,
      width: frame.width - 24,
      height: 34,
    })),
  ]
  const labels: ArchitectureBounds[] = []
  // Index orthogonal segments by their fixed axis. Label edits inspect only nearby
  // rows/columns instead of rescanning every segment of the 1,000-link graph.
  type Segment = { fixed: number; low: number; high: number; edge: number }
  const rows: Segment[] = [],
    columns: Segment[] = []
  layout.edges.forEach((edge, owner) =>
    edge.points.slice(1).forEach((b, index) => {
      const a = edge.points[index],
        horizontal = a.y === b.y
      const first = horizontal ? a.x : a.y,
        second = horizontal ? b.x : b.y
      ;(horizontal ? rows : columns).push({
        fixed: horizontal ? a.y : a.x,
        low: Math.min(first, second),
        high: Math.max(first, second),
        edge: owner,
      })
    }),
  )
  rows.sort((a, b) => a.fixed - b.fixed)
  columns.sort((a, b) => a.fixed - b.fixed)
  const crosses = (
    segments: Segment[],
    fixedLow: number,
    fixedHigh: number,
    low: number,
    high: number,
    owner: number,
  ) => {
    let left = 0,
      right = segments.length
    while (left < right) {
      const middle = (left + right) >>> 1
      if (segments[middle].fixed <= fixedLow) left = middle + 1
      else right = middle
    }
    for (let index = left; index < segments.length && segments[index].fixed < fixedHigh; index++) {
      const segment = segments[index]
      if (segment.edge !== owner && segment.high > low && segment.low < high) return true
    }
    return false
  }
  // Reserve manual labels first, so automatic labels avoid them regardless of link order.
  const ordered = [...layout.edges.entries()].sort(
    ([, a], [, b]) =>
      Number(b.link.labelPosition !== undefined) - Number(a.link.labelPosition !== undefined),
  )
  for (const [owner, edge] of ordered) {
    if (!edge.link.label) continue
    const segments = edge.points
      .slice(1)
      .map((b, index) => ({ a: edge.points[index], b }))
      .sort(
        (first, second) =>
          Math.hypot(second.b.x - second.a.x, second.b.y - second.a.y) -
          Math.hypot(first.b.x - first.a.x, first.b.y - first.a.y),
      )
    const text = shorten(edge.link.label, 36),
      measurement = metrics.get(text)!,
      width = measurement.width + 16
    const labelAt = (center: ArchitecturePoint, rotation: number): ArchitectureLabel => ({
      x: center.x - width / 2,
      y: center.y - 8,
      width,
      text,
      textOffset: measurement.offset,
      rotation,
      ...(Math.abs(rotation) === 90 ? { vertical: true } : {}),
    })
    const manual =
      edge.link.labelPosition !== undefined &&
      architectureLabelAnchor(edge.points, edge.link.labelPosition)
    if (manual) {
      edge.label = labelAt(manual, edge.link.labelRotation ?? manual.rotation)
      labels.push(architectureLabelBounds(edge.label))
      continue
    }
    let bestScore = Infinity,
      chosen: ArchitectureBounds | null = null
    placement: for (const { a, b } of segments) {
      const horizontal = a.y === b.y
      const length = Math.abs(b.x - a.x) + Math.abs(b.y - a.y)
      for (const rotation of edge.link.labelRotation !== undefined
        ? [edge.link.labelRotation]
        : horizontal
          ? [0]
          : [90, 0]) {
        for (const fraction of [0.5, 0.375, 0.625, 0.25, 0.75, 0.125, 0.875]) {
          const center = { x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction }
          const label = labelAt(center, rotation)
          const box = architectureLabelBounds(label)
          const along = horizontal ? box.width : box.height
          const score =
            (obstacles.some((other) => boxesIntersect(box, other)) ? 1000000 : 0) +
            (labels.some((other) => boxesIntersect(box, other)) ? 1000 : 0) +
            (crosses(
              rows,
              box.y - 2,
              box.y + box.height + 2,
              box.x - 2,
              box.x + box.width + 2,
              owner,
            ) ||
            crosses(
              columns,
              box.x - 2,
              box.x + box.width + 2,
              box.y - 2,
              box.y + box.height + 2,
              owner,
            )
              ? 10
              : 0) +
            (length * Math.min(fraction, 1 - fraction) < along / 2 + 4 ? 100 : 0) +
            Math.abs(fraction - 0.5)
          if (score >= bestScore) continue
          bestScore = score
          chosen = box
          edge.label = label
          if (score === 0) break placement
        }
      }
    }
    if (chosen) labels.push(chosen)
  }
  const labelBoxes = layout.edges.flatMap(({ label }) =>
    label ? [architectureLabelBounds(label)] : [],
  )
  const right = Math.max(
    layout.x + layout.width,
    ...layout.edges.flatMap((edge) => edge.points.map((point) => point.x + 20)),
    ...labelBoxes.map((box) => box.x + box.width + 20),
  )
  const bottom = Math.max(
    layout.y + layout.height,
    ...layout.edges.flatMap((edge) => edge.points.map((point) => point.y + 20)),
    ...labelBoxes.map((box) => box.y + box.height + 20),
  )
  layout.x = Math.min(
    layout.x,
    ...layout.edges.flatMap((edge) => edge.points.map((point) => point.x - 20)),
    ...labelBoxes.map((box) => box.x - 20),
  )
  layout.y = Math.min(
    layout.y,
    ...layout.edges.flatMap((edge) => edge.points.map((point) => point.y - 20)),
    ...labelBoxes.map((box) => box.y - 20),
  )
  layout.width = right - layout.x
  layout.height = bottom - layout.y
  return layout
}
const iconSvg = (type: ArchitectureObject['type'], x: number, y: number) => {
  const paths =
    type === 'server'
      ? '<rect x="2" y="3" width="20" height="7" rx="2"/><rect x="2" y="14" width="20" height="7" rx="2"/><path d="M6 6.5h.01M6 17.5h.01" stroke-width="3"/>'
      : type === 'database'
        ? '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 4 18 4 18 0V5M3 12c0 4 18 4 18 0"/>'
        : '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2c6 6 6 14 0 20M12 2c-6 6-6 14 0 20"/>'
  return `<g data-architecture-icon="${type}" transform="translate(${x} ${y}) scale(.7)" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths}</g>`
}
export function architectureSvg(
  project: ArchitectureProject,
  siteId?: string,
  translate: (key: string, values?: Record<string, string | number>) => string = (key) => key,
  themed = false,
  showResources = architecturePresentation(project).showResources,
  precomputed?: ArchitectureDiagramLayout,
): string {
  const layout = precomputed ?? architectureDiagramLayout(project, siteId, showResources)
  const color = (token: string, fallback: string) =>
    themed ? `var(--${token}, ${fallback})` : fallback
  const text = color('text', '#303030'),
    muted = color('muted', '#777777'),
    border = color('border-strong', '#d5d5d5'),
    canvas = color('canvas', '#ffffff')
  const propertiesButton = (
    kind: 'object' | 'site' | 'group',
    id: string,
    name: string,
    x: number,
    y: number,
  ) =>
    themed
      ? `<g class="architecture-properties-trigger" data-architecture-properties-${kind}="${id}" transform="translate(${x} ${y})" role="button" tabindex="0" aria-label="${xml(translate('Properties of {object}', { object: name }))}"><rect x="-11" y="-11" width="22" height="22" rx="5" fill="transparent"/><g fill="${muted}"><circle cx="-4" r="1.3"/><circle r="1.3"/><circle cx="4" r="1.3"/></g></g>`
      : ''
  const frameTitle = (
    kind: 'site' | 'group',
    frame: ArchitectureBounds & { id: string; name: string },
    label: string,
    limit: number,
  ) =>
    `<g ${themed ? `data-architecture-edit-${kind}="${frame.id}" role="button" tabindex="0" aria-label="${xml(label)}" style="cursor:pointer"` : ''}><title>${xml(frame.name)}</title>${themed ? `<rect x="${frame.x + 12}" y="${frame.y + 8}" width="${frame.width - 24}" height="32" fill="transparent"/>` : ''}<text x="${frame.x + 20}" y="${frame.y + 30}" font-size="${kind === 'site' ? 15 : 12}" font-weight="600">${xml(shorten(frame.name, limit))}</text></g>${propertiesButton(kind, frame.id, frame.name, frame.x + frame.width - 24, frame.y + 24)}`
  const groups =
    layout.sites
      .map(
        (site) =>
          `<g data-architecture-site="${site.id}"><rect x="${site.x}" y="${site.y}" width="${site.width}" height="${site.height}" rx="14" fill="${architectureBackgroundFill(site.background, themed)}" stroke="${border}"/>${frameTitle('site', site, translate('Edit site'), 28)}${layout.nodes.some((node) => node.object.siteId === site.id) || layout.groups.some((group) => group.siteId === site.id) ? '' : `<text x="${site.x + 24}" y="${site.y + 90}" fill="${muted}" font-size="12">${xml(translate('No objects yet.'))}</text>`}</g>`,
      )
      .join('') +
    layout.groups
      .map(
        (group) =>
          `<g data-architecture-group="${group.id}"><rect x="${group.x}" y="${group.y}" width="${group.width}" height="${group.height}" rx="10" fill="${architectureBackgroundFill(group.background, themed, true)}" stroke="${border}" stroke-dasharray="4 3"/>${frameTitle('group', group, translate('Edit group'), 28)}${layout.nodes.some((node) => node.object.groupId === group.id) ? '' : `<text x="${group.x + 20}" y="${group.y + 70}" fill="${muted}" font-size="11">${xml(translate('No objects yet.'))}</text>`}</g>`,
      )
      .join('')
  const connectionLabel = (link: ArchitectureProject['links'][number]) =>
    xml(
      translate('Connection: {label}', {
        label:
          link.label ||
          `${project.objects.find((object) => object.id === link.from)?.name} → ${project.objects.find((object) => object.id === link.to)?.name}`,
      }),
    )
  const edges = layout.edges
    .map(({ link, points, path: routedPath, strokePath }) => {
      const originalPath = points
        .map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`)
        .join(' ')
      const path = routedPath ?? originalPath
      const appearance = architectureLinkAppearance(link)
      return `<g data-architecture-link="${link.id}" ${themed ? `role="button" tabindex="0" aria-label="${connectionLabel(link)}"` : ''}><title>${xml(link.label)}</title>${themed ? `<path class="architecture-link-hit" d="${path}" fill="none" stroke="transparent" stroke-width="14" pointer-events="stroke"/>` : ''}<path class="architecture-link-line" d="${strokePath ?? path}" fill="none" stroke="${muted}" stroke-width="1.5" stroke-dasharray="${architectureLineDash(appearance.lineStyle)}" stroke-linecap="round"/><path class="architecture-link-arrowheads" d="${originalPath}" fill="none" stroke="none" stroke-width="1.5" pointer-events="none" ${appearance.endArrow === 'arrow' ? 'marker-end="url(#architecture-arrow)"' : ''}${appearance.startArrow === 'arrow' ? ' marker-start="url(#architecture-arrow)"' : ''}/></g>`
    })
    .join('')
  const bridgeOverlays = layout.edges
    .map(({ link, bridges }) =>
      bridges?.length
        ? `<g data-architecture-link-bridge="${link.id}" ${themed ? `role="button" tabindex="0" aria-label="${connectionLabel(link)}"` : ''}>${bridges.map((path) => `${themed ? `<path class="architecture-link-hit" d="${path}" fill="none" stroke="transparent" stroke-width="6" pointer-events="stroke"/>` : ''}<path class="architecture-link-line" d="${path}" fill="none" stroke="${muted}" stroke-width="1.5" stroke-dasharray="${architectureLineDash(architectureLinkAppearance(link).lineStyle)}" stroke-linecap="round"/>`).join('')}</g>`
        : '',
    )
    .join('')
  const edgeLabels = layout.edges
    .map(({ link, label }) => {
      if (!label) return ''
      const rotation = label.rotation ?? (label.vertical ? 90 : 0)
      return `<g data-architecture-link-label="${link.id}" ${rotation ? `transform="rotate(${rotation} ${label.x + label.width / 2} ${label.y + 8})"` : ''} ${themed ? `role="button" tabindex="0" aria-label="${xml(link.label)}"` : ''}><rect x="${label.x}" y="${label.y}" width="${label.width}" height="16" rx="3" fill="${canvas}"/><text x="${label.x + 8 + (label.textOffset ?? 0)}" y="${label.y + 12}" font-size="12" text-rendering="geometricPrecision" fill="${muted}">${xml(label.text)}</text></g>`
    })
    .join('')
  const nodes = layout.nodes
    .map(({ object, x, y, width, height }) => {
      const resources = (showResources ? project.resources : [])
        .filter((resource) => object.resources[resource.id])
        .map(
          (resource) =>
            `${resource.name} ${object.resources[resource.id]} ${translate(resource.unit)}`,
        )
      const disks = (showResources ? (object.disks ?? []) : []).map(
        (disk) =>
          `${disk.name || project.resources.find((resource) => resource.id === disk.resourceId)?.name} ${disk.capacity} ${translate('GB')}`,
      )
      const parameters = object.parameters.map(
        (parameter) => `${parameter.name}: ${parameter.value}`,
      )
      const lines = showResources
        ? [
            resources.slice(0, 2).join(' · '),
            [...resources.slice(2), ...disks, ...parameters].join(' · '),
          ]
        : [parameters.join(' · ')]
      return `<g data-architecture-object="${object.id}" ${themed ? `role="button" tabindex="0" aria-label="${xml(object.name)}"` : ''}><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="9" fill="${canvas}" stroke="${border}"/>${propertiesButton('object', object.id, object.name, x + width - 24, y + 20)}${iconSvg(object.type, x + 14, y + 10)}<text x="${x + 38}" y="${y + 23}" font-size="11" fill="${muted}">${xml(translate(architectureTypeLabels[object.type]))}</text><text x="${x + 14}" y="${y + 44}" font-size="14" font-weight="600">${xml(shorten(object.name, 30))}</text><text x="${x + 14}" y="${y + 64}" font-size="12" fill="${muted}">${xml(shorten(object.os || '—', 36))}</text>${lines.map((line, index) => `<text x="${x + 14}" y="${y + 87 + index * 20}" font-size="12">${xml(shorten(line, 38))}</text>`).join('')}${themed ? `<g data-architecture-connect="${object.id}" role="button" tabindex="0" aria-label="${xml(translate('Connect {object}', { object: object.name }))}"><circle class="architecture-port-hit" cx="${x + width}" cy="${y + 20}" r="12" fill="transparent"/><circle class="architecture-port-dot" cx="${x + width}" cy="${y + 20}" r="3.5" fill="${muted}" stroke="${canvas}" stroke-width="1.5"/></g>` : ''}</g>`
    })
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}" viewBox="${layout.x} ${layout.y} ${layout.width} ${layout.height}" role="${themed ? 'group' : 'img'}" aria-label="${xml(project.name)}" style="font-family:system-ui,sans-serif;color:${text}"><defs><marker id="architecture-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${muted}"/></marker></defs><rect x="${layout.x}" y="${layout.y}" width="${layout.width}" height="${layout.height}" fill="${themed ? 'transparent' : canvas}"/><g fill="${text}">${architecturePresentation(project).showTitle ? `<text data-architecture-title="true" x="${layout.x + 32}" y="${layout.y + 36}" font-size="20" font-weight="600">${xml(project.name)}</text>` : ''}${groups}${edges}${bridgeOverlays}${nodes}${edgeLabels}</g></svg>`
}
