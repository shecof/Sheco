import { TableView } from '@tiptap/extension-table'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { columnResizingPluginKey, TableMap } from '@tiptap/pm/tables'
import type { EditorView } from '@tiptap/pm/view'

export class FilledTableView extends TableView {
  constructor(
    node: ProseMirrorNode,
    cellMinWidth: number,
    private view: EditorView,
    HTMLAttributes: Record<string, unknown> = {},
  ) {
    super(node, cellMinWidth, view, HTMLAttributes)
    this.syncColumns()
  }

  update(node: ProseMirrorNode) {
    if (!super.update(node)) return false
    this.syncColumns()
    return true
  }

  private syncColumns() {
    let fixed = true
    let column = 0
    this.node.firstChild?.forEach((cell) => {
      for (let i = 0; i < cell.attrs.colspan; i++, column++) {
        if (!cell.attrs.colwidth?.[i]) {
          fixed = false
          // Tiptap sets min-width for an automatic column but leaves its previous width.
          ;(this.colgroup.children[column] as HTMLTableColElement).style.width = ''
        }
      }
    })
    this.table.classList.toggle('table-fixed-columns', fixed)
  }

  stopEvent(event: Event) {
    if (event.type !== 'mousedown' || (event as MouseEvent).button !== 0) return false
    const resize = columnResizingPluginKey.getState(this.view.state)
    if (!resize || resize.activeHandle < 0 || resize.dragging) return false
    const cell = this.view.state.doc.resolve(resize.activeHandle)
    if (cell.node(-1) !== this.node || !this.table.classList.contains('table-fixed-columns'))
      return false
    const column =
      TableMap.get(this.node).colCount(cell.pos - cell.start(-1)) +
      cell.nodeAfter!.attrs.colspan -
      1
    if (column !== this.colgroup.childElementCount - 1) return false
    const width = this.colgroup.children[column].getBoundingClientRect().width
    // Start the existing resize gesture at the displayed width of the stretched column.
    queueMicrotask(() => {
      if (this.view.isDestroyed) return
      const current = columnResizingPluginKey.getState(this.view.state)
      if (current?.activeHandle !== resize.activeHandle || !current.dragging) return
      this.view.dispatch(
        this.view.state.tr.setMeta(columnResizingPluginKey, {
          setDragging: { ...current.dragging, startWidth: width },
        }),
      )
    })
    return false
  }
}
