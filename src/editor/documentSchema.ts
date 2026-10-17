import { getSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TableKit } from '@tiptap/extension-table'
import { TaskList, TaskItem } from '@tiptap/extension-list'
import { Details, DetailsSummary, DetailsContent } from '@tiptap/extension-details'
import { Mathematics } from '@tiptap/extension-mathematics'
import { EditableImage, ImageGallery } from './ImageBlock'
import { FilledTableView } from './FilledTableView'
import { AttachmentNode, Callout, CodeBlock, PageLink, WikiLink, DatabaseEmbed } from './extensions'
import type { DocNode, Page } from '../shared/model'
import { attachmentViews } from '../shared/media'
import { ArchitectureEmbed } from './ArchitectureEmbed'
import { architectureEmbedAttrsSchema } from '../shared/architectureDocument'
import { MermaidBlock } from './DiagramBlock'
import { diagramAttrsSchema } from '../shared/diagram'
import { JiraBlock, JiraInline } from './JiraBlock'
import { jiraIssueAttrsSchema } from '../shared/jira'

// Used by both the editor and MCP validation so agents can author every editor block.
export function documentExtensions(resolveTitle?: (title: string) => Page | undefined) {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4] },
      codeBlock: false,
      dropcursor: { width: 3, color: 'var(--green)', class: 'editor-drop-cursor' },
      link: {
        openOnClick: false,
        autolink: true,
        protocols: ['http', 'https', 'mailto'],
        isAllowedUri: (url) => /^(https?:\/\/|mailto:)/i.test(url),
      },
    }),
    EditableImage,
    ImageGallery,
    TableKit.configure({ table: { resizable: true, View: FilledTableView } }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Details.configure({ persist: true }),
    DetailsSummary,
    DetailsContent,
    Callout,
    CodeBlock,
    MermaidBlock,
    ArchitectureEmbed,
    JiraBlock,
    JiraInline,
    PageLink,
    DatabaseEmbed,
    WikiLink.configure(resolveTitle ? { resolveTitle } : {}),
    AttachmentNode,
  ]
}
let schema: ReturnType<typeof getSchema> | undefined
export function validateEditorDocument(doc: DocNode) {
  schema ??= getSchema([...documentExtensions(), Mathematics])
  let count = 0
  function check(node: DocNode, depth: number) {
    if (++count > 20000 || depth > 40)
      throw new Error('Document exceeds the block or nesting limit')
    const spec = schema!.nodes[node.type]?.spec
    if (!spec) throw new Error('Unsupported block type: ' + node.type)
    const attrs = node.attrs ?? {}
    if (
      ['jiraIssue', 'jiraIssueInline'].includes(node.type) &&
      !jiraIssueAttrsSchema.safeParse(attrs).success
    )
      throw new Error('Invalid Jira issue attributes')
    if (node.type === 'jiraIssueInline' && attrs.display != null && attrs.display !== 'minimal')
      throw new Error('Inline Jira issues use the minimal view')
    if (node.type === 'architectureEmbed' && !architectureEmbedAttrsSchema.safeParse(attrs).success)
      throw new Error('Invalid architecture preview reference')
    if (node.type === 'mermaid' && !diagramAttrsSchema.safeParse(attrs).success)
      throw new Error('Invalid Mermaid source or block positions')
    if (
      node.type === 'attachment' &&
      attrs.display !== undefined &&
      !attachmentViews.includes(attrs.display as (typeof attachmentViews)[number])
    )
      throw new Error('Invalid attachment view')
    if (node.type === 'codeBlock' && attrs.comments != null) {
      const length = (node.content ?? []).map((child) => child.text ?? '').join('').length
      if (!Array.isArray(attrs.comments) || attrs.comments.length > 500)
        throw new Error('Invalid code comments')
      const ids = new Set<string>()
      for (const comment of attrs.comments) {
        if (
          !comment ||
          typeof comment !== 'object' ||
          typeof comment.id !== 'string' ||
          !comment.id ||
          comment.id.length > 100 ||
          ids.has(comment.id) ||
          typeof comment.text !== 'string' ||
          !comment.text.trim() ||
          comment.text.length > 4000 ||
          !Number.isInteger(comment.from) ||
          !Number.isInteger(comment.to) ||
          comment.from < 0 ||
          comment.to <= comment.from ||
          comment.to > length
        )
          throw new Error('Invalid code comment range or text')
        ids.add(comment.id)
      }
    }
    if (
      (node.type === 'tableCell' || node.type === 'tableHeader') &&
      attrs.align != null &&
      (typeof attrs.align !== 'string' || !['left', 'center', 'right'].includes(attrs.align))
    )
      throw new Error('Invalid table column alignment')
    for (const key of [
      'title',
      'language',
      'caption',
      'emoji',
      'label',
      'pageId',
      'id',
      'file',
      'name',
      'alt',
      'src',
      'originalSrc',
      'latex',
    ]) {
      if (attrs[key] != null && typeof attrs[key] !== 'string')
        throw new Error(`Invalid ${node.type} attribute: ${key}`)
    }
    for (const key of ['checked', 'open', 'lineNumbers', 'collapsedByDefault']) {
      if (attrs[key] != null && typeof attrs[key] !== 'boolean')
        throw new Error(`Invalid ${node.type} attribute: ${key}`)
    }
    for (const key of ['width', 'height', 'bytes', 'start', 'level', 'colspan', 'rowspan']) {
      if (
        attrs[key] != null &&
        (typeof attrs[key] !== 'number' ||
          !Number.isFinite(attrs[key]) ||
          Number(attrs[key]) < 0 ||
          Number(attrs[key]) > 1000000)
      )
        throw new Error(`Invalid ${node.type} attribute: ${key}`)
    }
    if (
      attrs.colwidth != null &&
      (!Array.isArray(attrs.colwidth) ||
        attrs.colwidth.some(
          (value) =>
            typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 10000,
        ))
    )
      throw new Error('Invalid table column widths')
    if (attrs.crop != null) {
      if (typeof attrs.crop !== 'object' || Array.isArray(attrs.crop))
        throw new Error('Invalid image crop')
      for (const key of ['x', 'y', 'width', 'height']) {
        const value = (attrs.crop as Record<string, unknown>)[key]
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1)
          throw new Error('Invalid image crop')
      }
    }
    for (const key of Object.keys(node.attrs ?? {}))
      if (!Object.hasOwn(spec.attrs ?? {}, key))
        throw new Error(`Unsupported ${node.type} attribute: ${key}`)
    for (const mark of node.marks ?? []) {
      const spec = schema!.marks[mark.type]?.spec
      if (!spec) throw new Error('Unsupported rich text mark: ' + mark.type)
      for (const key of Object.keys(mark.attrs ?? {}))
        if (!Object.hasOwn(spec.attrs ?? {}, key))
          throw new Error('Unsupported mark attribute: ' + key)
    }
    node.content?.forEach((child) => check(child, depth + 1))
  }
  check(doc, 0)
  schema.nodeFromJSON(doc).check()
}
