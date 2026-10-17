import { describe, it, expect } from 'vitest'
import { seedWorkspace } from '../src/shared/seed'
import { blockCatalog, executeWorkspaceTool } from '../src/shared/mcp'
import { validateEditorDocument } from '../src/editor/documentSchema'
import { uid, nextTimestamp, createPage, type DocNode } from '../src/shared/model'

function fixture() {
  const w = seedWorkspace()
  const attachment = {
    id: uid(),
    file: uid() + '.png',
    name: 'image.png',
    mime: 'image/png',
    bytes: 10,
    createdAt: new Date().toISOString(),
  }
  w.attachments.push(attachment)
  return { w, attachment, page: w.pages.find((p) => p.title === 'Field notes')! }
}
describe('MCP workspace operations', () => {
  it('allows attachment views on registered files and rejects invalid views without changing the workspace', () => {
    const { w, page, attachment } = fixture()
    for (const display of ['card', 'compact', 'tile', 'link']) {
      const block = {
        type: 'attachment',
        attrs: {
          id: attachment.id,
          file: attachment.file,
          name: attachment.name,
          bytes: attachment.bytes,
          display,
        },
      }
      const result = executeWorkspaceTool(
        w,
        'edit_blocks',
        {
          workspaceId: w.id,
          pageId: page.id,
          expectedUpdatedAt: page.updatedAt,
          index: 0,
          blocks: [block],
        },
        validateEditorDocument,
      )
      expect(result.workspace.pages.find((p) => p.id === page.id)?.content.content?.[0]).toEqual(
        block,
      )
    }
    const before = structuredClone(w)
    expect(() =>
      executeWorkspaceTool(
        w,
        'edit_blocks',
        {
          workspaceId: w.id,
          pageId: page.id,
          expectedUpdatedAt: page.updatedAt,
          index: 0,
          blocks: [
            {
              type: 'attachment',
              attrs: { id: attachment.id, file: attachment.file, display: 'invalid' },
            },
          ],
        },
        validateEditorDocument,
      ),
    ).toThrow('Invalid attachment view')
    expect(w).toEqual(before)
  })
  it('gives consecutive local and agent edits distinct versions even within one millisecond', () => {
    const future = new Date(Date.now() + 1000).toISOString()
    const first = nextTimestamp(future)
    const second = nextTimestamp(first)
    expect(Date.parse(first)).toBe(Date.parse(future) + 1)
    expect(Date.parse(second)).toBe(Date.parse(first) + 1)
  })
  it('validates examples for every block against the real editor schema and preserves attributes', () => {
    const { w, page, attachment } = fixture()
    const architecture = createPage(w, 'Infrastructure', page.id, 'architecture')
    w.pages.push(architecture)
    const examples = blockCatalog.map((b) =>
      JSON.parse(
        JSON.stringify(b.example)
          .replaceAll(
            'sheco-asset://WORKSPACE_ID/ATTACHMENT_FILE',
            `sheco-asset://${w.id}/${attachment.file}`,
          )
          .replaceAll('ARCHITECTURE_PAGE_ID', architecture.id)
          .replaceAll('DATABASE_PAGE_ID', w.databases[0].pageId)
          .replaceAll('PAGE_ID', w.pages[0].id)
          .replaceAll('ATTACHMENT_ID', attachment.id)
          .replaceAll('ATTACHMENT_FILE', attachment.file),
      ),
    )
    const content: DocNode = { type: 'doc', content: examples }
    const output = executeWorkspaceTool(
      w,
      'update_page',
      { workspaceId: w.id, pageId: page.id, expectedUpdatedAt: page.updatedAt, patch: { content } },
      validateEditorDocument,
    )
    expect(output.workspace.pages.find((p) => p.id === page.id)?.content).toEqual(content)
    expect(output.workspace.pages.find((p) => p.id === page.id)?.updatedAt).not.toBe(page.updatedAt)
    expect(w.pages.find((p) => p.id === page.id)?.content).toBe(page.content)
  })
  it('rejects unknown blocks, malformed nesting and unregistered assets before changing content', () => {
    const { w, page } = fixture()
    for (const block of [
      { type: 'inventedBlock' },
      { type: 'bulletList', content: [{ type: 'paragraph' }] },
      { type: 'codeBlock', attrs: { invented: true } },
      { type: 'image', attrs: { src: 'file:///etc/passwd' } },
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'unsafe',
            marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
          },
        ],
      },
    ]) {
      expect(() =>
        executeWorkspaceTool(
          w,
          'edit_blocks',
          {
            workspaceId: w.id,
            pageId: page.id,
            expectedUpdatedAt: page.updatedAt,
            index: 0,
            blocks: [block],
          },
          validateEditorDocument,
        ),
      ).toThrow()
    }
  })
  it('rejects stale versions, foreign workspaces, cycles and invalid ranges', () => {
    const { w, page } = fixture()
    expect(() =>
      executeWorkspaceTool(
        w,
        'get_page',
        { workspaceId: uid(), pageId: page.id },
        validateEditorDocument,
      ),
    ).toThrow('authorized')
    expect(() =>
      executeWorkspaceTool(
        w,
        'update_page',
        {
          workspaceId: w.id,
          pageId: page.id,
          expectedUpdatedAt: new Date(0).toISOString(),
          patch: { title: 'stale' },
        },
        validateEditorDocument,
      ),
    ).toThrow('conflict')
    expect(() =>
      executeWorkspaceTool(
        w,
        'update_page',
        {
          workspaceId: w.id,
          pageId: page.id,
          expectedUpdatedAt: page.updatedAt,
          expectedRevision: w.revision + 1,
          patch: { title: 'stale' },
        },
        validateEditorDocument,
      ),
    ).toThrow('conflict')
    expect(() =>
      executeWorkspaceTool(
        w,
        'update_page',
        {
          workspaceId: w.id,
          pageId: page.id,
          expectedUpdatedAt: page.updatedAt,
          patch: { parentId: page.id },
        },
        validateEditorDocument,
      ),
    ).toThrow('cycle')
    expect(() =>
      executeWorkspaceTool(
        w,
        'edit_blocks',
        { workspaceId: w.id, pageId: page.id, expectedUpdatedAt: page.updatedAt, index: 9999 },
        validateEditorDocument,
      ),
    ).toThrow('bounds')
  })
  it('creates an inline database and a record with arbitrary content, and protects populated columns', () => {
    const { w, page } = fixture()
    const created = executeWorkspaceTool(
      w,
      'create_database',
      {
        workspaceId: w.id,
        pageId: page.id,
        expectedUpdatedAt: page.updatedAt,
        title: 'Agent collection',
      },
      validateEditorDocument,
    )
    const db = created.workspace.databases.at(-1)!
    const record = executeWorkspaceTool(
      created.workspace,
      'create_page',
      {
        workspaceId: w.id,
        title: 'A record',
        parentId: db.pageId,
        databaseId: db.id,
        properties: { [db.columns[0].id]: 'Done' },
        content: {
          type: 'doc',
          content: [
            {
              type: 'codeBlock',
              attrs: { title: 'Code', lineNumbers: true, collapsedByDefault: true },
              content: [{ type: 'text', text: 'print(1)' }],
            },
          ],
        },
      },
      validateEditorDocument,
    )
    expect(record.workspace.pages.at(-1)?.databaseId).toBe(db.id)
    expect(
      created.workspace.pages.find((p) => p.id === page.id)?.content.content?.at(-1)?.type,
    ).toBe('databaseEmbed')
    expect(() =>
      executeWorkspaceTool(
        record.workspace,
        'update_database',
        {
          workspaceId: w.id,
          databaseId: db.id,
          expectedRevision: w.revision,
          patch: { columns: [] },
        },
        validateEditorDocument,
      ),
    ).toThrow('property')
    expect(() =>
      executeWorkspaceTool(
        created.workspace,
        'create_page',
        {
          workspaceId: w.id,
          title: 'bad',
          parentId: db.pageId,
          databaseId: db.id,
          properties: { [db.columns[0].id]: 'Invented' },
        },
        validateEditorDocument,
      ),
    ).toThrow('Option')
  })
  it('moves blocks atomically and recovers trashed descendants', () => {
    const { w, page } = fixture()
    page.content = {
      type: 'doc',
      content: ['one', 'two', 'three'].map((text) => ({
        type: 'paragraph',
        content: [{ type: 'text', text }],
      })),
    }
    const moved = executeWorkspaceTool(
      w,
      'move_blocks',
      {
        workspaceId: w.id,
        pageId: page.id,
        expectedUpdatedAt: page.updatedAt,
        index: 0,
        count: 2,
        toIndex: 1,
      },
      validateEditorDocument,
    )
    expect(
      moved.workspace.pages
        .find((p) => p.id === page.id)
        ?.content.content?.map((p) => p.content?.[0].text),
    ).toEqual(['three', 'one', 'two'])
    const trashed = executeWorkspaceTool(
      w,
      'trash_page',
      { workspaceId: w.id, pageId: page.id, expectedUpdatedAt: page.updatedAt },
      validateEditorDocument,
    )
    const p = trashed.workspace.pages.find((p) => p.id === page.id)!
    expect(p.deletedAt).toBeTruthy()
    const restored = executeWorkspaceTool(
      trashed.workspace,
      'restore_page',
      { workspaceId: w.id, pageId: p.id, expectedUpdatedAt: p.updatedAt },
      validateEditorDocument,
    )
    expect(
      restored.workspace.pages.find((restoredPage) => restoredPage.id === page.id)?.deletedAt,
    ).toBeNull()
  })
  it('merges property edits without clearing other cells, and removes only empty columns', () => {
    const { w } = fixture()
    const db = w.databases[0]
    const record = w.pages.find((p) => p.databaseId === db.id)!
    const textColumn = db.columns.find((c) => c.type === 'text')!
    const output = executeWorkspaceTool(
      w,
      'update_page',
      {
        workspaceId: w.id,
        pageId: record.id,
        expectedUpdatedAt: record.updatedAt,
        patch: { properties: { [textColumn.id]: 'Changed only this cell' } },
      },
      validateEditorDocument,
    )
    expect(output.workspace.pages.find((p) => p.id === record.id)?.properties).toEqual({
      ...record.properties,
      [textColumn.id]: 'Changed only this cell',
    })
    const emptyId = uid()
    const added = executeWorkspaceTool(
      w,
      'update_database',
      {
        workspaceId: w.id,
        databaseId: db.id,
        expectedRevision: w.revision,
        patch: {
          columns: [
            ...db.columns,
            { id: emptyId, name: 'Empty', type: 'text', width: 180, hidden: false, options: [] },
          ],
        },
      },
      validateEditorDocument,
    )
    const removed = executeWorkspaceTool(
      added.workspace,
      'update_database',
      {
        workspaceId: w.id,
        databaseId: db.id,
        expectedRevision: w.revision,
        patch: { columns: db.columns },
      },
      validateEditorDocument,
    )
    expect(removed.workspace.databases[0].columns).toEqual(db.columns)
  })
})
