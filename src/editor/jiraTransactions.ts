import { Fragment, type Node as PMNode } from '@tiptap/pm/model'
import { closeHistory } from '@tiptap/pm/history'
import { TextSelection, type EditorState } from '@tiptap/pm/state'

export function jiraEditorText(node: PMNode) {
  return node.textBetween(0, node.content.size, '', (leaf) =>
    leaf.type.name === 'jiraIssueInline'
      ? [leaf.attrs.issueKey, leaf.attrs.status].filter(Boolean).join(' · ')
      : leaf.textContent,
  )
}

export function jiraInlineOrigin(state: EditorState, pos: number, size = 0) {
  const resolved = state.doc.resolve(pos)
  if (!['paragraph', 'heading'].includes(resolved.parent.type.name)) return null
  return {
    type: resolved.parent.type.name as 'paragraph' | 'heading',
    before: resolved.parentOffset > 0,
    after: resolved.parentOffset + size < resolved.parent.content.size,
    ...(resolved.parent.type.name === 'heading'
      ? { level: resolved.parent.attrs.level as number }
      : {}),
  }
}

export function jiraDisplayTransaction(
  state: EditorState,
  pos: number,
  display: 'detailed' | 'minimal',
) {
  const node = state.doc.nodeAt(pos)
  if (!node || !['jiraIssue', 'jiraIssueInline'].includes(node.type.name)) return null
  const inline = node.type.name === 'jiraIssueInline'
  const attrs = { ...node.attrs, display }
  const tr = closeHistory(state.tr)
  if (display === 'detailed') {
    if (!inline) return tr.setNodeMarkup(pos, undefined, attrs)
    const origin = jiraInlineOrigin(state, pos, node.nodeSize)
    if (!origin) return null
    return tr.replaceRangeWith(
      pos,
      pos + node.nodeSize,
      state.schema.nodes.jiraIssue.create({ ...attrs, inlineOrigin: origin }),
    )
  }
  if (inline) return tr.setNodeMarkup(pos, undefined, attrs)
  const origin = node.attrs.inlineOrigin as ReturnType<typeof jiraInlineOrigin>
  const mention = state.schema.nodes.jiraIssueInline.create({ ...attrs, inlineOrigin: null })
  const resolved = state.doc.resolve(pos)
  const index = resolved.index()
  const previous = index > 0 ? resolved.parent.child(index - 1) : undefined
  const next = index + 1 < resolved.parent.childCount ? resolved.parent.child(index + 1) : undefined
  const paragraph = state.schema.nodes[origin?.type ?? 'paragraph']
  const before = previous?.type === paragraph && (!origin || origin.before) ? previous : undefined
  const after =
    origin?.after &&
    next?.type === paragraph &&
    (!before || JSON.stringify(before.attrs) === JSON.stringify(next.attrs))
      ? next
      : undefined
  let content = before?.content ?? Fragment.empty
  if (
    !origin &&
    content.size &&
    !(content.lastChild?.isText && /\s$/.test(content.lastChild.text ?? ''))
  )
    content = content.append(Fragment.from(state.schema.text(' ')))
  const cursor = pos - (before?.nodeSize ?? 0) + 1 + content.size + mention.nodeSize
  content = content.append(Fragment.from(mention))
  if (after?.content.size) {
    if (!origin && !(after.firstChild?.isText && /^\s/.test(after.firstChild.text ?? '')))
      content = content.append(Fragment.from(state.schema.text(' ')))
    content = content.append(after.content)
  }
  tr.replaceWith(
    pos - (before?.nodeSize ?? 0),
    pos + node.nodeSize + (after?.nodeSize ?? 0),
    paragraph.create(
      before?.attrs ??
        after?.attrs ??
        (origin?.type === 'heading' ? { level: origin.level } : undefined),
      content,
    ),
  )
  return tr.setSelection(TextSelection.create(tr.doc, cursor))
}
