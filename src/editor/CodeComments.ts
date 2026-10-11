import { Plugin, PluginKey, TextSelection, type EditorState } from '@tiptap/pm/state'
import { Mapping } from '@tiptap/pm/transform'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'

export type CodeComment = { id: string; from: number; to: number; text: string }
export const codeCommentsKey = new PluginKey('codeComments')
export function codeCommentSelection(state: EditorState) {
  const { selection } = state
  if (
    !(selection instanceof TextSelection) ||
    selection.empty ||
    selection.$from.parent !== selection.$to.parent ||
    selection.$from.parent.type.name !== 'codeBlock'
  )
    return null
  return {
    pos: selection.$from.before(),
    from: selection.$from.parentOffset,
    to: selection.$to.parentOffset,
  }
}
export function requestCodeComment(view: EditorView) {
  const range = codeCommentSelection(view.state)
  if (!range) return
  view.dispatch(view.state.tr.setMeta(codeCommentsKey, range).setMeta('addToHistory', false))
}
export function codeComments(node: PMNode): CodeComment[] {
  return node.attrs.comments ?? []
}
export function commentLines(code: string, comment: CodeComment) {
  const first = code.slice(0, comment.from).split('\n').length
  const last = code.slice(0, comment.to).split('\n').length
  return first === last ? String(first) : `${first}–${last}`
}
export const codeCommentsPlugin = () =>
  new Plugin({
    key: codeCommentsKey,
    appendTransaction(transactions, oldState, state) {
      if (!transactions.some((tr) => tr.docChanged)) return null
      const mapping = new Mapping()
      for (const tr of transactions) mapping.appendMapping(tr.mapping)
      const tr = state.tr
      oldState.doc.descendants((oldNode, oldPos) => {
        if (oldNode.type.name !== 'codeBlock' || !codeComments(oldNode).length) return
        const pos = mapping.map(oldPos, 1)
        const node = state.doc.nodeAt(pos)
        if (
          !node ||
          node.type.name !== 'codeBlock' ||
          node.textContent === oldNode.textContent ||
          JSON.stringify(node.attrs.comments) !== JSON.stringify(oldNode.attrs.comments)
        )
          return
        const comments = codeComments(oldNode).flatMap((comment) => {
          const from = Math.max(0, mapping.map(oldPos + 1 + comment.from, 1) - pos - 1)
          const to = Math.min(node.content.size, mapping.map(oldPos + 1 + comment.to, -1) - pos - 1)
          return to > from ? [{ ...comment, from, to }] : []
        })
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, comments })
      })
      return tr.docChanged ? tr : null
    },
    props: {
      decorations(state) {
        const decorations: Decoration[] = []
        state.doc.descendants((node, pos) => {
          if (node.type.name !== 'codeBlock') return
          for (const comment of codeComments(node)) {
            if (comment.from < 0 || comment.to > node.content.size || comment.from >= comment.to)
              continue
            decorations.push(
              Decoration.inline(pos + 1 + comment.from, pos + 1 + comment.to, {
                class: 'code-comment-highlight',
                'data-code-comment': comment.id,
                tabindex: '0',
                role: 'button',
                'aria-label': comment.text,
              }),
            )
          }
        })
        return DecorationSet.create(state.doc, decorations)
      },
    },
  })
