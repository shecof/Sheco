import type { DocNode, Workspace, Page, Database } from './model'
import { columnValue, databaseRows } from './model'
import { architectureMermaid } from './projectArchitecture'
import { jiraIssueAttrsSchema, jiraIssueUrl } from './jira'
export function safeName(title: string): string {
  let value =
    title
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
      .trim()
      .replace(/[. ]+$/g, '')
      .slice(0, 80) || 'Untitled'
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(value)) value = '_' + value
  return value
}
export const pageFilename = (p: Page) => `${safeName(p.title)}--${p.id.slice(0, 8)}.md`
const escapeText = (s: string) => s.replace(/([\\`*_[\]<>])/g, '\\$1')
export function markdown(
  node: DocNode,
  links: Record<string, string> = {},
  assetPrefix = 'attachments/',
): string {
  const children = () => (node.content ?? []).map((n) => markdown(n, links, assetPrefix)).join('')
  if (node.type === 'text') {
    let s = escapeText(node.text ?? '')
    for (const mark of node.marks ?? []) {
      if (mark.type === 'code') {
        const fence = '`'.repeat(
          Math.max(1, ...[...(node.text ?? '').matchAll(/`+/g)].map((m) => m[0].length + 1)),
        )
        s = fence + ' ' + (node.text ?? '') + ' ' + fence
      } else if (mark.type === 'bold') s = `**${s}**`
      else if (mark.type === 'italic') s = `*${s}*`
      else if (mark.type === 'strike') s = `~~${s}~~`
      else if (mark.type === 'underline') s = `<u>${s}</u>`
      else if (mark.type === 'link') {
        const href = String(mark.attrs?.href ?? '')
        if (/^(https?:|mailto:)/i.test(href))
          s = `[${s}](${href.replace(/[()\s]/g, (c) => encodeURIComponent(c))})`
      }
    }
    return s
  }
  switch (node.type) {
    case 'doc':
      return children().trimEnd() + '\n'
    case 'paragraph':
      return children() + '\n\n'
    case 'heading':
      return '#'.repeat(Number(node.attrs?.level ?? 2)) + ' ' + children() + '\n\n'
    case 'hardBreak':
      return '  \n'
    case 'horizontalRule':
      return '---\n\n'
    case 'codeBlock': {
      const code = (node.content ?? []).map((n) => n.text ?? '').join('')
      const fence = '`'.repeat(
        Math.max(3, ...[...code.matchAll(/`+/g)].map((m) => m[0].length + 1)),
      )
      return (
        (node.attrs?.title ? escapeText(String(node.attrs.title)) + '\n\n' : '') +
        `${fence}${String(node.attrs?.language ?? '').replace(/[^\w+-]/g, '')}\n${code}\n${fence}\n\n` +
        (Array.isArray(node.attrs?.comments)
          ? node.attrs.comments
              .map((comment) => {
                const first = code.slice(0, comment.from).split('\n').length
                const last = code.slice(0, comment.to).split('\n').length
                return `> ${first === last ? first : `${first}–${last}`}: ${escapeText(code.slice(comment.from, comment.to))}\n> ${escapeText(comment.text).replace(/\n/g, '\n> ')}\n\n`
              })
              .join('')
          : '')
      )
    }
    case 'mermaid': {
      const source = String(node.attrs?.source ?? '')
      const fence = '`'.repeat(
        Math.max(3, ...[...source.matchAll(/`+/g)].map((match) => match[0].length + 1)),
      )
      return `${fence}mermaid\n${source}\n${fence}\n\n`
    }
    case 'jiraIssueInline':
    case 'jiraIssue': {
      const attrs = jiraIssueAttrsSchema.safeParse(node.attrs ?? {}).data
      if (!attrs?.issueKey) return node.type === 'jiraIssueInline' ? 'Jira' : 'Jira\n\n'
      const link = `[${escapeText(attrs.issueKey)}](${jiraIssueUrl(attrs.baseUrl, attrs.issueKey).replace(/[()\s]/g, (c) => encodeURIComponent(c))})`
      if (node.type === 'jiraIssueInline')
        return link + (attrs.status ? ` (${escapeText(attrs.status)})` : '')
      return (
        link +
        (attrs.display === 'detailed'
          ? ` — ${escapeText(attrs.summary)}\n\nStatus: ${escapeText(attrs.status || '—')} · Due date: ${attrs.dueDate || '—'}`
          : attrs.status
            ? ` (${escapeText(attrs.status)})`
            : '') +
        '\n\n'
      )
    }
    case 'bulletList':
    case 'orderedList':
    case 'taskList':
      return (
        (node.content ?? [])
          .map((item, i) => {
            const prefix =
              node.type === 'orderedList'
                ? `${Number(node.attrs?.start ?? 1) + i}. `
                : node.type === 'taskList'
                  ? `- [${item.attrs?.checked ? 'x' : ' '}] `
                  : '- '
            const body = markdown(item, links, assetPrefix).trimEnd()
            return prefix + body.replace(/\n/g, '\n' + ' '.repeat(prefix.length)) + '\n'
          })
          .join('') + '\n'
      )
    case 'listItem':
    case 'taskItem':
      return children()
    case 'blockquote':
      return (
        children()
          .trimEnd()
          .split('\n')
          .map((s) => '> ' + s)
          .join('\n') + '\n\n'
      )
    case 'callout':
      return (
        '> [!NOTE]\n' +
        children()
          .trimEnd()
          .split('\n')
          .map((s) => '> ' + s)
          .join('\n') +
        '\n\n'
      )
    case 'details':
      return (
        '<details>\n<summary>' +
        escapeText(
          (node.content ?? [])
            .find((n) => n.type === 'detailsSummary')
            ?.content?.map((n) => n.text ?? '')
            .join('') ?? 'Details',
        ) +
        '</summary>\n\n' +
        (node.content ?? [])
          .filter((n) => n.type !== 'detailsSummary')
          .map((n) => markdown(n, links, assetPrefix))
          .join('') +
        '\n</details>\n\n'
      )
    case 'detailsContent':
      return children()
    case 'table': {
      const rows = (node.content ?? []).map((row) =>
        (row.content ?? []).map((cell) =>
          markdown(cell, links, assetPrefix).trim().replace(/\n/g, '<br>').replace(/\|/g, '\\|'),
        ),
      )
      if (!rows.length) return ''
      return (
        '| ' +
        rows[0].join(' | ') +
        ' |\n| ' +
        (node.content?.[0].content ?? [])
          .map((cell) =>
            cell.attrs?.align === 'center'
              ? ':---:'
              : cell.attrs?.align === 'right'
                ? '---:'
                : cell.attrs?.align === 'left'
                  ? ':---'
                  : '---',
          )
          .join(' | ') +
        ' |\n' +
        rows
          .slice(1)
          .map((row) => '| ' + row.join(' | ') + ' |\n')
          .join('') +
        '\n'
      )
    }
    case 'tableRow':
    case 'tableCell':
    case 'tableHeader':
      return children()
    case 'image': {
      const source = String(node.attrs?.src ?? '')
      const file = source.startsWith('sheco-asset:') ? source.split('/').pop() : ''
      return file
        ? `![${escapeText(String(node.attrs?.alt ?? ''))}](${assetPrefix}${file})\n\n` +
            (node.attrs?.caption ? escapeText(String(node.attrs.caption)) + '\n\n' : '')
        : ''
    }
    case 'imageGallery':
      return (Array.isArray(node.attrs?.images) ? node.attrs.images : [])
        .map((attrs) => markdown({ type: 'image', attrs }, links, assetPrefix))
        .join('')
    case 'attachment':
      return `[${escapeText(String(node.attrs?.name ?? 'Attachment'))}](${assetPrefix}${String(node.attrs?.file ?? '')})\n\n`
    case 'wikiLink':
    case 'pageLink':
    case 'databaseEmbed':
    case 'architectureEmbed': {
      const id = String(node.attrs?.pageId ?? '')
      const label = escapeText(String(node.attrs?.label ?? 'Page'))
      return (
        (links[id] ? `[${label}](<${links[id]}>)` : `[[${label}]]`) +
        (node.type !== 'wikiLink' ? '\n\n' : '')
      )
    }
    case 'inlineMath':
      return '$' + String(node.attrs?.latex ?? '') + '$'
    case 'blockMath':
      return '$$\n' + String(node.attrs?.latex ?? '') + '\n$$\n\n'
    default:
      return children()
  }
}
function architectureDocument(page: Page): DocNode {
  return {
    type: 'doc',
    content: page.architecture
      ? [{ type: 'mermaid', attrs: { source: architectureMermaid(page.architecture) } }]
      : [],
  }
}
function expandDatabases(node: DocNode, w: Workspace): DocNode {
  if (node.type === 'architectureEmbed') {
    const page = w.pages.find(
      (page) => page.id === node.attrs?.pageId && page.kind === 'architecture' && !page.deletedAt,
    )
    return page
      ? {
          type: 'doc',
          content: [
            { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: page.title }] },
            ...(architectureDocument(page).content ?? []),
          ],
        }
      : node
  }
  if (node.type === 'databaseEmbed') {
    const page = w.pages.find((p) => p.id === node.attrs?.pageId && !p.deletedAt)
    const db = w.databases.find((d) => d.pageId === page?.id)
    if (!page || !db) return node
    const columns = db.columns.filter((c) => !c.hidden)
    const cell = (content: DocNode[]): DocNode => ({
      type: 'tableCell',
      content: [{ type: 'paragraph', content }],
    })
    const text = (value: string): DocNode[] => (value ? [{ type: 'text', text: value }] : [])
    return {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: text(page.title || 'Untitled database') },
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: ['Name', ...columns.map((c) => c.name)].map((name) => cell(text(name))),
            },
            ...databaseRows(w, db).map((row) => ({
              type: 'tableRow',
              content: [
                cell([
                  { type: 'wikiLink', attrs: { pageId: row.id, label: row.title || 'Untitled' } },
                ]),
                ...columns.map((c) => {
                  const value = columnValue(row, c)
                  const displayed =
                    c.type === 'relation'
                      ? (w.pages.find((p) => p.id === value)?.title ?? '')
                      : Array.isArray(value)
                        ? value.join(', ')
                        : String(value ?? '')
                  return cell(text(displayed))
                }),
              ],
            })),
          ],
        },
      ],
    }
  }
  return {
    ...node,
    ...(node.content ? { content: node.content.map((n) => expandDatabases(n, w)) } : {}),
  }
}
export function pageMarkdown(
  page: Page,
  w: Workspace,
  links: Record<string, string> = {},
  assetPrefix = 'attachments/',
): string {
  const db = w.databases.find((d) => d.id === page.databaseId)
  const props = db?.columns
    .map((c) => `${JSON.stringify(c.name)}: ${JSON.stringify(columnValue(page, c))}`)
    .join('\n')
  return (
    (props ? '---\n' + props + '\n---\n\n' : '') +
    '# ' +
    escapeText(page.title || 'Untitled') +
    '\n\n' +
    (page.description ? page.description + '\n\n' : '') +
    markdown(
      page.kind === 'architecture' ? architectureDocument(page) : expandDatabases(page.content, w),
      links,
      assetPrefix,
    )
  )
}
export function databaseCSV(db: Database, w: Workspace): string {
  const csv = (v: unknown) => {
    let s = Array.isArray(v) ? v.join(', ') : String(v ?? '')
    if (/^[\t\r\n]|^\s*[=+\-@]/.test(s)) s = "'" + s
    return '"' + s.replace(/"/g, '""') + '"'
  }
  return (
    '\ufeff' +
    [
      ['Name', ...db.columns.map((c) => c.name)],
      ...w.pages
        .filter((p) => p.databaseId === db.id && !p.deletedAt)
        .sort((a, b) => a.order - b.order)
        .map((p) => [p.title, ...db.columns.map((c) => columnValue(p, c))]),
    ]
      .map((row) => row.map(csv).join(','))
      .join('\r\n') +
    '\r\n'
  )
}
