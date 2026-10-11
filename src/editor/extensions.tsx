import { useI18n } from '../i18n'
import { Node, mergeAttributes, InputRule } from '@tiptap/core'
import {
  NodeViewWrapper,
  NodeViewContent,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from '@tiptap/react'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { closeHistory } from '@tiptap/pm/history'
import { createLowlight, common } from 'lowlight'
import {
  Copy,
  Check,
  ArrowUpRight,
  File,
  FileText,
  ChevronDown,
  Search,
  MoreHorizontal,
  Table2,
  Settings2,
  ChevronRight,
  MessageSquare,
  Trash2,
  Pencil,
  PanelsTopLeft,
  RectangleHorizontal,
  Square,
  Link2,
} from 'lucide-react'
import { useState, useRef, useEffect, type MouseEvent, type KeyboardEvent } from 'react'
import { useApp } from '../state'
import { PageIcon, Popover, MenuItem } from '../components/ui'
import { attachmentViews } from '../shared/media'
import { selectBlocks, selectedBlocks } from './BlockSelection'
import {
  codeCommentsPlugin,
  codeComments,
  codeCommentSelection,
  codeCommentsKey,
  requestCodeComment,
  commentLines,
  type CodeComment,
} from './CodeComments'
import { IconPicker } from '../components/IconPicker'
import { DatabaseView } from '../components/Database'
const lowlight = createLowlight(common)
function CodeView({ node, updateAttributes, editor, getPos }: NodeViewProps) {
  const { t, language } = useI18n()

  const [copied, setCopied] = useState(false)
  const [chooseLanguage, setChooseLanguage] = useState(false)
  const [query, setQuery] = useState('')
  const [configure, setConfigure] = useState(false)
  const [title, setTitle] = useState('')
  const [lineNumbers, setLineNumbers] = useState(false)
  const [collapsedDefault, setCollapsedDefault] = useState(false)
  const [collapsed, setCollapsed] = useState(!!node.attrs.collapsedByDefault)
  const settingsAnchor = useRef<HTMLButtonElement>(null)
  const languageAnchor = useRef<HTMLButtonElement>(null)
  const commentAnchor = useRef<HTMLButtonElement>(null)
  const activePreviewAnchor = useRef<HTMLElement | null>(null)
  const editAnchor = useRef<HTMLElement | null>(null)
  const [commentPreview, setCommentPreview] = useState<{
    ids: string[]
    anchor: { current: HTMLElement }
    pinned: boolean
  } | null>(null)
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelDismiss = () => {
    if (dismissTimer.current) clearTimeout(dismissTimer.current)
    dismissTimer.current = null
  }
  const dismissPreview = (expected?: HTMLElement) => {
    // A queued scroll callback from the previous range must not close its replacement.
    if (expected && activePreviewAnchor.current !== expected) return
    cancelDismiss()
    activePreviewAnchor.current = null
    setCommentPreview(null)
  }
  const leaveComment = () => {
    if (commentPreview?.pinned) return
    cancelDismiss()
    const anchor = activePreviewAnchor.current
    dismissTimer.current = setTimeout(() => {
      if (anchor) dismissPreview(anchor)
    }, 180)
  }
  useEffect(
    () => () => {
      if (dismissTimer.current) clearTimeout(dismissTimer.current)
    },
    [],
  )
  const [range, setRange] = useState<{ from: number; to: number } | null>(null)
  const [commentDraft, setCommentDraft] = useState<{
    id?: string
    from: number
    to: number
    text: string
  } | null>(null)
  const draftRef = useRef(commentDraft)
  draftRef.current = commentDraft
  const [commentText, setCommentText] = useState('')
  const comments = codeComments(node)
  const changeComments = (comments: CodeComment[]) => {
    const pos = getPos()
    if (typeof pos !== 'number' || editor.isDestroyed) return
    const current = editor.state.doc.nodeAt(pos)
    if (current?.type.name !== 'codeBlock') return
    editor.view.dispatch(
      closeHistory(editor.state.tr).setNodeMarkup(pos, undefined, { ...current.attrs, comments }),
    )
    editor.view.dispatch(closeHistory(editor.state.tr))
  }
  useEffect(() => {
    const refresh = ({ transaction }: { transaction?: typeof editor.state.tr } = {}) => {
      const pos = getPos()
      if (typeof pos !== 'number') return
      const selected = codeCommentSelection(editor.state)
      setRange(selected?.pos === pos ? selected : null)
      const requested = transaction?.getMeta(codeCommentsKey) as typeof selected | undefined
      if (requested?.pos === pos) {
        dismissPreview()
        setCommentText('')
        setCommentDraft({ from: requested.from, to: requested.to, text: '' })
      }
      const draft = draftRef.current
      if (draft && !draft.id && transaction?.docChanged) {
        const oldPos = transaction.mapping.invert().map(pos)
        const nextFrom = transaction.mapping.map(oldPos + 1 + draft.from, 1) - pos - 1
        const nextTo = transaction.mapping.map(oldPos + 1 + draft.to, -1) - pos - 1
        setCommentDraft(nextTo > nextFrom ? { ...draft, from: nextFrom, to: nextTo } : null)
      }
    }
    refresh()
    editor.on('transaction', refresh)
    return () => {
      editor.off('transaction', refresh)
    }
  }, [editor, getPos, node.nodeSize])
  const editComment = (comment: CodeComment) => {
    editAnchor.current = commentPreview?.anchor.current ?? null
    dismissPreview()
    setCommentText(comment.text)
    setCommentDraft(comment)
  }
  const showComment = (target: EventTarget | null, pinned: boolean) => {
    if (!(target instanceof HTMLElement) || commentDraft) return
    const highlight = target.closest<HTMLElement>('[data-code-comment]')
    if (!highlight) return
    cancelDismiss()
    if (commentPreview?.pinned && !pinned) return
    const pos = getPos()
    if (typeof pos !== 'number') return
    const offset = editor.view.posAtDOM(highlight, 0) - pos - 1
    const ids = comments
      .filter((comment) => comment.from <= offset && comment.to > offset)
      .map((comment) => comment.id)
    if (!ids.length) return
    activePreviewAnchor.current = highlight
    setCommentPreview((current) =>
      current?.anchor.current === highlight
        ? { ...current, pinned: current.pinned || pinned }
        : { ids, anchor: { current: highlight }, pinned },
    )
  }
  useEffect(() => setCollapsed(!!node.attrs.collapsedByDefault), [node.attrs.collapsedByDefault])
  const { run } = useApp()
  return (
    <NodeViewWrapper
      className={'code-block' + (collapsed ? ' is-collapsed' : '')}
      spellCheck={false}
      onClick={(event: MouseEvent<HTMLElement>) => {
        if (editor.state.selection.empty) showComment(event.target, true)
      }}
      onMouseOver={(event: MouseEvent<HTMLElement>) => showComment(event.target, false)}
      onMouseOut={(event: MouseEvent<HTMLElement>) => {
        const highlight = (event.target as HTMLElement).closest('[data-code-comment]')
        if (
          highlight &&
          !(
            event.relatedTarget instanceof globalThis.Node &&
            highlight.contains(event.relatedTarget)
          )
        )
          leaveComment()
      }}
      onKeyDownCapture={(event: KeyboardEvent<HTMLElement>) => {
        if (
          (event.key === 'Enter' || event.key === ' ') &&
          (event.target as HTMLElement).matches('[data-code-comment]')
        ) {
          event.preventDefault()
          event.stopPropagation()
          showComment(event.target, true)
        }
      }}
    >
      {node.attrs.title && (
        <div className="code-title" contentEditable={false}>
          {node.attrs.title}
        </div>
      )}
      <div className="code-header" contentEditable={false}>
        <div className="code-heading-controls">
          <button
            className="code-collapse"
            aria-label={t(collapsed ? 'Expand code' : 'Collapse code')}
            aria-expanded={!collapsed}
            onClick={() => setCollapsed(!collapsed)}
          >
            <ChevronRight size={14} />
          </button>
          <button
            ref={languageAnchor}
            aria-label={t('Code language')}
            className="code-language"
            onClick={() => {
              setQuery('')
              setChooseLanguage(true)
            }}
          >
            {node.attrs.language || t('Plain text')} <ChevronDown size={12} />
          </button>
        </div>
        <div className="code-actions">
          <button
            ref={commentAnchor}
            aria-label={t('Comment on selection')}
            title={t('Comment on selection')}
            disabled={!range && !commentDraft}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              if (!range) return
              requestCodeComment(editor.view)
            }}
          >
            <MessageSquare size={14} />
          </button>
          <button
            ref={settingsAnchor}
            aria-label={t('Code block settings')}
            title={t('Code block settings')}
            onClick={() => {
              setTitle(node.attrs.title || '')
              setLineNumbers(!!node.attrs.lineNumbers)
              setCollapsedDefault(!!node.attrs.collapsedByDefault)
              setConfigure(!configure)
            }}
          >
            <Settings2 size={14} />
          </button>
          <button
            onClick={() =>
              run(async () => {
                await window.sheco.copyText(node.textContent)
                setCopied(true)
                setTimeout(() => setCopied(false), 2000)
              })
            }
          >
            {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? t('Copied') : t('Copy')}
          </button>
        </div>
      </div>
      <pre hidden={collapsed} className={node.attrs.lineNumbers ? 'with-line-numbers' : ''}>
        {node.attrs.lineNumbers && (
          <span className="code-line-numbers" contentEditable={false} aria-hidden="true">
            {node.textContent.split('\n').map((_, i) => (
              <span key={i}>{i + 1}</span>
            ))}
          </span>
        )}
        <NodeViewContent<'code'> as="code" spellCheck={false} />
      </pre>
      {!!comments.length && (
        <div className="code-comments-print" contentEditable={false}>
          {comments.map((comment) => (
            <div key={comment.id}>
              <span>{t('Lines {lines}', { lines: commentLines(node.textContent, comment) })}</span>
              <q>{node.textContent.slice(comment.from, comment.to)}</q>
              <p>{comment.text}</p>
            </div>
          ))}
        </div>
      )}
      {commentPreview && !commentDraft && !collapsed && (
        <Popover
          anchor={commentPreview.anchor}
          className="code-comment-preview"
          onClose={() => dismissPreview(commentPreview.anchor.current)}
        >
          <div
            role="dialog"
            aria-label={t('Code comment')}
            onMouseEnter={cancelDismiss}
            onMouseLeave={leaveComment}
          >
            {comments
              .filter((comment) => commentPreview.ids.includes(comment.id))
              .map((comment) => (
                <div className="code-comment-preview-item" key={comment.id}>
                  <p>{comment.text}</p>
                  <button
                    aria-label={t('Edit comment')}
                    title={t('Edit comment')}
                    onClick={() => editComment(comment)}
                  >
                    <Pencil size={13} />
                  </button>
                </div>
              ))}
          </div>
        </Popover>
      )}
      {commentDraft && (
        <Popover
          anchor={commentDraft.id ? editAnchor : commentAnchor}
          align="end"
          className="code-comment-popover"
          onClose={() => setCommentDraft(null)}
        >
          <form
            role="dialog"
            aria-label={t('Code comment')}
            onSubmit={(event) => {
              event.preventDefault()
              if (!commentText.trim()) return
              const latest = commentDraft.id
                ? comments.find((c) => c.id === commentDraft.id)
                : commentDraft
              if (!latest || latest.from < 0 || latest.to > node.content.size) return
              const comment = {
                ...latest,
                id: commentDraft.id ?? crypto.randomUUID(),
                text: commentText.trim(),
              }
              changeComments(
                commentDraft.id
                  ? comments.map((c) => (c.id === comment.id ? comment : c))
                  : [...comments, comment],
              )
              setCommentDraft(null)
              editor.view.focus()
            }}
          >
            <div className="popover-title">{t('Code comment')}</div>
            <textarea
              autoFocus
              aria-label={t('Comment')}
              maxLength={4000}
              rows={3}
              value={commentText}
              onChange={(event) => setCommentText(event.target.value)}
            />
            <div className="modal-actions">
              {commentDraft.id && (
                <button
                  type="button"
                  className="button"
                  aria-label={t('Delete comment')}
                  onClick={() => {
                    changeComments(comments.filter((c) => c.id !== commentDraft.id))
                    setCommentDraft(null)
                  }}
                >
                  <Trash2 size={14} />
                </button>
              )}
              <button type="button" className="button" onClick={() => setCommentDraft(null)}>
                {t('Cancel')}
              </button>
              <button type="submit" className="button primary" disabled={!commentText.trim()}>
                {t('Save')}
              </button>
            </div>
          </form>
        </Popover>
      )}
      {configure && (
        <Popover
          anchor={settingsAnchor}
          align="end"
          className="code-settings-popover"
          onClose={() => setConfigure(false)}
        >
          <form
            role="dialog"
            aria-label={t('Code block settings')}
            className="code-settings-content"
            onSubmit={(e) => {
              e.preventDefault()
              updateAttributes({
                title: title.trim(),
                lineNumbers,
                collapsedByDefault: collapsedDefault,
              })
              setConfigure(false)
            }}
          >
            <div className="popover-title">{t('Code block settings')}</div>
            <label className="field-label">
              {t('Block title')}
              <input
                aria-label={t('Block title')}
                placeholder={t('e.g. Example request')}
                maxLength={200}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label className="code-settings-toggle">
              <input
                type="checkbox"
                checked={lineNumbers}
                onChange={(e) => setLineNumbers(e.target.checked)}
              />
              {t('Show line numbers')}
            </label>
            <label className="code-settings-toggle">
              <input
                type="checkbox"
                checked={collapsedDefault}
                onChange={(e) => setCollapsedDefault(e.target.checked)}
              />
              {t('Collapsed by default')}
            </label>
            <div className="modal-actions">
              <button className="button" type="button" onClick={() => setConfigure(false)}>
                {t('Cancel')}
              </button>
              <button className="button primary" type="submit">
                {t('Save')}
              </button>
            </div>
          </form>
        </Popover>
      )}
      {chooseLanguage && (
        <Popover
          anchor={languageAnchor}
          className="code-language-popover"
          onClose={() => setChooseLanguage(false)}
        >
          <div role="dialog" aria-label={t('Code language')}>
            <div className="search-input">
              <Search size={16} />
              <input
                autoFocus
                aria-label={t('Search languages')}
                placeholder={t('Search languages…')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className="language-options" role="listbox" aria-label={t('Languages')}>
              {['', ...lowlight.listLanguages().sort()]
                .filter((l) => (l || t('Plain text')).toLowerCase().includes(query.toLowerCase()))
                .map((l) => (
                  <button
                    key={l}
                    role="option"
                    aria-selected={(node.attrs.language || '') === l}
                    onClick={() => {
                      updateAttributes({ language: l || null })
                      setChooseLanguage(false)
                    }}
                  >
                    <span>{l || t('Plain text')}</span>
                    {(node.attrs.language || '') === l && <Check size={15} />}
                  </button>
                ))}
            </div>
          </div>
        </Popover>
      )}
    </NodeViewWrapper>
  )
}
export const CodeBlock = CodeBlockLowlight.extend({
  parseMarkdown: (token, helpers) => {
    if (
      token.raw?.startsWith('```') === false &&
      token.raw?.startsWith('~~~') === false &&
      token.codeBlockStyle !== 'indented'
    )
      return []
    return token.lang?.toLowerCase() === 'mermaid'
      ? helpers.createNode('mermaid', { source: token.text ?? '', positions: {} })
      : helpers.createNode(
          'codeBlock',
          { language: token.lang || null },
          token.text ? [helpers.createTextNode(token.text)] : [],
        )
  },
  addKeyboardShortcuts() {
    return {
      ...this.parent?.(),
      Tab: () =>
        this.editor.commands.command(({ tr }) => {
          const { $from, $to } = tr.selection
          if ($from.parent.type !== this.type || !$from.sameParent($to)) return false
          tr.insertText('\t')
          return true
        }),
    }
  },
  addAttributes() {
    return {
      ...this.parent?.(),
      title: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-code-title') ?? '',
        renderHTML: (attrs) => ({ 'data-code-title': attrs.title }),
      },
      lineNumbers: {
        default: false,
        parseHTML: (element) => element.getAttribute('data-line-numbers') === 'true',
        renderHTML: (attrs) => ({ 'data-line-numbers': String(attrs.lineNumbers) }),
      },
      collapsedByDefault: {
        default: false,
        parseHTML: (element) => element.getAttribute('data-collapsed') === 'true',
        renderHTML: (attrs) => ({ 'data-collapsed': String(attrs.collapsedByDefault) }),
      },
      comments: {
        default: [],
        parseHTML: (element) => {
          try {
            const comments = JSON.parse(element.getAttribute('data-code-comments') ?? '[]')
            return Array.isArray(comments)
              ? comments
                  .filter(
                    (comment) =>
                      comment &&
                      typeof comment.id === 'string' &&
                      typeof comment.text === 'string' &&
                      comment.text.trim() &&
                      comment.text.length <= 4000 &&
                      Number.isInteger(comment.from) &&
                      Number.isInteger(comment.to) &&
                      comment.from >= 0 &&
                      comment.to > comment.from &&
                      comment.to <= element.textContent!.length,
                  )
                  .slice(0, 500)
              : []
          } catch {
            return []
          }
        },
        renderHTML: (attrs) => ({ 'data-code-comments': JSON.stringify(attrs.comments) }),
      },
    }
  },
  addNodeView() {
    return ReactNodeViewRenderer(CodeView)
  },
  addProseMirrorPlugins() {
    return [...(this.parent?.() ?? []), codeCommentsPlugin()]
  },
}).configure({ lowlight, defaultLanguage: null })
function CalloutView({ node, updateAttributes }: NodeViewProps) {
  const { t, language } = useI18n()

  const [customize, setCustomize] = useState(false)
  const color = ['gray', 'yellow', 'red', 'green'].includes(node.attrs.color)
    ? node.attrs.color
    : 'gray'
  return (
    <NodeViewWrapper className={'callout-block callout-' + color} data-color={color}>
      <button
        className="callout-emoji"
        contentEditable={false}
        title={t('Customize callout')}
        aria-label={t('Customize callout')}
        onClick={() => setCustomize(true)}
      >
        {node.attrs.emoji}
      </button>
      <NodeViewContent className="callout-content" />
      <button
        className="callout-options"
        contentEditable={false}
        aria-label={t('Callout background and icon')}
        onClick={() => setCustomize(true)}
      >
        <MoreHorizontal size={16} />
      </button>
      {customize && (
        <IconPicker
          title={t('Customize callout')}
          emojisOnly
          value={node.attrs.emoji}
          onSelect={(emoji) => {
            updateAttributes({ emoji })
            setCustomize(false)
          }}
          onClose={() => setCustomize(false)}
        >
          <div className="callout-colors" aria-label={t('Callout background')}>
            {['gray', 'yellow', 'red', 'green'].map((c) => (
              <button
                key={c}
                aria-label={c + t(' background')}
                aria-pressed={color === c}
                className={'color-choice ' + c}
                onClick={() => updateAttributes({ color: c })}
              >
                <span />
                {t(c[0].toUpperCase() + c.slice(1))}
                {color === c && <Check size={13} />}
              </button>
            ))}
          </div>
        </IconPicker>
      )}
    </NodeViewWrapper>
  )
}
export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() {
    return { emoji: { default: '💡' }, color: { default: 'gray' } }
  },
  parseHTML() {
    return [{ tag: 'div[data-type="callout"]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'callout' }), 0]
  },
  addNodeView() {
    return ReactNodeViewRenderer(CalloutView)
  },
})
function PageLinkView({ node }: NodeViewProps) {
  const { t, language } = useI18n()

  const { w, openPage } = useApp()
  const page = w?.pages.find((p) => p.id === node.attrs.pageId && !p.deletedAt)
  return (
    <NodeViewWrapper
      className={'page-link-block ' + (!page ? 'missing' : '')}
      contentEditable={false}
    >
      <button
        onClick={(e) => {
          if (page) openPage(page.id, e.metaKey || e.ctrlKey)
        }}
      >
        <PageIcon icon={page?.icon ?? 'file'} size={20} />
        <span className="page-link-title">
          {page?.title || node.attrs.label || t('Deleted page')}
        </span>
        <ArrowUpRight size={15} />
      </button>
    </NodeViewWrapper>
  )
}
export const PageLink = Node.create({
  name: 'pageLink',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return { pageId: { default: '' }, label: { default: 'Page' } }
  },
  parseHTML() {
    return [{ tag: 'div[data-type="page-link"]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'page-link' }),
      HTMLAttributes.label,
    ]
  },
  addNodeView() {
    return ReactNodeViewRenderer(PageLinkView)
  },
})
function WikiView({ node }: NodeViewProps) {
  const { t, language } = useI18n()

  const { w, openPage } = useApp()
  const page = w?.pages.find((p) => p.id === node.attrs.pageId && !p.deletedAt)
  return (
    <NodeViewWrapper as="span" className="wiki-link" contentEditable={false}>
      <button
        title={page ? t('Open ') + page.title : t('Page is in Trash')}
        onClick={(e) => {
          if (page) openPage(page.id, e.metaKey || e.ctrlKey)
        }}
      >
        <FileText size={12} />
        {page?.title || node.attrs.label}
      </button>
    </NodeViewWrapper>
  )
}
export const WikiLink = Node.create<{
  resolveTitle: (title: string) => { id: string; title: string } | undefined
}>({
  name: 'wikiLink',
  group: 'inline',
  inline: true,
  atom: true,
  addOptions() {
    return { resolveTitle: () => undefined }
  },
  addAttributes() {
    return { pageId: { default: '' }, label: { default: 'Page' } }
  },
  parseHTML() {
    return [{ tag: 'span[data-type="wiki-link"]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, { 'data-type': 'wiki-link' }),
      HTMLAttributes.label,
    ]
  },
  addNodeView() {
    return ReactNodeViewRenderer(WikiView)
  },
  addInputRules() {
    return [
      new InputRule({
        find: /\[\[([^\]]+)\]\]$/,
        handler: ({ state, range, match }) => {
          const page = this.options.resolveTitle(match[1])
          if (!page) return null
          state.tr.replaceWith(
            range.from,
            range.to,
            this.type.create({ pageId: page.id, label: page.title }),
          )
        },
      }),
    ]
  },
})
function AttachmentView({ node, editor, getPos }: NodeViewProps) {
  const { t } = useI18n()
  const { run } = useApp()
  const [chooseView, setChooseView] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const display = attachmentViews.includes(node.attrs.display) ? node.attrs.display : 'card'
  const choices = [
    { value: 'card', label: t('Wide card'), icon: PanelsTopLeft },
    { value: 'compact', label: t('Compact rectangle'), icon: RectangleHorizontal },
    { value: 'tile', label: t('Square tile'), icon: Square },
    { value: 'link', label: t('Link with icon'), icon: Link2 },
  ]
  useEffect(() => {
    if (chooseView) menu.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus()
  }, [chooseView])
  function changeView(value: string) {
    const pos = getPos()
    const current = typeof pos === 'number' ? editor.state.doc.nodeAt(pos) : null
    if (typeof pos === 'number' && current?.type.name === 'attachment' && display !== value)
      editor.view.dispatch(
        closeHistory(editor.state.tr).setNodeMarkup(pos, undefined, {
          ...current.attrs,
          display: value,
        }),
      )
    setChooseView(false)
    anchor.current?.focus()
  }
  return (
    <NodeViewWrapper
      className={`attachment-block attachment-${display}`}
      data-file-view={display}
      contentEditable={false}
    >
      <button
        className="attachment-open"
        draggable
        data-drag-handle
        aria-label={t('Open file {name}', { name: node.attrs.name })}
        title={node.attrs.name}
        onClick={(event) => {
          if (event.ctrlKey || event.metaKey || event.shiftKey) {
            const pos = getPos()
            if (typeof pos !== 'number') return
            const positions = selectedBlocks(editor.state)
            selectBlocks(
              editor.view,
              positions.includes(pos)
                ? positions.filter((value) => value !== pos)
                : [...positions, pos],
            )
            editor.view.focus()
            return
          }
          run(() => window.sheco.openAttachment(node.attrs.id))
        }}
      >
        <File size={display === 'tile' ? 32 : display === 'link' ? 16 : 24} />
        <span className="attachment-details">
          <strong>{node.attrs.name}</strong>
          {display !== 'link' && (
            <small>
              {Number(node.attrs.bytes) > 1024 * 1024
                ? (Number(node.attrs.bytes) / 1024 / 1024).toFixed(1) + t(' MB')
                : Math.ceil(Number(node.attrs.bytes) / 1024) + t(' KB')}
              {display === 'card' && ' ' + t('· Local attachment')}
            </small>
          )}
        </span>
      </button>
      <button
        className="attachment-view-button"
        ref={anchor}
        aria-label={t('File view')}
        title={t('File view')}
        aria-expanded={chooseView}
        onClick={() => setChooseView(!chooseView)}
      >
        <PanelsTopLeft size={15} />
      </button>
      {chooseView && (
        <Popover
          anchor={anchor}
          align="end"
          className="attachment-view-menu"
          onClose={() => setChooseView(false)}
        >
          <div
            ref={menu}
            role="group"
            aria-label={t('File view')}
            onKeyDown={(event) => {
              if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
              event.preventDefault()
              const buttons = [...menu.current!.querySelectorAll('button')]
              const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? buttons.length - 1
                    : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) %
                      buttons.length
              buttons[next]?.focus()
            }}
          >
            {choices.map(({ value, label, icon: Icon }) => (
              <MenuItem
                key={value}
                icon={<Icon size={16} />}
                selected={display === value}
                onClick={() => changeView(value)}
              >
                {label}
              </MenuItem>
            ))}
          </div>
        </Popover>
      )}
    </NodeViewWrapper>
  )
}
export const AttachmentNode = Node.create({
  name: 'attachment',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      id: { default: '' },
      file: { default: '' },
      name: { default: 'Attachment' },
      bytes: { default: 0 },
      display: {
        default: 'card',
        parseHTML: (element) => {
          const value = element.getAttribute('data-file-view')
          return attachmentViews.includes(value as (typeof attachmentViews)[number])
            ? value
            : 'card'
        },
        renderHTML: (attrs) => ({ 'data-file-view': attrs.display }),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-type="attachment"]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'attachment' }),
      HTMLAttributes.name,
    ]
  },
  addNodeView() {
    return ReactNodeViewRenderer(AttachmentView)
  },
})

function DatabaseEmbedView({ node }: NodeViewProps) {
  const { t, language } = useI18n()

  const { w, editPage, openPage } = useApp()
  const page = w?.pages.find(
    (p) => p.id === node.attrs.pageId && p.kind === 'database' && !p.deletedAt,
  )
  const db = w?.databases.find((d) => d.pageId === page?.id)
  return (
    <NodeViewWrapper className="database-embed" contentEditable={false}>
      {page && db ? (
        <>
          <div className="embedded-database-heading">
            <Table2 size={18} />
            <input
              aria-label={t('Database name')}
              value={page.title}
              maxLength={500}
              placeholder={t('Untitled database')}
              onChange={(e) => editPage(page.id, { title: e.target.value })}
            />
            <button
              aria-label={t('Open database ') + page.title}
              title={t('Open database page')}
              onClick={() => openPage(page.id, true)}
            >
              <ArrowUpRight size={16} />
            </button>
          </div>
          <DatabaseView page={page} db={db} embedded />
        </>
      ) : (
        <div className="missing-database">
          <Table2 size={18} />
          {t('This database is in Trash or no longer available.')}
        </div>
      )}
    </NodeViewWrapper>
  )
}
export const DatabaseEmbed = Node.create({
  name: 'databaseEmbed',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return { pageId: { default: '' }, label: { default: 'Database' } }
  },
  parseHTML() {
    return [{ tag: 'div[data-type="database-embed"]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'database-embed' }),
      HTMLAttributes.label,
    ]
  },
  addNodeView() {
    return ReactNodeViewRenderer(DatabaseEmbedView)
  },
})
