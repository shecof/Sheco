import { describe, expect, it } from 'vitest'
import { getSchema } from '@tiptap/core'
import { EditorState } from '@tiptap/pm/state'
import { history, undo, redo } from '@tiptap/pm/history'
import { documentExtensions, validateEditorDocument } from '../src/editor/documentSchema'
import { jiraDisplayTransaction, jiraEditorText } from '../src/editor/jiraTransactions'
import { workspaceSchema, plainText, type DocNode } from '../src/shared/model'
import { seedWorkspace } from '../src/shared/seed'
import { markdown } from '../src/shared/export'
import { normalizeJiraDocument } from '../src/shared/jiraDocument'

const attrs = {
  baseUrl: 'https://example.atlassian.net',
  issueKey: 'PROJECT-123',
  display: 'minimal',
  summary: 'Review release',
  status: 'In progress',
  statusCategory: 'indeterminate',
  dueDate: '',
  fetchedAt: '',
}
const text = (text: string, marks?: DocNode['marks']): DocNode => ({
  type: 'text',
  text,
  ...(marks ? { marks } : {}),
})
const paragraph = (...content: DocNode[]): DocNode => ({ type: 'paragraph', content })
const mention: DocNode = { type: 'jiraIssueInline', attrs }
const block: DocNode = { type: 'jiraIssue', attrs: { ...attrs, display: 'detailed' } }
const schema = getSchema(documentExtensions())
function position(state: EditorState, type: string) {
  let found = -1
  state.doc.descendants((node, pos) => {
    if (found < 0 && node.type.name === type) found = pos
  })
  return found
}
describe('Inline Jira document behavior', () => {
  it('retains the visible key and status when converting a paragraph to plain code text or showing it in the outline', () => {
    const node = schema.nodeFromJSON(paragraph(text('Before '), mention, text(' after.')))
    expect(jiraEditorText(node)).toBe('Before PROJECT-123 · In progress after.')
  })
  it('validates mentions within paragraphs, headings and every list type, and exports key/status in the same sentence', () => {
    const sentence = [text('Track '), mention, text(' before shipping.')]
    for (const type of ['bulletList', 'orderedList', 'taskList']) {
      const doc: DocNode = {
        type: 'doc',
        content: [
          {
            type,
            content: [
              {
                type: type === 'taskList' ? 'taskItem' : 'listItem',
                ...(type === 'taskList' ? { attrs: { checked: true } } : {}),
                content: [paragraph(...sentence)],
              },
            ],
          },
        ],
      }
      expect(() => validateEditorDocument(doc)).not.toThrow()
      expect(markdown(doc)).toContain(
        'Track [PROJECT-123](https://example.atlassian.net/browse/PROJECT-123) (In progress) before shipping.',
      )
      expect(plainText(doc)).toContain('PROJECT-123 Review release In progress')
    }
    expect(() =>
      validateEditorDocument({
        type: 'doc',
        content: [{ type: 'heading', attrs: { level: 2 }, content: sentence }],
      }),
    ).not.toThrow()
    expect(() =>
      validateEditorDocument({
        type: 'doc',
        content: [{ ...mention, attrs: { ...attrs, display: 'detailed' } }],
      }),
    ).toThrow()
    expect(() =>
      validateEditorDocument({
        type: 'doc',
        content: [paragraph({ ...mention, attrs: { ...attrs, pat: 'secret' } })],
      }),
    ).toThrow('Invalid Jira issue attributes')
  })
  it('upgrades legacy minimal list blocks without mutating the original, losing marks or changing detailed snapshots', () => {
    const w = seedWorkspace('Migration', false)
    w.pages[0].content = {
      type: 'doc',
      content: [
        {
          type: 'orderedList',
          attrs: { start: 3 },
          content: [
            {
              type: 'listItem',
              content: [paragraph(text('Track', [{ type: 'bold' }])), { type: 'jiraIssue', attrs }],
            },
          ],
        },
        block,
        paragraph(text('Separate note.')),
      ],
    }
    const original = structuredClone(w)
    const loaded = workspaceSchema.parse(w)
    expect(w).toEqual(original)
    expect(Date.parse(loaded.pages[0].updatedAt)).toBeGreaterThan(
      Date.parse(original.pages[0].updatedAt),
    )
    const content = loaded.pages[0].content
    expect(content.content?.[0].attrs).toEqual({ start: 3 })
    expect(content.content?.[0].content?.[0].content).toEqual([
      paragraph(text('Track', [{ type: 'bold' }]), text(' '), mention),
    ])
    expect(content.content?.slice(1)).toEqual(original.pages[0].content.content?.slice(1))
    expect(() => validateEditorDocument(content)).not.toThrow()
    expect(workspaceSchema.parse(loaded).pages[0].content).toEqual(content)
    expect(workspaceSchema.parse(loaded).pages[0].updatedAt).toBe(loaded.pages[0].updatedAt)
    const malformed: DocNode = {
      type: 'doc',
      content: [
        { type: 'jiraIssue', attrs, content: [text('Unexpected content must be retained.')] },
      ],
    }
    expect(normalizeJiraDocument(malformed)).toEqual(malformed)
  })
  it('converts a mention inside marked list text into a card and back, with exact undo/redo and no lost text', () => {
    const doc: DocNode = {
      type: 'doc',
      content: [
        {
          type: 'orderedList',
          attrs: { start: 4 },
          content: [
            {
              type: 'listItem',
              content: [
                paragraph(
                  text('Before ', [{ type: 'bold' }]),
                  mention,
                  text(' after.', [{ type: 'italic' }]),
                ),
              ],
            },
          ],
        },
      ],
    }
    let state = EditorState.create({ schema, doc: schema.nodeFromJSON(doc), plugins: [history()] })
    const original = state.doc.toJSON()
    state = state.apply(
      jiraDisplayTransaction(state, position(state, 'jiraIssueInline'), 'detailed')!,
    )
    expect(() => state.doc.check()).not.toThrow()
    expect(
      state.doc
        .toJSON()
        .content[0].content[0].content.some((node: DocNode) => node.type === 'jiraIssue'),
    ).toBe(true)
    const detailed = state.doc.toJSON()
    state = state.apply(jiraDisplayTransaction(state, position(state, 'jiraIssue'), 'minimal')!)
    expect(state.doc.toJSON()).toEqual(original)
    undo(state, (tr) => {
      state = state.apply(tr)
    })
    expect(state.doc.toJSON()).toEqual(detailed)
    redo(state, (tr) => {
      state = state.apply(tr)
    })
    expect(state.doc.toJSON()).toEqual(original)
  })
  it('fits cards at paragraph boundaries and preserves all neighbors when changing the view', () => {
    for (const content of [[mention, text(' Tail')], [text('Head '), mention], [mention]]) {
      let state = EditorState.create({
        schema,
        doc: schema.nodeFromJSON({
          type: 'doc',
          content: [
            paragraph(text('Independent before.')),
            paragraph(...content),
            paragraph(text('Independent after.')),
          ],
        }),
      })
      const original = state.doc.toJSON()
      state = state.apply(
        jiraDisplayTransaction(state, position(state, 'jiraIssueInline'), 'detailed')!,
      )
      state.doc.check()
      state = state.apply(jiraDisplayTransaction(state, position(state, 'jiraIssue'), 'minimal')!)
      state.doc.check()
      expect(state.doc.toJSON()).toEqual(original)
    }
  })
})
