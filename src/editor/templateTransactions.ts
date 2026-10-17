import { Slice } from '@tiptap/pm/model'
import { closeHistory } from '@tiptap/pm/history'
import { Selection, type EditorState } from '@tiptap/pm/state'
import type { DocNode } from '../shared/model'

export function templateTransaction(
  state: EditorState,
  content: DocNode,
  range = { from: state.selection.to, to: state.selection.to },
) {
  if (range.from < 0 || range.to < range.from || range.to > state.doc.content.size)
    throw new Error('The insertion position is no longer available.')
  const position = state.doc.resolve(range.from)
  // Rich blocks belong beside code, preserving its text and annotation ranges.
  if (range.from === range.to && position.parent.type.spec.code)
    range = { from: position.after(), to: position.after() }
  const document = state.schema.nodeFromJSON(content)
  document.check()
  if (document.type !== state.schema.topNodeType) throw new Error('Invalid template document.')
  const transaction = closeHistory(state.tr).replaceRange(
    range.from,
    range.to,
    new Slice(document.content, 0, 0),
  )
  const end = transaction.mapping.map(range.to, 1)
  transaction.setSelection(
    Selection.near(transaction.doc.resolve(Math.min(end, transaction.doc.content.size))),
  )
  return transaction.scrollIntoView()
}
