import { describe, expect, it } from 'vitest'
import { getSchema } from '@tiptap/core'
import { EditorState } from '@tiptap/pm/state'
import { history, undo } from '@tiptap/pm/history'
import { TableMap } from '@tiptap/pm/tables'
import { documentExtensions, validateEditorDocument } from '../src/editor/documentSchema'
import {
  autoSizeTable,
  reorderTable,
  tableHeaders,
  toggleTableHeader,
} from '../src/editor/TableActions'
import type { DocNode } from '../src/shared/model'
const schema = getSchema(documentExtensions())
const cell = (text: string, header = false, attrs = {}) =>
  schema.node(
    header ? 'tableHeader' : 'tableCell',
    attrs,
    schema.node('paragraph', null, schema.text(text)),
  )
const table = schema.node('table', null, [
  schema.node('tableRow', null, [
    cell('A', true, { colwidth: [120] }),
    cell('B', true, { colwidth: [160] }),
    cell('C', true, { colwidth: [200] }),
  ]),
  schema.node('tableRow', null, [
    cell('A1', false, { align: 'right', colwidth: [120] }),
    cell('B1'),
    cell('C1'),
  ]),
  schema.node('tableRow', null, [cell('A2'), cell('B2'), cell('C2')]),
])
function state(node = table) {
  return EditorState.create({ schema, doc: schema.node('doc', null, [node]), plugins: [history()] })
}
function undoTo(changed: EditorState, original: EditorState) {
  let restored = changed
  expect(
    undo(changed, (tr) => {
      restored = changed.apply(tr)
    }),
  ).toBe(true)
  expect(restored.doc.toJSON()).toEqual(original.doc.toJSON())
}
describe('table controls', () => {
  it('restores automatic widths without losing text, alignment or headers and undoes atomically', () => {
    const original = state()
    const changed = original.apply(autoSizeTable(original, 0))
    changed.doc.descendants((node) => {
      if (node.type.name === 'tableCell' || node.type.name === 'tableHeader')
        expect(node.attrs.colwidth).toBeNull()
    })
    expect(changed.doc.textContent).toBe(original.doc.textContent)
    expect(changed.doc.firstChild!.child(1).firstChild!.attrs.align).toBe('right')
    expect(tableHeaders(changed, 0)).toEqual({ row: true, column: false })
    undoTo(changed, original)
  })
  it('toggles first-row and first-column headers independently, retaining the shared corner', () => {
    const original = state()
    const both = original.apply(toggleTableHeader(original, 0, 'column')!)
    expect(tableHeaders(both, 0)).toEqual({ row: true, column: true })
    const column = both.apply(toggleTableHeader(both, 0, 'row')!)
    expect(tableHeaders(column, 0)).toEqual({ row: false, column: true })
    expect(column.doc.firstChild!.firstChild!.firstChild!.type.name).toBe('tableHeader')
    expect(column.doc.firstChild!.firstChild!.child(1).type.name).toBe('tableCell')
    expect(column.doc.textContent).toBe(original.doc.textContent)
    validateEditorDocument(column.doc.toJSON() as DocNode)
    undoTo(column, both)
  })
  it('reorders whole rows and columns preserving attributes and a single undo', () => {
    const original = state()
    const rows = original.apply(reorderTable(original, 0, 'row', 1, 2)!)
    expect(rows.doc.firstChild!.child(2).toJSON()).toEqual(table.child(1).toJSON())
    undoTo(rows, original)
    const columns = original.apply(reorderTable(original, 0, 'column', 0, 2)!)
    expect(columns.doc.firstChild!.firstChild!.textContent).toBe('BCA')
    expect(columns.doc.firstChild!.child(1).child(2).attrs).toEqual(
      table.child(1).firstChild!.attrs,
    )
    validateEditorDocument(columns.doc.toJSON() as DocNode)
    undoTo(columns, original)
    expect(reorderTable(original, 0, 'column', 1, 1)).toBeNull()
  })
  it('moves merged-cell groups without splitting or losing their content and widths', () => {
    const merged = schema.node('table', null, [
      schema.node('tableRow', null, [
        cell('AB', false, { colspan: 2, colwidth: [120, 160] }),
        cell('C'),
      ]),
      schema.node('tableRow', null, [
        cell('A1', false, { colwidth: [120] }),
        cell('B1', false, { colwidth: [160] }),
        cell('C1'),
      ]),
    ])
    const original = state(merged)
    const changed = original.apply(reorderTable(original, 0, 'column', 0, 2)!)
    const result = changed.doc.firstChild!
    expect(result.firstChild!.textContent).toBe('CAB')
    expect(result.firstChild!.child(1).attrs).toMatchObject({ colspan: 2, colwidth: [120, 160] })
    expect(TableMap.get(result).problems).toBeNull()
    validateEditorDocument(changed.doc.toJSON() as DocNode)
    undoTo(changed, original)
  })
  it('keeps enabled header axes fixed while body axes can still reorder', () => {
    const original = state()
    expect(reorderTable(original, 0, 'row', 0, 2)).toBeNull()
    expect(reorderTable(original, 0, 'row', 2, 0)).toBeNull()
    const both = original.apply(toggleTableHeader(original, 0, 'column')!)
    expect(reorderTable(both, 0, 'column', 0, 2)).toBeNull()
    expect(reorderTable(both, 0, 'column', 2, 0)).toBeNull()
    const changed = both.apply(reorderTable(both, 0, 'column', 1, 2)!)
    for (let row = 0; row < table.childCount; row++)
      expect(changed.doc.firstChild!.child(row).firstChild!.toJSON()).toEqual(
        both.doc.firstChild!.child(row).firstChild!.toJSON(),
      )
    undoTo(changed, both)
  })
  it('does not move a merged group that crosses the fixed header', () => {
    const merged = schema.node('table', null, [
      schema.node('tableRow', null, [
        cell('Header A', true, { rowspan: 2 }),
        cell('Header B', true),
      ]),
      schema.node('tableRow', null, [cell('B1')]),
      schema.node('tableRow', null, [cell('A2'), cell('B2')]),
    ])
    expect(reorderTable(state(merged), 0, 'row', 1, 2)).toBeNull()
  })
})
