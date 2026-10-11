import { describe, expect, it } from 'vitest'
import { Schema } from '@tiptap/pm/model'
import { EditorState } from '@tiptap/pm/state'
import { history, undo } from '@tiptap/pm/history'
import { textMatches, replaceMatches } from '../src/editor/FindReplace'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    text: { group: 'inline' },
    hardBreak: { group: 'inline', inline: true },
    mention: { group: 'inline', inline: true, atom: true },
    codeBlock: { group: 'block', content: 'text*', code: true },
  },
  marks: { bold: {} },
})
describe('page find and replace', () => {
  it('finds literal Unicode text across marks, retains offsets and never crosses blocks or atoms', () => {
    const doc = schema.node('doc', null, [
      schema.node('paragraph', null, [
        schema.text('До При'),
        schema.text('вет', [schema.mark('bold')]),
        schema.text(' ПРИВЕТ 😀 [a.b] '),
        schema.text('end'),
        schema.node('hardBreak'),
        schema.text('start'),
        schema.node('mention'),
        schema.text('finish'),
      ]),
      schema.node('codeBlock', null, schema.text('Привет $&')),
    ])
    const matches = textMatches(doc, 'привет')
    expect(matches).toHaveLength(3)
    expect(matches[0]).toEqual({ from: 4, to: 10 })
    for (const match of matches)
      expect(doc.textBetween(match.from, match.to).toLowerCase()).toBe('привет')
    expect(textMatches(doc, 'Привет', true)).toHaveLength(2)
    expect(textMatches(doc, '[a.b]')).toHaveLength(1)
    for (const query of ['', 'endstart', 'startfinish', 'finishПривет'])
      expect(textMatches(doc, query)).toEqual([])
  })
  it('replaces all from the end with literal text, keeps unrelated marks, and undoes in one step', () => {
    const original = schema.node('doc', null, [
      schema.node('paragraph', null, [
        schema.text('keep', [schema.mark('bold')]),
        schema.text(' foo foo'),
      ]),
      schema.node('codeBlock', null, schema.text('foo')),
    ])
    const state = EditorState.create({ schema, doc: original, plugins: [history()] })
    const replaced = state.apply(replaceMatches(state, textMatches(original, 'foo'), '$& longer'))
    expect(replaced.doc.textContent).toBe('keep $& longer $& longer$& longer')
    expect(replaced.doc.firstChild!.firstChild!.marks).toEqual(
      original.firstChild!.firstChild!.marks,
    )
    replaced.doc.check()
    let restored = replaced
    expect(
      undo(replaced, (tr) => {
        restored = replaced.apply(tr)
      }),
    ).toBe(true)
    expect(restored.doc.eq(original)).toBe(true)
  })
  it('replaces one selected occurrence and supports an empty replacement', () => {
    const original = schema.node(
      'doc',
      null,
      schema.node('paragraph', null, schema.text('test TEST test')),
    )
    const state = EditorState.create({ schema, doc: original })
    const result = state.apply(replaceMatches(state, [textMatches(original, 'test')[1]], ''))
    expect(result.doc.textContent).toBe('test  test')
  })
})
