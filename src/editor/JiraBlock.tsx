import { Node } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { closeHistory } from '@tiptap/pm/history'
import type { DOMOutputSpec } from '@tiptap/pm/model'
import { useEffect, useRef, useState } from 'react'
import {
  ArrowUpRight,
  RefreshCw,
  Ticket,
  Settings2,
  CalendarDays,
  CircleCheck,
  CircleDot,
  Check,
  X,
  Pencil,
} from 'lucide-react'
import { useApp } from '../state'
import { useI18n } from '../i18n'
import { Popover, MenuItem } from '../components/ui'
import { PopoverPicker } from '../components/PopoverPicker'
import {
  jiraIssueAttrsSchema,
  jiraIssueUrl,
  parseJiraKey,
  jiraErrorMessage,
  type JiraIssueAttrs,
} from '../shared/jira'
import { jiraDisplayTransaction } from './jiraTransactions'

function JiraView({ node, editor, getPos }: NodeViewProps) {
  const { w, flush, run } = useApp()
  const { t, language } = useI18n()
  const attrs = jiraIssueAttrsSchema.safeParse(node.attrs).data
  const inline = node.type.name === 'jiraIssueInline'
  const minimal = inline || attrs?.display === 'minimal'
  const current = useRef(w)
  current.current = w
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  const [input, setInput] = useState(node.attrs.issueKey || '')
  const [serverId, setServerId] = useState(
    () =>
      w?.plugins.jira.connections.find((item) => item.baseUrl === node.attrs.baseUrl)?.id ??
      w?.plugins.jira.connections[0]?.id ??
      '',
  )
  const selectedServer = useRef(serverId)
  useEffect(() => {
    if (!serverId && w?.plugins.jira.connections[0]) setServerId(w.plugins.jira.connections[0].id)
  }, [serverId, w?.plugins.jira.connections])
  selectedServer.current = serverId
  const [editing, setEditing] = useState(!node.attrs.issueKey)
  const editingOpen = useRef(editing)
  editingOpen.current = editing
  const inputRef = useRef<HTMLInputElement>(null)
  const insertionRef = useRef<HTMLSpanElement>(null)
  const draft = useRef(input)
  draft.current = input
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [menu, setMenu] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)
  const enabled = !!w?.plugins.jira.enabled
  const change = (patch: Partial<JiraIssueAttrs>) => {
    const pos = getPos()
    if (editor.isDestroyed || typeof pos !== 'number') return
    const latest = editor.state.doc.nodeAt(pos)
    if (latest?.type.name !== node.type.name) return
    if (patch.display) {
      const transaction = jiraDisplayTransaction(editor.state, pos, patch.display)
      if (transaction) editor.view.dispatch(transaction)
      editor.view.dispatch(closeHistory(editor.state.tr))
      return
    }
    editor.view.dispatch(
      closeHistory(editor.state.tr).setNodeMarkup(pos, undefined, { ...latest.attrs, ...patch }),
    )
    editor.view.dispatch(closeHistory(editor.state.tr))
  }
  const load = async (replace = false) => {
    if (!attrs || !w || busy || !canLoad || (replace && !input.trim())) return
    const workspaceId = w.id
    const connection = replace ? selectedConnection : snapshotConnection
    if (!connection) return
    const { baseUrl, authType } = connection
    const original = JSON.stringify(node.attrs)
    const requestedDraft = input
    const wasTyping = !!insertionRef.current?.contains(document.activeElement)
    let issueKey: string
    try {
      issueKey = replace ? parseJiraKey(input, baseUrl) : attrs.issueKey
    } catch {
      setError(t('Enter an issue key or a link from the configured Jira.'))
      return
    }
    setBusy(true)
    setError('')
    try {
      await flush()
      if (!alive.current || current.current?.id !== workspaceId) return
      const issue = await window.sheco.jiraIssue({ workspaceId, baseUrl, issueKey })
      if (
        !alive.current ||
        editor.isDestroyed ||
        current.current?.id !== workspaceId ||
        (replace && (!editingOpen.current || draft.current !== requestedDraft)) ||
        (replace && selectedServer.current !== serverId) ||
        !current.current.plugins.jira.enabled ||
        !current.current.plugins.jira.connections.some(
          (item) =>
            item.id === connection.id && item.baseUrl === baseUrl && item.authType === authType,
        )
      )
        return
      const pos = getPos()
      if (typeof pos !== 'number') return
      const latest = editor.state.doc.nodeAt(pos)
      if (latest?.type.name !== node.type.name || JSON.stringify(latest.attrs) !== original) {
        setError(t('The Jira block changed while loading. Try again.'))
        return
      }
      const resumeTyping = inline && replace && editingOpen.current && wasTyping
      change(issue)
      setEditing(false)
      setMenu(false)
      if (resumeTyping)
        requestAnimationFrame(() => {
          if (!alive.current || editor.isDestroyed || current.current?.id !== workspaceId) return
          const latestPos = getPos()
          if (
            typeof latestPos !== 'number' ||
            editor.state.doc.nodeAt(latestPos)?.attrs.issueKey !== issueKey
          )
            return
          if (
            document.activeElement !== document.body &&
            !editor.view.dom.contains(document.activeElement) &&
            document.activeElement !== inputRef.current
          )
            return
          editor.commands.setTextSelection(latestPos + 1)
          editor.view.focus()
        })
    } catch (error) {
      if (alive.current) setError(t(jiraErrorMessage(error)))
    } finally {
      if (alive.current) setBusy(false)
    }
  }
  const connections = w?.plugins.jira.connections ?? []
  const selectedConnection = connections.find((item) => item.id === serverId)
  const snapshotConnection = connections.find((item) => item.baseUrl === attrs?.baseUrl)
  const canLoad = enabled && !!(editing ? selectedConnection : snapshotConnection)
  const dueDate = attrs?.dueDate
    ? new Date(attrs.dueDate + 'T00:00:00').toLocaleDateString(
        language === 'ru' ? 'ru-RU' : 'en-US',
      )
    : t('No due date')
  const status = attrs && (
    <span className={'jira-status category-' + attrs.statusCategory}>
      {attrs.statusCategory === 'done' ? (
        <CircleCheck size={13} aria-hidden="true" />
      ) : (
        <CircleDot size={13} aria-hidden="true" />
      )}
      <span>{attrs.status || t('Unknown status')}</span>
    </span>
  )
  function cancelEdit() {
    if (!attrs?.issueKey) {
      const pos = getPos()
      if (typeof pos === 'number' && editor.state.doc.nodeAt(pos)?.type.name === node.type.name)
        editor.view.dispatch(closeHistory(editor.state.tr).delete(pos, pos + node.nodeSize))
      editor.view.focus()
      return
    }
    setEditing(false)
    setInput(attrs.issueKey)
    setError('')
    editor.view.focus()
  }
  const insertion = (
    <span ref={insertionRef} className="jira-insert">
      <Ticket size={14} aria-hidden="true" />
      {(connections.length > 1 || (!selectedConnection && connections.length > 0)) && (
        <PopoverPicker
          label={t('Jira server')}
          value={serverId}
          options={connections.map((item) => ({
            value: item.id,
            label: item.name || item.baseUrl,
          }))}
          selectedLabel={selectedConnection ? undefined : t('Choose a server')}
          className="jira-server-picker"
          onChange={(value) => {
            if (!busy) {
              setServerId(value)
              setError('')
            }
          }}
        />
      )}
      <input
        ref={inputRef}
        aria-label={t('Jira issue key or URL')}
        autoFocus
        placeholder={inline ? 'PROJECT-123' : t('PROJECT-123 or Jira issue URL')}
        value={input}
        maxLength={2000}
        readOnly={busy}
        onChange={(event) => {
          const value = event.target.value
          setInput(value)
          if (/^https?:\/\//i.test(value.trim())) {
            const match = connections.find((item) => {
              try {
                parseJiraKey(value, item.baseUrl)
                return true
              } catch {
                return false
              }
            })
            if (match) setServerId(match.id)
          }
        }}
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            event.preventDefault()
            void load(true)
          } else if (event.key === 'Escape') {
            event.preventDefault()
            cancelEdit()
          }
        }}
      />
      <button
        type="button"
        className="jira-submit"
        aria-label={t(attrs?.issueKey ? 'Change Jira issue' : 'Add issue')}
        title={t(attrs?.issueKey ? 'Change Jira issue' : 'Add issue')}
        disabled={!canLoad || busy || !input.trim()}
        onClick={() => void load(true)}
      >
        {busy ? <RefreshCw size={14} className="is-loading" /> : <Check size={14} />}
      </button>
      <button type="button" className="jira-cancel" aria-label={t('Cancel')} onClick={cancelEdit}>
        <X size={14} />
      </button>
      {!canLoad && (
        <span className="jira-error" role="status">
          {t('Enable Jira and configure its address and token in Settings → Plugins.')}
        </span>
      )}
    </span>
  )
  return (
    <NodeViewWrapper
      as={inline ? 'span' : 'div'}
      className={
        'jira-block ' +
        (minimal ? 'minimal' : 'detailed') +
        (inline ? ' jira-inline' : '') +
        (editing ? ' jira-editing' : '')
      }
      contentEditable={false}
    >
      {!attrs ? (
        <p className="jira-error">{t('Invalid Jira block')}</p>
      ) : editing || !attrs.issueKey ? (
        insertion
      ) : attrs.issueKey ? (
        <>
          <span className="jira-issue-content">
            <button
              className="jira-key"
              title={t('Open in Jira')}
              onClick={() =>
                run(() => window.sheco.external(jiraIssueUrl(attrs.baseUrl, attrs.issueKey)))
              }
            >
              {!minimal && <Ticket size={14} />}
              <strong>{attrs.issueKey}</strong>
              {!minimal && <ArrowUpRight size={12} />}
            </button>
            {status}
            {!minimal && (
              <>
                <span className="jira-due" title={t('Due date')}>
                  <CalendarDays size={13} aria-hidden="true" />
                  {dueDate}
                </span>
                {attrs.summary && <span className="jira-summary">{attrs.summary}</span>}
              </>
            )}
          </span>
          <span className="jira-actions">
            <button
              type="button"
              aria-label={t('Change Jira issue')}
              title={t('Change Jira issue')}
              disabled={!canLoad || busy}
              onClick={() => {
                setInput(attrs.issueKey)
                setError('')
                setEditing(true)
              }}
            >
              <Pencil size={14} />
            </button>
            <button
              type="button"
              aria-label={t('Refresh Jira issue')}
              title={t('Refresh Jira issue')}
              disabled={!canLoad || busy}
              onClick={() => void load()}
            >
              <RefreshCw size={14} className={busy ? 'is-loading' : ''} />
            </button>
            <button
              type="button"
              ref={anchor}
              aria-label={t('Jira block view')}
              title={t('Jira block view')}
              aria-expanded={menu}
              onClick={() => setMenu(!menu)}
            >
              <Settings2 size={14} />
            </button>
          </span>
          {menu && (
            <Popover anchor={anchor} align="end" onClose={() => setMenu(false)}>
              {(['detailed', 'minimal'] as const).map((display) => (
                <MenuItem
                  key={display}
                  selected={(minimal ? 'minimal' : 'detailed') === display}
                  onClick={() => {
                    change({ display })
                    setMenu(false)
                  }}
                >
                  {t(display === 'detailed' ? 'Detailed' : 'Minimal')}
                </MenuItem>
              ))}
            </Popover>
          )}
        </>
      ) : null}
      {error && (
        <span className="jira-error" role="alert">
          {error}
        </span>
      )}
    </NodeViewWrapper>
  )
}
function clipboardAttrs(element: HTMLElement) {
  try {
    return jiraIssueAttrsSchema.safeParse(
      JSON.parse(element.getAttribute('data-jira-issue') ?? '{}'),
    ).data
  } catch {
    return undefined
  }
}
function jiraAttributes(inline: boolean) {
  const defaults = jiraIssueAttrsSchema.parse({
    ...(inline ? { display: 'minimal' } : {}),
    inlineOrigin: null,
  })
  return Object.fromEntries(
    Object.entries(defaults).map(([key, value]) => [
      key,
      {
        default: value,
        rendered: false,
        parseHTML: (element: HTMLElement) =>
          clipboardAttrs(element)?.[key as keyof JiraIssueAttrs] ?? value,
      },
    ]),
  )
}
function jiraHTML(node: NodeViewProps['node'], inline: boolean): DOMOutputSpec {
  const attrs = jiraIssueAttrsSchema.parse(node.attrs)
  return [
    inline ? 'span' : 'div',
    {
      'data-type': inline ? 'jira-issue-inline' : 'jira-issue',
      'data-jira-issue': JSON.stringify(attrs),
    },
    attrs.issueKey
      ? ['a', { href: jiraIssueUrl(attrs.baseUrl, attrs.issueKey) }, attrs.issueKey]
      : 'Jira',
    [
      'span',
      {},
      inline || attrs.display === 'minimal'
        ? ` · ${attrs.status}`
        : ` ${attrs.summary} · ${attrs.status} · ${attrs.dueDate}`,
    ],
  ]
}
function jiraText(node: NodeViewProps['node']) {
  const attrs = jiraIssueAttrsSchema.safeParse(node.attrs).data
  if (!attrs) return 'Jira'
  return (
    attrs.display === 'minimal'
      ? [attrs.issueKey, attrs.status]
      : [attrs.issueKey, attrs.summary, attrs.status, attrs.dueDate]
  )
    .filter(Boolean)
    .join(' · ')
}
export const JiraBlock = Node.create({
  name: 'jiraIssue',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return jiraAttributes(false)
  },
  parseHTML() {
    return [
      {
        tag: 'div[data-type="jira-issue"]',
        getAttrs: (element) => {
          const attrs = clipboardAttrs(element)
          return attrs && attrs.display !== 'minimal' ? {} : false
        },
      },
    ]
  },
  renderHTML({ node }) {
    return jiraHTML(node, false)
  },
  renderText({ node }) {
    return jiraText(node)
  },
  addNodeView() {
    return ReactNodeViewRenderer(JiraView)
  },
})
export const JiraInline = Node.create({
  name: 'jiraIssueInline',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes() {
    return jiraAttributes(true)
  },
  parseHTML() {
    return ['span[data-type="jira-issue-inline"]', 'div[data-type="jira-issue"]'].map((tag) => ({
      tag,
      getAttrs: (element: HTMLElement) =>
        clipboardAttrs(element)?.display === 'minimal' ? {} : false,
    }))
  },
  renderHTML({ node }) {
    return jiraHTML(node, true)
  },
  renderText({ node }) {
    return jiraText(node)
  },
  addNodeView() {
    return ReactNodeViewRenderer(JiraView)
  },
})
