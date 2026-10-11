import { describe, it, expect } from 'vitest'
import { seedWorkspace } from '../src/shared/seed'
import {
  workspaceSchema,
  createPage,
  movePage,
  descendants,
  searchWorkspace,
  backlinks,
  databaseRows,
  createDatabase,
  linkedIds,
} from '../src/shared/model'
describe('workspace model', () => {
  it('searches full registered filenames on live pages, including nested images and galleries', () => {
    const w = seedWorkspace('Files', false)
    const page = createPage(w, 'Owner')
    w.pages.push(page)
    const file = {
      id: crypto.randomUUID(),
      file: 'stored.png',
      name: 'План проекта 2026.png',
      mime: 'image/png',
      bytes: 10,
      createdAt: new Date().toISOString(),
    }
    w.attachments.push(file)
    page.content = {
      type: 'doc',
      content: [
        {
          type: 'details',
          content: [
            { type: 'detailsSummary' },
            {
              type: 'detailsContent',
              content: [
                {
                  type: 'image',
                  attrs: { src: `sheco-asset://${w.id}/${file.file}`, alt: 'unrelated' },
                },
                {
                  type: 'imageGallery',
                  attrs: { images: [{ src: `sheco-asset://${w.id}/${file.file}` }] },
                },
              ],
            },
          ],
        },
      ],
    }
    expect(searchWorkspace(w, 'ПЛАН 2026')).toMatchObject([
      { page: { id: page.id }, kind: 'file', file: { id: file.id, name: file.name } },
    ])
    page.deletedAt = new Date().toISOString()
    expect(searchWorkspace(w, 'план')).toEqual([])
    page.deletedAt = null
    page.content = {
      type: 'doc',
      content: [
        { type: 'attachment', attrs: { id: file.id, file: file.file, name: 'short label' } },
      ],
    }
    expect(searchWorkspace(w, 'проекта')).toMatchObject([
      { kind: 'file', file: { name: file.name } },
    ])
    page.content = { type: 'doc', content: [{ type: 'paragraph' }] }
    expect(searchWorkspace(w, 'проекта')).toEqual([])
  })
  it('validates both the sample and a blank workspace', () => {
    expect(workspaceSchema.safeParse(seedWorkspace()).success).toBe(true)
    expect(workspaceSchema.safeParse(seedWorkspace('Work', false)).success).toBe(true)
  })
  it('adds reading defaults to older snapshots without changing their pages', () => {
    const original = seedWorkspace()
    const legacy = JSON.parse(JSON.stringify(original))
    for (const key of ['accent', 'showOutline', 'fixedWidth', 'fontSize', 'sidebarWidth'])
      delete legacy.ui[key]
    const restored = workspaceSchema.parse(legacy)
    expect(restored.pages).toEqual(original.pages)
    expect(restored.ui).toMatchObject({
      accent: 'neutral',
      showOutline: true,
      fixedWidth: true,
      fontSize: 0,
      sidebarWidth: 252,
    })
    const custom = workspaceSchema.parse({
      ...restored,
      ui: {
        ...restored.ui,
        accent: 'purple',
        showOutline: false,
        fixedWidth: false,
        fontSize: 2,
        sidebarWidth: 400,
      },
    })
    expect(workspaceSchema.parse(JSON.parse(JSON.stringify(custom))).ui).toEqual(custom.ui)
    expect(
      workspaceSchema.safeParse({ ...custom, ui: { ...custom.ui, fontSize: 3 } }).success,
    ).toBe(false)
    expect(
      workspaceSchema.safeParse({ ...custom, ui: { ...custom.ui, sidebarWidth: 900 } }).success,
    ).toBe(false)
  })
  it('keeps inline databases as independent schemas and tracks their page reference', () => {
    const w = seedWorkspace()
    const parent = w.pages.find((p) => p.title === 'Field notes')!
    const page = createPage(w, 'Inline collection', parent.id, 'database')
    w.pages.push(page)
    w.databases.push(createDatabase(page.id))
    parent.content = {
      type: 'doc',
      content: [{ type: 'databaseEmbed', attrs: { pageId: page.id } }],
    }
    expect(workspaceSchema.safeParse(w).success).toBe(true)
    expect(linkedIds(parent.content)).toEqual([page.id])
    expect(backlinks(w, page.id)).toContain(parent)
  })
  it('adds compatible database title widths and preserves custom widths on round trip', () => {
    const original = seedWorkspace()
    const legacy = JSON.parse(JSON.stringify(original))
    for (const database of legacy.databases) delete database.titleWidth
    const restored = workspaceSchema.parse(legacy)
    expect(restored.pages).toEqual(original.pages)
    expect(restored.databases.map((database) => database.titleWidth)).toEqual([220])
    restored.databases[0].titleWidth = 340
    expect(workspaceSchema.parse(JSON.parse(JSON.stringify(restored))).databases).toEqual(
      restored.databases,
    )
    expect(createDatabase(original.pages[0].id).titleWidth).toBe(220)
    for (const width of [79, 1001, Infinity]) {
      restored.databases[0].titleWidth = width
      expect(workspaceSchema.safeParse(restored).success).toBe(false)
    }
  })
  it('filters multi-select membership and relations by selected ID or typed page name', () => {
    const w = seedWorkspace()
    const db = w.databases[0]
    const category = db.columns.find((column) => column.type === 'multiSelect')!
    const rows = w.pages.filter((page) => page.databaseId === db.id)
    rows[0].properties[category.id] = ['Web', 'JWT']
    rows[1].properties[category.id] = ['Website']
    db.filters = [{ column: category.id, operator: 'equals', value: 'wEb' }]
    expect(databaseRows(w, db)).toContain(rows[0])
    expect(databaseRows(w, db)).not.toContain(rows[1])
    db.filters[0].value = 'Web, JWT'
    expect(databaseRows(w, db)).toEqual([rows[0]])
    db.filters[0].value = 'wEb'
    db.filters[0].operator = 'not'
    expect(databaseRows(w, db)).not.toContain(rows[0])
    expect(databaseRows(w, db)).toContain(rows[1])
    const relation = { ...category, id: crypto.randomUUID(), type: 'relation' as const }
    db.columns.push(relation)
    rows[0].properties[relation.id] = rows[1].id
    db.filters = [{ column: relation.id, operator: 'equals', value: rows[1].id.toUpperCase() }]
    expect(databaseRows(w, db)).toEqual([rows[0]])
    const checkbox = { ...category, id: crypto.randomUUID(), type: 'checkbox' as const }
    db.columns.push(checkbox)
    rows[0].properties[checkbox.id] = true
    rows[1].properties[checkbox.id] = false
    db.filters = [{ column: checkbox.id, operator: 'equals', value: 'false' }]
    expect(databaseRows(w, db)).toEqual(rows.slice(1))
    db.filters[0] = { column: checkbox.id, operator: 'empty', value: '' }
    expect(databaseRows(w, db)).toEqual(rows.slice(2))
    db.filters[0] = {
      column: relation.id,
      operator: 'contains',
      value: rows[1].title.toUpperCase(),
    }
    expect(databaseRows(w, db)).toEqual([rows[0]])
  })
  it('rejects cycles in the page hierarchy', () => {
    const w = seedWorkspace()
    w.pages[0].parentId = w.pages[0].id
    expect(workspaceSchema.safeParse(w).success).toBe(false)
  })
  it('rejects missing parents, duplicate pages, and invalid database memberships', () => {
    const w = seedWorkspace()
    w.pages.push({ ...w.pages[0] })
    expect(workspaceSchema.safeParse(w).success).toBe(false)
    w.pages.pop()
    w.pages[0].parentId = crypto.randomUUID()
    expect(workspaceSchema.safeParse(w).success).toBe(false)
  })
  it('prevents moving a parent under its child', () => {
    const w = seedWorkspace()
    const parent = w.pages.find((p) => p.title === 'Vulnerabilities')!
    const child = w.pages.find((p) => p.title === 'BOLA')!
    expect(() => movePage(w, parent.id, child.id)).toThrow('itself')
  })
  it('moves and reorders siblings without losing descendants', () => {
    const w = seedWorkspace()
    const root = w.pages.find((p) => p.title === 'Vulnerabilities')!
    const target = w.pages.find((p) => p.title === 'Resources')!
    const next = movePage(w, root.id, target.id)
    expect(next.pages.find((p) => p.id === root.id)?.parentId).toBe(target.id)
    expect(descendants(next, root.id).length).toBe(4)
    expect(workspaceSchema.safeParse(next).success).toBe(true)
  })
  it('keeps database records inside their database', () => {
    const w = seedWorkspace()
    const record = w.pages.find((p) => p.title === 'Nmap')!
    expect(() => movePage(w, record.id, null)).toThrow('Database records')
  })
  it('finds titles, body text, and property tags while excluding Trash', () => {
    const w = seedWorkspace()
    expect(searchWorkspace(w, 'nmap')[0].page.title).toBe('Nmap')
    expect(searchWorkspace(w, 'parameterized')[0].page.title).toBe('SQL Injection')
    expect(searchWorkspace(w, 'fuzzing')[0].kind).toBe('record')
    w.pages.find((p) => p.title === 'Nmap')!.deletedAt = new Date().toISOString()
    expect(searchWorkspace(w, 'nmap').some((r) => r.page.title === 'Nmap')).toBe(false)
  })
  it('detects backlinks from page blocks, wiki syntax, and relations', () => {
    const w = seedWorkspace()
    const n = w.pages.find((p) => p.title === 'Nmap')!
    expect(backlinks(w, n.id).map((p) => p.title)).toContain('Field notes')
    const page = createPage(w, 'Reference')
    page.content = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Read [[Nmap]]' }] }],
    }
    w.pages.push(page)
    expect(backlinks(w, n.id).map((p) => p.title)).toContain('Reference')
    page.content = { type: 'doc' }
    page.properties = { relation: n.id }
    expect(backlinks(w, n.id).map((p) => p.title)).toContain('Reference')
  })
  it('applies multiple filters, search, and numeric sorting', () => {
    const w = seedWorkspace()
    const db = w.databases[0]
    const type = db.columns.find((c) => c.name === 'Type')!
    db.filters = [{ column: type.id, operator: 'equals', value: 'Utility' }]
    expect(databaseRows(w, db).every((p) => p.properties[type.id] === 'Utility')).toBe(true)
    expect(databaseRows(w, db, 'nmap').length).toBe(1)
    db.sort = { column: 'title', direction: 'desc' }
    const rows = databaseRows(w, db)
    expect(rows[0].title).toBe('Wireshark')
    db.filters = []
    const number = { ...type, id: crypto.randomUUID(), name: 'Rank', type: 'number' as const }
    db.columns.push(number)
    const records = w.pages.filter((p) => p.databaseId === db.id)
    records[0].properties[number.id] = 10
    records[1].properties[number.id] = 2
    db.filters = [{ column: number.id, operator: 'notEmpty', value: '' }]
    db.sort = { column: number.id, direction: 'asc' }
    expect(databaseRows(w, db).map((p) => p.properties[number.id])).toEqual([2, 10])
  })
})
