import { useI18n } from './i18n'
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Plus,
  X,
  PanelLeft,
  Star,
  MoreHorizontal,
  ChevronRight,
  Check,
  Download,
  Copy,
  Trash2,
  Link,
  FilePlus2,
  Table2,
  Search,
  ArrowUpRight,
  Sparkles,
  HardDrive,
  ChevronDown,
  Folder,
  BookOpen,
  Terminal,
} from 'lucide-react'
import { useApp } from './state'
import { ancestors, plainText, linkedIds, type Page } from './shared/model'
import { Logo } from './components/Logo'
import { IconPicker } from './components/IconPicker'
import { Sidebar } from './components/Sidebar'
import { QuickSearch } from './components/Search'
import { SettingsDialog } from './components/Settings'
import { ReadingSettings } from './components/ReadingSettings'
import { CommandBuilder } from './components/CommandBuilder'
import { commandBuilderTab, commandBuilderSettingsTab } from './shared/plugins'
import { PluginConfiguration } from './components/PluginConfiguration'
import { DatabaseView, PropertyField, ColumnPopover } from './components/Database'
const BlockEditor = lazy(() =>
  import('./editor/BlockEditor').then((module) => ({ default: module.BlockEditor })),
)
function DocumentEditor({ page }: { page: Page }) {
  const { t, language } = useI18n()

  return (
    <Suspense fallback={<div className="editor-loading">{t('Opening editor…')}</div>}>
      <BlockEditor page={page} />
    </Suspense>
  )
}
import { PageIcon, IconButton, Popover, MenuItem } from './components/ui'

function PageView({ page }: { page: Page }) {
  const { t, language } = useI18n()

  const { w, editPage, openPage, update, titleFocusId, clearTitleFocus } = useApp()
  const titleRef = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const input = titleRef.current
    if (!input) return
    const resize = () => {
      input.style.height = 'auto'
      input.style.height = `${input.scrollHeight}px`
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(input)
    return () => observer.disconnect()
  }, [page.title])
  useEffect(() => {
    if (titleFocusId !== page.id) return
    titleRef.current?.focus()
    titleRef.current?.select()
    clearTitleFocus()
  }, [titleFocusId, page.id, clearTitleFocus])
  const [iconMenu, setIconMenu] = useState(false)
  const [propertyModal, setPropertyModal] = useState(false)
  const propertyAnchor = useRef<HTMLButtonElement>(null)
  const [databaseNotes, setDatabaseNotes] = useState(false)
  const db = w!.databases.find((d) => d.pageId === page.id)
  const parentDB = w!.databases.find((d) => d.id === page.databaseId)
  const children = w!.pages
    .filter(
      (p) =>
        !p.deletedAt &&
        p.parentId === page.id &&
        !p.databaseId &&
        !linkedIds(page.content).includes(p.id),
    )
    .sort((a, b) => a.order - b.order)
  return (
    <article
      className={
        'page-content ' +
        (db ? 'database-page' : 'note-page') +
        (w!.ui.fixedWidth ? ' fixed-width' : ' full-width')
      }
      style={{ '--reading-step': `${w!.ui.fontSize * 2}px` } as CSSProperties}
      key={page.id}
    >
      <header className="page-heading">
        <button
          className={'page-icon-large ' + (db ? 'database-icon' : '')}
          title={t('Change page icon')}
          onClick={() => setIconMenu(true)}
        >
          <PageIcon icon={page.icon} size={30} />
        </button>
        {(parentDB || db) && (
          <div className="page-eyebrow">
            {parentDB ? t('DATABASE ENTRY') : t('YOUR RESOURCE LIBRARY')}
          </div>
        )}
        <textarea
          ref={titleRef}
          rows={1}
          className="page-title"
          aria-label={t('Page title')}
          placeholder={t('Untitled')}
          value={page.title}
          maxLength={500}
          onChange={(e) => editPage(page.id, { title: e.target.value.replace(/[\r\n]+/g, ' ') })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              document.querySelector<HTMLElement>('.document-editor')?.focus()
            }
          }}
        />
        <textarea
          className="page-description"
          aria-label={t('Page description')}
          rows={1}
          placeholder={t('Add a description…')}
          value={page.description}
          maxLength={2000}
          onChange={(e) => {
            editPage(page.id, { description: e.target.value })
            e.target.style.height = 'auto'
            e.target.style.height = e.target.scrollHeight + 'px'
          }}
        />
      </header>
      {parentDB && (
        <div className="page-properties">
          {parentDB.columns.map((c) => (
            <div className="page-property-row" key={c.id}>
              <span>
                <span className="property-type">
                  {c.type === 'multiSelect'
                    ? '☷'
                    : c.type === 'url'
                      ? '↗'
                      : c.type === 'select'
                        ? '◉'
                        : '≡'}
                </span>
                {c.name}
              </span>
              <PropertyField page={page} column={c} db={parentDB} mode="page" />
            </div>
          ))}
          <button
            ref={propertyAnchor}
            className="add-page-property"
            onClick={() => setPropertyModal(true)}
          >
            <Plus size={15} />
            {t('Add a property')}
          </button>
        </div>
      )}
      {db ? (
        <>
          <DatabaseView page={page} db={db} />
          {databaseNotes ||
          plainText(page.content).trim() ||
          page.content.content?.some((n) => n.type !== 'paragraph') ? (
            <div className="database-note-area">
              <h3>{t('Notes')}</h3>
              <DocumentEditor page={page} />
            </div>
          ) : (
            <button className="add-database-notes" onClick={() => setDatabaseNotes(true)}>
              <Plus size={14} />
              {t('Add notes below this database')}
            </button>
          )}
        </>
      ) : (
        <DocumentEditor page={page} />
      )}
      {!!children.length && (
        <div className="subpages-section">
          <h3>
            <Folder size={15} />
            {t('Pages in this note')}
          </h3>
          <div>
            {children.map((p) => (
              <button key={p.id} onClick={() => openPage(p.id)}>
                <PageIcon icon={p.icon} />
                <span>{p.title || t('Untitled')}</span>
                <ArrowUpRight size={14} />
              </button>
            ))}
          </div>
        </div>
      )}
      {iconMenu && (
        <IconPicker
          value={page.icon}
          onSelect={(icon) => {
            editPage(page.id, { icon })
            setIconMenu(false)
          }}
          onClose={() => setIconMenu(false)}
        />
      )}
      {propertyModal && parentDB && (
        <ColumnPopover
          db={parentDB}
          anchor={propertyAnchor}
          onClose={() => setPropertyModal(false)}
        />
      )}
    </article>
  )
}
function Trash() {
  const { t, language } = useI18n()

  const { w, restore } = useApp()
  const deleted = w!.pages.filter(
    (p) => p.deletedAt && !w!.pages.some((a) => a.id === p.parentId && a.deletedAt),
  )
  return (
    <div className="trash-page">
      <Trash2 size={34} />
      <h1>{t('Trash')}</h1>
      <p>{t('Deleted pages stay here until you restore them.')}</p>
      {deleted.length ? (
        <div className="trash-list">
          {deleted.map((p) => (
            <div key={p.id}>
              <PageIcon icon={p.icon} />
              <span className="trash-page-details">
                <strong>{p.title || t('Untitled')}</strong>
                <small>
                  {t('Deleted')} {new Date(p.deletedAt!).toLocaleDateString()}
                </small>
              </span>
              <button className="button" onClick={() => restore(p.id)}>
                {t('Restore')}
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="trash-empty">
          <Check size={28} />
          <strong>{t('Everything is in its place.')}</strong>
          <p>{t('Your trash is empty.')}</p>
        </div>
      )}
    </div>
  )
}
export function App() {
  const { t, language } = useI18n()

  const {
    w,
    data,
    status,
    error,
    toast,
    busy,
    openPage,
    closeTab,
    newPage,
    update,
    removePage,
    duplicate,
    flush,
    notify,
    run,
    importPage,
  } = useApp()
  const [screen, setScreen] = useState('page')
  const [sidebar, setSidebar] = useState(true)
  const [search, setSearch] = useState<'current' | 'new' | null>(null)
  const [settings, setSettings] = useState(false)
  const [settingsCategory, setSettingsCategory] = useState<'plugins' | undefined>()
  const showSettings = (plugins = false) => {
    setSettingsCategory(plugins ? 'plugins' : undefined)
    setSettings(true)
  }
  const [more, setMore] = useState(false)
  const pageOptionsAnchor = useRef<HTMLDivElement>(null)
  const [exportMenu, setExportMenu] = useState(false)
  const exportAnchor = useRef<HTMLButtonElement>(null)
  const historySpace = useRef('')
  const history = useRef<string[]>([])
  const historyIndex = useRef(-1)
  const goingBack = useRef(false)
  const [historyVersion, setHistoryVersion] = useState(0)
  const page = w?.pages.find((p) => p.id === w.ui.activeId && !p.deletedAt)
  const activePlugin = w?.ui.activeId === commandBuilderTab && screen === 'page'
  const activeConfiguration = w?.ui.activeId === commandBuilderSettingsTab && screen === 'page'
  const openPluginConfiguration = () => {
    openPage(commandBuilderSettingsTab, true)
    setScreen('page')
    setSettings(false)
  }
  const openPlugin = () => {
    openPage(commandBuilderTab, true)
    setScreen('page')
    setSettings(false)
  }
  const exportPage = useCallback(
    (format: 'markdown' | 'pdf' | 'csv') =>
      run(async () => {
        if (!w?.ui.activeId || !w.pages.some((p) => p.id === w.ui.activeId && !p.deletedAt)) return
        const database = w.databases.find((db) => db.pageId === w.ui.activeId)
        if (format === 'csv' && !database) return
        await flush()
        const result =
          format === 'csv'
            ? await window.sheco.exportDatabase(database!.id)
            : await window.sheco.exportPage(w.ui.activeId, format)
        if (result)
          notify(
            format === 'csv'
              ? t('Database exported as CSV.')
              : (format === 'pdf' ? t('PDF') : t('Markdown')) + t(' exported.'),
          )
      }),
    [w?.ui.activeId, w?.databases, run, flush, notify],
  )
  useEffect(() => {
    setMore(false)
    setExportMenu(false)
  }, [w?.id, w?.ui.activeId, screen])
  const action = useCallback(
    (action: string) => {
      if (action === 'search') setSearch('current')
      if (action === 'newTab') setSearch('new')
      if (action === 'settings') {
        setSettingsCategory(undefined)
        setSettings(true)
      }
      if (action === 'newPage') {
        newPage()
        setScreen('page')
      }
      if (action === 'closeTab' && w?.ui.activeId) closeTab(w.ui.activeId)
      if (action === 'import')
        run(async () => {
          await importPage()
          setScreen('page')
        })
      if (action === 'exportMarkdown') exportPage('markdown')
      if (action === 'exportPDF') exportPage('pdf')
    },
    [newPage, closeTab, w?.ui.activeId, run, importPage, exportPage],
  )
  useEffect(() => window.sheco.onMenu(action), [action])
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey
      if (!mod) return
      if (/^[1-9]$/.test(event.key) && !event.altKey) {
        event.preventDefault()
        const index = event.key === '9' ? (w?.ui.tabs.length ?? 1) - 1 : Number(event.key) - 1
        const id = w?.ui.tabs[index]
        if (id) {
          openPage(id)
          setScreen('page')
        }
      }
      const mapping: Record<string, string> = {
        k: 'search',
        t: 'newTab',
        w: 'closeTab',
        n: 'newPage',
        ',': 'settings',
      }
      // Native menu accelerators dispatch these in Electron; browser shortcuts are suppressed there.
      if (
        mapping[event.key.toLowerCase()] &&
        event.target instanceof HTMLElement &&
        event.target.closest('[role="dialog"]')
      ) {
        if (event.key.toLowerCase() === 'k') {
          event.preventDefault()
          setSearch('current')
        }
      }
    }
    document.addEventListener('keydown', listener)
    const open = (event: Event) => {
      const { id, newTab } = (event as CustomEvent).detail
      openPage(id, newTab)
      setScreen('page')
    }
    window.addEventListener('open-page', open)
    return () => {
      document.removeEventListener('keydown', listener)
      window.removeEventListener('open-page', open)
    }
  }, [w?.ui.tabs, openPage])
  useEffect(() => {
    if (!w) return
    if (historySpace.current !== w.id) {
      historySpace.current = w.id
      history.current = []
      historyIndex.current = -1
      setScreen('page')
    }
    if (!w.ui.activeId) return
    if (goingBack.current) {
      goingBack.current = false
      return
    }
    if (history.current[historyIndex.current] !== w.ui.activeId) {
      history.current = history.current.slice(0, historyIndex.current + 1)
      history.current.push(w.ui.activeId)
      historyIndex.current = history.current.length - 1
      setHistoryVersion((v) => v + 1)
    }
  }, [w?.ui.activeId, w?.id])
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)')
    const set = () =>
      (document.documentElement.dataset.theme =
        w?.ui.theme === 'dark' || (w?.ui.theme === 'system' && media.matches) ? 'dark' : 'light')
    set()
    media.addEventListener('change', set)
    return () => media.removeEventListener('change', set)
  }, [w?.ui.theme])
  useEffect(() => {
    document.documentElement.dataset.accent = w?.ui.accent ?? 'neutral'
  }, [w?.ui.accent])
  const go = (direction: number) => {
    const index = historyIndex.current + direction
    const id = history.current[index]
    if (
      id &&
      (w?.pages.some((p) => p.id === id && !p.deletedAt) ||
        id === commandBuilderSettingsTab ||
        (id === commandBuilderTab && w?.plugins.commandBuilder.enabled))
    ) {
      historyIndex.current = index
      goingBack.current = true
      openPage(id)
      setScreen('page')
      setHistoryVersion((v) => v + 1)
    }
  }
  if (!w || !data)
    return (
      <div className="boot-screen">
        <Logo />
        <h1>sheco</h1>
        {error ? (
          <>
            <p>{error}</p>
            <button className="button" onClick={() => location.reload()}>
              {t('Try again')}
            </button>
          </>
        ) : (
          <p>{t('Opening your local space…')}</p>
        )}
      </div>
    )
  const path = page ? ancestors(w, page.id) : []
  return (
    <>
      <div
        className={
          'app ' + (!sidebar ? 'sidebar-hidden' : '') + ' platform-' + window.sheco.platform
        }
        inert={busy}
        aria-busy={busy}
      >
        {sidebar && (
          <Sidebar
            screen={screen}
            onNavigate={setScreen}
            onSearch={() => setSearch('current')}
            onSettings={() => showSettings()}
            onPluginSettings={() => showSettings(true)}
            onCollapse={() => setSidebar(false)}
          />
        )}
        <main className="main-pane">
          <div className="tab-bar">
            <div className="tab-navigation">
              {!sidebar && (
                <IconButton title={t('Show sidebar')} onClick={() => setSidebar(true)}>
                  <PanelLeft size={16} />
                </IconButton>
              )}
              <IconButton
                title={t('Back')}
                onClick={() => go(-1)}
                disabled={historyIndex.current <= 0}
              >
                <ArrowLeft size={15} />
              </IconButton>
              <IconButton
                title={t('Forward')}
                onClick={() => go(1)}
                disabled={historyIndex.current >= history.current.length - 1}
              >
                <ArrowRight size={15} />
              </IconButton>
            </div>
            <div className="tabs" role="tablist">
              {w.ui.tabs
                .map((id) =>
                  id === commandBuilderTab
                    ? { id, title: t('Command builder'), icon: 'plugin' }
                    : id === commandBuilderSettingsTab
                      ? { id, title: t('Tool configuration'), icon: 'plugin' }
                      : w.pages.find((p) => p.id === id && !p.deletedAt),
                )
                .filter((p): p is NonNullable<typeof p> => !!p)
                .map((p) => (
                  <div
                    className={
                      'tab ' + (w.ui.activeId === p.id && screen === 'page' ? 'active' : '')
                    }
                    key={p.id}
                    role="tab"
                    aria-selected={w.ui.activeId === p.id && screen === 'page'}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData('application/sheco-tab', p.id)}
                    onDragOver={(e) => {
                      if (e.dataTransfer.types.includes('application/sheco-tab')) e.preventDefault()
                    }}
                    onDrop={(e) => {
                      e.preventDefault()
                      const id = e.dataTransfer.getData('application/sheco-tab')
                      if (!id || id === p.id) return
                      update((w) => {
                        const tabs = [...w.ui.tabs]
                        const from = tabs.indexOf(id)
                        if (from < 0) return w
                        tabs.splice(tabs.indexOf(p.id), 0, tabs.splice(from, 1)[0])
                        return { ...w, ui: { ...w.ui, tabs } }
                      })
                    }}
                  >
                    <button
                      className="tab-open"
                      onClick={() => {
                        openPage(p.id)
                        setScreen('page')
                      }}
                    >
                      {p.id === commandBuilderTab || p.id === commandBuilderSettingsTab ? (
                        <Terminal size={14} />
                      ) : (
                        <PageIcon icon={p.icon} size={14} />
                      )}
                      <span>{p.title || t('Untitled')}</span>
                    </button>
                    <button
                      className="tab-close"
                      aria-label={t('Close tab ') + p.title}
                      onClick={() => closeTab(p.id)}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
            </div>
            <IconButton title={t('New tab')} onClick={() => setSearch('new')}>
              <Plus size={17} />
            </IconButton>
            <div className="window-drag-region" />
          </div>
          <div className="page-topbar">
            <nav className="breadcrumbs" aria-label={t('Breadcrumb')}>
              <button onClick={() => setScreen('page')}>
                <span className="breadcrumb-space">{w.name[0]}</span>
                {w.name}
              </button>
              {activePlugin || activeConfiguration ? (
                <span>
                  <ChevronRight size={12} />
                  <span>{t(activeConfiguration ? 'Tool configuration' : 'Command builder')}</span>
                </span>
              ) : screen === 'page' ? (
                path.map((p, i) => (
                  <span key={p.id}>
                    <ChevronRight size={12} />
                    <button
                      className={i === path.length - 1 ? 'current' : ''}
                      onClick={() => openPage(p.id)}
                    >
                      {p.title || t('Untitled')}
                    </button>
                  </span>
                ))
              ) : (
                <span>
                  <ChevronRight size={12} />
                  <span>{t('Trash')}</span>
                </span>
              )}
            </nav>
            <div className="topbar-actions">
              <button
                className={'save-status ' + status}
                title={status === 'error' ? error : t('Changes are saved automatically')}
                onClick={() => {
                  if (status === 'error') showSettings()
                }}
              >
                {status === 'saved' ? (
                  <Check size={13} />
                ) : status === 'error' ? (
                  <span>!</span>
                ) : (
                  <span className="saving-dot" />
                )}
                <span>
                  {status === 'saved'
                    ? t('All changes saved')
                    : status === 'saving'
                      ? t('Saving…')
                      : status === 'error'
                        ? t('Save failed')
                        : t('Unsaved changes')}
                </span>
              </button>
              {page && screen === 'page' && (
                <>
                  <IconButton
                    title={
                      w.ui.favorites.includes(page.id)
                        ? t('Remove favorite')
                        : t('Add to favorites')
                    }
                    onClick={() =>
                      update((w) => ({
                        ...w,
                        ui: {
                          ...w.ui,
                          favorites: w.ui.favorites.includes(page.id)
                            ? w.ui.favorites.filter((id) => id !== page.id)
                            : [...w.ui.favorites, page.id],
                        },
                      }))
                    }
                  >
                    <Star
                      size={17}
                      fill={w.ui.favorites.includes(page.id) ? 'currentColor' : 'none'}
                      className={w.ui.favorites.includes(page.id) ? 'starred' : ''}
                    />
                  </IconButton>
                  <div className="toolbar-anchor" ref={pageOptionsAnchor}>
                    <IconButton
                      title={t('Page options')}
                      onClick={() => {
                        setExportMenu(false)
                        setMore(!more)
                      }}
                    >
                      <MoreHorizontal size={19} />
                    </IconButton>
                    {more && (
                      <Popover
                        anchor={pageOptionsAnchor}
                        align="end"
                        className="page-options"
                        onClose={() => {
                          setMore(false)
                          setExportMenu(false)
                        }}
                      >
                        <div className="popover-title">{t('Page actions')}</div>
                        {page.kind !== 'database' && (
                          <MenuItem
                            icon={<Search size={15} />}
                            onClick={() => {
                              setMore(false)
                              window.dispatchEvent(new Event('find-replace'))
                            }}
                          >
                            {t('Find and replace')}
                          </MenuItem>
                        )}
                        <MenuItem
                          icon={<FilePlus2 size={15} />}
                          onClick={() => {
                            newPage(
                              page.id,
                              'page',
                              page.kind === 'database'
                                ? w.databases.find((d) => d.pageId === page.id)?.id
                                : null,
                            )
                            setMore(false)
                          }}
                        >
                          {page.kind === 'database' ? t('New entry') : t('New subpage')}
                        </MenuItem>
                        <MenuItem
                          icon={<Copy size={15} />}
                          onClick={() => {
                            duplicate(page.id)
                            setMore(false)
                          }}
                        >
                          {t('Duplicate page')}
                        </MenuItem>
                        <MenuItem
                          icon={<Link size={15} />}
                          onClick={() => {
                            run(async () => {
                              await window.sheco.copyText('sheco://page/' + page.id)
                              notify(t('Page link copied.'))
                            })
                            setMore(false)
                          }}
                        >
                          {t('Copy page link')}
                        </MenuItem>
                        <div className="menu-separator" />
                        <div className="page-reading-options">
                          <div className="popover-title">{t('Reading')}</div>
                          <ReadingSettings />
                        </div>
                        <div className="menu-separator" />
                        <button
                          ref={exportAnchor}
                          type="button"
                          className="menu-item page-export-trigger"
                          aria-haspopup="menu"
                          aria-expanded={exportMenu}
                          onClick={() => setExportMenu(!exportMenu)}
                          onKeyDown={(event) => {
                            if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                              event.preventDefault()
                              setExportMenu(true)
                            }
                          }}
                        >
                          <Download size={15} />
                          <span>{t('Export')}</span>
                          <ChevronRight size={14} />
                        </button>
                        {exportMenu && (
                          <Popover
                            anchor={exportAnchor}
                            align="end"
                            className="page-export-popover"
                            onClose={() => setExportMenu(false)}
                          >
                            <div
                              role="menu"
                              aria-label={t('Export format')}
                              onKeyDown={(event) => {
                                if (event.key === 'ArrowLeft') {
                                  event.preventDefault()
                                  setExportMenu(false)
                                  exportAnchor.current?.focus()
                                  return
                                }
                                const buttons = [
                                  ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                                    '[role="menuitem"]',
                                  ),
                                ]
                                const index = buttons.indexOf(
                                  document.activeElement as HTMLButtonElement,
                                )
                                const next =
                                  event.key === 'ArrowDown'
                                    ? (index + 1) % buttons.length
                                    : event.key === 'ArrowUp'
                                      ? (index + buttons.length - 1) % buttons.length
                                      : event.key === 'Home'
                                        ? 0
                                        : event.key === 'End'
                                          ? buttons.length - 1
                                          : -1
                                if (next < 0) return
                                event.preventDefault()
                                buttons[next]?.focus()
                              }}
                            >
                              {(
                                [
                                  { format: 'markdown', label: 'Markdown (.md)' },
                                  { format: 'pdf', label: 'PDF (.pdf)' },
                                  { format: 'csv', label: 'CSV (.csv)' },
                                ] as const
                              )
                                .filter(
                                  (choice) => choice.format !== 'csv' || page.kind === 'database',
                                )
                                .map((choice, index) => (
                                  <button
                                    key={choice.format}
                                    type="button"
                                    className="menu-item"
                                    role="menuitem"
                                    autoFocus={index === 0}
                                    onClick={() => {
                                      setExportMenu(false)
                                      setMore(false)
                                      exportPage(choice.format)
                                    }}
                                  >
                                    <span>{choice.label}</span>
                                  </button>
                                ))}
                            </div>
                          </Popover>
                        )}
                        <div className="menu-separator" />
                        <MenuItem
                          danger
                          icon={<Trash2 size={15} />}
                          onClick={() => {
                            removePage(page.id)
                            setMore(false)
                          }}
                        >
                          {t('Move to Trash')}
                        </MenuItem>
                      </Popover>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
          {w.ui.tabs.includes(commandBuilderTab) && (
            <div
              className="content-scroll command-scroll"
              hidden={!activePlugin}
              key={w.id + ':command-builder'}
            >
              <CommandBuilder onSettings={openPluginConfiguration} />
            </div>
          )}
          {w.ui.tabs.includes(commandBuilderSettingsTab) && (
            <div
              className="content-scroll plugin-configuration-scroll"
              hidden={!activeConfiguration}
              key={w.id + ':command-builder-settings'}
            >
              <PluginConfiguration onOpen={openPlugin} />
            </div>
          )}
          <div
            className="content-scroll"
            hidden={activePlugin || activeConfiguration}
            key={w.id + ':' + screen + ':' + (page?.id ?? 'none')}
          >
            {screen === 'trash' ? (
              <Trash />
            ) : page ? (
              <PageView key={page.id} page={page} />
            ) : (
              <div className="empty-workspace">
                <span className="empty-illustration">
                  <BookOpen size={48} />
                  <Sparkles size={20} />
                </span>
                <h1>{t('A little space to think.')}</h1>
                <p>{t('Open a page, search your notes, or start something new.')}</p>
                <div>
                  <button className="button primary" onClick={() => newPage()}>
                    <Plus size={16} />
                    {t('New page')}
                  </button>
                  <button className="button" onClick={() => setSearch('new')}>
                    <Search size={16} />
                    {t('Find a page')}
                  </button>
                </div>
                <small>
                  <HardDrive size={13} />
                  {t('Your knowledge stays on this device.')}
                </small>
              </div>
            )}
          </div>
        </main>
        {toast && (
          <div className="toast" role="status">
            <Check size={16} />
            <span>{t(toast)}</span>
            <button aria-label={t('Dismiss notification')} onClick={() => notify('')}>
              <X size={14} />
            </button>
          </div>
        )}
        {search && (
          <QuickSearch
            newTab={search === 'new'}
            onClose={() => setSearch(null)}
            onSelect={() => setScreen('page')}
          />
        )}
        {settings && (
          <SettingsDialog
            key={w.id}
            initialCategory={settingsCategory}
            onClose={() => setSettings(false)}
            onOpenPlugin={openPlugin}
            onConfigurePlugin={openPluginConfiguration}
          />
        )}
      </div>
      {busy && (
        <div className="workspace-transition" role="status">
          <Logo />
          <p>{t('Opening your workspace…')}</p>
        </div>
      )}
    </>
  )
}
