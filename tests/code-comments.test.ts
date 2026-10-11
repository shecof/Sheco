import { describe, it, expect } from 'vitest'
import { Schema } from '@tiptap/pm/model'
import { EditorState } from '@tiptap/pm/state'
import { history, undo } from '@tiptap/pm/history'
import { codeCommentsPlugin } from '../src/editor/CodeComments'
import { validateEditorDocument } from '../src/editor/documentSchema'
import { markdown } from '../src/shared/export'
import { plainText } from '../src/shared/model'
const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'text*' },
    text: {},
    codeBlock: { group: 'block', content: 'text*', attrs: { comments: { default: [] } } },
  },
})
const code = 'first\nselected\nlast'
const comment = { id: 'one', from: 6, to: 14, text: 'Explain the output' }
const doc = schema.node(
  'doc',
  null,
  schema.node('codeBlock', { comments: [comment] }, schema.text(code)),
)
function fixture() {
  return EditorState.create({ schema, doc, plugins: [codeCommentsPlugin(), history()] })
}
describe('code comments', () => {
  it('maps ranges through text edits, retains them on undo, and removes an entirely deleted range', () => {
    const state = fixture()
    const edited = state.applyTransaction(state.tr.insertText('prefix ', 1)).state
    expect(edited.doc.firstChild!.attrs.comments).toEqual([{ ...comment, from: 13, to: 21 }])
    let restored = edited
    expect(
      undo(edited, (tr) => {
        restored = edited.applyTransaction(tr).state
      }),
    ).toBe(true)
    expect(restored.doc.eq(doc)).toBe(true)
    const removed = state.applyTransaction(state.tr.delete(7, 15)).state
    expect(removed.doc.firstChild!.attrs.comments).toEqual([])
    expect(removed.doc.textContent).toBe('first\n\nlast')
  })
  it('retains deliberate comment updates and exports searchable explanations with selected text', () => {
    const state = fixture()
    const edited = state.applyTransaction(
      state.tr.setNodeMarkup(0, undefined, { comments: [{ ...comment, text: 'Updated' }] }),
    ).state
    expect(edited.doc.firstChild!.attrs.comments[0].text).toBe('Updated')
    const node = doc.firstChild!.toJSON()
    expect(markdown(node)).toContain('> 2: selected\n> Explain the output')
    expect(plainText(node)).toContain('Explain the output')
  })
  it('accepts older blocks and validates persisted comment ranges, text, and unique IDs', () => {
    const document = (comments?: unknown) => ({
      type: 'doc',
      content: [
        {
          type: 'codeBlock',
          attrs: comments === undefined ? {} : { comments },
          content: [{ type: 'text', text: code }],
        },
      ],
    })
    expect(() => validateEditorDocument(document())).not.toThrow()
    expect(() => validateEditorDocument(document([comment]))).not.toThrow()
    for (const invalid of [
      [{ ...comment, from: -1 }],
      [{ ...comment, to: 100 }],
      [{ ...comment, text: '' }],
      [comment, comment],
      {},
    ])
      expect(() => validateEditorDocument(document(invalid))).toThrow(/Invalid code comment/)
  })
})
