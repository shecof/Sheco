import { useI18n } from '../i18n'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, ArrowUpRight, CornerDownLeft, X, Paperclip } from 'lucide-react'
import { searchWorkspace, ancestors } from '../shared/model'
import { useApp } from '../state'
import { Modal, PageIcon } from './ui'
export function QuickSearch({
  newTab,
  onClose,
  onSelect,
}: {
  newTab: boolean
  onClose: () => void
  onSelect: () => void
}) {
  const { t, language } = useI18n()

  const { w, openPage } = useApp()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const results = useMemo(() => searchWorkspace(w!, query), [w, query])
  const choose = (index: number, forceNew = false) => {
    const result = results[index]
    if (result) {
      openPage(result.page.id, newTab || forceNew)
      onSelect()
      onClose()
    }
  }
  useEffect(() => {
    setSelected(0)
  }, [query])
  useEffect(() => {
    document.querySelector('.search-result.is-selected')?.scrollIntoView({ block: 'nearest' })
  }, [selected])
  return (
    <Modal title={newTab ? t('Open a new tab') : t('Quick search')} wide onClose={onClose}>
      <div className="quick-search-input">
        <Search size={21} />
        <input
          ref={input}
          autoFocus
          placeholder={t('Search pages, content, and filenames…')}
          aria-label={t('Search your workspace')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              setSelected((v) =>
                results.length
                  ? (v + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length
                  : 0,
              )
            }
            if (e.key === 'Enter') {
              e.preventDefault()
              choose(selected, e.metaKey || e.ctrlKey)
            }
          }}
        />
        {query && (
          <button
            aria-label={t('Clear search')}
            onClick={() => {
              setQuery('')
              input.current?.focus()
            }}
          >
            <X size={16} />
          </button>
        )}
        <kbd>{t('esc')}</kbd>
      </div>
      <div className="search-results">
        <div className="search-section-title">
          {query ? t('Results') : t('Recently updated')}
          <span>{results.length}</span>
        </div>
        {results.map((result, i) => (
          <button
            className={'search-result ' + (i === selected ? 'is-selected' : '')}
            key={result.page.id + ':' + (result.file?.id ?? 'page')}
            onMouseEnter={() => setSelected(i)}
            onClick={(e) => choose(i, e.metaKey || e.ctrlKey)}
          >
            <span className="search-result-icon">
              {result.file ? (
                <Paperclip size={20} />
              ) : (
                <PageIcon icon={result.page.icon} size={20} />
              )}
            </span>
            <span>
              <strong>
                {result.file?.name || result.page.title || t('Untitled')}
                <small>
                  {result.kind === 'file'
                    ? t('File')
                    : result.kind === 'record'
                      ? t('Database entry')
                      : result.kind === 'content'
                        ? t('Content')
                        : t('Page')}
                </small>
              </strong>
              <span className="search-path">
                {ancestors(w!, result.page.id)
                  .slice(0, result.file ? undefined : -1)
                  .map((p) => p.title)
                  .join(' / ') || w!.name}
              </span>
              {query && result.excerpt && !result.file && <p>{result.excerpt}</p>}
            </span>
            <ArrowUpRight size={15} />
          </button>
        ))}
        {!results.length && (
          <div className="search-empty">
            <Search size={30} />
            <strong>
              {t('No matches for “')}
              {query}”
            </strong>
            <p>{t('Try a page title, a filename, a tag, or a word from your notes.')}</p>
          </div>
        )}
      </div>
      <div className="search-footer">
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd>
          {t('navigate')}
        </span>
        <span>
          <CornerDownLeft size={12} />
          {t('open')}
        </span>
        <span>
          <kbd>{window.sheco.platform === 'darwin' ? '⌘' : t('Ctrl')}</kbd>
          {t('+ Enter in new tab')}
        </span>
      </div>
    </Modal>
  )
}
