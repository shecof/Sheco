import { useEffect, useRef, useState } from 'react'
import { Extension, type Editor } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'
import { closeHistory } from '@tiptap/pm/history'
import { ArrowDown, ArrowUp, ChevronDown, X } from 'lucide-react'
import { useI18n } from '../i18n'
import { blockSelectionKey } from './BlockSelection'

type Match = { from: number; to: number }
type SearchState = { query: string; caseSensitive: boolean; active: number; matches: Match[] }
export const findReplaceKey = new PluginKey<SearchState>('findReplace')

export function textMatches(doc: PMNode, query: string, caseSensitive = false): Match[] {
  if (!query) return []
  const matches: Match[] = []
  // Search contiguous text across marks, while keeping atoms and block boundaries intact.
  const pattern = new RegExp(
    query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    caseSensitive ? 'gu' : 'giu',
  )
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return
    let text = ''
    let start = pos + 1
    const flush = () => {
      pattern.lastIndex = 0
      for (const match of text.matchAll(pattern))
        matches.push({ from: start + match.index!, to: start + match.index! + match[0].length })
      text = ''
    }
    node.forEach((child, offset) => {
      if (child.isText) {
        if (!text) start = pos + 1 + offset
        text += child.text
      } else flush()
    })
    flush()
    return false
  })
  return matches
}
export function replaceMatches(state: EditorState, matches: Match[], replacement: string) {
  const tr = closeHistory(state.tr)
  for (const { from, to } of [...matches].sort((a, b) => b.from - a.from))
    tr.insertText(replacement, from, to)
  return tr
}
export const FindReplace = Extension.create({
  name: 'findReplace',
  addProseMirrorPlugins() {
    return [
      new Plugin<SearchState>({
        key: findReplaceKey,
        state: {
          init: () => ({ query: '', caseSensitive: false, active: 0, matches: [] }),
          apply(tr, previous) {
            const change = tr.getMeta(findReplaceKey) as Partial<SearchState> | undefined
            if (!change && !tr.docChanged) return previous
            const next = { ...previous, ...change }
            if (
              tr.docChanged ||
              next.query !== previous.query ||
              next.caseSensitive !== previous.caseSensitive
            )
              next.matches = textMatches(tr.doc, next.query, next.caseSensitive)
            if (
              tr.docChanged &&
              change?.active === undefined &&
              previous.matches[previous.active]
            ) {
              const from = tr.mapping.map(previous.matches[previous.active].from)
              const index = next.matches.findIndex((match) => match.from >= from)
              next.active = index < 0 ? 0 : index
            }
            next.active = Math.max(0, Math.min(next.active, next.matches.length - 1))
            return next
          },
        },
        props: {
          decorations(state) {
            const search = findReplaceKey.getState(state)!
            return DecorationSet.create(
              state.doc,
              search.matches.map((match, index) =>
                Decoration.inline(match.from, match.to, {
                  class: 'find-match' + (index === search.active ? ' find-match-active' : ''),
                }),
              ),
            )
          },
        },
      }),
    ]
  },
})

export function FindReplacePanel({ editor }: { editor: Editor }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [showReplace, setShowReplace] = useState(false)
  const [query, setQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [search, setSearch] = useState<SearchState>({
    query: '',
    caseSensitive: false,
    active: 0,
    matches: [],
  })
  const input = useRef<HTMLInputElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const focusFrame = useRef(0)
  function close() {
    setOpen(false)
    editor.view.dispatch(
      editor.state.tr.setMeta(findReplaceKey, { query: '' }).setMeta('addToHistory', false),
    )
    editor.view.focus()
  }
  useEffect(() => {
    function show(replace: boolean) {
      const selection = editor.state.selection
      if (!selection.empty && selection.$from.parent === selection.$to.parent)
        setQuery(editor.state.doc.textBetween(selection.from, selection.to))
      setOpen(true)
      setShowReplace(replace)
      cancelAnimationFrame(focusFrame.current)
      focusFrame.current = requestAnimationFrame(() => {
        input.current?.focus()
        input.current?.select()
      })
    }
    function shortcut(event: KeyboardEvent) {
      if (
        !(event.ctrlKey || event.metaKey) ||
        event.altKey ||
        event.isComposing ||
        (event.target instanceof Element && event.target.closest('[role="dialog"],.popover'))
      )
        return
      const key =
        event.code === 'KeyF' ? 'f' : event.code === 'KeyH' ? 'h' : event.key.toLowerCase()
      if (key === 'f' || key === 'h') {
        event.preventDefault()
        event.stopPropagation()
        show(key === 'h')
      }
    }
    const requested = () => show(true)
    const refreshed = () => setSearch(findReplaceKey.getState(editor.state)!)
    editor.on('transaction', refreshed)
    document.addEventListener('keydown', shortcut, true)
    window.addEventListener('find-replace', requested)
    return () => {
      cancelAnimationFrame(focusFrame.current)
      editor.off('transaction', refreshed)
      document.removeEventListener('keydown', shortcut, true)
      window.removeEventListener('find-replace', requested)
    }
  }, [editor])
  useEffect(() => {
    editor.view.dispatch(
      editor.state.tr
        .setMeta(findReplaceKey, { query: open ? query : '', caseSensitive, active: 0 })
        .setMeta('addToHistory', false),
    )
    if (open && query) navigate(0)
  }, [editor, open, query, caseSensitive])
  function navigate(index: number) {
    const current = findReplaceKey.getState(editor.state)!
    if (!current.matches.length) return
    const active = (index + current.matches.length) % current.matches.length
    const match = current.matches[active]
    const tr = editor.state.tr
    // Reveal matches inside folded sections through the normal document transaction.
    const resolved = tr.doc.resolve(match.from)
    for (let depth = resolved.depth; depth > 0; depth--)
      if (resolved.node(depth).type.name === 'details' && !resolved.node(depth).attrs.open)
        tr.setNodeMarkup(resolved.before(depth), undefined, {
          ...resolved.node(depth).attrs,
          open: true,
        })
    tr.setSelection(TextSelection.create(tr.doc, match.from, match.to)).setMeta(
      blockSelectionKey,
      [],
    )
    editor.view.dispatch(tr.setMeta(findReplaceKey, { active }).scrollIntoView())
  }
  function replace(all: boolean) {
    const current = findReplaceKey.getState(editor.state)!
    const matches = all
      ? current.matches
      : current.matches.slice(current.active, current.active + 1)
    if (!matches.length) return
    editor.view.dispatch(replaceMatches(editor.state, matches, replacement))
    editor.view.dispatch(closeHistory(editor.state.tr))
    const next = findReplaceKey.getState(editor.state)!
    navigate(next.active)
  }
  if (!open) return null
  return (
    <div
      ref={panel}
      className="editor-find-panel"
      role="search"
      aria-label={t('Find and replace')}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          close()
        }
        if (
          event.key === 'Enter' &&
          !event.nativeEvent.isComposing &&
          event.target instanceof HTMLInputElement &&
          event.target.type === 'text'
        ) {
          event.preventDefault()
          if (event.target instanceof HTMLInputElement && event.target.name === 'replacement')
            replace(false)
          else navigate(search.active + (event.shiftKey ? -1 : 1))
        }
      }}
    >
      <div className="editor-find-row">
        <button
          title={t('Show replacement')}
          aria-label={t('Show replacement')}
          aria-expanded={showReplace}
          onClick={() => setShowReplace(!showReplace)}
        >
          <ChevronDown
            size={15}
            style={{ transform: showReplace ? undefined : 'rotate(-90deg)' }}
          />
        </button>
        <input
          ref={input}
          value={query}
          aria-label={t('Find in page')}
          placeholder={t('Find in page')}
          onChange={(event) => setQuery(event.target.value)}
        />
        <span className="find-count" role="status">
          {search.matches.length
            ? `${search.active + 1} / ${search.matches.length}`
            : t('No matches')}
        </span>
        <button
          title={t('Previous match')}
          aria-label={t('Previous match')}
          disabled={!search.matches.length}
          onClick={() => navigate(search.active - 1)}
        >
          <ArrowUp size={15} />
        </button>
        <button
          title={t('Next match')}
          aria-label={t('Next match')}
          disabled={!search.matches.length}
          onClick={() => navigate(search.active + 1)}
        >
          <ArrowDown size={15} />
        </button>
        <button title={t('Close')} aria-label={t('Close find and replace')} onClick={close}>
          <X size={15} />
        </button>
      </div>
      {showReplace && (
        <div className="editor-find-row editor-replace-row">
          <input
            name="replacement"
            value={replacement}
            aria-label={t('Replace with')}
            placeholder={t('Replace with')}
            onChange={(event) => setReplacement(event.target.value)}
          />
          <button disabled={!search.matches.length} onClick={() => replace(false)}>
            {t('Replace')}
          </button>
          <button disabled={!search.matches.length} onClick={() => replace(true)}>
            {t('Replace all')}
          </button>
        </div>
      )}
      <label className="find-case">
        <input
          type="checkbox"
          checked={caseSensitive}
          onChange={(event) => setCaseSensitive(event.target.checked)}
        />
        {t('Match case')}
      </label>
    </div>
  )
}
