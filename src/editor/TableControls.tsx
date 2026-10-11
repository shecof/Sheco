import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import type { Transaction } from '@tiptap/pm/state'
import { TableMap } from '@tiptap/pm/tables'
import {
  MoveHorizontal,
  Table2,
  ChevronDown,
  GripVertical,
  GripHorizontal,
  Plus,
  MoreHorizontal,
  Trash2,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  AlignLeft,
  AlignCenter,
  AlignRight,
} from 'lucide-react'
import { useI18n } from '../i18n'
import { MenuItem, Popover } from '../components/ui'
import { addAlignedTableRowAfter, alignTableColumns, tableColumnAlignment } from './TableAlignment'
import {
  autoSizeTable,
  reorderTable,
  selectTableCell,
  tableHeaders,
  toggleTableHeader,
  type TableAxis,
} from './TableActions'

type Geometry = {
  pos: number
  x: number
  y: number
  width: number
  height: number
  rows: { start: number; end: number }[]
  columns: { start: number; end: number }[]
  row: number
  column: number
  activeRow: number | null
  activeColumn: number | null
  lastRow: boolean
  lastColumn: boolean
  rightVisible: boolean
}
type Menu = { kind: 'headers' | 'table' } | { kind: TableAxis; index: number }

function enclosingTable(editor: Editor, pos: number) {
  const resolved = editor.state.doc.resolve(pos)
  for (let depth = resolved.depth; depth > 0; depth--)
    if (resolved.node(depth).type.name === 'table') return resolved.before(depth)
  return null
}

function HeaderIcon({ axis }: { axis: TableAxis }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1" y="2" width="14" height="12" rx="1" stroke="currentColor" />
      <path d="M1 8h14M6 2v12" stroke="currentColor" />
      <rect
        x="1"
        y="2"
        width={axis === 'row' ? 14 : 5}
        height={axis === 'row' ? 6 : 12}
        fill="currentColor"
      />
    </svg>
  )
}

export function TableControls({ editor }: { editor: Editor }) {
  const { t } = useI18n()
  const layer = useRef<HTMLDivElement>(null)
  const hovered = useRef<HTMLTableCellElement | null>(null)
  const [geometry, setGeometry] = useState<Geometry | null>(null)
  const [menu, setMenu] = useState<Menu | null>(null)
  const menuRef = useRef<Menu | null>(null)
  menuRef.current = menu
  const anchor = useRef<HTMLElement | null>(null)
  const drag = useRef<{
    axis: TableAxis
    from: number
    to: number
    pointer: number
    x: number
    y: number
    active: boolean
    doc: Editor['state']['doc']
    pos: number
  } | null>(null)
  const [destination, setDestination] = useState<{
    axis: TableAxis
    index: number
    after: boolean
  } | null>(null)
  const suppressClick = useRef(false)

  useEffect(() => {
    let frame = 0
    let current: Geometry | null = null
    function measure() {
      frame = 0
      if (editor.isDestroyed || !layer.current) return
      const host = layer.current.parentElement!
      const cell = hovered.current?.isConnected ? hovered.current : null
      const pos = cell
        ? enclosingTable(editor, editor.view.posAtDOM(cell, 0))
        : enclosingTable(editor, editor.state.selection.from)
      const dom = pos === null ? null : editor.view.nodeDOM(pos)
      const wrapper = dom instanceof HTMLElement ? dom : null
      const table = wrapper?.querySelector('table')
      if (pos === null || !table || !wrapper) {
        current = null
        setGeometry(null)
        setMenu(null)
        return
      }
      if (current && current.pos !== pos) setMenu(null)
      const rect = table.getBoundingClientRect()
      const bounds = host.getBoundingClientRect()
      const clip = wrapper.getBoundingClientRect()
      const node = editor.state.doc.nodeAt(pos)!
      const map = TableMap.get(node)
      function cellArea(position: number) {
        const resolved = editor.state.doc.resolve(position)
        for (let depth = resolved.depth; depth > 0; depth--)
          if (['tableCell', 'tableHeader'].includes(resolved.node(depth).type.name))
            return map.findCell(resolved.before(depth) - pos! - 1)
        return null
      }
      const hoverArea = cell ? cellArea(editor.view.posAtDOM(cell, 0)) : null
      const caretArea =
        enclosingTable(editor, editor.state.selection.from) === pos
          ? cellArea(editor.state.selection.from)
          : null
      current = {
        pos,
        x: clip.left - bounds.left,
        y: rect.top - bounds.top,
        width: Math.min(wrapper.clientWidth, rect.right - clip.left),
        height: rect.height,
        rows: [...table.rows].map((r) => {
          const b = r.getBoundingClientRect()
          return { start: b.top - rect.top, end: b.bottom - rect.top }
        }),
        columns: [...table.querySelectorAll('col')].map((c) => {
          const b = c.getBoundingClientRect()
          return { start: b.left - clip.left, end: b.right - clip.left }
        }),
        row: caretArea?.top ?? hoverArea?.top ?? 0,
        column: caretArea?.left ?? hoverArea?.left ?? 0,
        activeRow: caretArea?.top ?? null,
        activeColumn: caretArea?.left ?? null,
        lastRow: hoverArea?.bottom === map.height,
        lastColumn: hoverArea?.right === map.width,
        rightVisible: rect.right <= clip.right + 1,
      }
      setGeometry(current)
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure)
    }
    function pointer(event: PointerEvent) {
      const target = event.target
      if (
        drag.current ||
        !(target instanceof Element) ||
        target.closest('.table-controls,.table-control-menu')
      )
        return
      const cell = target.closest<HTMLTableCellElement>('td,th')
      const next =
        cell && editor.view.dom.contains(cell) && cell.closest('.tableWrapper') ? cell : null
      if (!next && hovered.current && current && layer.current) {
        // Keep the hovered cell while crossing the gap to its edge strips or toolbar.
        const rect = layer.current.getBoundingClientRect()
        if (
          event.clientX >= rect.left - 25 &&
          event.clientX <= rect.right + 24 &&
          event.clientY >= rect.top - 66 &&
          event.clientY <= rect.bottom + 24
        )
          return
      }
      if (hovered.current === next) return
      hovered.current = next
      schedule()
    }
    function move(event: PointerEvent) {
      const gesture = drag.current
      if (!gesture || gesture.pointer !== event.pointerId || !current) return
      if (!gesture.active && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) < 4)
        return
      gesture.active = true
      event.preventDefault()
      window.getSelection()?.removeAllRanges()
      const bounds = layer.current!.getBoundingClientRect()
      const point =
        gesture.axis === 'row' ? event.clientY - bounds.top : event.clientX - bounds.left
      const items = gesture.axis === 'row' ? current.rows : current.columns
      let index = items.findIndex((item) => point < (item.start + item.end) / 2)
      if (index < 0) index = items.length
      const minimum = tableHeaders(editor.state, gesture.pos)[gesture.axis] ? 1 : 0
      index = Math.max(minimum, index)
      gesture.to = Math.max(
        minimum,
        Math.min(items.length - 1, index > gesture.from ? index - 1 : index),
      )
      setDestination({
        axis: gesture.axis,
        index: Math.min(index, items.length - 1),
        after: index === items.length,
      })
    }
    function end(event: PointerEvent) {
      const gesture = drag.current
      if (!gesture || gesture.pointer !== event.pointerId) return
      drag.current = null
      setDestination(null)
      if (!gesture.active) return
      suppressClick.current = true
      if (event.type !== 'pointercancel' && editor.state.doc === gesture.doc) {
        const tr = reorderTable(editor.state, gesture.pos, gesture.axis, gesture.from, gesture.to)
        if (tr) editor.view.dispatch(tr)
      }
      editor.view.focus()
    }
    const observer = new ResizeObserver(schedule)
    observer.observe(layer.current!.parentElement!)
    editor.on('transaction', schedule)
    document.addEventListener('pointermove', pointer)
    document.addEventListener('pointermove', move, { passive: false })
    document.addEventListener('pointerup', end)
    document.addEventListener('pointercancel', end)
    document.addEventListener('scroll', schedule, true)
    window.addEventListener('resize', schedule)
    schedule()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      editor.off('transaction', schedule)
      document.removeEventListener('pointermove', pointer)
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', end)
      document.removeEventListener('pointercancel', end)
      document.removeEventListener('scroll', schedule, true)
      window.removeEventListener('resize', schedule)
      drag.current = null
    }
  }, [editor])

  function dispatch(tr: Transaction | null) {
    if (tr) editor.view.dispatch(tr)
    editor.view.focus()
  }
  function select(row = geometry!.row, column = geometry!.column) {
    editor.view.dispatch(selectTableCell(editor.state, geometry!.pos, row, column))
  }
  function open(event: React.MouseEvent<HTMLButtonElement>, next: Menu) {
    if (
      suppressClick.current &&
      event.detail !== 0 &&
      (next.kind === 'row' || next.kind === 'column')
    ) {
      suppressClick.current = false
      return
    }
    suppressClick.current = false
    const previousAnchor = anchor.current
    anchor.current = event.currentTarget
    if (next.kind === 'row') select(next.index, 0)
    else if (next.kind === 'column') select(0, next.index)
    setMenu(
      menuRef.current?.kind === next.kind && previousAnchor === event.currentTarget ? null : next,
    )
  }
  function start(event: React.PointerEvent<HTMLButtonElement>, axis: TableAxis, from: number) {
    if (event.button !== 0) return
    event.preventDefault()
    suppressClick.current = false
    setMenu(null)
    select(axis === 'row' ? from : 0, axis === 'column' ? from : 0)
    drag.current = {
      axis,
      from,
      to: from,
      pointer: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      active: false,
      doc: editor.state.doc,
      pos: geometry!.pos,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const validGeometry =
    geometry &&
    geometry.pos <= editor.state.doc.content.size &&
    editor.state.doc.nodeAt(geometry.pos)?.type.name === 'table'
  const headers = validGeometry ? tableHeaders(editor.state, geometry.pos) : null
  const selectedAxis = menu && (menu.kind === 'row' || menu.kind === 'column') ? menu : null
  const marker =
    destination && geometry
      ? (destination.axis === 'row' ? geometry.rows : geometry.columns)[destination.index]
      : null
  return (
    <div
      ref={layer}
      className="table-controls"
      contentEditable={false}
      onKeyDown={(event) => {
        if (!(event.metaKey || event.ctrlKey)) return
        if (event.key.toLowerCase() === 'z') {
          event.preventDefault()
          if (event.shiftKey) editor.commands.redo()
          else editor.commands.undo()
          setMenu(null)
          editor.view.focus()
        }
      }}
      style={
        geometry
          ? { left: geometry.x, top: geometry.y, width: geometry.width, height: geometry.height }
          : { display: 'none' }
      }
    >
      {geometry && validGeometry && (
        <>
          <div
            className="table-tools"
            role="toolbar"
            aria-label={t('Table settings')}
            onMouseDown={(event) => event.preventDefault()}
          >
            <button
              type="button"
              aria-label={t('Auto-fit columns')}
              title={t('Auto-fit columns')}
              onClick={() => dispatch(autoSizeTable(editor.state, geometry.pos))}
            >
              <MoveHorizontal size={16} />
            </button>
            <span className="table-tools-divider" />
            <button
              type="button"
              aria-label={t('Table headers')}
              title={t('Table headers')}
              aria-expanded={menu?.kind === 'headers'}
              onClick={(event) => open(event, { kind: 'headers' })}
            >
              <Table2 size={16} />
              <ChevronDown size={12} />
            </button>
            <button
              type="button"
              aria-label={t('Table options')}
              title={t('Table options')}
              onClick={(event) => open(event, { kind: 'table' })}
            >
              <MoreHorizontal size={16} />
            </button>
          </div>
          {geometry.rows.map(
            (row, index) =>
              index === geometry.activeRow &&
              !(index === 0 && headers!.row) && (
                <button
                  key={index}
                  type="button"
                  className="table-axis-handle table-row-handle"
                  style={{ top: (row.start + row.end) / 2 - 11 }}
                  aria-label={t('Row {number} options', { number: index + 1 })}
                  title={t('Drag to reorder row · Click for options')}
                  onPointerDown={(event) => start(event, 'row', index)}
                  onClick={(event) => open(event, { kind: 'row', index })}
                >
                  <GripVertical size={14} />
                </button>
              ),
          )}
          {geometry.columns.map(
            (column, index) =>
              index === geometry.activeColumn &&
              !(index === 0 && headers!.column) &&
              (column.start + column.end) / 2 >= 0 &&
              (column.start + column.end) / 2 <= geometry.width && (
                <button
                  key={index}
                  type="button"
                  className="table-axis-handle table-column-handle"
                  style={{ left: (column.start + column.end) / 2 - 11 }}
                  aria-label={t('Column {number} options', { number: index + 1 })}
                  title={t('Drag to reorder column · Click for options')}
                  onPointerDown={(event) => start(event, 'column', index)}
                  onClick={(event) => open(event, { kind: 'column', index })}
                >
                  <GripHorizontal size={14} />
                </button>
              ),
          )}
          {geometry.lastRow && (
            <button
              type="button"
              className="table-add-row"
              aria-label={t('Add row')}
              title={t('Add row')}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                select(geometry.rows.length - 1, geometry.column)
                dispatch(addAlignedTableRowAfter(editor.state))
              }}
            >
              <Plus size={16} />
            </button>
          )}
          {geometry.lastColumn && geometry.rightVisible && (
            <button
              type="button"
              className="table-add-column"
              aria-label={t('Add column')}
              title={t('Add column')}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                select(geometry.row, geometry.columns.length - 1)
                editor.commands.addColumnAfter()
                editor.view.focus()
              }}
            >
              <Plus size={16} />
            </button>
          )}
          {marker && destination && (
            <div
              className={'table-reorder-marker ' + destination.axis}
              style={
                destination.axis === 'row'
                  ? { top: destination.after ? marker.end : marker.start }
                  : { left: destination.after ? marker.end : marker.start }
              }
            />
          )}
          {menu && (
            <Popover anchor={anchor} onClose={() => setMenu(null)} className="table-control-menu">
              {menu.kind === 'headers' &&
                (['row', 'column'] as const).map((axis) => (
                  <button
                    type="button"
                    key={axis}
                    className="table-header-toggle"
                    role="switch"
                    aria-checked={headers![axis]}
                    onClick={() => dispatch(toggleTableHeader(editor.state, geometry.pos, axis))}
                  >
                    <HeaderIcon axis={axis} />
                    <span>{t(axis === 'row' ? 'Header row' : 'Header column')}</span>
                    <span className={'switch-track' + (headers![axis] ? ' on' : '')} />
                  </button>
                ))}
              {selectedAxis && (
                <>
                  {selectedAxis.kind === 'column' && (
                    <div
                      className="table-column-alignment"
                      role="group"
                      aria-label={t('Column alignment')}
                    >
                      {(
                        [
                          ['left', 'Align column left', AlignLeft],
                          ['center', 'Align column center', AlignCenter],
                          ['right', 'Align column right', AlignRight],
                        ] as const
                      ).map(([align, label, Icon]) => (
                        <button
                          key={align}
                          type="button"
                          aria-label={t(label)}
                          title={t(label)}
                          aria-pressed={tableColumnAlignment(editor.state) === align}
                          onClick={() => dispatch(alignTableColumns(editor.state, align))}
                        >
                          <Icon size={16} />
                        </button>
                      ))}
                    </div>
                  )}
                  {[-1, 1].map((step) => {
                    const to = selectedAxis.index + step
                    const Icon =
                      selectedAxis.kind === 'row'
                        ? step < 0
                          ? ArrowUp
                          : ArrowDown
                        : step < 0
                          ? ArrowLeft
                          : ArrowRight
                    return (
                      <button
                        type="button"
                        className="menu-item"
                        key={step}
                        disabled={
                          to < (headers![selectedAxis.kind] ? 1 : 0) ||
                          to >=
                            (selectedAxis.kind === 'row' ? geometry.rows : geometry.columns).length
                        }
                        onClick={() => {
                          dispatch(
                            reorderTable(
                              editor.state,
                              geometry.pos,
                              selectedAxis.kind,
                              selectedAxis.index,
                              to,
                            ),
                          )
                          setMenu(null)
                        }}
                      >
                        <Icon size={16} />
                        <span>
                          {t(
                            selectedAxis.kind === 'row'
                              ? step < 0
                                ? 'Move up'
                                : 'Move down'
                              : step < 0
                                ? 'Move left'
                                : 'Move right',
                          )}
                        </span>
                      </button>
                    )
                  })}
                  <MenuItem
                    danger
                    icon={<Trash2 size={16} />}
                    onClick={() => {
                      select(
                        selectedAxis.kind === 'row' ? selectedAxis.index : 0,
                        selectedAxis.kind === 'column' ? selectedAxis.index : 0,
                      )
                      editor.commands[selectedAxis.kind === 'row' ? 'deleteRow' : 'deleteColumn']()
                      setMenu(null)
                      editor.view.focus()
                    }}
                  >
                    {t(selectedAxis.kind === 'row' ? 'Delete row' : 'Delete column')}
                  </MenuItem>
                </>
              )}
              {menu.kind === 'table' && (
                <MenuItem
                  danger
                  icon={<Trash2 size={16} />}
                  onClick={() => {
                    select()
                    editor.commands.deleteTable()
                    setMenu(null)
                    editor.view.focus()
                  }}
                >
                  {t('Delete table')}
                </MenuItem>
              )}
            </Popover>
          )}
        </>
      )}
    </div>
  )
}
