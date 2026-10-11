import { describe, expect, it } from 'vitest'
import { getSchema } from '@tiptap/core'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { history, undo } from '@tiptap/pm/history'
import { CellSelection, TableMap } from '@tiptap/pm/tables'
import { documentExtensions, validateEditorDocument } from '../src/editor/documentSchema'
import {
  addAlignedTableRowAfter,
  alignTableColumns,
  tableColumnAlignment,
} from '../src/editor/TableAlignment'
import { markdown } from '../src/shared/export'
import type { DocNode } from '../src/shared/model'

const schema = getSchema(documentExtensions())
const paragraph = (text: string) => schema.node('paragraph', null, schema.text(text))
const cell = (text: string, attrs = {}, header = false) =>
  schema.node(header ? 'tableHeader' : 'tableCell', attrs, paragraph(text))
const table = schema.node('table', null, [
  schema.node('tableRow', null, [cell('A', {}, true), cell('B', {}, true), cell('C', {}, true)]),
  schema.node('tableRow', null, [
    cell('A1', { rowspan: 2, colwidth: [100], align: 'right' }),
    cell('B1/C1', { colspan: 2, colwidth: [120, 140] }),
  ]),
  schema.node('tableRow', null, [cell('B2'), cell('C2')]),
])
const doc = schema.node('doc', null, [table])
const map = TableMap.get(table)

describe('simple table column alignment', () => {
  it('aligns the full column including its header and intersecting merged cells, with one undo', () => {
    const state = EditorState.create({
      schema,
      doc,
      selection: TextSelection.create(doc, 1 + map.map[1] + 2),
      plugins: [history()],
    })
    const changed = state.apply(alignTableColumns(state, 'center'))
    const result = changed.doc.firstChild!
    expect(result.nodeAt(map.map[1])!.attrs.align).toBe('center')
    expect(result.nodeAt(map.map[4])!.attrs.align).toBe('center')
    expect(result.nodeAt(map.map[7])!.attrs.align).toBe('center')
    expect(result.nodeAt(map.map[0])!.attrs.align).toBeNull()
    expect(result.nodeAt(map.map[2])!.attrs.align).toBeNull()
    expect(result.nodeAt(map.map[8])!.attrs.align).toBeNull()
    expect(result.nodeAt(map.map[3])!.attrs).toEqual(table.nodeAt(map.map[3])!.attrs)
    expect(result.nodeAt(map.map[4])!.attrs).toMatchObject({ colspan: 2, colwidth: [120, 140] })
    expect(changed.doc.textContent).toBe(doc.textContent)
    expect(tableColumnAlignment(changed)).toBe('center')
    validateEditorDocument(changed.doc.toJSON() as DocNode)
    let restored = changed
    expect(
      undo(changed, (tr) => {
        restored = changed.apply(tr)
      }),
    ).toBe(true)
    expect(restored.doc.toJSON()).toEqual(doc.toJSON())
  })
  it('handles a selection across columns and exports Markdown alignment markers', () => {
    const state = EditorState.create({
      schema,
      doc,
      selection: CellSelection.create(doc, 1 + map.map[0], 1 + map.map[2]),
    })
    const changed = state.apply(alignTableColumns(state, 'right'))
    expect(tableColumnAlignment(changed)).toBe('right')
    expect(markdown(changed.doc.toJSON() as DocNode)).toContain('| ---: | ---: | ---: |')
    const parsed = schema.nodeFromJSON(changed.doc.toJSON())
    expect(parsed.toJSON()).toEqual(changed.doc.toJSON())
  })
  it('keeps column alignment when adding a row, without changing existing spans or widths', () => {
    const state = EditorState.create({
      schema,
      doc,
      selection: TextSelection.create(doc, 1 + map.map[1] + 2),
    })
    const aligned = state.apply(alignTableColumns(state, 'center'))
    const changed = aligned.apply(addAlignedTableRowAfter(aligned)!)
    const result = changed.doc.firstChild!
    const nextMap = TableMap.get(result)
    expect(nextMap.height).toBe(map.height + 1)
    expect(result.child(1).content.size).toBeGreaterThan(0)
    expect(result.nodeAt(nextMap.map[4])!.attrs.align).toBe('center')
    expect(result.nodeAt(nextMap.map[3])!.attrs.align).toBeNull()
    expect(result.nodeAt(nextMap.map[5])!.attrs.align).toBeNull()
    expect(result.child(2).toJSON()).toEqual(aligned.doc.firstChild!.child(1).toJSON())
    expect(result.child(3).toJSON()).toEqual(aligned.doc.firstChild!.child(2).toJSON())
    validateEditorDocument(changed.doc.toJSON() as DocNode)
  })
  it('rejects invalid alignments while older tables keep valid default attributes', () => {
    const plain: DocNode = {
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [{ type: 'tableHeader', content: [{ type: 'paragraph' }] }],
            },
          ],
        },
      ],
    }
    expect(() => validateEditorDocument(plain)).not.toThrow()
    const header = plain.content![0].content![0].content![0]
    header.attrs = { align: 'justify' }
    expect(() => validateEditorDocument(plain)).toThrow('Invalid table column alignment')
    header.attrs = { align: ['left'] }
    expect(() => validateEditorDocument(plain)).toThrow('Invalid table column alignment')
  })
})
