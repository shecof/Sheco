import { describe, expect, it } from 'vitest'
import { getSchema } from '@tiptap/core'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { history, undo, redo } from '@tiptap/pm/history'
import { documentExtensions, validateEditorDocument } from '../src/editor/documentSchema'
import { templateTransaction } from '../src/editor/templateTransactions'

const schema = getSchema(documentExtensions())
const paragraph = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const document = (...content: unknown[]) => schema.nodeFromJSON({ type: 'doc', content })

describe('Template insertion', () => {
  it('inserts beside annotated code without splitting its text or comment ranges', () => {
    const original = document(
      {
        type: 'codeBlock',
        attrs: { comments: [{ id: 'comment', from: 0, to: 4, text: 'Keep this' }] },
        content: [{ type: 'text', text: 'code' }],
      },
      paragraph('Tail'),
    )
    let state = EditorState.create({ schema, doc: original, plugins: [history()] })
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 3)))
    state = state.apply(
      templateTransaction(state, { type: 'doc', content: [paragraph('Inserted')] }),
    )
    expect(state.doc.child(0).eq(original.child(0))).toBe(true)
    expect(state.doc.textContent).toBe('codeInsertedTail')
    expect(() => validateEditorDocument(state.doc.toJSON())).not.toThrow()
    undo(state, (transaction) => {
      state = state.apply(transaction)
    })
    expect(state.doc.eq(original)).toBe(true)
  })
  it('preserves surrounding content and selected text, retains rich blocks, and undoes in one step', () => {
    const original = document(paragraph('Before after'), paragraph('Retained sibling'))
    let state = EditorState.create({ schema, doc: original, plugins: [history()] })
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, 7)))
    const payload = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Inserted', marks: [{ type: 'bold' }] }],
        },
        {
          type: 'taskList',
          content: [{ type: 'taskItem', attrs: { checked: true }, content: [paragraph('Task')] }],
        },
      ],
    }
    state = state.apply(templateTransaction(state, payload))
    state.doc.check()
    expect(state.doc.textContent).toBe('BeforeInsertedTask afterRetained sibling')
    let checked = false
    state.doc.descendants((node) => {
      if (node.type.name === 'taskItem') checked = node.attrs.checked
    })
    expect(checked).toBe(true)
    const inserted = state.doc
    expect(
      undo(state, (transaction) => {
        state = state.apply(transaction)
      }),
    ).toBe(true)
    expect(state.doc.eq(original)).toBe(true)
    expect(
      redo(state, (transaction) => {
        state = state.apply(transaction)
      }),
    ).toBe(true)
    expect(state.doc.eq(inserted)).toBe(true)
  })
  it('replaces only an explicit slash range and fits insertion into nested list content', () => {
    const original = document(
      { type: 'bulletList', content: [{ type: 'listItem', content: [paragraph('/template')] }] },
      paragraph('Sibling'),
    )
    let state = EditorState.create({ schema, doc: original })
    state = state.apply(
      templateTransaction(
        state,
        { type: 'doc', content: [paragraph('Literal <script>')] },
        { from: 3, to: 12 },
      ),
    )
    state.doc.check()
    expect(state.doc.textContent).toBe('Literal <script>Sibling')
    expect(state.doc.firstChild?.type.name).toBe('bulletList')
  })
  it('rejects unavailable positions and non-document payloads without changing the source', () => {
    const state = EditorState.create({ schema, doc: document(paragraph('Keep')) })
    expect(() =>
      templateTransaction(
        state,
        { type: 'doc', content: [paragraph('New')] },
        { from: 100, to: 100 },
      ),
    ).toThrow('position')
    expect(() => templateTransaction(state, paragraph('New'))).toThrow('document')
    expect(state.doc.textContent).toBe('Keep')
  })
})
