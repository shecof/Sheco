import { describe, expect, it } from 'vitest'
import { seedWorkspace } from '../src/shared/seed'
import {
  backlinks,
  createPage,
  linkedIds,
  movePage,
  pageSchema,
  pageText,
  searchWorkspace,
  workspaceSchema,
  uid,
  type DocNode,
} from '../src/shared/model'
import { architectureEmbedAttrsSchema } from '../src/shared/architectureDocument'
import { pageMarkdown } from '../src/shared/export'
import { executeWorkspaceTool, validateReferences } from '../src/shared/mcp'
import { validateEditorDocument } from '../src/editor/documentSchema'

function fixture() {
  const w = seedWorkspace('Architecture pages', false)
  w.plugins.projectArchitecture.enabled = true
  const parent = w.pages[0]
  const page = createPage(w, 'Infrastructure', parent.id, 'architecture')
  page.architecture!.objects.push({
    id: uid(),
    name: 'api-unique',
    type: 'server',
    os: 'Debian',
    resources: { cpu: 2, ram: 4 },
    parameters: [{ name: 'Address', value: '192.0.2.12' }],
  })
  w.pages.push(page)
  const embed = { type: 'architectureEmbed', attrs: { pageId: page.id, label: page.title } }
  parent.content = { type: 'doc', content: [embed] }
  return { w, parent, page, embed }
}

describe('architecture pages and document previews', () => {
  it('preserves manual connection label metadata through workspace JSON and guarded MCP edits', () => {
    const { w, page } = fixture()
    const project = structuredClone(page.architecture!)
    project.objects.push({ ...project.objects[0], id: uid(), name: 'database' })
    project.links.push({
      id: uid(),
      from: project.objects[0].id,
      to: project.objects[1].id,
      label: 'SQL',
      labelPosition: 0.37,
      labelRotation: -45,
    })
    const next = executeWorkspaceTool(
      w,
      'update_page',
      {
        workspaceId: w.id,
        pageId: page.id,
        expectedUpdatedAt: page.updatedAt,
        patch: { architecture: project },
      },
      validateEditorDocument,
    ).workspace
    const restored = workspaceSchema.parse(JSON.parse(JSON.stringify(next)))
    expect(restored.pages.find((item) => item.id === page.id)!.architecture!.links).toEqual(
      project.links,
    )
    expect(
      pageMarkdown(
        restored.pages.find((item) => item.id === page.id)!,
        restored,
      ),
    ).toContain('|"SQL"|')
    expect(page.architecture!.links).toEqual([])
  })
  it('round-trips page-owned data and rejects orphan data, missing diagrams and database entries', () => {
    const { w, page } = fixture()
    expect(workspaceSchema.parse(JSON.parse(JSON.stringify(w)))).toEqual(w)
    const { architecture, ...missing } = page
    expect(pageSchema.safeParse(missing).success).toBe(false)
    expect(pageSchema.safeParse({ ...page, kind: 'page' }).success).toBe(false)
    expect(pageSchema.safeParse({ ...page, databaseId: uid() }).success).toBe(false)
    expect(
      pageSchema.safeParse({
        ...page,
        architecture: {
          ...architecture,
          objects: [{ ...architecture!.objects[0], siteId: uid() }],
        },
      }).success,
    ).toBe(false)
    const old = seedWorkspace('Legacy workspace', false)
    expect(workspaceSchema.parse(old).pages[0].architecture).toBeUndefined()
  })
  it('validates bounded preview references against the full editor grammar and workspace page types', () => {
    const { w, parent, page, embed } = fixture()
    expect(() => validateEditorDocument(parent.content)).not.toThrow()
    expect(() => validateReferences(w, embed)).not.toThrow()
    const listed = executeWorkspaceTool(
      w,
      'list_pages',
      { workspaceId: w.id },
      validateEditorDocument,
    ).result.pages as Record<string, unknown>[]
    expect(listed.find((p) => p.id === page.id)).toMatchObject({
      kind: 'architecture',
      architectureObjectCount: 1,
      architectureSiteCount: 0,
    })
    expect(listed.find((p) => p.id === page.id)).not.toHaveProperty('architecture')
    for (const attrs of [
      { pageId: 'file:///private' },
      { pageId: page.id, label: 'x'.repeat(501) },
      { pageId: page.id, script: 'bad' },
    ]) {
      expect(architectureEmbedAttrsSchema.safeParse(attrs).success).toBe(false)
      expect(() =>
        validateEditorDocument({
          type: 'doc',
          content: [{ type: 'architectureEmbed', attrs }],
        } as DocNode),
      ).toThrow()
    }
    expect(() =>
      validateReferences(w, { ...embed, attrs: { ...embed.attrs, pageId: parent.id } }),
    ).toThrow('architecture page')
    expect(() =>
      validateReferences(w, { ...embed, attrs: { ...embed.attrs, pageId: uid() } }),
    ).toThrow('Page not found')
    expect(() =>
      validateReferences(
        {
          ...w,
          pages: w.pages.map((p) =>
            p.id === page.id ? { ...p, deletedAt: new Date().toISOString() } : p,
          ),
        },
        embed,
      ),
    ).toThrow()
  })
  it('searches object metadata, records backlinks and exports topology from both parent and child', () => {
    const { w, parent, page, embed } = fixture()
    expect(linkedIds(embed)).toEqual([page.id])
    expect(backlinks(w, page.id)).toContain(parent)
    expect(searchWorkspace(w, 'api-unique').map((r) => r.page.id)).toEqual([page.id])
    expect(pageText(page)).toContain('192.0.2.12')
    for (const current of [parent, page]) {
      const text = pageMarkdown(current, w)
      expect(text).toContain('```mermaid')
      expect(text).toContain('api-unique')
      expect(text).toContain('Debian')
    }
    const moved = movePage(w, page.id, null)
    expect(moved.pages.find((p) => p.id === page.id)!.architecture).toBe(page.architecture)
    expect(moved.pages.find((p) => p.id === parent.id)!.content).toBe(parent.content)
  })
  it('creates architecture pages only with the plugin and guards concurrent diagram edits', () => {
    const { w, parent } = fixture()
    const args = {
      workspaceId: w.id,
      title: 'Agent diagram',
      kind: 'architecture',
      parentId: parent.id,
    }
    const create = (workspace = w, override = {}) =>
      executeWorkspaceTool(
        workspace,
        'create_page',
        { ...args, ...override },
        validateEditorDocument,
      )
    expect(() =>
      create({
        ...w,
        plugins: {
          ...w.plugins,
          projectArchitecture: { ...w.plugins.projectArchitecture, enabled: false },
        },
      }),
    ).toThrow('Enable architecture')
    expect(() => create(w, { content: { type: 'doc', content: [{ type: 'paragraph' }] } })).toThrow(
      'independent diagram',
    )
    expect(() => create(w, { kind: 'page', architecture: w.pages.at(-1)!.architecture })).toThrow(
      'Architecture data requires',
    )
    const made = create().workspace
    const page = made.pages.at(-1)!
    expect(page.icon).toBe('network')
    const args2 = {
      workspaceId: w.id,
      pageId: page.id,
      expectedUpdatedAt: page.updatedAt,
      patch: { title: 'Renamed diagram', architecture: page.architecture },
    }
    const changed = executeWorkspaceTool(
      made,
      'update_page',
      args2,
      validateEditorDocument,
    ).workspace
    expect(changed.pages.at(-1)!.architecture!.name).toBe('Renamed diagram')
    expect(() =>
      executeWorkspaceTool(changed, 'update_page', args2, validateEditorDocument),
    ).toThrow(/changed|conflict/i)
    for (const [tool, extra] of [
      ['update_page', { patch: { content: parent.content } }],
      ['edit_blocks', { index: 0, blocks: [] }],
      ['move_blocks', { index: 0, count: 1, toIndex: 0 }],
    ] as const) {
      expect(() =>
        executeWorkspaceTool(
          made,
          tool,
          { workspaceId: w.id, pageId: page.id, expectedUpdatedAt: page.updatedAt, ...extra },
          validateEditorDocument,
        ),
      ).toThrow()
    }
    const read = executeWorkspaceTool(
      changed,
      'get_page',
      { workspaceId: w.id, pageId: page.id },
      validateEditorDocument,
    ).result
    expect(read.markdown).toContain('```mermaid')
  })
  it('trashes and restores architecture children atomically while retaining previews and diagrams', () => {
    const { w, parent, page } = fixture()
    const args = { workspaceId: w.id, pageId: parent.id, expectedUpdatedAt: parent.updatedAt }
    const trashed = executeWorkspaceTool(w, 'trash_page', args, validateEditorDocument).workspace
    expect(trashed.pages.find((p) => p.id === page.id)!.deletedAt).toBeTruthy()
    expect(trashed.pages.find((p) => p.id === page.id)!.architecture).toEqual(page.architecture)
    const restored = executeWorkspaceTool(
      trashed,
      'restore_page',
      {
        workspaceId: w.id,
        pageId: page.id,
        expectedUpdatedAt: trashed.pages.find((p) => p.id === page.id)!.updatedAt,
      },
      validateEditorDocument,
    ).workspace
    expect(restored.pages.find((p) => p.id === page.id)!.deletedAt).toBeNull()
    expect(restored.pages.find((p) => p.id === parent.id)!.deletedAt).toBeNull()
    expect(restored.pages.find((p) => p.id === parent.id)!.content).toEqual(parent.content)
  })
})
