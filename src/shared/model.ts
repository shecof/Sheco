import {
  filePreviewTabSchema,
  filePreviewId,
  attachmentPreviewKind,
  attachmentPreviewMime,
} from './filePreview'
import { z } from 'zod'
import { architecturePageProjectSchema, architectureSearchText } from './architectureDocument'
import { createArchitectureProject } from './projectArchitecture'
import {
  pluginAppTabs,
  isPluginAppTab,
  pluginAppEnabled,
  pluginSettingsTabs,
  isPluginSettingsTab,
  pluginsSchema,
  defaultPlugins,
} from './plugins'
import { normalizeJiraDocument } from './jiraDocument'
import { nodeSchema, type DocNode } from './document'
export { nodeSchema, type DocNode } from './document'
export const propertyTypes = [
  'text',
  'number',
  'checkbox',
  'select',
  'multiSelect',
  'date',
  'url',
  'email',
  'status',
  'relation',
  'created',
  'modified',
] as const
export const columnSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  type: z.enum(propertyTypes),
  width: z.number().min(80).max(1000).default(180),
  hidden: z.boolean().default(false),
  options: z.array(z.string().max(100)).default([]),
})
export type Column = z.infer<typeof columnSchema>
export const valueSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.array(z.string()),
  z.null(),
])
export type PropertyValue = z.infer<typeof valueSchema>
export const pageSchema = z
  .object({
    id: z.string().uuid(),
    parentId: z.string().uuid().nullable(),
    databaseId: z.string().uuid().nullable(),
    title: z.string().max(500),
    icon: z.string().max(40),
    description: z.string().max(2000).default(''),
    kind: z.enum(['page', 'database', 'architecture']),
    architecture: architecturePageProjectSchema.optional(),
    order: z.number().finite(),
    content: nodeSchema.refine(
      (node) => node.type === 'doc',
      'A page must contain a document root',
    ),
    properties: z.record(z.string(), valueSchema),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    deletedAt: z.string().datetime().nullable(),
  })
  .superRefine((page, ctx) => {
    if (
      (page.kind === 'architecture') !== !!page.architecture ||
      (page.kind === 'architecture' && page.databaseId)
    )
      ctx.addIssue({
        code: 'custom',
        path: ['architecture'],
        message: 'Architecture pages require their own diagram and cannot be database entries',
      })
  })
  .transform((page) => {
    const content = normalizeJiraDocument(page.content)
    return content === page.content
      ? page
      : { ...page, content, updatedAt: nextTimestamp(page.updatedAt) }
  })
export type Page = z.infer<typeof pageSchema>
export const databaseSchema = z.object({
  id: z.string().uuid(),
  pageId: z.string().uuid(),
  columns: z.array(columnSchema).max(100),
  titleWidth: z.number().min(80).max(1000).default(220),
  view: z.enum(['table', 'list', 'board', 'gallery']).default('table'),
  sort: z
    .object({ column: z.string(), direction: z.enum(['asc', 'desc']) })
    .nullable()
    .default(null),
  filters: z
    .array(
      z.object({
        column: z.string(),
        operator: z.enum(['contains', 'equals', 'not', 'empty', 'notEmpty']),
        value: z.string(),
      }),
    )
    .default([]),
})
export type Database = z.infer<typeof databaseSchema>
export function createDatabase(pageId: string): Database {
  return {
    id: uid(),
    pageId,
    columns: [
      {
        id: uid(),
        name: 'Status',
        type: 'status',
        width: 180,
        hidden: false,
        options: ['Not started', 'In progress', 'Done'],
      },
    ],
    view: 'table',
    titleWidth: 220,
    sort: null,
    filters: [],
  }
}

export const attachmentSchema = z.object({
  id: z.string().uuid(),
  file: z.string().regex(/^[0-9a-f-]{36}\.[a-z0-9]{1,12}$/),
  name: z.string().max(500),
  mime: z.string(),
  bytes: z.number().nonnegative(),
  createdAt: z.string().datetime(),
})
export type Attachment = z.infer<typeof attachmentSchema>
export const workspaceSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().uuid(),
    name: z.string().min(1).max(100),
    icon: z.string().max(40),
    revision: z.number().int().nonnegative(),
    pages: z.array(pageSchema).max(100000),
    databases: z.array(databaseSchema).max(10000),
    attachments: z.array(attachmentSchema).max(100000),
    plugins: pluginsSchema.default(defaultPlugins),
    ui: z.object({
      tabs: z
        .array(
          z.union([
            z.string().uuid(),
            z.enum(pluginAppTabs),
            z.enum(pluginSettingsTabs),
            filePreviewTabSchema,
          ]),
        )
        .max(40),
      activeId: z
        .union([
          z.string().uuid(),
          z.enum(pluginAppTabs),
          z.enum(pluginSettingsTabs),
          filePreviewTabSchema,
        ])
        .nullable(),
      expanded: z.array(z.string().uuid()),
      favorites: z.array(z.string().uuid()),
      theme: z.enum(['light', 'dark', 'system']).default('light'),
      accent: z.enum(['neutral', 'blue', 'green', 'purple', 'orange']).default('neutral'),
      showOutline: z.boolean().default(true),
      fixedWidth: z.boolean().default(true),
      fontSize: z.number().int().min(-2).max(2).default(0),
      sidebarWidth: z.number().int().min(220).max(560).default(252),
    }),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .transform((w) => {
    // Retire only valid image-preview tabs from the previous format; retain files and strict invalid-state checks.
    if (
      !w.plugins.filePreview.enabled ||
      new Set(w.ui.tabs).size !== w.ui.tabs.length ||
      (w.ui.activeId && !w.ui.tabs.includes(w.ui.activeId))
    )
      return w
    const removed = new Set(
      w.ui.tabs.filter((id) =>
        w.attachments.some(
          (a) => a.id === filePreviewId(id) && attachmentPreviewMime(a)?.startsWith('image/'),
        ),
      ),
    )
    if (!removed.size) return w
    const tabs = w.ui.tabs.filter((id) => !removed.has(id))
    return {
      ...w,
      ui: {
        ...w.ui,
        tabs,
        activeId:
          w.ui.activeId && removed.has(w.ui.activeId) ? (tabs.at(-1) ?? null) : w.ui.activeId,
      },
    }
  })
  .superRefine((w, ctx) => {
    const pages = new Map(w.pages.map((p) => [p.id, p]))
    const dbs = new Map(w.databases.map((d) => [d.id, d]))
    if (pages.size !== w.pages.length || dbs.size !== w.databases.length)
      ctx.addIssue({ code: 'custom', message: 'Duplicate record identifiers' })
    if (
      new Set(w.attachments.map((a) => a.id)).size !== w.attachments.length ||
      new Set(w.attachments.map((a) => a.file)).size !== w.attachments.length
    )
      ctx.addIssue({ code: 'custom', message: 'Duplicate attachment identifiers' })
    if (
      new Set(w.ui.tabs).size !== w.ui.tabs.length ||
      w.ui.tabs.some((id) =>
        isPluginSettingsTab(id)
          ? false
          : isPluginAppTab(id)
            ? !pluginAppEnabled(w.plugins, id)
            : filePreviewId(id)
              ? !w.plugins.filePreview.enabled ||
                !w.attachments.some((a) => a.id === filePreviewId(id) && attachmentPreviewKind(a))
              : !pages.has(id) || pages.get(id)?.deletedAt,
      ) ||
      (w.ui.activeId && !w.ui.tabs.includes(w.ui.activeId))
    )
      ctx.addIssue({ code: 'custom', message: 'Invalid tab state' })
    for (const p of w.pages) {
      if (p.parentId && !pages.has(p.parentId))
        ctx.addIssue({ code: 'custom', message: 'Missing parent' })
      if (p.databaseId && (!dbs.has(p.databaseId) || p.parentId !== dbs.get(p.databaseId)?.pageId))
        ctx.addIssue({ code: 'custom', message: 'Invalid database membership' })
      if (p.kind === 'database' && w.databases.filter((d) => d.pageId === p.id).length !== 1)
        ctx.addIssue({ code: 'custom', message: 'A database page must have exactly one schema' })
      const seen = new Set([p.id])
      let parent = p.parentId
      while (parent && pages.has(parent)) {
        if (seen.has(parent)) {
          ctx.addIssue({ code: 'custom', message: 'Page hierarchy contains a cycle' })
          break
        }
        seen.add(parent)
        parent = pages.get(parent)!.parentId
      }
    }
    for (const d of w.databases)
      if (
        pages.get(d.pageId)?.kind !== 'database' ||
        new Set(d.columns.map((c) => c.id)).size !== d.columns.length
      )
        ctx.addIssue({ code: 'custom', message: 'Invalid database schema' })
  })
export type Workspace = z.infer<typeof workspaceSchema>
export interface SpaceInfo {
  id: string
  name: string
  icon: string
  path: string
}
export interface BootData {
  spaces: SpaceInfo[]
  active: Workspace
  path: string
  recovered?: boolean
}
export interface SearchResult {
  page: Page
  kind: 'page' | 'content' | 'record' | 'file'
  file?: { id: string; name: string }
  excerpt: string
  score: number
}
export const emptyDoc = (): DocNode => ({ type: 'doc', content: [{ type: 'paragraph' }] })
export const uid = () => crypto.randomUUID()
export function nextTimestamp(previous?: string): string {
  return new Date(Math.max(Date.now(), Date.parse(previous ?? '') + 1 || 0)).toISOString()
}
export function createPage(
  w: Workspace,
  title = 'Untitled',
  parentId: string | null = null,
  kind: Page['kind'] = 'page',
  databaseId: string | null = null,
): Page {
  const now = new Date().toISOString()
  return {
    id: uid(),
    title,
    parentId,
    databaseId,
    kind,
    icon: kind === 'database' ? 'table' : kind === 'architecture' ? 'network' : 'file',
    ...(kind === 'architecture' && {
      architecture: {
        ...createArchitectureProject(title.trim().slice(0, 120) || 'Untitled architecture'),
        ...(w.plugins.projectArchitecture.defaults && {
          presentation: { ...w.plugins.projectArchitecture.defaults },
        }),
      },
    }),
    description: '',
    order: Math.max(-1, ...w.pages.filter((p) => p.parentId === parentId).map((p) => p.order)) + 1,
    content: emptyDoc(),
    properties: {},
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  }
}
export function plainText(node: DocNode): string {
  if (node.text) return node.text
  if (node.type === 'image')
    return [node.attrs?.alt, node.attrs?.caption].filter((v) => typeof v === 'string').join(' ')
  if (node.type === 'imageGallery')
    return (Array.isArray(node.attrs?.images) ? node.attrs.images : [])
      .map((attrs) => plainText({ type: 'image', attrs }))
      .join(' ')
  if (node.type === 'codeBlock')
    return [
      node.attrs?.title,
      (node.content ?? []).map(plainText).join(''),
      ...(Array.isArray(node.attrs?.comments)
        ? node.attrs.comments.map((comment) => comment.text)
        : []),
    ]
      .filter(Boolean)
      .join(' ')
  if (node.type === 'wikiLink' || node.type === 'pageLink') return String(node.attrs?.label ?? '')
  if (node.type === 'attachment') return String(node.attrs?.name ?? '')
  if (node.type === 'architectureEmbed') return String(node.attrs?.label ?? '')
  if (node.type === 'mermaid') return String(node.attrs?.source ?? '')
  if (node.type === 'jiraIssue' || node.type === 'jiraIssueInline')
    return ['issueKey', 'summary', 'status', 'dueDate']
      .map((key) => String(node.attrs?.[key] ?? ''))
      .filter(Boolean)
      .join(' ')
  return (node.content ?? [])
    .map(plainText)
    .join(node.type === 'paragraph' || node.type === 'heading' ? '' : ' ')
}
export const pageText = (page: Page) =>
  page.architecture ? architectureSearchText(page.architecture) : plainText(page.content)
export function ancestors(w: Workspace, id: string): Page[] {
  const out: Page[] = []
  const seen = new Set<string>()
  let p = w.pages.find((p) => p.id === id)
  while (p && !seen.has(p.id)) {
    seen.add(p.id)
    out.unshift(p)
    p = w.pages.find((a) => a.id === p!.parentId)
  }
  return out
}
export function descendants(w: Workspace, id: string): string[] {
  const ids = new Set([id])
  let changed = true
  while (changed) {
    changed = false
    for (const p of w.pages)
      if (p.parentId && ids.has(p.parentId) && !ids.has(p.id)) {
        ids.add(p.id)
        changed = true
      }
  }
  return [...ids]
}
export function movePage(
  w: Workspace,
  id: string,
  parentId: string | null,
  beforeId?: string,
): Workspace {
  if (parentId && descendants(w, id).includes(parentId))
    throw new Error('A page cannot be moved inside itself.')
  const page = w.pages.find((p) => p.id === id)
  if (!page) return w
  const target = w.pages.find((p) => p.id === parentId)
  if (target?.kind === 'database' || page.databaseId)
    throw new Error(
      'Database records stay in their database. Use a relation to link them elsewhere.',
    )
  const siblings = w.pages
    .filter((p) => p.parentId === parentId && p.id !== id && !p.deletedAt)
    .sort((a, b) => a.order - b.order)
  const index = beforeId ? siblings.findIndex((p) => p.id === beforeId) : -1
  siblings.splice(index < 0 ? siblings.length : index, 0, page)
  return {
    ...w,
    pages: w.pages.map((p) =>
      siblings.some((s) => s.id === p.id)
        ? {
            ...p,
            parentId,
            order: siblings.findIndex((s) => s.id === p.id),
            updatedAt: new Date().toISOString(),
          }
        : p,
    ),
  }
}
export function linkedIds(node: DocNode): string[] {
  const own =
    ['wikiLink', 'pageLink', 'databaseEmbed', 'architectureEmbed'].includes(node.type) &&
    typeof node.attrs?.pageId === 'string'
      ? [node.attrs.pageId]
      : []
  return [...own, ...(node.content ?? []).flatMap(linkedIds)]
}
export function backlinks(w: Workspace, id: string): Page[] {
  const title = w.pages.find((p) => p.id === id)?.title.toLocaleLowerCase()
  return w.pages.filter(
    (p) =>
      !p.deletedAt &&
      p.id !== id &&
      (linkedIds(p.content).includes(id) ||
        (title && plainText(p.content).toLocaleLowerCase().includes(`[[${title}]]`)) ||
        Object.values(p.properties).some((v) => (Array.isArray(v) ? v.includes(id) : v === id))),
  )
}
export function searchWorkspace(w: Workspace, query: string): SearchResult[] {
  const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean)
  if (!words.length)
    return w.pages
      .filter((p) => !p.deletedAt)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 12)
      .map((page) => ({
        page,
        kind: page.databaseId ? 'record' : 'page',
        excerpt:
          page.description ||
          ancestors(w, page.id)
            .map((p) => p.title)
            .join(' / '),
        score: 0,
      }))
  const out: SearchResult[] = []
  const attachments = new Map(w.attachments.map((file) => [file.file, file]))
  for (const page of w.pages.filter((p) => !p.deletedAt)) {
    const title = page.title.toLocaleLowerCase()
    const files = new Map<string, { id: string; name: string }>()
    const collectFiles = (node: DocNode) => {
      const add = (file: string, fallback?: { id: string; name: string }) => {
        const registered = attachments.get(file)
        const value = registered ? { id: registered.id, name: registered.name } : fallback
        if (value) files.set(value.id, value)
      }
      if (node.type === 'attachment')
        add(String(node.attrs?.file ?? ''), {
          id: String(node.attrs?.id ?? node.attrs?.file ?? ''),
          name: String(node.attrs?.name ?? ''),
        })
      if (node.type === 'image') {
        for (const key of ['src', 'originalSrc']) {
          const source = String(node.attrs?.[key] ?? '')
          if (source.startsWith(`sheco-asset://${w.id}/`)) add(source.split('/').pop()!)
        }
      }
      if (node.type === 'imageGallery' && Array.isArray(node.attrs?.images))
        node.attrs.images.forEach((attrs) => collectFiles({ type: 'image', attrs }))
      node.content?.forEach(collectFiles)
    }
    collectFiles(page.content)
    const matchingFiles = [...files.values()].filter((file) =>
      words.every((word) => file.name.toLocaleLowerCase().includes(word)),
    )
    for (const file of matchingFiles)
      out.push({ page, kind: 'file', file, excerpt: page.title, score: 50 * words.length })
    const content = pageText(page)
    const props = Object.values(page.properties).flat().join(' ')
    const all =
      `${title} ${page.description} ${content} ${props} ${[...files.values()].map((file) => file.name).join(' ')}`.toLocaleLowerCase()
    if (!words.every((word) => all.includes(word))) continue
    if (matchingFiles.length && !words.every((word) => title.includes(word))) continue
    const score = words.reduce(
      (s, word) =>
        s + (title === word ? 100 : title.startsWith(word) ? 60 : title.includes(word) ? 40 : 10),
      0,
    )
    const index = content.toLocaleLowerCase().indexOf(words[0])
    const excerpt =
      index >= 0 ? content.slice(Math.max(0, index - 40), index + 150) : page.description || props
    out.push({
      page,
      kind: page.databaseId
        ? 'record'
        : words.every((word) => title.includes(word))
          ? 'page'
          : 'content',
      excerpt,
      score,
    })
  }
  return out
    .sort((a, b) => b.score - a.score || b.page.updatedAt.localeCompare(a.page.updatedAt))
    .slice(0, 100)
}
export function columnValue(page: Page, column: Column): PropertyValue {
  if (column.type === 'created') return page.createdAt
  if (column.type === 'modified') return page.updatedAt
  return page.properties[column.id] ?? null
}
export function databaseRows(w: Workspace, db: Database, query = ''): Page[] {
  const text = (v: PropertyValue) => (Array.isArray(v) ? v.join(', ') : String(v ?? ''))
  const val = (p: Page, id: string) =>
    id === 'title'
      ? p.title
      : text(
          columnValue(
            p,
            db.columns.find((c) => c.id === id)!,
          ),
        )
  let rows = w.pages.filter(
    (p) =>
      !p.deletedAt &&
      p.databaseId === db.id &&
      (!query ||
        `${p.title} ${Object.values(p.properties).flat().join(' ')}`
          .toLowerCase()
          .includes(query.toLowerCase())),
  )
  rows = rows.filter((p) =>
    db.filters.every((f) => {
      if (f.column !== 'title' && !db.columns.some((c) => c.id === f.column)) return true
      const column = db.columns.find((c) => c.id === f.column)
      const value = column ? columnValue(p, column) : p.title
      let v = val(p, f.column).toLowerCase()
      const q = f.value.toLowerCase()
      if (column?.type === 'checkbox' && ['true', 'false'].includes(q)) v = String(!!value)
      if (column?.type === 'multiSelect' && Array.isArray(value)) {
        const matches = value.some((item) => item.toLowerCase() === q) || v === q
        if (f.operator === 'equals') return matches
        if (f.operator === 'not') return !matches
      }
      if (column?.type === 'relation' && !w.pages.some((page) => page.id.toLowerCase() === q))
        v = w.pages.find((page) => page.id === value)?.title.toLowerCase() ?? ''
      return f.operator === 'contains'
        ? v.includes(q)
        : f.operator === 'equals'
          ? v === q
          : f.operator === 'not'
            ? v !== q
            : f.operator === 'empty'
              ? !v
              : !!v
    }),
  )
  if (db.sort && (db.sort.column === 'title' || db.columns.some((c) => c.id === db.sort!.column))) {
    const { column, direction } = db.sort
    const type = db.columns.find((c) => c.id === column)?.type
    rows.sort(
      (a, b) =>
        (type === 'number'
          ? Number(val(a, column) || 0) - Number(val(b, column) || 0)
          : val(a, column).localeCompare(val(b, column), undefined, { numeric: true })) *
        (direction === 'asc' ? 1 : -1),
    )
  } else rows.sort((a, b) => a.order - b.order)
  return rows
}
