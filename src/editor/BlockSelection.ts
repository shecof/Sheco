import { Extension } from '@tiptap/core'
import {
  Plugin,
  PluginKey,
  TextSelection,
  type EditorState,
  type Transaction,
} from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import { Fragment, Slice, type Node as PMNode } from '@tiptap/pm/model'
import { closeHistory } from '@tiptap/pm/history'

export const blockSelectionKey = new PluginKey<number[]>('blockSelection')
export const selectedBlocks = (state: EditorState) => blockSelectionKey.getState(state) ?? []
export function topBlocks(doc: PMNode) {
  const blocks: { pos: number; node: PMNode }[] = []
  doc.forEach((node, pos) => blocks.push({ node, pos }))
  return blocks
}
// List items and collapsible content expose their children as independent blocks.
export function selectableBlocks(doc: PMNode) {
  const blocks: { pos: number; node: PMNode }[] = []
  function visit(parent: PMNode, start: number, independent: boolean) {
    parent.forEach((node, offset) => {
      const pos = start + offset
      const list = ['bulletList', 'orderedList', 'taskList', 'listItem', 'taskItem'].includes(
        node.type.name,
      )
      const details = node.type.name === 'details'
      const content = node.type.name === 'detailsContent'
      if (parent === doc || (independent && !list)) blocks.push({ pos, node })
      if (list || details || content) visit(node, pos + 1, list || content)
    })
  }
  visit(doc, 0, false)
  return blocks
}
export function blockNodes(doc: PMNode, positions: number[]) {
  const blocks = positions
    .flatMap((pos) => {
      const node = doc.nodeAt(pos)
      return node?.isBlock ? [{ pos, node }] : []
    })
    .sort((a, b) => a.pos - b.pos)
  return blocks.filter(
    (block) =>
      !blocks.some(
        (parent) => parent.pos < block.pos && parent.pos + parent.node.nodeSize > block.pos,
      ),
  )
}
export function selectBlocks(view: EditorView, positions: number[]) {
  view.dispatch(view.state.tr.setMeta(blockSelectionKey, positions).setMeta('addToHistory', false))
}
export function deleteBlocks(state: EditorState, positions: number[]) {
  const tr = closeHistory(state.tr)
  for (const { pos, node } of blockNodes(state.doc, positions).reverse())
    tr.delete(pos, pos + node.nodeSize)
  tr.setSelection(
    TextSelection.near(tr.doc.resolve(Math.min(positions[0] ?? 0, tr.doc.content.size))),
  )
  return tr.setMeta(blockSelectionKey, [])
}
export function blockSlice(state: EditorState, positions: number[]) {
  return new Slice(Fragment.from(blockNodes(state.doc, positions).map((block) => block.node)), 0, 0)
}
export function duplicateBlocks(state: EditorState, positions: number[]) {
  const blocks = blockNodes(state.doc, positions)
  const tr = closeHistory(state.tr)
  if (!blocks.length) return tr
  const insertion = blocks.at(-1)!.pos + blocks.at(-1)!.node.nodeSize
  tr.insert(insertion, Fragment.from(blocks.map((block) => block.node)))
  return tr.setMeta(blockSelectionKey, [])
}
function copyBlocks(view: EditorView, event: ClipboardEvent, cut: boolean) {
  const positions = selectedBlocks(view.state)
  if (!positions.length || !event.clipboardData) return false
  const slice = blockSlice(view.state, positions)
  if (!slice.content.size) return false
  const { dom, text } = view.serializeForClipboard(slice)
  event.clipboardData.clearData()
  event.clipboardData.setData('text/html', dom.innerHTML)
  event.clipboardData.setData('text/plain', text)
  event.preventDefault()
  if (cut) {
    view.dispatch(deleteBlocks(view.state, positions))
    view.dispatch(closeHistory(view.state.tr))
  }
  return true
}
// Text drops belong after the hovered block, inside its nearest list item.
export function listItemDropTarget(doc: PMNode, position: number) {
  const $pos = doc.resolve(position)
  for (let depth = $pos.depth; depth > 0; depth--) {
    const item = $pos.node(depth)
    if (!['listItem', 'taskItem'].includes(item.type.name)) continue
    const itemPos = $pos.before(depth)
    if ($pos.depth > depth)
      return { itemPos, blockPos: $pos.before(depth + 1), pos: $pos.after(depth + 1) }
    // A boundary (including an empty item) still keeps the required leading paragraph.
    const index = Math.max(0, $pos.index(depth) - 1)
    let blockPos = $pos.start(depth)
    for (let i = 0; i < index; i++) blockPos += item.child(i).nodeSize
    return { itemPos, blockPos, pos: blockPos + item.child(index).nodeSize }
  }
  return null
}
export function moveBlocks(state: EditorState, positions: number[], target: number): Transaction {
  const blocks = blockNodes(state.doc, positions)
  const tr = closeHistory(state.tr)
  if (!blocks.length) return tr
  if (blocks.some(({ pos, node }) => target > pos && target < pos + node.nodeSize)) return tr
  const first = blocks[0].pos
  const last = blocks[blocks.length - 1].pos + blocks[blocks.length - 1].node.nodeSize
  const contiguous = blocks.reduce((size, block) => size + block.node.nodeSize, 0) === last - first
  if (contiguous && target >= first && target <= last) return tr
  const content = Fragment.from(blocks.map((b) => b.node))
  for (const { pos, node } of [...blocks].reverse()) tr.delete(pos, pos + node.nodeSize)
  const insertion = tr.mapping.map(target, -1)
  tr.insert(insertion, content)
  const next: number[] = []
  let pos = insertion
  for (const block of blocks) {
    next.push(pos)
    pos += block.node.nodeSize
  }
  tr.setSelection(TextSelection.near(tr.doc.resolve(insertion)))
  return tr.setMeta(blockSelectionKey, next)
}

type Options = {
  handlePosition: () => number | null
  openMenu: (x: number, y: number, pos: number) => void
  dragLabel: (count: number) => string
}
export const BlockSelection = Extension.create<Options>({
  name: 'blockSelection',
  priority: 1000,
  addOptions() {
    return {
      handlePosition: () => null,
      openMenu: () => {},
      dragLabel: (count) => `${count} blocks`,
    }
  },
  addProseMirrorPlugins() {
    const options = this.options
    return [
      new Plugin<number[]>({
        key: blockSelectionKey,
        state: {
          init: () => [],
          apply(tr, value) {
            const explicit = tr.getMeta(blockSelectionKey) as number[] | undefined
            const positions =
              explicit ??
              value.flatMap((pos) => {
                const mapped = tr.mapping.mapResult(pos, 1)
                return mapped.deleted ? [] : [mapped.pos]
              })
            const valid = new Set(selectableBlocks(tr.doc).map((b) => b.pos))
            return [...new Set(positions)].filter((pos) => valid.has(pos)).sort((a, b) => a - b)
          },
        },
        props: {
          decorations(state) {
            return DecorationSet.create(
              state.doc,
              selectedBlocks(state).flatMap((pos) => {
                const node = state.doc.nodeAt(pos)
                return node
                  ? [
                      Decoration.node(pos, pos + node.nodeSize, {
                        class:
                          'block-is-selected' +
                          ([
                            'paragraph',
                            'heading',
                            'blockquote',
                            'bulletList',
                            'orderedList',
                            'taskList',
                          ].includes(node.type.name)
                            ? ' block-text-is-selected'
                            : ''),
                      }),
                    ]
                  : []
              }),
            )
          },
          handleDOMEvents: {
            copy: (view, event) => copyBlocks(view, event, false),
            cut: (view, event) => copyBlocks(view, event, true),
          },
          handleKeyDown(view, event) {
            if (
              !event.isComposing &&
              (event.ctrlKey || event.metaKey) &&
              !event.altKey &&
              (event.key.toLowerCase() === 'd' || event.code === 'KeyD')
            ) {
              event.preventDefault()
              let positions = selectedBlocks(view.state)
              if (!positions.length) {
                const position = view.state.selection.from
                const block = selectableBlocks(view.state.doc)
                  .reverse()
                  .find(({ pos, node }) => position >= pos && position < pos + node.nodeSize)
                if (block) positions = [block.pos]
              }
              view.dispatch(duplicateBlocks(view.state, positions))
              view.dispatch(closeHistory(view.state.tr))
              return true
            }
            if (!selectedBlocks(view.state).length || event.isComposing) return false
            if (event.key === 'Delete' || event.key === 'Backspace') {
              event.preventDefault()
              view.dispatch(deleteBlocks(view.state, selectedBlocks(view.state)))
              view.dispatch(closeHistory(view.state.tr))
              return true
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              selectBlocks(view, [])
              return true
            }
            // Typing after a block selection starts a new paragraph and preserves the blocks.
            if (
              !(event.metaKey || event.ctrlKey || event.altKey) &&
              (event.key.length === 1 || event.key === 'Enter')
            ) {
              const blocks = blockNodes(view.state.doc, selectedBlocks(view.state))
              const last = blocks[blocks.length - 1]
              const pos = last.pos + last.node.nodeSize
              const tr = closeHistory(view.state.tr).insert(
                pos,
                view.state.schema.nodes.paragraph.create(),
              )
              tr.setSelection(TextSelection.create(tr.doc, pos + 1)).setMeta(blockSelectionKey, [])
              view.dispatch(tr)
              if (event.key === 'Enter') {
                event.preventDefault()
                return true
              }
              return false
            }
            if (
              !(event.metaKey || event.ctrlKey || event.altKey) &&
              !['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(event.key)
            )
              selectBlocks(view, [])
            return false
          },
        },
        view(view) {
          let scope: HTMLElement | null = null
          const rectangle = document.createElement('div')
          rectangle.className = 'block-selection-rectangle'
          const marker = document.createElement('div')
          marker.className = 'block-batch-drop-marker'
          const token = crypto.randomUUID()
          const mime = 'application/x-sheco-blocks'
          let marquee: {
            x: number
            y: number
            clientX: number
            clientY: number
            initial: number[]
            active: boolean
            pointer: number
            caret?: number
          } | null = null
          let dragging = false
          let target = 0
          let ghost: HTMLElement | null = null
          let frame = 0
          const domBlocks = () =>
            selectableBlocks(view.state.doc).flatMap((b) => {
              const dom = view.nodeDOM(b.pos)
              if (!(dom instanceof HTMLElement)) return []
              const rect = dom.getBoundingClientRect()
              return rect.width > 0 && rect.height > 0 ? [{ ...b, dom, rect }] : []
            })
          const allowed = (event: Event) => {
            scope = view.dom.closest('.content-scroll') as HTMLElement | null
            return (
              event.target instanceof Element &&
              !!scope?.contains(event.target) &&
              !event.target.closest('.popover,.modal-overlay,.command-palette,.format-toolbar')
            )
          }
          const interactive = (target: Element) =>
            !!target.closest('button,input,textarea,select,a,[role="slider"],.drag-handle')
          function listTarget(event: DragEvent) {
            const items: { pos: number; node: PMNode; rect: DOMRect; text: DOMRect }[] = []
            view.state.doc.descendants((node, pos) => {
              if (!['listItem', 'taskItem'].includes(node.type.name)) return
              const dom = view.nodeDOM(pos)
              const paragraph = view.nodeDOM(pos + 1)
              if (dom instanceof HTMLElement && paragraph instanceof HTMLElement)
                items.push({
                  pos,
                  node,
                  rect: dom.getBoundingClientRect(),
                  text: paragraph.getBoundingClientRect(),
                })
            })
            // Prefer the deepest item. Its text column accepts nesting; the marker gutter
            // still allows moving a block outside the whole list. Include the gap below a row.
            const item = items
              .reverse()
              .find(
                ({ rect, text }) =>
                  event.clientX >= text.left &&
                  event.clientX <= rect.right &&
                  event.clientY >= rect.top &&
                  event.clientY <= rect.bottom + 8,
              )
            if (!item) return null
            let hovered: { pos: number; node: PMNode; rect: DOMRect } | null = null
            item.node.forEach((node, offset) => {
              const pos = item.pos + 1 + offset
              const dom = view.nodeDOM(pos)
              if (!(dom instanceof HTMLElement)) return
              const rect = dom.getBoundingClientRect()
              if (!hovered || event.clientY >= rect.top) hovered = { pos, node, rect }
            })
            const block = hovered as { pos: number; node: PMNode; rect: DOMRect } | null
            if (!block) return null
            const target = listItemDropTarget(view.state.doc, block.pos + 1)
            if (!target) return null
            const before =
              !block.node.isTextblock && event.clientY < (block.rect.top + block.rect.bottom) / 2
            return {
              pos: before ? block.pos : target.pos,
              left: item.text.left,
              right: item.rect.right,
              y: before ? block.rect.top - 4 : block.rect.bottom + 4,
            }
          }
          function blank(event: PointerEvent) {
            const target = event.target as Element
            if (interactive(target)) return false
            if (
              target.closest(
                '.page-heading,.page-properties,.subpages-section,.page-outline,.table-controls',
              )
            )
              return false
            // Only the side gutters start a marquee. Whitespace inside the document belongs
            // to native text selection, including short links and empty paragraphs.
            const bounds = view.dom.getBoundingClientRect()
            return event.clientX < bounds.left || event.clientX > bounds.right
          }
          function renderMarquee() {
            if (!marquee || !scope) return
            const x = marquee.x - scope.scrollLeft
            const y = marquee.y - scope.scrollTop
            const left = Math.min(x, marquee.clientX),
              top = Math.min(y, marquee.clientY)
            const right = Math.max(x, marquee.clientX),
              bottom = Math.max(y, marquee.clientY)
            Object.assign(rectangle.style, {
              left: `${left}px`,
              top: `${top}px`,
              width: `${right - left}px`,
              height: `${bottom - top}px`,
            })
            const intersecting = domBlocks().filter(
              ({ rect: r }) =>
                r.right >= left && r.left <= right && r.bottom >= top && r.top <= bottom,
            )
            const positions = intersecting
              .filter(
                (parent) =>
                  !intersecting.some(
                    (child) =>
                      child.pos > parent.pos && child.pos < parent.pos + parent.node.nodeSize,
                  ),
              )
              .map((b) => b.pos)
            const next = [...new Set([...marquee.initial, ...positions])].sort((a, b) => a - b)
            if (next.join() !== selectedBlocks(view.state).join()) selectBlocks(view, next)
          }
          function scrollSelection() {
            frame = 0
            if (!marquee?.active || !scope) return
            const bounds = scope.getBoundingClientRect()
            const offset =
              marquee.clientY < bounds.top + 36
                ? -12
                : marquee.clientY > bounds.bottom - 36
                  ? 12
                  : 0
            if (offset) scope.scrollTop += offset
            renderMarquee()
            frame = requestAnimationFrame(scrollSelection)
          }
          function down(event: PointerEvent) {
            if (event.button !== 0 || !allowed(event) || !scope) return
            if (!blank(event)) {
              const target = event.target as Element
              if (
                (event.shiftKey || event.metaKey || event.ctrlKey) &&
                target.closest('.image-frame')
              )
                return
              const picture = target.closest('.image-frame > img')
              if (picture) {
                const block = domBlocks()
                  .reverse()
                  .find((b) => b.dom.contains(picture))
                if (block && selectedBlocks(view.state).includes(block.pos)) return
              }
              if (!interactive(target) || (view.dom.contains(target) && target.closest('a')))
                selectBlocks(view, [])
              return
            }
            event.preventDefault()
            const paragraph = (event.target as Element).closest('p')
            const caret =
              paragraph?.parentElement === view.dom
                ? !paragraph.textContent
                  ? view.posAtDOM(paragraph, 0)
                  : view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
                : undefined
            marquee = {
              x: event.clientX + scope.scrollLeft,
              y: event.clientY + scope.scrollTop,
              clientX: event.clientX,
              clientY: event.clientY,
              initial: event.shiftKey ? selectedBlocks(view.state) : [],
              active: false,
              pointer: event.pointerId,
              caret,
            }
          }
          function move(event: PointerEvent) {
            if (!marquee || event.pointerId !== marquee.pointer) return
            marquee.clientX = event.clientX
            marquee.clientY = event.clientY
            if (
              !marquee.active &&
              Math.hypot(
                event.clientX + (scope?.scrollLeft ?? 0) - marquee.x,
                event.clientY + (scope?.scrollTop ?? 0) - marquee.y,
              ) > 4
            ) {
              marquee.active = true
              document.body.appendChild(rectangle)
              document.body.classList.add('selecting-blocks')
              window.getSelection()?.removeAllRanges()
              frame = requestAnimationFrame(scrollSelection)
            }
            if (marquee.active) {
              event.preventDefault()
              renderMarquee()
            }
          }
          function end(event?: PointerEvent) {
            if (!marquee || (event && event.pointerId !== marquee.pointer)) return
            if (!marquee.active) {
              const tr = view.state.tr.setMeta(blockSelectionKey, []).setMeta('addToHistory', false)
              if (marquee.caret !== undefined)
                tr.setSelection(TextSelection.create(tr.doc, marquee.caret))
              view.dispatch(tr)
            }
            marquee = null
            cancelAnimationFrame(frame)
            rectangle.remove()
            document.body.classList.remove('selecting-blocks')
            view.focus()
          }
          function context(event: MouseEvent) {
            if (!allowed(event) || !view.dom.contains(event.target as Node)) return
            // Nested controls retain their own context menu (e.g. a database cell).
            if ((event.target as Element).closest('.database-table,input,textarea')) return
            const block = domBlocks()
              .reverse()
              .find((b) => b.dom.contains(event.target as Node))
            if (!block) return
            event.preventDefault()
            event.stopImmediatePropagation()
            if (!selectedBlocks(view.state).includes(block.pos)) selectBlocks(view, [])
            options.openMenu(event.clientX + 8, event.clientY, block.pos)
          }
          function startDrag(event: DragEvent) {
            if (!(event.target instanceof Element) || !event.dataTransfer) return
            const direct = view.dom.contains(event.target)
              ? event.target.closest(
                  '.image-frame > img[data-drag-handle],.attachment-open[data-drag-handle]',
                )
              : null
            if (!direct && !event.target.closest('.drag-handle')) return
            let positions = selectedBlocks(view.state)
            const pos = direct
              ? (domBlocks()
                  .reverse()
                  .find((b) => b.dom.contains(direct))?.pos ?? null)
              : options.handlePosition()
            if (pos === null) return
            if (!positions.includes(pos)) {
              positions = [pos]
              selectBlocks(view, positions)
            }
            if (!positions.length) return
            event.stopImmediatePropagation()
            dragging = true
            event.dataTransfer.setData(mime, token)
            event.dataTransfer.effectAllowed = 'move'
            ghost = document.createElement('div')
            ghost.className = 'block-drag-preview'
            const card = view.nodeDOM(pos)
            const surface =
              card instanceof HTMLElement ? card.querySelector('.attachment-open') : null
            if (surface instanceof HTMLElement) {
              ghost.classList.add('block-file-drag-preview')
              ghost.appendChild(surface.cloneNode(true))
              ghost.style.width = `${Math.min(surface.getBoundingClientRect().width, 320)}px`
            }
            if (!surface || positions.length > 1) {
              const label = document.createElement('span')
              label.textContent = options.dragLabel(positions.length)
              ghost.appendChild(label)
            }
            document.body.appendChild(ghost)
            event.dataTransfer.setDragImage(ghost, 12, 12)
            view.dragging = null
          }
          function over(event: DragEvent) {
            if (!dragging || !allowed(event) || !event.dataTransfer) return
            event.preventDefault()
            event.stopImmediatePropagation()
            event.dataTransfer.dropEffect = 'move'
            if (scope && event.type !== 'drop') {
              const r = scope.getBoundingClientRect()
              if (event.clientY < r.top + 36) scope.scrollTop -= 12
              else if (event.clientY > r.bottom - 36) scope.scrollTop += 12
            }
            const blocks = domBlocks()
            // Compact files share a row. A left/right destination belongs to the hovered
            // card, rather than the first block with the same vertical coordinate.
            const file = blocks.find(
              (b) =>
                b.node.type.name === 'attachment' &&
                ['compact', 'tile'].includes(b.node.attrs.display) &&
                event.clientX >= b.rect.left &&
                event.clientX <= b.rect.right &&
                event.clientY >= b.rect.top &&
                event.clientY <= b.rect.bottom,
            )
            if (file) {
              const before = event.clientX < (file.rect.left + file.rect.right) / 2
              target = file.pos + (before ? 0 : file.node.nodeSize)
              const surface = file.dom.querySelector('.attachment-open')!.getBoundingClientRect()
              Object.assign(marker.style, {
                left: `${(before ? surface.left : surface.right) - 1.5}px`,
                top: `${surface.top}px`,
                width: '3px',
                height: `${surface.height}px`,
              })
              if (!marker.isConnected) document.body.appendChild(marker)
              return
            }
            const next = blocks.find((b) => event.clientY < (b.rect.top + b.rect.bottom) / 2)
            const nested = listTarget(event)
            target = nested?.pos ?? next?.pos ?? view.state.doc.content.size
            const bounds = view.dom.getBoundingClientRect()
            const y = nested?.y ?? next?.rect.top ?? blocks.at(-1)?.rect.bottom ?? bounds.top
            Object.assign(marker.style, {
              left: `${nested?.left ?? bounds.left}px`,
              top: `${y - 1.5}px`,
              width: `${nested ? nested.right - nested.left : bounds.width}px`,
              height: '3px',
            })
            if (!marker.isConnected) document.body.appendChild(marker)
          }
          function finishDrag() {
            dragging = false
            marker.remove()
            ghost?.remove()
            ghost = null
          }
          function blur() {
            marquee = null
            cancelAnimationFrame(frame)
            rectangle.remove()
            document.body.classList.remove('selecting-blocks')
            finishDrag()
          }
          function drop(event: DragEvent) {
            if (!dragging || !allowed(event) || event.dataTransfer?.getData(mime) !== token) return
            over(event)
            event.preventDefault()
            event.stopImmediatePropagation()
            view.dispatch(moveBlocks(view.state, selectedBlocks(view.state), target))
            view.dispatch(closeHistory(view.state.tr))
            view.focus()
            finishDrag()
          }
          const bindings: [string, EventListener][] = [
            ['pointerdown', down as EventListener],
            ['pointermove', move as EventListener],
            ['pointerup', end as EventListener],
            ['pointercancel', end as EventListener],
            ['contextmenu', context as EventListener],
            ['dragstart', startDrag as EventListener],
            ['dragenter', over as EventListener],
            ['dragover', over as EventListener],
            ['drop', drop as EventListener],
            ['dragend', finishDrag],
          ]
          for (const [name, handler] of bindings) document.addEventListener(name, handler, true)
          window.addEventListener('blur', blur)
          return {
            destroy() {
              for (const [name, handler] of bindings)
                document.removeEventListener(name, handler, true)
              window.removeEventListener('blur', blur)
              cancelAnimationFrame(frame)
              rectangle.remove()
              marker.remove()
              ghost?.remove()
              document.body.classList.remove('selecting-blocks')
            },
          }
        },
      }),
    ]
  },
})
