import type { EditorState, Transaction } from '@tiptap/pm/state'
import { TextSelection } from '@tiptap/pm/state'
import { closeHistory } from '@tiptap/pm/history'
import { TableMap, moveTableRow, moveTableColumn, toggleHeader } from '@tiptap/pm/tables'

export type TableAxis = 'row' | 'column'

export function tableHeaders(state: EditorState, pos: number) {
  const table = state.doc.nodeAt(pos)!
  const map = TableMap.get(table)
  const header = (row: number, col: number) =>
    table.nodeAt(map.map[row * map.width + col])!.type.name === 'tableHeader'
  return {
    row: Array.from({ length: map.width }, (_, col) => header(0, col)).every(Boolean),
    column: Array.from({ length: map.height }, (_, row) => header(row, 0)).every(Boolean),
  }
}

export function selectTableCell(state: EditorState, pos: number, row = 0, column = 0) {
  const table = state.doc.nodeAt(pos)!
  const map = TableMap.get(table)
  const cell = map.map[row * map.width + column]
  return state.tr
    .setSelection(TextSelection.near(state.doc.resolve(pos + 1 + cell + 1)))
    .setMeta('addToHistory', false)
}

export function autoSizeTable(state: EditorState, pos: number) {
  const tr = closeHistory(state.tr)
  const table = state.doc.nodeAt(pos)!
  table.descendants((cell, offset) => {
    if (cell.type.spec.tableRole === 'cell' || cell.type.spec.tableRole === 'header_cell') {
      if (cell.attrs.colwidth != null)
        tr.setNodeMarkup(pos + 1 + offset, undefined, { ...cell.attrs, colwidth: null })
      return false
    }
  })
  return tr
}

export function toggleTableHeader(state: EditorState, pos: number, axis: TableAxis) {
  const selected = state.apply(selectTableCell(state, pos))
  let result: Transaction | null = null
  toggleHeader(axis)(selected, (tr) => {
    result = closeHistory(tr)
  })
  return result
}

export function reorderTable(
  state: EditorState,
  pos: number,
  axis: TableAxis,
  from: number,
  to: number,
) {
  if (from === to) return null
  const fixedHeader = tableHeaders(state, pos)[axis]
  if (fixedHeader && (from === 0 || to === 0)) return null
  const table = state.doc.nodeAt(pos)!
  const selected = state.apply(selectTableCell(state, pos))
  let result: Transaction | null = null
  const move = axis === 'row' ? moveTableRow : moveTableColumn
  move({ from, to })(selected, (tr) => {
    if (fixedHeader) {
      const moved = tr.doc.nodeAt(pos)!
      // A merged cell may expand the moved group into the header. Keep that axis fixed.
      if (axis === 'row' && !moved.firstChild!.eq(table.firstChild!)) return
      if (axis === 'column') {
        const before = TableMap.get(table),
          after = TableMap.get(moved)
        for (let row = 0; row < before.height; row++)
          if (
            !table
              .nodeAt(before.map[row * before.width])!
              .eq(moved.nodeAt(after.map[row * after.width])!)
          )
            return
      }
    }
    result = closeHistory(tr)
  })
  return result
}
