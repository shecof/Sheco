import { describe, expect, it } from 'vitest'
import { Schema } from '@tiptap/pm/model'
import { EditorState } from '@tiptap/pm/state'
import { history, undo } from '@tiptap/pm/history'
import {
  topBlocks,
  selectableBlocks,
  moveBlocks,
  deleteBlocks,
  listItemDropTarget,
  duplicateBlocks,
  blockSlice,
} from '../src/editor/BlockSelection'
const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'text*' },
    text: {},
    orderedList: { group: 'block', content: 'listItem+' },
    bulletList: { group: 'block', content: 'listItem+' },
    taskList: { group: 'block', content: 'taskItem+' },
    listItem: { content: 'paragraph block*' },
    taskItem: { content: 'paragraph block*', attrs: { checked: { default: false } } },
    details: {
      group: 'block',
      content: 'detailsSummary detailsContent',
      attrs: { open: { default: true } },
    },
    detailsSummary: { content: 'text*' },
    detailsContent: { content: 'block+' },
    image: { group: 'block', atom: true, attrs: { src: {}, caption: {} } },
    code: { group: 'block', content: 'text*', attrs: { title: {}, collapsed: {} } },
  },
})
const doc = schema.node('doc', null, [
  schema.node('paragraph', null, schema.text('Before')),
  schema.node('image', { src: 'original.png', caption: 'Caption' }),
  schema.node('paragraph', null, schema.text('Between')),
  schema.node('code', { title: 'Example', collapsed: true }, schema.text('a\nb')),
  schema.node('paragraph', null, schema.text('After')),
])
describe('block selection transactions', () => {
  it('copies and duplicates disjoint mixed blocks in order, keeps attributes and undoes the duplication once', () => {
    const state = EditorState.create({ schema, doc, plugins: [history()] })
    const positions = topBlocks(doc)
      .filter(({ node }) => ['image', 'code'].includes(node.type.name))
      .map(({ pos }) => pos)
    expect(
      blockSlice(state, positions.reverse()).content.eq(
        schema.node('doc', null, [doc.child(1), doc.child(3)]).content,
      ),
    ).toBe(true)
    const duplicated = state.apply(duplicateBlocks(state, positions))
    duplicated.doc.check()
    expect(duplicated.doc.childCount).toBe(doc.childCount + 2)
    expect(duplicated.doc.child(4).eq(doc.child(1))).toBe(true)
    expect(duplicated.doc.child(5).eq(doc.child(3))).toBe(true)
    let restored = duplicated
    expect(
      undo(duplicated, (tr) => {
        restored = duplicated.apply(tr)
      }),
    ).toBe(true)
    expect(restored.doc.eq(doc)).toBe(true)
  })
  it('duplicates a list child without losing the list image or selecting an ancestor twice', () => {
    const original = schema.node(
      'doc',
      null,
      schema.node('orderedList', null, schema.node('listItem', null, [doc.child(0), doc.child(1)])),
    )
    const state = EditorState.create({ schema, doc: original })
    const paragraph = selectableBlocks(original).find(({ node }) => node.type.name === 'paragraph')!
    const duplicated = state.apply(duplicateBlocks(state, [paragraph.pos]))
    duplicated.doc.check()
    expect(duplicated.doc.firstChild!.firstChild!.childCount).toBe(3)
    expect(duplicated.doc.firstChild!.firstChild!.lastChild!.eq(doc.child(1))).toBe(true)
    const slice = blockSlice(state, [0, paragraph.pos])
    expect(slice.content.childCount).toBe(1)
    expect(slice.content.firstChild!.eq(original.firstChild!)).toBe(true)
  })
  it('selects and moves a picture out of nested collapsible content without moving its summary or siblings', () => {
    const p = (value: string) => schema.node('paragraph', null, schema.text(value))
    const picture = schema.node('image', { src: 'original.png', caption: 'Caption' })
    const fold = (title: string, children: ReturnType<typeof schema.node>[]) =>
      schema.node('details', { open: true }, [
        schema.node('detailsSummary', null, schema.text(title)),
        schema.node('detailsContent', null, children),
      ])
    const original = schema.node('doc', null, [
      fold('Outer', [p('Context'), fold('Inner', [picture]), p('After picture')]),
      p('End'),
    ])
    const blocks = selectableBlocks(original)
    const image = blocks.find((block) => block.node.type.name === 'image')!
    expect(image).toBeDefined()
    expect(
      blocks.some((block) => ['detailsSummary', 'detailsContent'].includes(block.node.type.name)),
    ).toBe(false)
    const state = EditorState.create({ schema, doc: original, plugins: [history()] })
    const moved = state.apply(moveBlocks(state, [image.pos], original.content.size))
    moved.doc.check()
    expect(moved.doc.lastChild!.eq(picture)).toBe(true)
    expect(moved.doc.firstChild!.attrs.open).toBe(true)
    expect(moved.doc.firstChild!.textContent).toBe('OuterContextInnerAfter picture')
    expect(moved.doc.firstChild!.lastChild!.child(1).lastChild!.firstChild!.type.name).toBe(
      'paragraph',
    )
    let restored = moved
    expect(
      undo(moved, (tr) => {
        restored = moved.apply(tr)
      }),
    ).toBe(true)
    expect(restored.doc.eq(original)).toBe(true)
    const deleted = state.apply(deleteBlocks(state, [image.pos]))
    deleted.doc.check()
    expect(deleted.doc.firstChild!.textContent).toBe(original.firstChild!.textContent)
    expect(deleted.doc.firstChild!.lastChild!.childCount).toBe(3)
  })
  it.each(['orderedList', 'bulletList', 'taskList'])(
    'moves a mixed group below a %s item without an extra paragraph, retains its sibling, and undoes once',
    (type) => {
      const itemType = type === 'taskList' ? 'taskItem' : 'listItem'
      const paragraph = schema.node('paragraph', null, schema.text('Target text'))
      const sibling = schema.node(itemType, { checked: true }, [
        schema.node('paragraph', null, schema.text('Sibling')),
        schema.node('paragraph', null, schema.text('Details')),
      ])
      const image = doc.child(1),
        code = doc.child(3)
      const original = schema.node('doc', null, [
        image,
        doc.child(0),
        code,
        schema.node(type, null, [schema.node(itemType, { checked: true }, paragraph), sibling]),
        doc.child(4),
      ])
      const blocks = selectableBlocks(original)
      const target = listItemDropTarget(
        original,
        blocks.find((b) => b.node.eq(paragraph))!.pos + 2,
      )!
      const state = EditorState.create({ schema, doc: original, plugins: [history()] })
      const moved = state.apply(
        moveBlocks(
          state,
          topBlocks(original)
            .filter((b) => ['image', 'code'].includes(b.node.type.name))
            .map((b) => b.pos),
          target.pos,
        ),
      )
      moved.doc.check()
      const list = topBlocks(moved.doc).find((b) => b.node.type.name === type)!.node
      expect(
        list.firstChild!.content.eq(
          schema.node(itemType, { checked: true }, [paragraph, image, code]).content,
        ),
      ).toBe(true)
      expect(list.child(1).eq(sibling)).toBe(true)
      if (type === 'taskList') expect(list.firstChild!.attrs.checked).toBe(true)
      let restored = moved
      expect(
        undo(moved, (tr) => {
          restored = moved.apply(tr)
        }),
      ).toBe(true)
      expect(restored.doc.eq(original)).toBe(true)
    },
  )

  it('chooses the nearest nested item, keeps later item blocks, and accepts empty item boundaries', () => {
    const p = (text = '') => schema.node('paragraph', null, text ? schema.text(text) : undefined)
    const nestedText = p('Nested target'),
      details = p('Keep details')
    const nested = schema.node(
      'bulletList',
      null,
      schema.node('listItem', null, [nestedText, details]),
    )
    const original = schema.node('doc', null, [
      schema.node('orderedList', null, schema.node('listItem', null, [p('Parent'), nested])),
      doc.child(1),
    ])
    const paragraphPos = selectableBlocks(original).find((b) => b.node.eq(nestedText))!.pos
    const target = listItemDropTarget(original, paragraphPos + 2)!
    const state = EditorState.create({ schema, doc: original })
    const imagePos = topBlocks(original).at(-1)!.pos
    const moved = state.apply(moveBlocks(state, [imagePos], target.pos))
    moved.doc.check()
    const parent = moved.doc.firstChild!.firstChild!
    expect(parent.firstChild!.textContent).toBe('Parent')
    expect(parent.child(1).firstChild!.childCount).toBe(3)
    expect(parent.child(1).firstChild!.child(1).eq(doc.child(1))).toBe(true)
    expect(parent.child(1).firstChild!.lastChild!.eq(details)).toBe(true)
    const empty = schema.node(
      'doc',
      null,
      schema.node('taskList', null, schema.node('taskItem', { checked: true }, p())),
    )
    expect(listItemDropTarget(empty, 2)).toEqual({ itemPos: 1, blockPos: 2, pos: 4 })
    expect(listItemDropTarget(empty, 3)).toEqual({ itemPos: 1, blockPos: 2, pos: 4 })
    expect(listItemDropTarget(doc, 2)).toBeNull()
  })

  it('treats a drop inside any selected ancestor as a no-op for a disjoint group', () => {
    const list = schema.node(
      'orderedList',
      null,
      schema.node('listItem', null, schema.node('paragraph', null, schema.text('Target'))),
    )
    const original = schema.node('doc', null, [list, doc.child(0), doc.child(1)])
    const state = EditorState.create({ schema, doc: original })
    const tr = moveBlocks(state, [0, topBlocks(original).at(-1)!.pos], 4)
    expect(tr.docChanged).toBe(false)
    expect(tr.doc.eq(original)).toBe(true)
  })

  it('selects, deletes, moves and undoes an image inside a list without selecting or erasing its siblings', () => {
    const nested = schema.node('doc', null, [
      schema.node('orderedList', null, [
        schema.node('listItem', null, [
          schema.node('paragraph', null, schema.text('Item one')),
          schema.node('image', { src: 'one.png', caption: 'Nested caption' }),
          schema.node('paragraph', null, schema.text('Details')),
        ]),
        schema.node('listItem', null, schema.node('paragraph', null, schema.text('Item two'))),
      ]),
      schema.node('paragraph', null, schema.text('After')),
    ])
    const state = EditorState.create({ schema, doc: nested, plugins: [history()] })
    const image = selectableBlocks(nested).find((b) => b.node.type.name === 'image')!
    const deleted = state.apply(deleteBlocks(state, [image.pos]))
    expect(deleted.doc.textContent).toBe(nested.textContent)
    expect(deleted.doc.firstChild!.childCount).toBe(2)
    expect(deleted.doc.firstChild!.firstChild!.childCount).toBe(2)
    deleted.doc.check()
    const firstParagraph = selectableBlocks(nested).find((b) => b.node.type.name === 'paragraph')!
    const textDeleted = state.apply(deleteBlocks(state, [firstParagraph.pos]))
    textDeleted.doc.check()
    expect(textDeleted.doc.textContent).toContain('DetailsItem twoAfter')
    expect(
      selectableBlocks(textDeleted.doc).find((b) => b.node.type.name === 'image')!.node.attrs
        .caption,
    ).toBe('Nested caption')
    const moved = state.apply(moveBlocks(state, [image.pos], nested.content.size))
    expect(moved.doc.lastChild!.type.name).toBe('image')
    expect(moved.doc.lastChild!.attrs.caption).toBe('Nested caption')
    moved.doc.check()
    let restored = moved
    expect(
      undo(moved, (tr) => {
        restored = moved.apply(tr)
      }),
    ).toBe(true)
    expect(restored.doc.eq(nested)).toBe(true)
  })

  it('moves a disjoint selection as one ordered group and undoes without losing media or code attributes', () => {
    const state = EditorState.create({ schema, doc, plugins: [history()] })
    const positions = topBlocks(doc)
      .filter((_, i) => i === 1 || i === 3)
      .map((b) => b.pos)
    const moved = state.apply(moveBlocks(state, positions, 0))
    expect(topBlocks(moved.doc).map((b) => b.node.type.name)).toEqual([
      'image',
      'code',
      'paragraph',
      'paragraph',
      'paragraph',
    ])
    expect(moved.doc.child(0).attrs.caption).toBe('Caption')
    expect(moved.doc.child(1).attrs.collapsed).toBe(true)
    expect(moved.doc.child(1).textContent).toBe('a\nb')
    let restored = moved
    expect(
      undo(moved, (tr) => {
        restored = moved.apply(tr)
      }),
    ).toBe(true)
    expect(restored.doc.eq(doc)).toBe(true)
  })
  it('deletes only selected blocks, keeps a valid empty document for select-all, and treats drops inside a selected run as a no-op', () => {
    const state = EditorState.create({ schema, doc })
    const blocks = topBlocks(doc)
    const deleted = state.apply(deleteBlocks(state, [blocks[1].pos, blocks[3].pos]))
    expect(deleted.doc.textContent).toBe('BeforeBetweenAfter')
    const empty = state.apply(
      deleteBlocks(
        state,
        blocks.map((b) => b.pos),
      ),
    )
    expect(empty.doc.childCount).toBe(1)
    expect(empty.doc.firstChild?.type.name).toBe('paragraph')
    expect(empty.doc.textContent).toBe('')
    expect(
      moveBlocks(
        state,
        blocks.map((b) => b.pos),
        doc.content.size,
      ).docChanged,
    ).toBe(false)
  })
})
