import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { seedWorkspace } from '../src/shared/seed'
import { workspaceSchema, createPage, createDatabase, type DocNode } from '../src/shared/model'
import {
  documentTemplateSchema,
  documentTemplatesPluginSchema,
  legacyExampleTemplates,
  captureTemplate,
  fillTemplate,
  templateVariables,
  formatTemplateDate,
  templateFieldSchema,
  templateFields,
  templateFieldValues,
  invalidTemplateFields,
  templateProperties,
  templateEditorContent,
  templateStoredContent,
  templateDateNode,
} from '../src/shared/documentTemplates'
import {
  documentTemplatesTab,
  documentTemplatesSettingsTab,
  dataToolsTab,
  dataToolsSettingsTab,
} from '../src/shared/plugins'
import { validateEditorDocument } from '../src/editor/documentSchema'

describe('Document templates', () => {
  it('keeps inline date/time draft atoms out of persisted documents and applies per-field formats', () => {
    const template = documentTemplateSchema.parse({
      id: randomUUID(),
      name: 'Inline fields',
      dateFormat: 'DD.MM.YYYY',
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Before {{da', marks: [{ type: 'bold' }] },
              {
                type: 'text',
                text: 'te}} / {{time:HH:mm:ss}} / {{owner}}',
                marks: [{ type: 'italic' }],
              },
            ],
          },
          { type: 'codeBlock', content: [{ type: 'text', text: '{{date}}' }] },
        ],
      },
    })
    const original = structuredClone(template)
    const draft = templateEditorContent(template)
    const fields = draft.content![0].content!.filter((node) => node.type === templateDateNode)
    expect(fields.map((node) => node.attrs)).toEqual([
      { kind: 'date', format: 'DD.MM.YYYY' },
      { kind: 'time', format: 'HH:mm:ss' },
    ])
    expect(fields[0].marks).toEqual([{ type: 'bold' }])
    expect(draft.content![1]).toEqual(template.content.content![1])
    fields[0].attrs!.format = 'YYYY-MM-DD'
    const stored = templateStoredContent(draft)
    expect(JSON.stringify(stored)).not.toContain(templateDateNode)
    expect(JSON.stringify(stored)).toContain('{{date:YYYY-MM-DD}}')
    validateEditorDocument(stored)
    const filled = fillTemplate(
      { ...template, content: stored },
      {},
      { now: new Date(2026, 9, 15, 9, 41, 5) },
    )
    expect(filled.content![0].content!.map((node) => node.text).join('')).toBe(
      'Before 2026-10-15 / 09:41:05 / {{owner}}',
    )
    expect(template).toEqual(original)
    expect(() =>
      templateStoredContent({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: templateDateNode, attrs: { kind: 'date', format: 'execute()' } }],
          },
        ],
      }),
    ).toThrow('format')
  })
  it('maps code annotations through automatic date replacements without mutating the source', () => {
    const template = documentTemplateSchema.parse({
      id: randomUUID(),
      name: 'Code',
      content: {
        type: 'doc',
        content: [
          {
            type: 'codeBlock',
            attrs: {
              language: 'text',
              title: 'Code',
              comments: [
                { id: 'variable', from: 0, to: 8, text: 'Date' },
                { id: 'tail', from: 9, to: 13, text: 'Retained tail' },
              ],
            },
            content: [{ type: 'text', text: '{{date}} tail' }],
          },
        ],
      },
    })
    template.dateFormat = 'D'
    const context = { now: new Date(2026, 9, 15) }
    const filled = fillTemplate(template, {}, context)
    expect(filled.content![0].attrs!.comments).toEqual([
      { id: 'variable', from: 0, to: 2, text: 'Date' },
      { id: 'tail', from: 3, to: 7, text: 'Retained tail' },
    ])
    expect(() => validateEditorDocument(filled)).not.toThrow()
    expect(fillTemplate(template, { date: '' }, context)).toEqual(filled)
    expect(template.content.content![0].content![0].text).toBe('{{date}} tail')
  })
  it('captures independent typed database defaults and applies them only to that database', () => {
    const workspace = seedWorkspace('Defaults', false)
    const parent = createPage(workspace, 'Database', null, 'database')
    const database = createDatabase(parent.id)
    const noteId = randomUUID(),
      numberId = randomUUID(),
      checkId = randomUUID(),
      dateId = randomUUID()
    database.columns.push(
      { id: noteId, name: 'Note', type: 'text', width: 180, hidden: false, options: [] },
      { id: numberId, name: 'Number', type: 'number', width: 180, hidden: false, options: [] },
      { id: checkId, name: 'Checked', type: 'checkbox', width: 180, hidden: false, options: [] },
      { id: dateId, name: 'Date', type: 'date', width: 180, hidden: false, options: [] },
    )
    const page = createPage(workspace, 'Entry', parent.id, 'page', database.id)
    page.properties = {
      [database.columns[0].id]: 'In progress',
      [noteId]: '{{project}}',
      [numberId]: 0,
      [checkId]: false,
      [dateId]: '{{date:YYYY-MM-DD}}',
    }
    const template = captureTemplate(page, randomUUID(), database)
    expect(templateFields(template).map((field) => field.name)).toEqual(['project'])
    expect(templateFields(template, false)).toEqual([])
    const properties = templateProperties(
      template,
      database,
      { project: 'Apollo' },
      { now: new Date(2026, 9, 14), pages: workspace.pages },
    )
    expect(properties).toEqual({
      ...page.properties,
      [noteId]: '{{project}}',
      [dateId]: '2026-10-14',
    })
    expect(templateProperties(template, createDatabase(randomUUID()))).toEqual({})
    template.databaseDefaults!.values[checkId] = true
    expect(page.properties[checkId]).toBe(false)
    template.databaseDefaults!.values[numberId] = 'not a number'
    expect(() => templateProperties(template, database)).toThrow('properties')
    template.databaseDefaults!.values[numberId] = 12
    const removedColumn = {
      ...database,
      columns: database.columns.filter((column) => column.id !== noteId),
    }
    expect(templateProperties(template, removedColumn)[noteId]).toBeUndefined()
    workspace.pages.push(parent, page)
    workspace.databases.push(database)
    workspace.plugins.documentTemplates.templates = [template]
    expect(
      workspaceSchema.parse(workspace).plugins.documentTemplates.templates[0].databaseDefaults,
    ).toEqual(template.databaseDefaults)
    expect(
      documentTemplateSchema.safeParse({
        ...template,
        databaseDefaults: { databaseId: database.id, values: { invalid: 'bad' } },
      }).success,
    ).toBe(false)
  })
  it('preserves legacy required fields and resolves optional, default, date and choice fields', () => {
    const template = legacyExampleTemplates('en', randomUUID)[1]
    expect(templateFields(template)[0]).toMatchObject({
      name: 'project',
      required: true,
      kind: 'text',
      defaultValue: '',
    })
    expect(invalidTemplateFields(template, {})).toEqual(['project'])
    template.content = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: '{{project}} {{comment}} {{when}} {{status}}' }],
        },
      ],
    }
    template.fields = [
      templateFieldSchema.parse({ name: 'project', label: 'Project', defaultValue: 'Apollo' }),
      templateFieldSchema.parse({ name: 'comment', kind: 'multiline', required: false }),
      templateFieldSchema.parse({ name: 'when', kind: 'date', defaultValue: '2026-02-28' }),
      templateFieldSchema.parse({
        name: 'status',
        kind: 'select',
        options: ['Planned', 'Active'],
        defaultValue: 'Planned',
      }),
    ]
    expect(invalidTemplateFields(template, {})).toEqual([])
    const values = templateFieldValues(template, { comment: '', status: 'Active' })
    expect(values).toEqual({ project: 'Apollo', comment: '', when: '2026-02-28', status: 'Active' })
    expect(fillTemplate(template, values).content![0].content![0].text).toBe(
      '{{project}} {{comment}} {{when}} {{status}}',
    )
    expect(invalidTemplateFields(template, { when: '2026-02-30', status: 'Unknown' })).toEqual([
      'when',
      'status',
    ])
    expect(templateFieldSchema.safeParse({ name: 'date' }).success).toBe(false)
    expect(
      templateFieldSchema.safeParse({
        name: 'choice',
        kind: 'select',
        options: ['A'],
        defaultValue: 'B',
      }).success,
    ).toBe(false)
    expect(
      documentTemplateSchema.safeParse({
        ...template,
        fields: [template.fields[0], template.fields[0]],
      }).success,
    ).toBe(false)
    expect(documentTemplateSchema.parse(template).fields).toEqual(template.fields)
  })
  it('formats local date/time snapshots, inline overrides and literal text without treating them as user fields', () => {
    const template = legacyExampleTemplates('en', randomUUID)[0]
    template.dateFormat = 'YYYY/MM/DD'
    template.timeFormat = 'hh:mm A'
    template.content = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: '{{date}} {{time}} {{date:DD.MM.YYYY}} {{time:HH:mm:ss}} {{title}} {{project}}',
            },
          ],
        },
      ],
    }
    const now = new Date(2026, 9, 14, 18, 5, 9)
    expect(templateVariables(template.content)).toEqual(['project'])
    const filled = fillTemplate(
      template,
      { title: 'Note', project: 'Apollo' },
      { now, language: 'ru' },
    )
    expect(filled.content![0].content![0].text).toBe(
      '2026/10/14 06:05 PM 14.10.2026 18:05:09 {{title}} {{project}}',
    )
    expect(formatTemplateDate(now, '[Created] YYYY-MM-DD', 'en')).toBe('Created 2026-10-14')
    expect(formatTemplateDate(now, 'D MMMM YYYY', 'ru')).toBe('14 октября 2026')
    expect(formatTemplateDate(now, 'locale', 'ru')).toBe(now.toLocaleDateString('ru-RU'))
    expect(() => formatTemplateDate(now, 'arbitrary code()', 'en')).toThrow('format')
    expect(
      documentTemplateSchema.safeParse({ ...template, dateFormat: 'X'.repeat(101) }).success,
    ).toBe(false)
    const unchanged = legacyExampleTemplates('en', randomUUID)[0]
    const customized = { ...unchanged, id: randomUUID(), dateFormat: 'YYYY-MM-DD' }
    expect(
      documentTemplatesPluginSchema.parse({ templates: [unchanged, customized] }).templates,
    ).toEqual([customized])
  })
  it('substitutes automatic fields across adjacent formatting marks without crossing atoms or blocks', () => {
    const template = legacyExampleTemplates('en', randomUUID)[1]
    template.content = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Before {{da', marks: [{ type: 'bold' }] },
            { type: 'text', text: 'te}} after', marks: [{ type: 'italic' }] },
          ],
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: '{{not' },
            { type: 'hardBreak' },
            { type: 'text', text: 'AField}}' },
          ],
        },
        { type: 'paragraph', content: [{ type: 'text', text: '{{not' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Either}}' }] },
      ],
    }
    expect(templateVariables(template.content)).toEqual([])
    template.dateFormat = 'YYYY-MM-DD'
    const filled = fillTemplate(template, {}, { now: new Date(2026, 9, 15) })
    expect(filled.content![0].content).toEqual([
      { type: 'text', text: 'Before 2026-10-15', marks: [{ type: 'bold' }] },
      { type: 'text', text: ' after', marks: [{ type: 'italic' }] },
    ])
    expect(filled.content!.slice(1)).toEqual(template.content.content!.slice(1))
    validateEditorDocument(filled)
    expect(
      fillTemplate(template, { date: '<literal> {{another}}' }, { now: new Date(2026, 9, 15) }),
    ).toEqual(filled)
  })
  it('adds disabled compatible defaults without replacing old content or catalogs', () => {
    const workspace = seedWorkspace('Legacy', false)
    const legacy = structuredClone(workspace) as unknown as { plugins: Record<string, unknown> }
    delete legacy.plugins.documentTemplates
    delete legacy.plugins.dataTools
    const parsed = workspaceSchema.parse(legacy)
    expect(parsed.pages).toEqual(workspace.pages)
    expect(parsed.plugins.commandBuilder).toEqual(workspace.plugins.commandBuilder)
    expect(parsed.plugins.documentTemplates).toEqual({
      enabled: false,
      initialized: false,
      catalogRevision: 2,
      templates: [],
    })
    expect(parsed.plugins.dataTools).toEqual({ enabled: false, indent: 2, csvDelimiter: ',' })
  })
  it('retires only unchanged legacy examples in either language, once, without restoring deletions', () => {
    for (const language of ['en', 'ru'] as const) {
      const templates = legacyExampleTemplates(language, randomUUID)
      templates.forEach((template) => validateEditorDocument(template.content))
      const custom = { ...structuredClone(templates[0]), id: randomUUID(), name: 'My own template' }
      const edited = structuredClone(templates[1])
      edited.content.content![0].content![0].text = 'An edited project'
      const original = {
        enabled: true,
        initialized: true,
        templates: [templates[0], templates[2], templates[3], edited, custom],
      }
      const before = structuredClone(original)
      const upgraded = documentTemplatesPluginSchema.parse(original)
      expect(original).toEqual(before)
      expect(upgraded.templates).toEqual([edited, custom])
      expect(upgraded.catalogRevision).toBe(2)
      expect(documentTemplatesPluginSchema.parse(upgraded)).toEqual(upgraded)
      expect(documentTemplatesPluginSchema.parse({ ...original, templates: [] }).templates).toEqual(
        [],
      )
      expect(
        documentTemplatesPluginSchema.parse({ ...upgraded, templates: [templates[0]] }).templates,
      ).toEqual([templates[0]])
    }
  })
  it('captures a lossless independent page body and retains media and status snapshots', () => {
    const workspace = seedWorkspace('Capture', false)
    const page = createPage(workspace, 'My template')
    page.icon = '📌'
    page.content = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: '{{project}}', marks: [{ type: 'bold' }] }],
        },
        {
          type: 'image',
          attrs: {
            src: `sheco-asset://${workspace.id}/${randomUUID()}.png`,
            width: 200,
            caption: 'Example',
          },
        },
      ],
    }
    const template = captureTemplate(page, randomUUID())
    expect(template.content).toEqual(page.content)
    expect(template.icon).toBe('📌')
    template.content.content![0].content![0].text = 'Changed'
    expect(page.content.content![0].content![0].text).toBe('{{project}}')
  })
  it('substitutes text literally, preserves marks and never substitutes attributes', () => {
    const template = legacyExampleTemplates('en', randomUUID)[1]
    template.content = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: '{{ project }} {{title}} {{date}} {{unknown}} {{constructor}}',
              marks: [{ type: 'link', attrs: { href: 'https://example.com/{{project}}' } }],
            },
          ],
        },
      ],
    }
    expect(templateVariables(template.content)).toEqual(['project', 'unknown', 'constructor'])
    template.dateFormat = 'YYYY-MM-DD'
    const filled = fillTemplate(
      template,
      {
        project: '<script>literal</script>',
        title: 'Title',
        date: '2026-10-13',
      },
      { now: new Date(2026, 9, 15) },
    )
    expect(filled.content![0].content![0].text).toBe(
      '{{ project }} {{title}} 2026-10-15 {{unknown}} {{constructor}}',
    )
    expect(filled.content![0].content![0].marks).toEqual(
      template.content.content![0].content![0].marks,
    )
    expect(template.content.content![0].content![0].text).toContain('{{ project }}')
  })
  it('rejects duplicate IDs, empty names, excessive variables and oversized documents', () => {
    const template = legacyExampleTemplates('en', randomUUID)[0]
    expect(
      documentTemplatesPluginSchema.safeParse({ templates: [template, template] }).success,
    ).toBe(false)
    expect(documentTemplateSchema.safeParse({ ...template, name: ' ' }).success).toBe(false)
    const text = (value: string): DocNode => ({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: value }] }],
    })
    expect(
      documentTemplateSchema.safeParse({ ...template, content: text('x'.repeat(1024 * 1024)) })
        .success,
    ).toBe(false)
    const large = Array.from({ length: 9 }, () => ({
      ...template,
      id: randomUUID(),
      content: text('x'.repeat(950000)),
    }))
    expect(large.every((item) => documentTemplateSchema.safeParse(item).success)).toBe(true)
    expect(documentTemplatesPluginSchema.safeParse({ templates: large }).success).toBe(false)
    expect(
      documentTemplateSchema.safeParse({
        ...template,
        content: text(Array.from({ length: 41 }, (_, i) => `{{field${i}}}`).join(' ')),
      }).success,
    ).toBe(false)
    let deep: DocNode = { type: 'paragraph' }
    for (let i = 0; i < 41; i++) deep = { type: 'doc', content: [deep] }
    expect(documentTemplateSchema.safeParse({ ...template, content: deep }).success).toBe(false)
  })
  it('keeps configuration tabs available while disabled and rejects disabled app tabs', () => {
    const workspace = seedWorkspace('Tabs', false)
    workspace.ui.tabs = [documentTemplatesSettingsTab, dataToolsSettingsTab]
    workspace.ui.activeId = documentTemplatesSettingsTab
    expect(workspaceSchema.safeParse(workspace).success).toBe(true)
    workspace.ui.tabs.push(documentTemplatesTab, dataToolsTab)
    expect(workspaceSchema.safeParse(workspace).success).toBe(false)
    workspace.plugins.documentTemplates.enabled = true
    workspace.plugins.dataTools.enabled = true
    expect(workspaceSchema.safeParse(workspace).success).toBe(true)
  })
})
