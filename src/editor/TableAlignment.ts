import type { EditorState } from '@tiptap/pm/state'
import { closeHistory } from '@tiptap/pm/history'
import { addRowAfter, isInTable, selectedRect, TableMap } from '@tiptap/pm/tables'

export type ColumnAlignment = 'left' | 'center' | 'right'
function columnCells(state: EditorState) {
  if (!isInTable(state)) return null
  const rect = selectedRect(state)
  const positions = new Set<number>()
  for (let row = 0; row < rect.map.height; row++)
    for (let col = rect.left; col < rect.right; col++)
      positions.add(rect.map.map[row * rect.map.width + col])
  return { ...rect, positions }
}
export function alignTableColumns(state: EditorState, align: ColumnAlignment) {
  const cells = columnCells(state)
  const tr = closeHistory(state.tr)
  if (!cells) return tr
  for (const pos of cells.positions) {
    const cell = cells.table.nodeAt(pos)!
    tr.setNodeMarkup(cells.tableStart + pos, undefined, { ...cell.attrs, align })
  }
  return tr
}
export function tableColumnAlignment(state: EditorState): ColumnAlignment | null {
  const cells = columnCells(state)
  if (!cells) return null
  const values = new Set(
    [...cells.positions].map((pos) => cells.table.nodeAt(pos)!.attrs.align ?? 'left'),
  )
  return values.size === 1 ? [...values][0] : null
}
export function addAlignedTableRowAfter(state: EditorState) {
  if (!isInTable(state)) return null
  const before = selectedRect(state)
  let result: ReturnType<typeof alignTableColumns> | null = null
  addRowAfter(state, (tr) => {
    const table = tr.doc.nodeAt(before.tableStart - 1)!
    const map = TableMap.get(table)
    const positions = new Set<number>()
    for (let col = 0; col < map.width; col++) {
      const pos = map.map[before.bottom * map.width + col]
      // Cells spanning from an existing row keep their original attributes.
      if (positions.has(pos) || map.findCell(pos).top !== before.bottom) continue
      positions.add(pos)
      const source = before.table.nodeAt(
        before.map.map[(before.bottom - 1) * before.map.width + col],
      )!
      const cell = table.nodeAt(pos)!
      tr.setNodeMarkup(before.tableStart + pos, undefined, {
        ...cell.attrs,
        align: source.attrs.align,
      })
    }
    result = closeHistory(tr)
  })
  return result
}
