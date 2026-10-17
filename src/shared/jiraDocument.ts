import type { DocNode } from './model'
import { jiraIssueAttrsSchema } from './jira'

// Upgrade legacy minimal block snapshots without changing detailed cards or other content.
export function normalizeJiraDocument(node: DocNode): DocNode {
  if (!node.content) return node
  const content: DocNode[] = []
  let changed = false
  for (const child of node.content) {
    const normalized = normalizeJiraDocument(child)
    const attrs =
      child.type === 'jiraIssue' &&
      child.attrs?.display === 'minimal' &&
      !child.text &&
      !child.content?.length
        ? jiraIssueAttrsSchema.safeParse(child.attrs).data
        : undefined
    if (attrs) {
      const inline: DocNode = { ...child, type: 'jiraIssueInline', attrs }
      const previous = content.at(-1)
      if (previous?.type === 'paragraph') {
        const prior = previous.content ?? []
        const last = prior.at(-1)
        const space =
          last && !(last.type === 'text' && /\s$/.test(last.text ?? ''))
            ? [{ type: 'text', text: ' ' }]
            : []
        content[content.length - 1] = { ...previous, content: [...prior, ...space, inline] }
      } else content.push({ type: 'paragraph', content: [inline] })
      changed = true
    } else {
      content.push(normalized)
      changed ||= normalized !== child
    }
  }
  return changed ? { ...node, content } : node
}
