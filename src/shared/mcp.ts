import { z } from 'zod'
import { defaultDiagramScale } from './diagram'
import {
  nodeSchema,
  workspaceSchema,
  columnSchema,
  valueSchema,
  attachmentSchema,
  createPage,
  createDatabase,
  descendants,
  emptyDoc,
  plainText,
  searchWorkspace,
  uid,
  nextTimestamp as timestamp,
  type Workspace,
  type DocNode,
  type Page,
} from './model'
import { markdown } from './export'

export const mcpConfigSchema = z.object({
  enabled: z.boolean().default(false),
  allowWrites: z.boolean().default(false),
  port: z.number().int().min(1024).max(65535).default(24876),
  workspaceId: z.string().uuid().nullable().default(null),
  token: z.string().regex(/^[a-f0-9]{64}$/),
})
export type McpConfig = z.infer<typeof mcpConfigSchema>
export interface McpStatus {
  config: McpConfig
  running: boolean
  endpoint: string
  error: string
  lastActivity: string | null
}
export interface McpRequest {
  id: string
  tool: string
  args: Record<string, unknown>
  deadline: number
}
export interface McpReply {
  id: string
  result?: unknown
  error?: string
}

const text = (text: string) => ({ type: 'text', text })
const paragraph = (value = 'Your text') => ({ type: 'paragraph', content: [text(value)] })
/** Examples use the same JSON node names as the editor, including nested blocks. */
export const blockCatalog = [
  { name: 'Text', example: paragraph() },
  {
    name: 'Heading (levels 1–4)',
    example: { type: 'heading', attrs: { level: 2 }, content: [text('Heading')] },
  },
  {
    name: 'Bullet list',
    example: { type: 'bulletList', content: [{ type: 'listItem', content: [paragraph()] }] },
  },
  {
    name: 'Numbered list',
    example: {
      type: 'orderedList',
      attrs: { start: 1 },
      content: [{ type: 'listItem', content: [paragraph()] }],
    },
  },
  {
    name: 'To-do list',
    example: {
      type: 'taskList',
      content: [{ type: 'taskItem', attrs: { checked: false }, content: [paragraph()] }],
    },
  },
  {
    name: 'Toggle',
    example: {
      type: 'details',
      attrs: { open: false },
      content: [
        { type: 'detailsSummary', content: [text('Summary')] },
        { type: 'detailsContent', content: [paragraph()] },
      ],
    },
  },
  { name: 'Quote', example: { type: 'blockquote', content: [paragraph()] } },
  {
    name: 'Callout',
    example: { type: 'callout', attrs: { emoji: '💡', color: 'gray' }, content: [paragraph()] },
  },
  { name: 'Divider', example: { type: 'horizontalRule' } },
  {
    name: 'Mermaid diagram',
    example: {
      type: 'mermaid',
      attrs: {
        source: 'flowchart TB\n  A["Start"] --> B["Finish"]',
        positions: {},
        scale: defaultDiagramScale,
      },
    },
  },
  {
    name: 'Code',
    example: {
      type: 'codeBlock',
      attrs: {
        language: 'javascript',
        title: 'Example',
        lineNumbers: true,
        collapsedByDefault: false,
        comments: [{ id: 'comment-1', from: 0, to: 11, text: 'Write a message to the console.' }],
      },
      content: [text('console.log("Hello")')],
    },
  },
  { name: 'Block math', example: { type: 'blockMath', attrs: { latex: 'E = mc^2' } } },
  {
    name: 'Inline math',
    example: { type: 'paragraph', content: [{ type: 'inlineMath', attrs: { latex: 'x^2' } }] },
  },
  {
    name: 'Image',
    example: {
      type: 'image',
      attrs: {
        src: 'sheco-asset://WORKSPACE_ID/ATTACHMENT_FILE',
        alt: 'Description',
        caption: 'Caption',
        width: 640,
      },
    },
  },
  {
    name: 'Image slider',
    example: {
      type: 'imageGallery',
      attrs: {
        width: 640,
        images: [{ src: 'sheco-asset://WORKSPACE_ID/ATTACHMENT_FILE', caption: 'Caption' }],
      },
    },
  },
  {
    name: 'Attachment',
    example: {
      type: 'attachment',
      attrs: {
        id: 'ATTACHMENT_ID',
        file: 'ATTACHMENT_FILE',
        name: 'report.pdf',
        bytes: 100,
        display: 'card',
      },
    },
  },
  {
    name: 'Page link',
    example: { type: 'pageLink', attrs: { pageId: 'PAGE_ID', label: 'Page title' } },
  },
  {
    name: 'Inline page link',
    example: {
      type: 'paragraph',
      content: [{ type: 'wikiLink', attrs: { pageId: 'PAGE_ID', label: 'Page title' } }],
    },
  },
  {
    name: 'Inline database',
    example: { type: 'databaseEmbed', attrs: { pageId: 'DATABASE_PAGE_ID', label: 'Collection' } },
  },
  {
    name: 'Table',
    example: {
      type: 'table',
      content: [
        {
          type: 'tableRow',
          content: [
            { type: 'tableHeader', content: [paragraph('Name')] },
            { type: 'tableHeader', attrs: { align: 'right' }, content: [paragraph('Value')] },
          ],
        },
        {
          type: 'tableRow',
          content: [
            { type: 'tableCell', content: [paragraph()] },
            { type: 'tableCell', attrs: { align: 'right' }, content: [paragraph()] },
          ],
        },
      ],
    },
  },
]

const scope = { workspaceId: z.string().uuid() }
const revision = { expectedRevision: z.number().int().nonnegative().optional() }
const pageTarget = { ...scope, pageId: z.string().uuid() }
const pageVersion = { expectedUpdatedAt: z.string().datetime() }
const doc = z.object({
  type: z.literal('doc'),
  content: z.array(z.record(z.string(), z.unknown())).max(10000),
})
const props = z.record(z.string(), valueSchema)
const pagePatch = z
  .object({
    title: z.string().max(500).optional(),
    description: z.string().max(2000).optional(),
    icon: z.string().max(40).optional(),
    parentId: z.string().uuid().nullable().optional(),
    properties: props.optional(),
    content: doc.optional(),
  })
  .strict()
export const mcpTools = [
  {
    name: 'get_workspace',
    write: false,
    description:
      'Get the authorized workspace ID, revision, name and counts. Only this workspace is accessible, while it is open in Sheco.',
    schema: z.object({ workspaceId: z.string().uuid().optional() }).strict(),
  },
  {
    name: 'get_block_catalog',
    write: false,
    description:
      'Get JSON examples for EVERY supported block, rich text marks, and attachment instructions. Use this before authoring content.',
    schema: z.object({ workspaceId: z.string().uuid().optional() }).strict(),
  },
  {
    name: 'list_pages',
    write: false,
    description:
      'List page metadata, nested pages and database entries. Omit parentId for all pages; null lists roots. Paginated, excludes Trash by default.',
    schema: z
      .object({
        ...scope,
        parentId: z.string().uuid().nullable().optional(),
        includeTrash: z.boolean().default(false),
        offset: z.number().int().nonnegative().default(0),
        limit: z.number().int().min(1).max(200).default(100),
      })
      .strict(),
  },
  {
    name: 'search_pages',
    write: false,
    description: 'Search titles, descriptions, all block content and database properties.',
    schema: z
      .object({
        ...scope,
        query: z.string().min(1).max(500),
        limit: z.number().int().min(1).max(100).default(30),
      })
      .strict(),
  },
  {
    name: 'get_page',
    write: false,
    description:
      'Read a complete page: JSON document with all blocks, properties, updatedAt and Markdown. Use updatedAt for guarded edits.',
    schema: z.object(pageTarget).strict(),
  },
  {
    name: 'create_page',
    write: true,
    description:
      'Create a root page, nested page, or database entry (provide databaseId and its pageId as parentId). Supports any block JSON.',
    schema: z
      .object({
        ...scope,
        ...revision,
        title: z.string().max(500),
        parentId: z.string().uuid().nullable().default(null),
        databaseId: z.string().uuid().nullable().default(null),
        icon: z.string().max(40).default('file'),
        description: z.string().max(2000).default(''),
        content: doc.optional(),
        properties: props.optional(),
      })
      .strict(),
  },
  {
    name: 'update_page',
    write: true,
    description:
      'Patch page metadata, parent, database values, or full document. Properties are merged by column ID; use null to clear a value. Requires the latest page updatedAt; conflict never overwrites newer edits.',
    schema: z.object({ ...pageTarget, ...revision, ...pageVersion, patch: pagePatch }).strict(),
  },
  {
    name: 'edit_blocks',
    write: true,
    description:
      'Insert, replace, or delete top-level blocks by zero-based index in ONE atomic edit. Nested content is supported. Requires page updatedAt. For append set index to content.length, deleteCount to 0.',
    schema: z
      .object({
        ...pageTarget,
        ...revision,
        ...pageVersion,
        index: z.number().int().nonnegative(),
        deleteCount: z.number().int().nonnegative().default(0),
        blocks: z.array(z.record(z.string(), z.unknown())).max(1000).default([]),
      })
      .strict(),
  },
  {
    name: 'move_blocks',
    write: true,
    description:
      'Move a contiguous group of top-level blocks within a page. toIndex is the insertion index AFTER removing the group. Requires page updatedAt.',
    schema: z
      .object({
        ...pageTarget,
        ...revision,
        ...pageVersion,
        index: z.number().int().nonnegative(),
        count: z.number().int().min(1),
        toIndex: z.number().int().nonnegative(),
      })
      .strict(),
  },
  {
    name: 'trash_page',
    write: true,
    description:
      'Move a page AND its descendants to recoverable Trash. Does not permanently delete data.',
    schema: z.object({ ...pageTarget, ...revision, ...pageVersion }).strict(),
  },
  {
    name: 'restore_page',
    write: true,
    description: 'Restore a trashed page, descendants and necessary ancestors.',
    schema: z.object({ ...pageTarget, ...revision, ...pageVersion }).strict(),
  },
  {
    name: 'list_databases',
    write: false,
    description: 'List all database schemas and their host page IDs.',
    schema: z.object(scope).strict(),
  },
  {
    name: 'get_database',
    write: false,
    description:
      'Read a database schema and paginated entries (each entry is a page with editable properties and arbitrary blocks).',
    schema: z
      .object({
        ...scope,
        databaseId: z.string().uuid(),
        offset: z.number().int().nonnegative().default(0),
        limit: z.number().int().min(1).max(200).default(100),
      })
      .strict(),
  },
  {
    name: 'create_database',
    write: true,
    description:
      'Create a database inside an ordinary page and append its databaseEmbed block automatically. Columns get generated UUIDs if omitted; entries use create_page.',
    schema: z
      .object({
        ...pageTarget,
        ...revision,
        ...pageVersion,
        title: z.string().min(1).max(500),
        columns: z
          .array(columnSchema.omit({ id: true }).extend({ id: z.string().uuid().optional() }))
          .max(100)
          .optional(),
      })
      .strict(),
  },
  {
    name: 'update_database',
    write: true,
    description:
      'Update columns, view, sort or filters. Get the workspace revision first. Removed columns with existing values are rejected; IDs must be preserved when renaming.',
    schema: z
      .object({
        ...scope,
        databaseId: z.string().uuid(),
        expectedRevision: z.number().int().nonnegative(),
        patch: z
          .object({
            columns: z.array(columnSchema).max(100).optional(),
            view: z.enum(['table', 'list', 'board', 'gallery']).optional(),
            sort: z
              .object({ column: z.string(), direction: z.enum(['asc', 'desc']) })
              .nullable()
              .optional(),
            filters: z
              .array(
                z.object({
                  column: z.string(),
                  operator: z.enum(['contains', 'equals', 'not', 'empty', 'notEmpty']),
                  value: z.string(),
                }),
              )
              .max(100)
              .optional(),
          })
          .strict(),
      })
      .strict(),
  },
  {
    name: 'list_attachments',
    write: false,
    description: 'List local attachment metadata and asset URLs for images.',
    schema: z
      .object({
        ...scope,
        offset: z.number().int().nonnegative().default(0),
        limit: z.number().int().min(1).max(200).default(100),
      })
      .strict(),
  },
  {
    name: 'read_attachment',
    write: false,
    description:
      'Read up to 8 MiB of an attachment as base64. Only registered attachment IDs, no filesystem paths.',
    schema: z.object({ ...scope, attachmentId: z.string().uuid() }).strict(),
  },
  {
    name: 'upload_attachment',
    write: true,
    description:
      'Upload one file as base64 (up to 8 MiB). Returns attachment metadata, image/attachment block JSON and asset URL; insert with edit_blocks. Repeat for multiple files.',
    schema: z
      .object({
        ...scope,
        name: z.string().min(1).max(500),
        base64: z
          .string()
          .min(4)
          .max(12 * 1024 * 1024),
      })
      .strict(),
  },
] as const

export function parseTool(name: string, input: unknown) {
  const tool = mcpTools.find((t) => t.name === name)
  if (!tool) throw new Error('Unknown tool')
  return { tool, args: tool.schema.parse(input) as Record<string, any> }
}
function requirePage(w: Workspace, id: string, trashed = false) {
  const page = w.pages.find((p) => p.id === id && (trashed || !p.deletedAt))
  if (!page) throw new Error('Page not found')
  return page
}
function checkProperties(w: Workspace, page: Page) {
  const db = w.databases.find((d) => d.id === page.databaseId)
  if (!db) {
    if (Object.keys(page.properties).length)
      throw new Error('Only database entries have properties')
    return
  }
  for (const [id, value] of Object.entries(page.properties)) {
    const column = db.columns.find((c) => c.id === id)
    if (!column || ['created', 'modified'].includes(column.type))
      throw new Error('Unknown or read-only property: ' + id)
    if (value === null) continue
    const valid =
      column.type === 'number'
        ? typeof value === 'number'
        : column.type === 'checkbox'
          ? typeof value === 'boolean'
          : ['multiSelect', 'relation'].includes(column.type)
            ? Array.isArray(value)
            : typeof value === 'string'
    if (!valid) throw new Error('Invalid value for property: ' + column.name)
    if (
      ['select', 'status', 'multiSelect'].includes(column.type) &&
      (Array.isArray(value) ? value : [value]).some((v) => !column.options.includes(String(v)))
    )
      throw new Error('Option not in column schema: ' + column.name)
    if (
      column.type === 'relation' &&
      (value as string[]).some((id) => !w.pages.some((p) => p.id === id && !p.deletedAt))
    )
      throw new Error('Relation page not found')
  }
}
export function executeWorkspaceTool(
  w: Workspace,
  name: string,
  input: unknown,
  validateDocument: (doc: DocNode) => void,
): { workspace: Workspace; result: Record<string, unknown> } {
  // Uploaded bytes are staged in the main process; only registered metadata crosses this internal boundary.
  const a =
    name === '_register_attachment'
      ? (z.object({ ...scope, attachment: attachmentSchema }).parse(input) as Record<string, any>)
      : parseTool(name, input).args
  if (a.workspaceId && a.workspaceId !== w.id)
    throw new Error('This workspace is not authorized or is no longer open')
  if (a.expectedRevision !== undefined && a.expectedRevision !== w.revision)
    throw new Error('Revision conflict. Read the latest workspace and retry.')
  let next = w
  let result: Record<string, unknown> = {}
  const page = a.pageId ? requirePage(w, a.pageId, name === 'restore_page') : null
  if (page && a.expectedUpdatedAt && page.updatedAt !== a.expectedUpdatedAt)
    throw new Error('Page conflict. Read the latest page and retry.')
  const replace = (p: Page) => {
    next = { ...next, pages: next.pages.map((old) => (old.id === p.id ? p : old)) }
    result = { page: p }
  }
  const content = (value: unknown) => {
    const parsed = nodeSchema.parse(value)
    if (parsed.type !== 'doc') throw new Error('Document root must be doc')
    validateDocument(parsed)
    validateReferences(w, parsed)
    return parsed
  }
  switch (name) {
    case 'get_workspace':
      result = {
        id: w.id,
        name: w.name,
        revision: w.revision,
        pageCount: w.pages.filter((p) => !p.deletedAt).length,
        blockTypes: blockCatalog.map((b) => b.name),
      }
      break
    case 'get_block_catalog':
      result = {
        blocks: blockCatalog,
        marks: ['bold', 'italic', 'strike', 'code', 'underline', 'link'],
        notes:
          'Documents have {type:"doc",content:[blocks]}. Rich text uses text.marks. Link attrs.href supports http, https or mailto. Images use local asset URLs returned by upload_attachment. Attachment attrs.display is card (default), compact, tile or link. All writes use the editor schema. Read get_page.updatedAt before editing; never invent page, database, property or attachment IDs.',
      }
      break
    case 'list_pages': {
      const pages = w.pages
        .filter(
          (p) =>
            (a.includeTrash || !p.deletedAt) &&
            (a.parentId === undefined || p.parentId === a.parentId),
        )
        .sort((p, q) => p.order - q.order)
      result = {
        total: pages.length,
        pages: pages
          .slice(a.offset, a.offset + a.limit)
          .map(({ content, ...p }) => ({ ...p, blockCount: content.content?.length ?? 0 })),
      }
      break
    }
    case 'search_pages':
      result = {
        results: searchWorkspace(w, a.query)
          .slice(0, a.limit)
          .map((r) => ({
            pageId: r.page.id,
            title: r.page.title,
            excerpt: r.excerpt,
            kind: r.kind,
            updatedAt: r.page.updatedAt,
          })),
      }
      break
    case 'get_page':
      result = { page, markdown: markdown(page!.content), text: plainText(page!.content) }
      break
    case 'create_page': {
      if (a.parentId) requirePage(w, a.parentId)
      if (
        a.databaseId &&
        !w.databases.some((d) => d.id === a.databaseId && d.pageId === a.parentId)
      )
        throw new Error('Database and parent do not match')
      const p = {
        ...createPage(w, a.title, a.parentId, 'page', a.databaseId),
        icon: a.icon,
        description: a.description,
        content: a.content ? content(a.content) : emptyDoc(),
        properties: a.properties ?? {},
      }
      checkProperties(w, p)
      next = { ...w, pages: [...w.pages, p] }
      result = { page: p }
      break
    }
    case 'update_page': {
      if (a.patch.parentId) requirePage(w, a.patch.parentId)
      const p = {
        ...page!,
        ...a.patch,
        properties: a.patch.properties
          ? { ...page!.properties, ...a.patch.properties }
          : page!.properties,
        content: a.patch.content ? content(a.patch.content) : page!.content,
        updatedAt: timestamp(page!.updatedAt),
      }
      checkProperties(w, p)
      replace(p)
      break
    }
    case 'edit_blocks': {
      const blocks = [...(page!.content.content ?? [])]
      if (a.index > blocks.length || a.deleteCount > blocks.length - a.index)
        throw new Error('Block range out of bounds')
      blocks.splice(a.index, a.deleteCount, ...a.blocks)
      replace({
        ...page!,
        content: content({
          type: 'doc',
          content: blocks.length ? blocks : [{ type: 'paragraph' }],
        }),
        updatedAt: timestamp(page!.updatedAt),
      })
      break
    }
    case 'move_blocks': {
      const blocks = [...(page!.content.content ?? [])]
      if (a.index + a.count > blocks.length || a.toIndex > blocks.length - a.count)
        throw new Error('Block range out of bounds')
      blocks.splice(a.toIndex, 0, ...blocks.splice(a.index, a.count))
      replace({
        ...page!,
        content: { type: 'doc', content: blocks },
        updatedAt: timestamp(page!.updatedAt),
      })
      break
    }
    case 'trash_page':
    case 'restore_page': {
      const ids = new Set(descendants(w, page!.id))
      if (name === 'restore_page') {
        let parent = page!.parentId
        while (parent) {
          ids.add(parent)
          parent = w.pages.find((p) => p.id === parent)?.parentId ?? null
        }
      }
      const now = timestamp(page!.updatedAt)
      const tabs = name === 'trash_page' ? w.ui.tabs.filter((id) => !ids.has(id)) : w.ui.tabs
      next = {
        ...w,
        pages: w.pages.map((p) =>
          ids.has(p.id)
            ? { ...p, deletedAt: name === 'trash_page' ? now : null, updatedAt: now }
            : p,
        ),
        ui: {
          ...w.ui,
          tabs,
          activeId: tabs.includes(w.ui.activeId!) ? w.ui.activeId : (tabs.at(-1) ?? null),
          favorites:
            name === 'trash_page' ? w.ui.favorites.filter((id) => !ids.has(id)) : w.ui.favorites,
        },
      }
      result = { affectedPageIds: [...ids] }
      break
    }
    case 'list_databases':
      result = { databases: w.databases.filter((d) => !requirePage(w, d.pageId, true).deletedAt) }
      break
    case 'get_database': {
      const database = w.databases.find((d) => d.id === a.databaseId)
      if (!database) throw new Error('Database not found')
      requirePage(w, database.pageId)
      const entries = w.pages
        .filter((p) => p.databaseId === database.id && !p.deletedAt)
        .sort((p, q) => p.order - q.order)
      result = {
        database,
        total: entries.length,
        entries: entries.slice(a.offset, a.offset + a.limit),
      }
      break
    }
    case 'create_database': {
      if (page!.kind === 'database') throw new Error('Choose an ordinary page as the host')
      const p = createPage(w, a.title, page!.id, 'database')
      const database = createDatabase(p.id)
      if (a.columns) database.columns = a.columns.map((c: any) => ({ ...c, id: c.id ?? uid() }))
      next = { ...w, pages: [...w.pages, p], databases: [...w.databases, database] }
      replace({
        ...page!,
        content: {
          type: 'doc',
          content: [
            ...(page!.content.content ?? []),
            { type: 'databaseEmbed', attrs: { pageId: p.id, label: p.title } },
          ],
        },
        updatedAt: timestamp(page!.updatedAt),
      })
      result = { page: p, database }
      break
    }
    case 'update_database': {
      const db = w.databases.find((d) => d.id === a.databaseId)
      if (!db) throw new Error('Database not found')
      requirePage(w, db.pageId)
      const database = { ...db, ...a.patch }
      const columnIds = new Set(database.columns.map((c: any) => c.id))
      if (
        (database.sort &&
          database.sort.column !== 'title' &&
          !columnIds.has(database.sort.column)) ||
        database.filters.some((f: any) => f.column !== 'title' && !columnIds.has(f.column))
      )
        throw new Error('Sort or filter references an unknown column')
      const removed = new Set(db.columns.filter((c) => !columnIds.has(c.id)).map((c) => c.id))
      for (const p of w.pages.filter((p) => p.databaseId === db.id)) {
        for (const id of removed) {
          const value = p.properties[id]
          if (value != null && value !== '' && !(Array.isArray(value) && !value.length))
            throw new Error('Cannot remove a property with existing values. Clear it first.')
        }
      }
      next = {
        ...w,
        databases: w.databases.map((d) => (d.id === db.id ? database : d)),
        pages: removed.size
          ? w.pages.map((p) =>
              p.databaseId === db.id
                ? {
                    ...p,
                    properties: Object.fromEntries(
                      Object.entries(p.properties).filter(([id]) => !removed.has(id)),
                    ),
                    updatedAt: timestamp(p.updatedAt),
                  }
                : p,
            )
          : w.pages,
      }
      for (const p of next.pages.filter((p) => p.databaseId === db.id)) checkProperties(next, p)
      result = { database }
      break
    }
    case 'list_attachments':
      result = {
        total: w.attachments.length,
        attachments: w.attachments
          .slice(a.offset, a.offset + a.limit)
          .map((a) => ({ ...a, assetUrl: `sheco-asset://${w.id}/${a.file}` })),
      }
      break
    case '_register_attachment':
      next = { ...w, attachments: [...w.attachments, a.attachment] }
      result = { attachment: a.attachment }
      break
    default:
      throw new Error('Tool requires the desktop attachment service')
  }
  if (next !== w) workspaceSchema.parse(next)
  return { workspace: next, result: { ...result, workspaceId: w.id, revision: w.revision } }
}

/** Prevent agent-authored links from escaping registered pages and local assets. */
export function validateReferences(w: Workspace, node: DocNode) {
  const attrs = node.attrs ?? {}
  if (['pageLink', 'wikiLink', 'databaseEmbed'].includes(node.type)) {
    const page = requirePage(w, String(attrs.pageId))
    if (node.type === 'databaseEmbed' && page.kind !== 'database')
      throw new Error('Database embed must reference a database page')
  }
  if (
    node.type === 'attachment' &&
    !w.attachments.some((a) => a.id === attrs.id && a.file === attrs.file)
  )
    throw new Error('Attachment is not registered in this workspace')
  const image = (a: Record<string, unknown>) => {
    for (const key of ['caption', 'alt', 'title', 'src', 'originalSrc']) {
      if (a[key] != null && typeof a[key] !== 'string')
        throw new Error('Invalid image attribute: ' + key)
    }
    for (const key of ['src', 'originalSrc'])
      if (a[key] != null) {
        const url = String(a[key])
        if (
          !w.attachments.some(
            (file) =>
              /^image\/(png|jpeg|gif|webp|avif)$/.test(file.mime) &&
              url === `sheco-asset://${w.id}/${file.file}`,
          )
        )
          throw new Error('Image must use a registered local asset URL')
      }
    if (typeof a.src !== 'string') throw new Error('Image source is required')
    if (
      a.width != null &&
      (typeof a.width !== 'number' || !Number.isFinite(a.width) || a.width < 40 || a.width > 10000)
    )
      throw new Error('Invalid image width')
  }
  if (node.type === 'image') image(attrs)
  if (node.type === 'imageGallery') {
    if (!Array.isArray(attrs.images) || !attrs.images.length || attrs.images.length > 500)
      throw new Error('Slider requires 1–500 images')
    attrs.images.forEach(image)
  }
  if (node.type === 'heading' && ![1, 2, 3, 4].includes(Number(attrs.level ?? 1)))
    throw new Error('Heading level must be 1–4')
  if (
    node.type === 'callout' &&
    attrs.color &&
    !['gray', 'yellow', 'red', 'green'].includes(String(attrs.color))
  )
    throw new Error('Unsupported callout background')
  for (const mark of node.marks ?? [])
    if (mark.type === 'link' && !/^(https?:\/\/|mailto:)/i.test(String(mark.attrs?.href)))
      throw new Error('Unsupported link URL')
  for (const child of node.content ?? []) validateReferences(w, child)
}
