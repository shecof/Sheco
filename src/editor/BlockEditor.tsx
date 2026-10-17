import { useI18n } from '../i18n'
import { useEffect, useRef, useState } from 'react'
import { EditorContent, useEditor, type Editor, type JSONContent } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import Placeholder from '@tiptap/extension-placeholder'
import { isImageAttachment, mediaBlocks } from '../shared/media'
import { BlockMenu, BlockSubmenu } from './BlockMenu'
import { codeCommentSelection, requestCodeComment } from './CodeComments'
import { documentExtensions, validateEditorDocument } from './documentSchema'
import { templateTransaction } from './templateTransactions'
import { CreateTemplatePageDialog } from '../components/DocumentTemplates'
import { TableControls } from './TableControls'
import { FindReplace, FindReplacePanel } from './FindReplace'
import {
  BlockSelection,
  selectedBlocks,
  deleteBlocks,
  duplicateBlocks,
  blockSelectionKey,
  blockNodes,
  selectBlocks,
} from './BlockSelection'
import { Mathematics } from '@tiptap/extension-mathematics'
import { Markdown } from '@tiptap/markdown'
import { DragHandle } from '@tiptap/extension-drag-handle-react'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import { Fragment } from '@tiptap/pm/model'
import { closeHistory } from '@tiptap/pm/history'
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  Link,
  Plus,
  GripVertical,
  ArrowUp,
  ArrowDown,
  Copy,
  Trash2,
  Type,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  List,
  ListOrdered,
  ListTodo,
  ChevronRight,
  Minus,
  Quote,
  Lightbulb,
  Braces,
  Sigma,
  Table2,
  Image as ImageIcon,
  Paperclip,
  FilePlus2,
  FileSymlink,
  Search,
  Check,
  MessageSquare,
  GitBranch,
  Network,
  Ticket,
  Terminal,
} from 'lucide-react'
import {
  commandBuilderTab,
  documentTemplatesTab,
  documentTemplatesAvailable,
  documentTemplatesSettingsTab,
  dataToolsTab,
} from '../shared/plugins'
import { jiraInlineOrigin, jiraEditorText } from './jiraTransactions'
import { createPage, plainText, type Page, type DocNode, type Attachment } from '../shared/model'
import { useApp } from '../state'
import { Modal, MenuItem, PageIcon } from '../components/ui'
import 'katex/dist/katex.min.css'
import { defaultDiagramSource, flowchartSource, parseFlowchart } from '../shared/diagram'

type Palette = {
  type: 'slash' | 'wiki'
  query: string
  from: number
  to: number
  x: number
  y: number
}
const commands = [
  {
    id: 'text',
    name: 'Text',
    description: 'Just start writing',
    icon: Type,
    keywords: 'paragraph',
  },
  {
    id: 'h1',
    name: 'Heading 1',
    description: 'A big section heading',
    icon: Heading1,
    keywords: 'title h1',
  },
  {
    id: 'h2',
    name: 'Heading 2',
    description: 'A medium section heading',
    icon: Heading2,
    keywords: 'h2',
  },
  {
    id: 'h3',
    name: 'Heading 3',
    description: 'A small section heading',
    icon: Heading3,
    keywords: 'h3',
  },
  {
    id: 'h4',
    name: 'Heading 4',
    description: 'An understated heading',
    icon: Heading4,
    keywords: 'h4',
  },
  {
    id: 'todo',
    name: 'To-do list',
    description: 'Track tasks with checkboxes',
    icon: ListTodo,
    keywords: 'checklist task',
  },
  {
    id: 'bullet',
    name: 'Bullet list',
    description: 'A simple bulleted list',
    icon: List,
    keywords: 'unordered',
  },
  {
    id: 'number',
    name: 'Numbered list',
    description: 'A list with a sequence',
    icon: ListOrdered,
    keywords: 'ordered',
  },
  {
    id: 'toggle',
    name: 'Toggle list',
    description: 'Content you can fold away',
    icon: ChevronRight,
    keywords: 'collapse details',
  },
  {
    id: 'quote',
    name: 'Quote',
    description: 'Make a passage stand out',
    icon: Quote,
    keywords: 'blockquote',
  },
  {
    id: 'callout',
    name: 'Callout',
    description: 'Highlight an idea or a note',
    icon: Lightbulb,
    keywords: 'notice',
  },
  {
    id: 'divider',
    name: 'Divider',
    description: 'A quiet break between sections',
    icon: Minus,
    keywords: 'line horizontal',
  },
  {
    id: 'code',
    name: 'Code block',
    description: 'Code with syntax highlighting',
    icon: Braces,
    keywords: 'snippet',
  },
  {
    id: 'math',
    name: 'Math formula',
    description: 'An expression in LaTeX',
    icon: Sigma,
    keywords: 'equation latex',
  },
  {
    id: 'architecture',
    name: 'Create architecture diagram',
    description: 'An architecture subpage with an inline preview',
    icon: Network,
    keywords: 'architecture infrastructure project схема архитектура инфраструктура',
  },
  {
    id: 'mermaid',
    name: 'Mermaid diagram',
    description: 'Build a diagram from code or visual blocks',
    icon: GitBranch,
    keywords: 'mermaid diagram flowchart схема диаграмма блок-схема',
  },
  {
    id: 'table',
    name: 'Simple table',
    description: 'A table inside this document',
    icon: Table2,
    keywords: 'rows columns',
  },
  {
    id: 'database',
    name: 'Database',
    description: 'An inline database with page records',
    icon: Table2,
    keywords: 'collection data table',
  },
  {
    id: 'image',
    name: 'Image',
    description: 'Add an image from your device',
    icon: ImageIcon,
    keywords: 'photo picture',
  },
  {
    id: 'attachment',
    name: 'Attachment',
    description: 'Keep a file with this page',
    icon: Paperclip,
    keywords: 'pdf file archive',
  },
  {
    id: 'jira',
    name: 'Jira issue',
    description: 'Add an issue from Jira',
    icon: Ticket,
    keywords: 'jira task issue задача джира',
  },
  {
    id: 'template',
    name: 'Insert template',
    description: 'Insert a saved template at the cursor',
    icon: FilePlus2,
    keywords: 'template вставить шаблон',
  },
  {
    id: 'templates',
    name: 'Document templates',
    description: 'Create a document from a template',
    icon: FilePlus2,
    keywords: 'templates template шаблоны шаблон документ',
  },
  {
    id: 'data',
    name: 'Data tools',
    description: 'Format, encode or transform data',
    icon: Terminal,
    keywords: 'data json xml csv base64 encoding данные форматирование кодировка',
  },
  {
    id: 'jira-inline',
    name: 'Jira issue in text',
    description: 'Issue key and status within a sentence',
    icon: Ticket,
    keywords: 'jira-inline jira mention minimal task issue задача джира текст упоминание',
  },
  {
    id: 'commands',
    name: 'Command builder',
    description: 'Open command builder',
    icon: Terminal,
    keywords: 'commands terminal tools команды терминал инструменты конструктор',
  },
  {
    id: 'page',
    name: 'Page',
    description: 'Create a nested page',
    icon: FilePlus2,
    keywords: 'child subpage',
  },
  {
    id: 'linkPage',
    name: 'Link to page',
    description: 'Connect to an existing page',
    icon: FileSymlink,
    keywords: 'reference internal',
  },
]
export function BlockEditor({ page }: { page: Page }) {
  const { t, language } = useI18n()

  const { w, editPage, update, run, notify, addAttachments, newPage, remoteEdits, openPage } =
    useApp()
  const remoteVersion = remoteEdits[page.id] ?? 0
  const lastRemoteVersion = useRef(remoteVersion)
  const workspaceRef = useRef(w)
  workspaceRef.current = w
  const [palette, setPalette] = useState<Palette | null>(null)
  const [selected, setSelected] = useState(0)
  const [blockPos, setBlockPos] = useState<number | null>(null)
  const [blockIsTable, setBlockIsTable] = useState(false)
  const [blockMenu, setBlockMenu] = useState<{ x: number; y: number; pos: number } | null>(null)
  const blockPosRef = useRef<number | null>(null)
  const [selectionCount, setSelectionCount] = useState(0)
  const [outlinePosition, setOutlinePosition] = useState<number | null>(null)
  const [picker, setPicker] = useState(false)
  const [pickerQuery, setPickerQuery] = useState('')
  const [link, setLink] = useState<string | null>(null)
  const [math, setMath] = useState<{ latex: string; pos?: number; inline?: boolean } | null>(null)
  const paletteRef = useRef<Palette | null>(null)
  const chosenRef = useRef<(index: number) => void>(() => {})
  const optionsRef = useRef<number>(0)
  const selectedRef = useRef(0)
  const editorRef = useRef<Editor | null>(null)
  const [templateInsertion, setTemplateInsertion] = useState<{
    editor: Editor
    document: Editor['state']['doc']
    range: { from: number; to: number }
    workspaceId: string
    remoteVersion: number
  } | null>(null)
  function openTemplateInsertion(range?: { from: number; to: number }) {
    const current = editorRef.current
    const workspace = workspaceRef.current
    if (
      !current ||
      current.isDestroyed ||
      !documentTemplatesAvailable ||
      !workspace?.plugins.documentTemplates.enabled ||
      workspace.ui.activeId !== page.id
    )
      return
    setTemplateInsertion({
      editor: current,
      document: current.state.doc,
      range: range ?? { from: current.state.selection.to, to: current.state.selection.to },
      workspaceId: workspace.id,
      remoteVersion,
    })
    dismiss()
  }
  const [imageImport, setImageImport] = useState<{
    count: number
    resolve: (mode: 'separate' | 'slider' | null) => void
  } | null>(null)
  const importChoice = useRef<typeof imageImport>(null)
  importChoice.current = imageImport
  const importing = useRef(false)
  useEffect(() => () => importChoice.current?.resolve(null), [page.id])
  async function importFiles(
    load: () => Promise<Attachment[]>,
    kind: 'auto' | 'attachments' = 'auto',
    position?: number,
  ) {
    const e = editorRef.current
    const workspaceId = workspaceRef.current?.id
    if (!e || e.isDestroyed || !workspaceId || importing.current) return
    importing.current = true
    // Importing files adds blocks; it must never overwrite a selected image or slider.
    const insertion =
      e.state.selection instanceof NodeSelection ? e.state.selection.to : e.state.selection.from
    let from = position ?? insertion
    const track = ({ transaction }: { transaction: Editor['state']['tr'] }) => {
      from = transaction.mapping.map(from, 1)
    }
    e.on('transaction', track)
    try {
      const items = await load()
      if (
        !items.length ||
        e.isDestroyed ||
        editorRef.current !== e ||
        workspaceRef.current?.id !== workspaceId
      )
        return
      addAttachments(items)
      let mode: 'separate' | 'slider' | 'attachments' | null =
        kind === 'attachments' ? 'attachments' : 'separate'
      const count = items.filter(isImageAttachment).length
      if (kind !== 'attachments' && count > 1) {
        mode = await new Promise<'separate' | 'slider' | null>((resolve) =>
          setImageImport({ count, resolve }),
        )
        setImageImport(null)
      }
      if (
        !mode ||
        e.isDestroyed ||
        editorRef.current !== e ||
        workspaceRef.current?.id !== workspaceId
      )
        return
      const blocks = [...mediaBlocks(items, workspaceId, mode), { type: 'paragraph' }]
      const content = Fragment.from(blocks.map((block) => e.schema.nodeFromJSON(block)))
      const resolved = e.state.doc.resolve(Math.min(from, e.state.doc.content.size))
      const tr = closeHistory(e.state.tr)
      let start = resolved.pos
      if (resolved.depth) {
        const top = resolved.node(1)
        start = resolved.before(1)
        if (top.isTextblock && top.content.size === 0)
          tr.replaceWith(start, resolved.after(1), content)
        else {
          start = resolved.after(1)
          tr.insert(start, content)
        }
      } else tr.insert(start, content)
      tr.setSelection(TextSelection.near(tr.doc.resolve(start + content.size - 1)))
      e.view.dispatch(tr)
      e.view.focus()
    } finally {
      e.off('transaction', track)
      importing.current = false
    }
  }
  async function uploadFiles(files: File[]) {
    const workspaceId = workspaceRef.current?.id
    const items: Attachment[] = []
    for (const file of files) {
      if (workspaceRef.current?.id !== workspaceId) break
      items.push(await window.sheco.attachBytes(file.name, await file.arrayBuffer()))
    }
    return items
  }
  function refreshPalette(e: Editor) {
    const { selection } = e.state
    const { $from } = selection
    if (!selection.empty || !$from.parent.isTextblock || e.isActive('codeBlock')) {
      setPalette(null)
      paletteRef.current = null
      return
    }
    const before = $from.parent.textBetween(0, $from.parentOffset, '\n', '\ufffc')
    const inlineJira = before.match(/\/(jira(?:-[a-z]*)?)$/i)
    const slash =
      before.match(/^\/(.*)$/) ??
      (inlineJira &&
      ((inlineJira.index ?? 0) === 0 || /[\s\ufffc]/.test(before[(inlineJira.index ?? 0) - 1]))
        ? inlineJira
        : null)
    const wiki = before.match(/\[\[([^\]]*)$/)
    const match = slash ?? wiki
    if (!match) {
      setPalette(null)
      paletteRef.current = null
      return
    }
    const coords = e.view.coordsAtPos(selection.from)
    const p: Palette = {
      type: slash ? 'slash' : 'wiki',
      query: match[1],
      from: $from.start() + (match.index ?? 0),
      to: selection.from,
      x: Math.min(coords.left, window.innerWidth - 340),
      y: Math.min(coords.bottom + 8, window.innerHeight - 340),
    }
    if (paletteRef.current?.query !== p.query || paletteRef.current?.type !== p.type) {
      setSelected(0)
      selectedRef.current = 0
    }
    paletteRef.current = p
    setPalette(p)
  }
  const editor = useEditor(
    {
      extensions: [
        ...documentExtensions((title) =>
          workspaceRef.current?.pages.find(
            (p) => !p.deletedAt && p.title.toLowerCase() === title.trim().toLowerCase(),
          ),
        ),
        BlockSelection.configure({
          handlePosition: () => blockPosRef.current,
          openMenu: (x, y, pos) => {
            setBlockMenu({ x, y, pos })
          },
          dragLabel: (count) => t('{count} blocks', { count }),
        }),
        FindReplace,
        Placeholder.configure({
          placeholder: ({ node }) =>
            node.type.name === 'paragraph' ? t('Write something, or type / for blocks…') : '',
          includeChildren: false,
          showOnlyCurrent: true,
        }),
        Mathematics.configure({
          katexOptions: { throwOnError: false, trust: false },
          blockOptions: { onClick: (node, pos) => setMath({ latex: node.attrs.latex, pos }) },
          inlineOptions: {
            onClick: (node, pos) => setMath({ latex: node.attrs.latex, pos, inline: true }),
          },
        }),
        Markdown,
      ],
      content: page.content as JSONContent,
      editorProps: {
        attributes: {
          class: 'document-editor',
          'aria-label': t('Page content'),
          spellcheck: 'true',
        },
        handleKeyDown: (view, event) => {
          const selection = view.state.selection
          if (
            !selectedBlocks(view.state).length &&
            selection instanceof NodeSelection &&
            [
              'image',
              'imageGallery',
              'attachment',
              'databaseEmbed',
              'architectureEmbed',
              'jiraIssue',
            ].includes(selection.node.type.name) &&
            !event.metaKey &&
            !event.ctrlKey &&
            !event.altKey &&
            (event.key.length === 1 || event.key === 'Enter')
          ) {
            const pos = selection.to
            const tr = view.state.tr.insert(pos, view.state.schema.nodes.paragraph.create())
            tr.setSelection(TextSelection.create(tr.doc, pos + 1))
            view.dispatch(tr)
            if (event.key === 'Enter') {
              event.preventDefault()
              return true
            }
          }
          if (!paletteRef.current) return false
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            const count = optionsRef.current
            if (count) {
              selectedRef.current =
                (selectedRef.current + (event.key === 'ArrowDown' ? 1 : -1) + count) % count
              setSelected(selectedRef.current)
            }
            return true
          }
          if (event.key === 'Enter' && optionsRef.current) {
            event.preventDefault()
            chosenRef.current(selectedRef.current)
            return true
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            setPalette(null)
            paletteRef.current = null
            return true
          }
          return false
        },
        handleClick: (view, _pos, event) => {
          const paragraph = (event.target as HTMLElement).closest('p')
          if (paragraph?.parentElement === view.dom && !paragraph.textContent) {
            const pos = view.posAtDOM(paragraph, 0)
            view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)))
            return true
          }
          const anchor = (event.target as HTMLElement).closest('a')
          if (anchor) {
            event.preventDefault()
            const url = anchor.getAttribute('href')
            if (url?.startsWith('sheco://page/')) {
              const id = url.split('/').pop()
              if (id)
                window.dispatchEvent(
                  new CustomEvent('open-page', {
                    detail: { id, newTab: event.metaKey || event.ctrlKey },
                  }),
                )
            } else if (url) run(() => window.sheco.external(url))
            return true
          }
          return false
        },
        handlePaste: (_view, event) => {
          const uri = event.clipboardData?.getData('text/plain').trim()
          const id = uri?.match(/^sheco:\/\/page\/([0-9a-f-]{36})$/)?.[1]
          const target = workspaceRef.current?.pages.find((p) => p.id === id && !p.deletedAt)
          if (target) {
            editorRef.current
              ?.chain()
              .focus()
              .insertContent({
                type: 'wikiLink',
                attrs: { pageId: target.id, label: target.title },
              })
              .run()
            return true
          }
          const files = [...(event.clipboardData?.files ?? [])]
          if (!files.length) return false
          run(() => importFiles(() => uploadFiles(files)))
          return true
        },
        transformPastedHTML: (html) => {
          const doc = new DOMParser().parseFromString(html, 'text/html')
          doc.querySelectorAll('[data-type="image-gallery"]').forEach((gallery) => {
            try {
              const images = JSON.parse(gallery.getAttribute('data-images') ?? '[]')
              if (
                !Array.isArray(images) ||
                !images.length ||
                images.some(
                  (image) =>
                    typeof image?.src !== 'string' ||
                    !image.src.startsWith(`sheco-asset://${workspaceRef.current?.id}/`),
                )
              )
                gallery.remove()
            } catch {
              gallery.remove()
            }
          })
          doc.querySelectorAll('img').forEach((img) => {
            if (!img.src.startsWith(`sheco-asset://${w!.id}/`)) img.remove()
          })
          return doc.body.innerHTML
        },
      },
      onUpdate: ({ editor }) => {
        editPage(page.id, { content: editor.getJSON() as DocNode })
        refreshPalette(editor)
      },
      onSelectionUpdate: ({ editor }) => refreshPalette(editor),
      onTransaction: ({ editor }) => setSelectionCount(selectedBlocks(editor.state).length),
      onCreate: ({ editor }) => {
        const imported = page.content.content?.[0]?.attrs?.importMarkdown
        if (typeof imported === 'string') {
          editor.commands.setContent(imported, { contentType: 'markdown' })
          editPage(page.id, { content: editor.getJSON() as DocNode })
        }
      },
    },
    [page.id],
  )
  editorRef.current = editor
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        !(event.metaKey || event.ctrlKey) ||
        !event.shiftKey ||
        event.altKey ||
        (event.code !== 'KeyT' && event.key.toLowerCase() !== 't')
      )
        return
      if (
        !editor ||
        editor.isDestroyed ||
        workspaceRef.current?.ui.activeId !== page.id ||
        !documentTemplatesAvailable ||
        !workspaceRef.current.plugins.documentTemplates.enabled ||
        document.querySelector('[role="dialog"][aria-modal="true"]')
      )
        return
      if (
        event.target instanceof Element &&
        event.target.closest('input,textarea,select') &&
        !event.target.matches('.page-title')
      )
        return
      event.preventDefault()
      openTemplateInsertion()
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  }, [editor, page.id, remoteVersion])
  useEffect(() => {
    if (!documentTemplatesAvailable || !w?.plugins.documentTemplates.enabled)
      setTemplateInsertion(null)
  }, [w?.plugins.documentTemplates.enabled])
  useEffect(() => {
    if (lastRemoteVersion.current === remoteVersion) return
    lastRemoteVersion.current = remoteVersion
    if (
      !editor ||
      editor.isDestroyed ||
      JSON.stringify(editor.getJSON()) === JSON.stringify(page.content)
    )
      return
    editor.commands.setContent(page.content as JSONContent, { emitUpdate: false })
    setPalette(null)
    setBlockMenu(null)
  }, [editor, remoteVersion])
  useEffect(() => {
    if (!editor) return
    const accepts = (event: DragEvent) =>
      event.target instanceof Element &&
      !!event.target.closest('.content-scroll') &&
      !event.target.closest('.modal-overlay')
    const over = (event: DragEvent) => {
      if (!accepts(event) || !event.dataTransfer?.types.includes('Files')) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
    }
    const drop = (event: DragEvent) => {
      const files = [...(event.dataTransfer?.files ?? [])]
      if (!accepts(event) || !files.length) return
      event.preventDefault()
      // Let the native drop-cursor plugin receive the completed drop and remove its marker.
      const hit = editor.view.posAtCoords({ left: event.clientX, top: event.clientY })
      let position = editor.state.doc.content.size
      if (hit) {
        const resolved = editor.state.doc.resolve(hit.pos)
        if (resolved.depth) {
          const top = resolved.before(1)
          const node = editor.state.doc.nodeAt(top)!
          const dom = editor.view.nodeDOM(top)
          const rect = dom instanceof Element ? dom.getBoundingClientRect() : null
          position = top + (rect && event.clientY > rect.top + rect.height / 2 ? node.nodeSize : 0)
        } else position = hit.pos
      }
      run(() => importFiles(() => uploadFiles(files), 'auto', position))
    }
    document.addEventListener('dragover', over, true)
    document.addEventListener('drop', drop, true)
    return () => {
      document.removeEventListener('dragover', over, true)
      document.removeEventListener('drop', drop, true)
    }
  }, [editor])
  const commandOptions = commands.filter(
    (c) =>
      (!['jira', 'jira-inline'].includes(c.id) || w!.plugins.jira.enabled) &&
      (c.id !== 'commands' || w!.plugins.commandBuilder.enabled) &&
      (!['template', 'templates'].includes(c.id) ||
        (documentTemplatesAvailable && w!.plugins.documentTemplates.enabled)) &&
      (c.id !== 'data' || w!.plugins.dataTools.enabled) &&
      (c.id !== 'architecture' || w!.plugins.projectArchitecture.enabled) &&
      (c.name + ' ' + t(c.name) + ' ' + c.keywords)
        .toLowerCase()
        .includes(palette?.query.toLowerCase() ?? ''),
  )
  const pageOptions = w!.pages
    .filter(
      (p) =>
        !p.deletedAt &&
        p.id !== page.id &&
        p.title.toLowerCase().includes(palette?.query.toLowerCase() ?? ''),
    )
    .slice(0, 30)
  optionsRef.current = palette?.type === 'wiki' ? pageOptions.length : commandOptions.length
  const dismiss = () => {
    setPalette(null)
    paletteRef.current = null
  }
  const execute = (id: string) => {
    if (!editor) return
    const p = paletteRef.current
    if (id === 'template' && documentTemplatesAvailable && w!.plugins.documentTemplates.enabled) {
      openTemplateInsertion(p ? { from: p.from, to: p.to } : undefined)
      return
    }
    if (p) editor.chain().focus().deleteRange({ from: p.from, to: p.to }).run()
    dismiss()
    const chain = editor.chain().focus()
    if (id === 'text') chain.setParagraph().run()
    else if (id === 'jira' && w!.plugins.jira.enabled)
      chain
        .insertContent({
          type: 'jiraIssue',
          attrs: { inlineOrigin: jiraInlineOrigin(editor.state, editor.state.selection.from) },
        })
        .run()
    else if (id === 'jira-inline' && w!.plugins.jira.enabled)
      chain.insertContent({ type: 'jiraIssueInline', attrs: { display: 'minimal' } }).run()
    else if (id === 'commands' && w!.plugins.commandBuilder.enabled)
      openPage(commandBuilderTab, true)
    else if (
      id === 'templates' &&
      documentTemplatesAvailable &&
      w!.plugins.documentTemplates.enabled
    )
      openPage(documentTemplatesTab, true)
    else if (id === 'data' && w!.plugins.dataTools.enabled) openPage(dataToolsTab, true)
    else if (/^h[1-4]$/.test(id)) chain.setHeading({ level: Number(id[1]) as 1 | 2 | 3 | 4 }).run()
    else if (id === 'todo') chain.toggleTaskList().run()
    else if (id === 'bullet') chain.toggleBulletList().run()
    else if (id === 'number') chain.toggleOrderedList().run()
    else if (id === 'toggle') chain.setDetails().run()
    else if (id === 'quote') chain.toggleBlockquote().run()
    else if (id === 'callout')
      chain
        .insertContent({
          type: 'callout',
          attrs: { emoji: '💡' },
          content: [{ type: 'paragraph' }],
        })
        .run()
    else if (id === 'divider') chain.setHorizontalRule().run()
    else if (id === 'code') chain.setCodeBlock().run()
    else if (id === 'architecture' && w!.plugins.projectArchitecture.enabled) {
      const child = newPage(page.id, 'architecture', null, false)
      const title = t('Untitled architecture')
      editPage(child.id, { title })
      chain
        .insertContent({ type: 'architectureEmbed', attrs: { pageId: child.id, label: title } })
        .run()
    } else if (id === 'mermaid') {
      const graph = parseFlowchart(defaultDiagramSource)!
      graph.nodes.forEach((node) => {
        node.label = t(node.label)
      })
      graph.edges.forEach((edge) => {
        edge.label = t(edge.label)
      })
      chain
        .insertContent({
          type: 'mermaid',
          attrs: { source: flowchartSource(graph), positions: {} },
        })
        .run()
    } else if (id === 'table') chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
    else if (id === 'database') {
      const child = newPage(page.id, 'database', null, false)
      editPage(child.id, { title: t('Untitled database') })
      chain
        .insertContent({
          type: 'databaseEmbed',
          attrs: { pageId: child.id, label: t('Untitled database') },
        })
        .run()
    } else if (id === 'math') setMath({ latex: 'E = mc^2' })
    else if (id === 'image' || id === 'attachment')
      run(() =>
        importFiles(() => window.sheco.attach(), id === 'attachment' ? 'attachments' : 'auto'),
      )
    else if (id === 'page') {
      const child = createPage(
        w!,
        t('Untitled'),
        page.id,
        'page',
        page.kind === 'database'
          ? (w!.databases.find((d) => d.pageId === page.id)?.id ?? null)
          : null,
      )
      update((w) => ({
        ...w,
        pages: [...w.pages, child],
        ui: { ...w.ui, expanded: [...new Set([...w.ui.expanded, page.id])] },
      }))
      chain
        .insertContent({ type: 'pageLink', attrs: { pageId: child.id, label: child.title } })
        .run()
    } else if (id === 'linkPage') {
      setPickerQuery('')
      setPicker(true)
    }
  }
  chosenRef.current = (index: number) => {
    const p = paletteRef.current
    if (!p || !editor) return
    if (p.type === 'wiki') {
      const target = pageOptions[index]
      if (target)
        editor
          .chain()
          .focus()
          .deleteRange({ from: p.from, to: p.to })
          .insertContent({ type: 'wikiLink', attrs: { pageId: target.id, label: target.title } })
          .insertContent(' ')
          .run()
      dismiss()
    } else if (commandOptions[index]) execute(commandOptions[index].id)
  }
  useEffect(() => {
    const item = document.querySelector('.command-palette .is-selected')
    item?.scrollIntoView({ block: 'nearest' })
  }, [selected])
  useEffect(() => {
    if (!editor || !w?.ui.showOutline) return
    let frame = 0
    let detach = () => {}
    const attach = () => {
      if (editor.isDestroyed || !editor.isInitialized) return
      const scroll = editor.view.dom.closest('.content-scroll')
      if (!scroll) return
      const refresh = () => {
        frame = 0
        if (editor.isDestroyed || !editor.isInitialized) return
        const top = scroll.getBoundingClientRect().top + 48
        let active: number | null = null
        editor.state.doc.descendants((node, pos) => {
          if (node.type.name !== 'heading' || !jiraEditorText(node).trim()) return
          const element = editor.view.nodeDOM(pos)
          if (!(element instanceof HTMLElement) || !element.getClientRects().length) return
          if (active === null || element.getBoundingClientRect().top <= top) active = pos
        })
        setOutlinePosition(active)
      }
      const schedule = () => {
        if (!frame) frame = requestAnimationFrame(refresh)
      }
      refresh()
      scroll.addEventListener('scroll', schedule)
      window.addEventListener('resize', schedule)
      detach = () => {
        scroll.removeEventListener('scroll', schedule)
        window.removeEventListener('resize', schedule)
      }
    }
    const created = () => {
      frame = requestAnimationFrame(attach)
    }
    editor.on('create', created)
    attach()
    return () => {
      cancelAnimationFrame(frame)
      editor.off('create', created)
      detach()
    }
  }, [editor, page.content, w?.ui.showOutline])
  if (!editor) return null
  const headings: { pos: number; level: number; title: string }[] = []
  if (w?.ui.showOutline) {
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'heading' && jiraEditorText(node).trim())
        headings.push({ pos, level: node.attrs.level, title: jiraEditorText(node) })
    })
  }
  const blockAction = (action: string) => {
    if (!blockMenu) return
    const pos = blockMenu.pos
    const node = editor.state.doc.nodeAt(pos)
    if (!node) {
      setBlockMenu(null)
      return
    }
    const selectedPositions = selectedBlocks(editor.state)
    const positions = selectedPositions.includes(pos) ? selectedPositions : [pos]
    let tr = closeHistory(editor.state.tr)
    const blocks = blockNodes(editor.state.doc, positions)
    if (
      action === 'gallery' &&
      blocks.length > 1 &&
      blocks.every((b) => ['image', 'imageGallery'].includes(b.node.type.name))
    ) {
      const images = blocks.flatMap((b) =>
        b.node.type.name === 'image' ? [b.node.attrs] : b.node.attrs.images,
      )
      for (const b of [...blocks].reverse()) tr.delete(b.pos, b.pos + b.node.nodeSize)
      const insertion = tr.mapping.map(blocks[0].pos, -1)
      tr.insert(
        insertion,
        editor.schema.nodes.imageGallery.create({ images, width: images[0].width ?? null }),
      )
      tr.setMeta(blockSelectionKey, [])
    }
    if (action === 'delete') tr = deleteBlocks(editor.state, positions)
    if (action === 'duplicate') {
      tr = duplicateBlocks(editor.state, positions)
    }
    if (action === 'up' || action === 'down') {
      // Move selected runs one place without separating their blocks or changing other content.
      const resolved = editor.state.doc.resolve(pos)
      const parent = resolved.parent
      const start = resolved.start()
      const siblings: typeof blocks = []
      parent.forEach((node, offset) => siblings.push({ node, pos: start + offset }))
      const sameParent = blocks.every(
        (block) => editor.state.doc.resolve(block.pos).start() === start,
      )
      const order = [...siblings]
      if (action === 'up') {
        for (let i = 1; i < order.length; i++)
          if (positions.includes(order[i].pos) && !positions.includes(order[i - 1].pos))
            [order[i - 1], order[i]] = [order[i], order[i - 1]]
      } else {
        for (let i = order.length - 2; i >= 0; i--)
          if (positions.includes(order[i].pos) && !positions.includes(order[i + 1].pos))
            [order[i], order[i + 1]] = [order[i + 1], order[i]]
      }
      if (
        sameParent &&
        order.some((block, i) => block !== siblings[i]) &&
        parent.type.validContent(Fragment.from(order.map((b) => b.node)))
      ) {
        tr.replaceWith(start, start + parent.content.size, Fragment.from(order.map((b) => b.node)))
        let next = start
        const moved: number[] = []
        for (const block of order) {
          if (positions.includes(block.pos)) moved.push(next)
          next += block.node.nodeSize
        }
        tr.setMeta(blockSelectionKey, selectedPositions.length ? moved : [])
      }
    }
    if (action.startsWith('type:')) {
      const id = action.slice(5)
      const content = node.isTextblock
        ? node.content.toJSON()
        : [
            {
              type: 'text',
              text:
                (node.type.name === 'jiraIssue' ? plainText(node.toJSON()) : '') ||
                jiraEditorText(node) ||
                String(node.attrs.source ?? node.attrs.latex ?? node.attrs.label ?? ''),
            },
          ].filter((n) => n.text)
      const paragraph = { type: 'paragraph', content }
      const replacement: JSONContent =
        id === 'text'
          ? paragraph
          : /^h[1-4]$/.test(id)
            ? { type: 'heading', attrs: { level: Number(id[1]) }, content }
            : id === 'code'
              ? {
                  type: 'codeBlock',
                  content: [
                    {
                      type: 'text',
                      text:
                        (node.type.name === 'jiraIssue' ? plainText(node.toJSON()) : '') ||
                        jiraEditorText(node) ||
                        String(node.attrs.latex ?? ''),
                    },
                  ].filter((n) => n.text),
                }
              : id === 'quote'
                ? { type: 'blockquote', content: [paragraph] }
                : id === 'callout'
                  ? { type: 'callout', attrs: { emoji: '💡' }, content: [paragraph] }
                  : id === 'todo'
                    ? {
                        type: 'taskList',
                        content: [
                          { type: 'taskItem', attrs: { checked: false }, content: [paragraph] },
                        ],
                      }
                    : {
                        type: id === 'bullet' ? 'bulletList' : 'orderedList',
                        content: [{ type: 'listItem', content: [paragraph] }],
                      }
      editor
        .chain()
        .focus()
        .insertContentAt({ from: pos, to: pos + node.nodeSize }, replacement)
        .run()
    } else {
      editor.view.dispatch(tr)
      editor.view.dispatch(closeHistory(editor.state.tr))
    }
    setBlockMenu(null)
    editor.commands.focus()
  }
  const insertBlock = (before: boolean) => {
    if (blockPos === null) return
    const node = editor.state.doc.nodeAt(blockPos)
    if (!node) return
    const pos = before ? blockPos : blockPos + node.nodeSize
    editor
      .chain()
      .focus()
      .insertContentAt(pos, { type: 'paragraph' })
      .setTextSelection(pos + 1)
      .unsetAllMarks()
      .run()
    refreshPalette(editor)
  }
  return (
    <div className="block-editor">
      <FindReplacePanel key={page.id} editor={editor} />
      <BubbleMenu
        editor={editor}
        options={{ placement: 'top' }}
        shouldShow={({ editor, state }) =>
          editor.isFocused &&
          !state.selection.empty &&
          !(state.selection instanceof NodeSelection) &&
          !editor.isActive('codeBlock') &&
          !selectedBlocks(state).length
        }
      >
        <div className="format-toolbar">
          {[
            {
              name: 'Bold',
              icon: Bold,
              active: 'bold',
              fn: () => editor.chain().focus().toggleBold().run(),
            },
            {
              name: 'Italic',
              icon: Italic,
              active: 'italic',
              fn: () => editor.chain().focus().toggleItalic().run(),
            },
            {
              name: 'Strike',
              icon: Strikethrough,
              active: 'strike',
              fn: () => editor.chain().focus().toggleStrike().run(),
            },
            {
              name: 'Inline code',
              icon: Code,
              active: 'code',
              fn: () => editor.chain().focus().toggleCode().run(),
            },
          ].map((item) => (
            <button
              aria-label={t(item.name)}
              title={t(item.name)}
              className={editor.isActive(item.active) ? 'active' : ''}
              key={t(item.name)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={item.fn}
            >
              <item.icon size={16} />
            </button>
          ))}
          <span />
          <button
            title={t('Add link')}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setLink(editor.getAttributes('link').href ?? '')}
          >
            <Link size={16} />
          </button>
          <button
            title={t('Inline formula')}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setMath({ latex: 'x^2', inline: true })}
          >
            <Sigma size={16} />
          </button>
        </div>
      </BubbleMenu>
      <DragHandle
        editor={editor}
        getReferencedVirtualElement={() => {
          const pos = blockPosRef.current
          const dom = pos === null ? null : editor.view.nodeDOM(pos)
          if (!(dom instanceof HTMLElement)) return null
          return {
            getBoundingClientRect: () => {
              const block = dom.getBoundingClientRect()
              const document = editor.view.dom.getBoundingClientRect()
              return new DOMRect(document.left, block.top, document.width, block.height)
            },
          }
        }}
        nested={{
          edgeDetection: 'none',
          defaultRules: false,
          rules: [
            {
              id: 'independent-nested-blocks',
              evaluate: ({ node, depth, $pos }) => {
                const inContainer = Array.from(
                  { length: depth },
                  (_, i) => $pos.node(i).type.name,
                ).some((name) =>
                  ['bulletList', 'orderedList', 'taskList', 'detailsContent'].includes(name),
                )
                return !node.isBlock ||
                  (depth > 1 && !inContainer) ||
                  [
                    'bulletList',
                    'orderedList',
                    'taskList',
                    'listItem',
                    'taskItem',
                    'detailsSummary',
                    'detailsContent',
                    'tableRow',
                    'tableCell',
                    'tableHeader',
                  ].includes(node.type.name)
                  ? 1000
                  : 0
              },
            },
          ],
        }}
        onNodeChange={({ node, pos }) => {
          if (node) {
            setBlockPos(pos)
            setBlockIsTable(node.type.name === 'table')
            blockPosRef.current = pos
          }
        }}
      >
        <div className={'block-controls' + (blockIsTable ? ' table-block-controls' : '')}>
          <button
            className="block-insert-button"
            title={t('Insert block above')}
            aria-label={t('Insert block above')}
            onMouseDown={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
            onClick={(e) => {
              e.stopPropagation()
              insertBlock(true)
            }}
          >
            <Plus size={15} />
          </button>
          <button
            title={t('Drag to move · Click for block options')}
            aria-label={t('Block options')}
            onClick={(e) => {
              if (blockPos === null) return
              if (e.shiftKey || e.metaKey || e.ctrlKey) {
                const positions = selectedBlocks(editor.state)
                selectBlocks(
                  editor.view,
                  positions.includes(blockPos)
                    ? positions.filter((p) => p !== blockPos)
                    : [...positions, blockPos],
                )
                editor.view.focus()
                return
              }
              const rect = e.currentTarget.getBoundingClientRect()
              setBlockMenu({
                x: (e.detail === 0 ? rect.right : e.clientX) + 8,
                y: e.detail === 0 ? rect.top : e.clientY,
                pos: blockPos,
              })
            }}
          >
            <GripVertical size={17} />
          </button>
          <button
            className="block-insert-button"
            title={t('Insert block below')}
            aria-label={t('Insert block below')}
            onMouseDown={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
            onClick={(e) => {
              e.stopPropagation()
              insertBlock(false)
            }}
          >
            <Plus size={15} />
          </button>
        </div>
      </DragHandle>
      <div className={'document-with-outline' + (headings.length ? ' has-outline' : '')}>
        <div className="document-main">
          <EditorContent editor={editor} />
          <TableControls editor={editor} />
        </div>
        {!!headings.length && (
          <nav className="page-outline" aria-label={t('Table of contents')}>
            <div className="page-outline-title">{t('Table of contents')}</div>
            {headings.map(({ pos, level, title }) => (
              <button
                key={pos}
                type="button"
                className={outlinePosition === pos ? 'active' : ''}
                aria-current={outlinePosition === pos ? 'location' : undefined}
                style={{ paddingLeft: `${(level - 1) * 12 + 8}px` }}
                onClick={() => {
                  const tr = editor.state.tr
                  const resolved = tr.doc.resolve(pos)
                  for (let depth = resolved.depth; depth > 0; depth--) {
                    const parent = resolved.node(depth)
                    if (parent.type.name === 'details' && !parent.attrs.open)
                      tr.setNodeMarkup(resolved.before(depth), undefined, {
                        ...parent.attrs,
                        open: true,
                      })
                  }
                  tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 1)))
                  editor.view.dispatch(tr)
                  editor.view.focus()
                  // Fold node views reveal their content after the transaction. Measure once
                  // that layout has settled, and align the heading in the reading container.
                  requestAnimationFrame(() => {
                    if (editor.isDestroyed) return
                    const element = editor.view.nodeDOM(pos)
                    const scroll = editor.view.dom.closest<HTMLElement>('.content-scroll')
                    if (!(element instanceof HTMLElement) || !scroll) return
                    scroll.scrollTo({
                      top:
                        scroll.scrollTop +
                        element.getBoundingClientRect().top -
                        scroll.getBoundingClientRect().top -
                        24,
                      behavior: 'instant',
                    })
                    setOutlinePosition(pos)
                  })
                }}
              >
                {title}
              </button>
            ))}
          </nav>
        )}
      </div>
      {documentTemplatesAvailable && templateInsertion && w!.plugins.documentTemplates.enabled && (
        <CreateTemplatePageDialog
          insert={{
            page,
            apply: (content) => {
              const request = templateInsertion
              const current = editorRef.current
              if (
                !current ||
                current.isDestroyed ||
                current !== request.editor ||
                workspaceRef.current?.id !== request.workspaceId ||
                workspaceRef.current.ui.activeId !== page.id ||
                remoteVersion !== request.remoteVersion ||
                !current.state.doc.eq(request.document)
              )
                return false
              const transaction = templateTransaction(current.state, content, request.range)
              validateEditorDocument(transaction.doc.toJSON() as DocNode)
              current.view.dispatch(transaction)
              current.view.dispatch(closeHistory(current.state.tr))
              current.view.focus()
              return true
            },
          }}
          onClose={() => {
            setTemplateInsertion(null)
            if (editorRef.current && !editorRef.current.isDestroyed) editorRef.current.view.focus()
          }}
          onManage={() => {
            setTemplateInsertion(null)
            openPage(documentTemplatesSettingsTab, true)
          }}
        />
      )}
      {imageImport && (
        <Modal title={t('Insert images')} onClose={() => imageImport.resolve(null)}>
          <div className="modal-content">
            <p>
              {imageImport.count} {t('images selected. Choose how to arrange them.')}
            </p>
            <div className="media-import-options">
              <button
                className="button"
                aria-label={t('Separate images')}
                onClick={() => imageImport.resolve('separate')}
              >
                <ImageIcon size={20} />
                <strong>{t('Separate images')}</strong>
                <span>{t('One image per block')}</span>
              </button>
              <button
                className="button"
                aria-label={t('Image slider')}
                onClick={() => imageImport.resolve('slider')}
              >
                <ImageIcon size={20} />
                <strong>{t('Image slider')}</strong>
                <span>{t('Browse the images in one block')}</span>
              </button>
            </div>
          </div>
        </Modal>
      )}
      {palette && (
        <div className="command-palette" style={{ left: palette.x, top: palette.y }} role="listbox">
          <div className="palette-label">
            {palette.type === 'wiki' ? t('Link a page') : t('Add a block')}
            <span>{t('↑↓ to navigate')}</span>
          </div>
          <div className="palette-scroll">
            {palette.type === 'slash'
              ? commandOptions.map((c, i) => (
                  <button
                    key={c.id}
                    className={i === selected ? 'is-selected' : ''}
                    role="option"
                    aria-selected={i === selected}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => {
                      setSelected(i)
                      selectedRef.current = i
                    }}
                    onClick={() => execute(c.id)}
                  >
                    <span className="command-icon">
                      <c.icon size={19} />
                    </span>
                    <span>
                      <strong>{t(c.name)}</strong>
                      <small>{t(c.description)}</small>
                    </span>
                  </button>
                ))
              : pageOptions.map((p, i) => (
                  <button
                    key={p.id}
                    className={i === selected ? 'is-selected' : ''}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => {
                      setSelected(i)
                      selectedRef.current = i
                    }}
                    onClick={() => chosenRef.current(i)}
                  >
                    <PageIcon icon={p.icon} />
                    <span>
                      <strong>{p.title || t('Untitled')}</strong>
                      <small>{p.databaseId ? t('Database entry') : t('Page')}</small>
                    </span>
                  </button>
                ))}
            {optionsRef.current === 0 && (
              <div className="empty-hint">{t('No matches. Try a different name.')}</div>
            )}
          </div>
        </div>
      )}
      {blockMenu && (
        <BlockMenu
          x={blockMenu.x}
          y={blockMenu.y}
          onClose={() => {
            setBlockMenu(null)
          }}
        >
          {selectionCount > 1 ? (
            <div className="popover-title">
              {t('{count} blocks selected', { count: selectionCount })}
            </div>
          ) : (
            <BlockSubmenu label={t('Turn into…')} icon={<Type size={15} />}>
              {commands
                .filter((c) =>
                  [
                    'text',
                    'h1',
                    'h2',
                    'h3',
                    'h4',
                    'todo',
                    'bullet',
                    'number',
                    'quote',
                    'callout',
                    'code',
                  ].includes(c.id),
                )
                .map((c) => (
                  <MenuItem
                    key={c.id}
                    role="menuitem"
                    icon={<c.icon size={15} />}
                    onClick={() => blockAction('type:' + c.id)}
                  >
                    {t(c.name)}
                  </MenuItem>
                ))}
            </BlockSubmenu>
          )}
          {selectionCount > 1 &&
            blockNodes(editor.state.doc, selectedBlocks(editor.state)).every((b) =>
              ['image', 'imageGallery'].includes(b.node.type.name),
            ) && (
              <MenuItem icon={<ImageIcon size={15} />} onClick={() => blockAction('gallery')}>
                {t('Combine into slider')}
              </MenuItem>
            )}
          {selectionCount < 2 && codeCommentSelection(editor.state)?.pos === blockMenu.pos && (
            <MenuItem
              icon={<MessageSquare size={15} />}
              onClick={() => {
                setBlockMenu(null)
                requestCodeComment(editor.view)
              }}
            >
              {t('Add comment')}
            </MenuItem>
          )}
          <MenuItem icon={<ArrowUp size={15} />} onClick={() => blockAction('up')}>
            {t('Move up')}
          </MenuItem>
          <MenuItem icon={<ArrowDown size={15} />} onClick={() => blockAction('down')}>
            {t('Move down')}
          </MenuItem>
          <MenuItem icon={<Copy size={15} />} onClick={() => blockAction('duplicate')}>
            {t('Duplicate')}
          </MenuItem>
          <div className="menu-separator" />
          <MenuItem danger icon={<Trash2 size={15} />} onClick={() => blockAction('delete')}>
            {t(selectionCount > 1 ? 'Delete blocks' : 'Delete block')}
          </MenuItem>
        </BlockMenu>
      )}
      {picker && (
        <Modal title={t('Link to a page')} onClose={() => setPicker(false)}>
          <div className="modal-content">
            <div className="search-input">
              <Search size={17} />
              <input
                autoFocus
                placeholder={t('Find a page…')}
                value={pickerQuery}
                onChange={(e) => setPickerQuery(e.target.value)}
              />
            </div>
            <div className="picker-list">
              {w!.pages
                .filter(
                  (p) =>
                    !p.deletedAt &&
                    p.id !== page.id &&
                    p.title.toLowerCase().includes(pickerQuery.toLowerCase()),
                )
                .map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      editor
                        .chain()
                        .focus()
                        .insertContent({
                          type: 'pageLink',
                          attrs: { pageId: p.id, label: p.title },
                        })
                        .run()
                      setPicker(false)
                    }}
                  >
                    <PageIcon icon={p.icon} />
                    {p.title || t('Untitled')}
                  </button>
                ))}
            </div>
          </div>
        </Modal>
      )}
      {link !== null && (
        <Modal title={t('Edit link')} onClose={() => setLink(null)}>
          <form
            className="modal-content"
            onSubmit={(e) => {
              e.preventDefault()
              if (!link) editor.chain().focus().unsetLink().run()
              else if (/^(https?:\/\/|mailto:)/i.test(link))
                editor.chain().focus().extendMarkRange('link').setLink({ href: link }).run()
              else {
                notify(t('Use an http, https, or mailto link.'))
                return
              }
              setLink(null)
            }}
          >
            <label>
              {t('Web or email address')}
              <input
                autoFocus
                placeholder={t('https://example.com')}
                value={link}
                onChange={(e) => setLink(e.target.value)}
              />
            </label>
            <div className="modal-actions">
              <button
                className="button"
                type="button"
                onClick={() => {
                  editor.chain().focus().unsetLink().run()
                  setLink(null)
                }}
              >
                {t('Remove link')}
              </button>
              <button className="button primary" type="submit">
                <Check size={15} />
                {t('Save link')}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {math && (
        <Modal
          title={math.inline ? t('Inline formula') : t('Math formula')}
          onClose={() => setMath(null)}
        >
          <form
            className="modal-content"
            onSubmit={(e) => {
              e.preventDefault()
              if (math.pos !== undefined) {
                if (math.inline)
                  editor.commands.updateInlineMath({ latex: math.latex, pos: math.pos })
                else editor.commands.updateBlockMath({ latex: math.latex, pos: math.pos })
              } else {
                if (math.inline)
                  editor.chain().focus().insertInlineMath({ latex: math.latex }).run()
                else editor.chain().focus().insertBlockMath({ latex: math.latex }).run()
              }
              setMath(null)
            }}
          >
            <label>
              {t('LaTeX expression')}
              <textarea
                autoFocus
                rows={4}
                value={math.latex}
                onChange={(e) => setMath({ ...math, latex: e.target.value })}
              />
            </label>
            <div className="modal-actions">
              <button className="button primary" type="submit">
                {t('Save formula')}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}
