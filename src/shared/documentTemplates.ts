import { z } from 'zod'
import { nodeSchema, type DocNode } from './document'
import type { Page, Database, Column, PropertyValue } from './model'

export const templateLimit = 100
export const templateBytesLimit = 1024 * 1024
const dateTokens = /\[[^\]\r\n]*\]|YYYY|MMMM|MMM|dddd|ddd|YY|MM|DD|HH|hh|mm|ss|M|D|H|h|m|s|A|a/g
export function validTemplateDateFormat(format: string) {
  return (
    format.length > 0 &&
    format.length <= 100 &&
    (format === 'locale' || /^[^\p{L}{}\[\]\r\n]*$/u.test(format.replace(dateTokens, '')))
  )
}
export function formatTemplateDate(
  date: Date,
  format: string,
  language: 'en' | 'ru' = 'en',
): string {
  if (!Number.isFinite(date.getTime()) || !validTemplateDateFormat(format))
    throw new Error('Invalid template date format.')
  const locale = language === 'ru' ? 'ru-RU' : 'en-US'
  if (format === 'locale') return date.toLocaleDateString(locale)
  const pad = (value: number) => String(value).padStart(2, '0')
  const month = (length: 'short' | 'long') =>
    new Intl.DateTimeFormat(locale, { month: length, day: 'numeric' })
      .formatToParts(date)
      .find((part) => part.type === 'month')!.value
  const tokens: Record<string, string> = {
    YYYY: String(date.getFullYear()),
    YY: pad(date.getFullYear() % 100),
    M: String(date.getMonth() + 1),
    MM: pad(date.getMonth() + 1),
    MMM: month('short'),
    MMMM: month('long'),
    D: String(date.getDate()),
    DD: pad(date.getDate()),
    ddd: date.toLocaleDateString(locale, { weekday: 'short' }),
    dddd: date.toLocaleDateString(locale, { weekday: 'long' }),
    H: String(date.getHours()),
    HH: pad(date.getHours()),
    h: String(date.getHours() % 12 || 12),
    hh: pad(date.getHours() % 12 || 12),
    m: String(date.getMinutes()),
    mm: pad(date.getMinutes()),
    s: String(date.getSeconds()),
    ss: pad(date.getSeconds()),
    A: date.getHours() < 12 ? 'AM' : 'PM',
    a: date.getHours() < 12 ? 'am' : 'pm',
  }
  return format.replace(dateTokens, (token) =>
    token.startsWith('[') ? token.slice(1, -1) : tokens[token],
  )
}
const dateFormatSchema = z.string().refine(validTemplateDateFormat, 'Invalid template date format')
export function validTemplateFieldDate(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  )
}
export const templateFieldSchema = z
  .strictObject({
    name: z
      .string()
      .regex(/^[\p{L}\p{N}_-]{1,60}$/u)
      .refine((name) => !['date', 'time', 'title'].includes(name)),
    label: z.string().max(100).default(''),
    kind: z.enum(['text', 'multiline', 'date', 'select']).default('text'),
    required: z.boolean().default(true),
    defaultValue: z.string().max(2000).default(''),
    options: z.array(z.string().trim().min(1).max(500)).max(100).default([]),
  })
  .superRefine((field, ctx) => {
    if (
      new Set(field.options).size !== field.options.length ||
      (field.kind === 'select' &&
        (!field.options.length ||
          (field.defaultValue && !field.options.includes(field.defaultValue))))
    )
      ctx.addIssue({ code: 'custom', message: 'Check field choices and default value' })
    if (field.kind === 'date' && field.defaultValue && !validTemplateFieldDate(field.defaultValue))
      ctx.addIssue({ code: 'custom', message: 'Invalid field date' })
  })
export type TemplateField = z.infer<typeof templateFieldSchema>
const propertyDefaultSchema = z.union([
  z.string().max(10000),
  z.number().finite(),
  z.boolean(),
  z.array(z.string().max(500)).max(1000),
  z.null(),
])
function boundedDocument(doc: DocNode) {
  if (new TextEncoder().encode(JSON.stringify(doc)).length > templateBytesLimit) return false
  let count = 0
  function visit(node: DocNode, depth: number): boolean {
    return (
      ++count <= 20000 &&
      depth <= 40 &&
      (node.content ?? []).every((child) => visit(child, depth + 1))
    )
  }
  return doc.type === 'doc' && visit(doc, 0)
}
export const documentTemplateSchema = z
  .strictObject({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(500),
    description: z.string().max(2000).default(''),
    icon: z.string().max(40).default('file'),
    dateFormat: dateFormatSchema.optional(),
    timeFormat: dateFormatSchema.optional(),
    fields: z.array(templateFieldSchema).max(40).optional(),
    databaseDefaults: z
      .strictObject({
        databaseId: z.string().uuid(),
        values: z
          .record(z.string().uuid(), propertyDefaultSchema)
          .refine((values) => Object.keys(values).length <= 100),
      })
      .optional(),
    content: nodeSchema.refine(
      (doc) => boundedDocument(doc) && templateVariables(doc).length <= 40,
      'Template document exceeds its limits',
    ),
  })
  .superRefine((template, ctx) => {
    if (
      new Set((template.fields ?? []).map((field) => field.name)).size !==
      (template.fields?.length ?? 0)
    )
      ctx.addIssue({ code: 'custom', message: 'Duplicate template fields' })
    if (templateFields(template).length > 40)
      ctx.addIssue({ code: 'custom', message: 'Too many template fields' })
  })
export type DocumentTemplate = z.infer<typeof documentTemplateSchema>
export const documentTemplatesPluginSchema = z
  .object({
    enabled: z.boolean().default(false),
    initialized: z.boolean().default(false),
    catalogRevision: z.union([z.literal(1), z.literal(2)]).default(1),
    templates: z.array(documentTemplateSchema).max(templateLimit).default([]),
  })
  .superRefine((plugin, ctx) => {
    if (new Set(plugin.templates.map((template) => template.id)).size !== plugin.templates.length)
      ctx.addIssue({ code: 'custom', message: 'Duplicate template identifiers' })
    if (new TextEncoder().encode(JSON.stringify(plugin.templates)).length > 8 * templateBytesLimit)
      ctx.addIssue({ code: 'custom', message: 'Template library is limited to 8 MB' })
  })
  .transform((plugin) =>
    plugin.catalogRevision === 2
      ? plugin
      : {
          ...plugin,
          catalogRevision: 2 as const,
          templates: plugin.templates.filter(
            (template) => !retiredExamples.has(templateKey(template)),
          ),
        },
  )
  .default({ enabled: false, initialized: false, catalogRevision: 2, templates: [] })

const variablePattern = /\{\{\s*([\p{L}\p{N}_-]{1,60})(?:\s*:\s*([^{}\r\n]{1,100}?))?\s*\}\}/gu
// Adjacent text marks form one run. Atoms and block boundaries always end it.
function mapTextRuns(
  node: DocNode,
  transform: (run: DocNode[], parent: DocNode) => DocNode[],
): void {
  if (!node.content) return
  const content: DocNode[] = []
  for (let index = 0; index < node.content.length;) {
    const child = node.content[index]
    if (child.type !== 'text') {
      mapTextRuns(child, transform)
      content.push(child)
      index++
      continue
    }
    const run: DocNode[] = []
    while (node.content[index]?.type === 'text') run.push(node.content[index++])
    content.push(...transform(run, node))
  }
  node.content = content
}
function replaceRun(
  run: DocNode[],
  replace: (source: string, name: string, format?: string) => string,
  edits?: { from: number; to: number; length: number }[],
): DocNode[] {
  const text = run.map((node) => node.text ?? '').join('')
  const matches = [...text.matchAll(variablePattern)]
  if (!matches.length) return run
  const result: DocNode[] = []
  function append(from: number, to: number) {
    let start = 0
    for (const node of run) {
      const end = start + (node.text?.length ?? 0)
      const part = (node.text ?? '').slice(Math.max(0, from - start), Math.min(end, to) - start)
      if (end > from && start < to && part) result.push({ ...node, text: part })
      start = end
    }
  }
  let position = 0
  for (const match of matches) {
    append(position, match.index)
    const value = replace(match[0], match[1], match[2]?.trim())
    if (value !== match[0])
      edits?.push({ from: match.index, to: match.index + match[0].length, length: value.length })
    if (value === match[0]) append(match.index, match.index + match[0].length)
    else if (value) {
      let end = 0
      const first = run.find((node) => (end += node.text?.length ?? 0) > match.index)!
      result.push({ ...first, text: value })
    }
    position = match.index + match[0].length
  }
  append(position, text.length)
  return result.reduce<DocNode[]>((nodes, node) => {
    const previous = nodes.at(-1)
    const { text: _text, ...shape } = node
    const { text: _previousText, ...previousShape } = previous ?? {}
    if (previous && JSON.stringify(shape) === JSON.stringify(previousShape))
      previous.text += node.text ?? ''
    else nodes.push(node)
    return nodes
  }, [])
}
export function templateVariables(content: DocNode): string[] {
  const names = new Set<string>()
  mapTextRuns(structuredClone(content), (run) => {
    for (const match of run
      .map((node) => node.text ?? '')
      .join('')
      .matchAll(variablePattern))
      if (!match[2]) names.add(match[1])
    return run
  })
  return [...names].filter((name) => !['date', 'time', 'title'].includes(name))
}
// Inline atoms belong only to the library draft. Persist the existing literal token format.
export const templateDateNode = 'templateDateField'
export function templateDateToken(kind: string, format: string) {
  if (!['date', 'time'].includes(kind) || !validTemplateDateFormat(format))
    throw new Error('Invalid template date format.')
  return `{{${kind}:${format}}}`
}
export function templateEditorContent(
  template: Pick<DocumentTemplate, 'content' | 'dateFormat' | 'timeFormat'>,
): DocNode {
  const content = structuredClone(template.content)
  mapTextRuns(content, (run, parent) => {
    if (parent.type === 'codeBlock') return run
    const text = run.map((node) => node.text ?? '').join('')
    const result: DocNode[] = []
    function append(from: number, to: number) {
      let offset = 0
      for (const node of run) {
        const end = offset + (node.text?.length ?? 0)
        if (offset < to && end > from) {
          const part = (node.text ?? '').slice(
            Math.max(0, from - offset),
            Math.min(to, end) - offset,
          )
          if (part) result.push({ ...node, text: part })
        }
        offset = end
      }
    }
    let position = 0
    for (const match of text.matchAll(variablePattern)) {
      const kind = match[1]
      const format =
        match[2]?.trim() ??
        (kind === 'date' ? (template.dateFormat ?? 'locale') : (template.timeFormat ?? 'HH:mm'))
      if (!['date', 'time'].includes(kind) || !validTemplateDateFormat(format)) continue
      append(position, match.index)
      let end = 0
      const opening = run.find((node) => (end += node.text?.length ?? 0) > match.index)!
      result.push({
        type: templateDateNode,
        attrs: { kind, format },
        ...(opening.marks && { marks: opening.marks }),
      })
      position = match.index + match[0].length
    }
    append(position, text.length)
    return result
  })
  return content
}
export function templateStoredContent(draft: DocNode): DocNode {
  function visit(node: DocNode): DocNode {
    if (node.type === templateDateNode)
      return {
        type: 'text',
        text: templateDateToken(String(node.attrs?.kind), String(node.attrs?.format)),
        ...(node.marks && { marks: structuredClone(node.marks) }),
      }
    if (node.content) node.content = node.content.map(visit)
    return node
  }
  // Keep oversized edits in the draft; the existing explicit Save validates all limits.
  return visit(structuredClone(draft))
}
export function fillTemplate(
  template: DocumentTemplate,
  _values: Record<string, string>,
  context: { now?: Date; language?: 'en' | 'ru' } = {},
): DocNode {
  const content = structuredClone(template.content)
  const now = context.now ?? new Date()
  mapTextRuns(content, (run, parent) => {
    const edits: { from: number; to: number; length: number }[] = []
    const result = replaceRun(
      run,
      (source, name, format) => {
        if (['date', 'time'].includes(name))
          return formatTemplateDate(
            now,
            format ??
              (name === 'date'
                ? (template.dateFormat ?? 'locale')
                : (template.timeFormat ?? 'HH:mm')),
            context.language,
          )
        return source
      },
      edits,
    )
    if (parent.type === 'codeBlock' && edits.length && Array.isArray(parent.attrs?.comments)) {
      const map = (position: number, end: boolean) => {
        let delta = 0
        for (const edit of edits) {
          if (position <= edit.from) return position + delta
          if (position < edit.to) return edit.from + delta + (end ? edit.length : 0)
          delta += edit.length - (edit.to - edit.from)
        }
        return position + delta
      }
      parent.attrs.comments = parent.attrs.comments
        .map((comment) => {
          const entry = comment as Record<string, unknown>
          return { ...entry, from: map(Number(entry.from), false), to: map(Number(entry.to), true) }
        })
        .filter((comment) => comment.to > comment.from)
    }
    return result
  })
  nodeSchema.parse(content)
  if (!boundedDocument(content)) throw new Error('Template document exceeds its limits')
  return content
}
export function templateFields(
  template: DocumentTemplate,
  includeProperties = true,
): TemplateField[] {
  const names = new Set(templateVariables(template.content))
  for (const value of Object.values(
    includeProperties ? (template.databaseDefaults?.values ?? {}) : {},
  )) {
    for (const text of typeof value === 'string' ? [value] : Array.isArray(value) ? value : []) {
      templateVariables({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
      }).forEach((name) => names.add(name))
    }
  }
  return [...names].map(
    (name) =>
      template.fields?.find((field) => field.name === name) ?? templateFieldSchema.parse({ name }),
  )
}
export function templateFieldValues(
  template: DocumentTemplate,
  input: Record<string, string>,
  includeProperties = true,
): Record<string, string> {
  return Object.fromEntries(
    templateFields(template, includeProperties).map((field) => [
      field.name,
      Object.hasOwn(input, field.name) ? input[field.name] : field.defaultValue,
    ]),
  )
}
export function invalidTemplateFields(
  template: DocumentTemplate,
  input: Record<string, string>,
  includeProperties = true,
): string[] {
  const values = templateFieldValues(template, input, includeProperties)
  return templateFields(template, includeProperties)
    .filter((field) => {
      const value = values[field.name]
      return (
        value.length > 2000 ||
        (field.required && !value.trim()) ||
        (!!value && field.kind === 'date' && !validTemplateFieldDate(value)) ||
        (!!value && field.kind === 'select' && !field.options.includes(value))
      )
    })
    .map((field) => field.name)
}
export function templatePropertyValueValid(column: Column, value: PropertyValue, pages?: Page[]) {
  if (value === null) return true
  if (column.type === 'checkbox') return typeof value === 'boolean'
  if (column.type === 'number') return typeof value === 'number' && Number.isFinite(value)
  if (column.type === 'multiSelect')
    return Array.isArray(value) && value.every((item) => column.options.includes(item))
  if (typeof value !== 'string') return false
  if (['select', 'status'].includes(column.type)) return !value || column.options.includes(value)
  if (column.type === 'date') return !value || Number.isFinite(Date.parse(value))
  if (column.type === 'relation')
    return !value || !!pages?.some((page) => page.id === value && !page.deletedAt)
  return !['created', 'modified'].includes(column.type)
}
export function templateProperties(
  template: DocumentTemplate,
  database?: Database,
  values: Record<string, string> = {},
  context: { now?: Date; language?: 'en' | 'ru'; pages?: Page[] } = {},
): Record<string, PropertyValue> {
  if (!database || template.databaseDefaults?.databaseId !== database.id) return {}
  const now = context.now ?? new Date()
  const expand = (text: string) => {
    const content = fillTemplate(
      {
        ...template,
        content: {
          type: 'doc',
          content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }],
        },
      },
      values,
      { ...context, now },
    )
    return content.content![0].content?.map((node) => node.text ?? '').join('') ?? ''
  }
  const properties: Record<string, PropertyValue> = {}
  for (const column of database.columns) {
    if (
      ['created', 'modified'].includes(column.type) ||
      !Object.hasOwn(template.databaseDefaults.values, column.id)
    )
      continue
    const source = template.databaseDefaults.values[column.id]
    const value =
      typeof source === 'string'
        ? expand(source)
        : Array.isArray(source)
          ? source.map(expand).filter(Boolean)
          : source
    if (!templatePropertyValueValid(column, value, context.pages))
      throw new Error('Template properties do not match the database. Check their values.')
    properties[column.id] = value
  }
  return properties
}
export function captureTemplate(page: Page, id: string, database?: Database): DocumentTemplate {
  return documentTemplateSchema.parse({
    id,
    name: page.title.trim() || 'Untitled',
    description: page.description,
    icon: page.icon,
    content: structuredClone(page.content),
    ...(database &&
      page.databaseId === database.id && {
        databaseDefaults: {
          databaseId: database.id,
          values: Object.fromEntries(
            database.columns
              .filter(
                (column) =>
                  !['created', 'modified'].includes(column.type) &&
                  Object.hasOwn(page.properties, column.id),
              )
              .map((column) => [column.id, structuredClone(page.properties[column.id])]),
          ),
        },
      }),
  })
}
// Frozen original examples are used only to retire unchanged legacy entries.
export function legacyExampleTemplates(
  language: 'en' | 'ru',
  id: () => string,
): DocumentTemplate[] {
  const ru = language === 'ru'
  const paragraph = (text = ''): DocNode => ({
    type: 'paragraph',
    ...(text ? { content: [{ type: 'text', text }] } : {}),
  })
  const heading = (text: string): DocNode => ({
    type: 'heading',
    attrs: { level: 2 },
    content: [{ type: 'text', text }],
  })
  const make = (name: string, sections: string[], intro = ''): DocumentTemplate => ({
    id: id(),
    name,
    icon: 'file',
    description: '',
    content: {
      type: 'doc',
      content: [paragraph(intro), ...sections.flatMap((name) => [heading(name), paragraph()])],
    },
  })
  return [
    make(
      ru ? 'Заметки встречи' : 'Meeting notes',
      ru
        ? ['Участники', 'Повестка', 'Решения', 'Следующие шаги']
        : ['Participants', 'Agenda', 'Decisions', 'Next steps'],
      '{{date}} · {{title}}',
    ),
    make(
      ru ? 'План проекта' : 'Project plan',
      ru
        ? ['Цель', 'Объём работ', 'Этапы', 'Риски', 'Критерии готовности']
        : ['Goal', 'Scope', 'Milestones', 'Risks', 'Acceptance criteria'],
      ru ? 'Проект: {{проект}}' : 'Project: {{project}}',
    ),
    make(
      ru ? 'Техническое исследование' : 'Technical research',
      ru
        ? ['Вопрос', 'Источники', 'Наблюдения', 'Выводы']
        : ['Question', 'Sources', 'Observations', 'Conclusions'],
    ),
    make(
      ru ? 'Отчёт об уязвимости' : 'Vulnerability report',
      ru
        ? ['Описание', 'Затронутые системы', 'Воспроизведение', 'Влияние', 'Рекомендации']
        : ['Description', 'Affected systems', 'Reproduction', 'Impact', 'Recommendations'],
    ),
  ]
}
function templateKey({
  name,
  description,
  icon,
  content,
  dateFormat,
  timeFormat,
  fields,
  databaseDefaults,
}: DocumentTemplate) {
  return JSON.stringify({
    name,
    description,
    icon,
    content,
    dateFormat,
    timeFormat,
    fields,
    databaseDefaults,
  })
}
const retiredExamples = new Set(
  (['en', 'ru'] as const).flatMap((language) =>
    legacyExampleTemplates(language, () => '00000000-0000-4000-8000-000000000000').map(templateKey),
  ),
)
