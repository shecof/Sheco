import { useI18n } from '../i18n'
import { useEffect, useRef, useState, type CSSProperties, type DragEvent } from 'react'
import { Logo } from './Logo'
import {
  Search,
  Plus,
  ChevronDown,
  ChevronRight,
  Star,
  Settings,
  Trash2,
  MoreHorizontal,
  FolderOpen,
  Layers,
  FilePlus2,
  Table2,
  Copy,
  Pencil,
  ArrowRight,
  Link,
  Download,
  PanelLeftClose,
  Puzzle,
  Terminal,
} from 'lucide-react'
import { useApp } from '../state'
import { descendants, movePage, type Page } from '../shared/model'
import { PageIcon, IconButton, MenuItem, Modal, Popover } from './ui'
import { commandBuilderTab } from '../shared/plugins'
export function Sidebar({
  screen,
  onNavigate,
  onSearch,
  onSettings,
  onCollapse,
  onPluginSettings,
}: {
  screen: string
  onNavigate: (screen: string) => void
  onSearch: () => void
  onSettings: () => void
  onCollapse: () => void
  onPluginSettings: () => void
}) {
  const { t, language } = useI18n()
  const [resizeWidth, setResizeWidth] = useState<number | null>(null)
  const resize = useRef<{
    pointer: number
    startX: number
    startWidth: number
    width: number
  } | null>(null)
  useEffect(() => () => document.body.classList.remove('resizing-sidebar'), [])

  const {
    w,
    data,
    openPage,
    newPage,
    update,
    editPage,
    removePage,
    duplicate,
    switchSpace,
    createSpace,
    openSpace,
    run,
    notify,
    flush,
  } = useApp()
  const [spaceMenu, setSpaceMenu] = useState(false)
  const [pluginMenu, setPluginMenu] = useState(false)
  const pluginAnchor = useRef<HTMLButtonElement>(null)
  const [newSpace, setNewSpace] = useState(false)
  const [spaceName, setSpaceName] = useState('')
  const [context, setContext] = useState<{ page: Page; x: number; y: number } | null>(null)
  const [rename, setRename] = useState<Page | null>(null)
  const [title, setTitle] = useState('')
  const [move, setMove] = useState<Page | null>(null)
  const [drop, setDrop] = useState<{
    id: string
    position: 'before' | 'after' | 'inside'
  } | null>(null)
  const draggingPage = useRef<string | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  if (!w || !data) return null
  const navigate = (id: string, newTab = false) => {
    openPage(id, newTab)
    onNavigate('page')
  }
  const toggle = (id: string) =>
    update((w) => ({
      ...w,
      ui: {
        ...w.ui,
        expanded: w.ui.expanded.includes(id)
          ? w.ui.expanded.filter((v) => v !== id)
          : [...w.ui.expanded, id],
      },
    }))
  const create = (parent: Page | null = null, kind: Page['kind'] = 'page') => {
    newPage(
      parent?.id ?? null,
      kind,
      parent?.kind === 'database'
        ? (w.databases.find((d) => d.pageId === parent.id)?.id ?? null)
        : null,
    )
    onNavigate('page')
  }
  const roots = w.pages.filter((p) => !p.deletedAt && !p.parentId).sort((a, b) => a.order - b.order)
  const canDrop = (id: string, parentId: string | null) => {
    const source = w.pages.find((page) => page.id === id && !page.deletedAt)
    const parent = w.pages.find((page) => page.id === parentId)
    return (
      !!source &&
      !source.databaseId &&
      (!parentId || (!!parent && !parent.deletedAt && parent.kind !== 'database')) &&
      (!parentId || !descendants(w, id).includes(parentId))
    )
  }
  const dropPosition = (event: DragEvent<HTMLElement>, page: Page) => {
    const id = draggingPage.current
    if (!id || id === page.id) return null
    const rect = event.currentTarget.getBoundingClientRect()
    const fraction = (event.clientY - rect.top) / rect.height
    const position = fraction < 0.25 ? 'before' : fraction > 0.75 ? 'after' : 'inside'
    return canDrop(id, position === 'inside' ? page.id : page.parentId) ? position : null
  }
  const finishDrag = () => {
    draggingPage.current = null
    setDragging(null)
    setDrop(null)
  }
  const renderPage = (page: Page, depth = 0) => {
    const children = w.pages
      .filter((p) => !p.deletedAt && p.parentId === page.id)
      .sort((a, b) => a.order - b.order)
    const expanded = w.ui.expanded.includes(page.id)
    return (
      <div
        key={page.id}
        className={
          'tree-item ' +
          (drop?.id === page.id && drop.position !== 'inside' ? 'tree-drop-' + drop.position : '')
        }
        style={{ '--drop-indent': `${10 + depth * 16}px` } as CSSProperties}
      >
        <div
          className={
            'tree-row ' +
            (screen === 'page' && w.ui.activeId === page.id ? 'active ' : '') +
            (drop?.id === page.id && drop.position === 'inside' ? 'tree-drop-inside ' : '') +
            (dragging === page.id ? 'tree-dragging' : '')
          }
          style={{ paddingLeft: 10 + depth * 16 }}
          draggable={!page.databaseId}
          onDragStart={(e) => {
            if ((e.target as HTMLElement).closest('.tree-actions, .tree-chevron')) {
              e.preventDefault()
              return
            }
            draggingPage.current = page.id
            setDragging(page.id)
            e.dataTransfer.effectAllowed = 'move'
            e.dataTransfer.setData('application/sheco-page', page.id)
          }}
          onDragEnd={finishDrag}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes('application/sheco-page')) {
              e.stopPropagation()
              const position = dropPosition(e, page)
              if (position) e.preventDefault()
              e.dataTransfer.dropEffect = position ? 'move' : 'none'
              setDrop(position ? { id: page.id, position } : null)
            }
          }}
          onDragLeave={(e) => {
            if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return
            setDrop((current) => (current?.id === page.id ? null : current))
          }}
          onDrop={(e) => {
            e.preventDefault()
            e.stopPropagation()
            const id = e.dataTransfer.getData('application/sheco-page')
            const position = dropPosition(e, page)
            finishDrag()
            if (!id || !position) return
            try {
              update((workspace) => {
                const siblings = workspace.pages
                  .filter((p) => !p.deletedAt && p.parentId === page.parentId && p.id !== id)
                  .sort((a, b) => a.order - b.order)
                const nextSibling = siblings[siblings.findIndex((p) => p.id === page.id) + 1]
                const next = movePage(
                  workspace,
                  id,
                  position === 'inside' ? page.id : page.parentId,
                  position === 'before'
                    ? page.id
                    : position === 'after'
                      ? nextSibling?.id
                      : undefined,
                )
                return position === 'inside' && !next.ui.expanded.includes(page.id)
                  ? { ...next, ui: { ...next.ui, expanded: [...next.ui.expanded, page.id] } }
                  : next
              })
            } catch (error) {
              notify((error as Error).message)
            }
          }}
          onContextMenu={(e) => {
            e.preventDefault()
            setContext({ page, x: e.clientX, y: e.clientY })
          }}
        >
          <button
            className={'tree-chevron ' + (!children.length ? 'empty' : '')}
            aria-label={(expanded ? t('Collapse ') : t('Expand ')) + page.title}
            onClick={() => toggle(page.id)}
          >
            {children.length > 0 &&
              (expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />)}
          </button>
          <button
            className="tree-page"
            onClick={(e) => navigate(page.id, e.metaKey || e.ctrlKey)}
            onDoubleClick={() => toggle(page.id)}
          >
            <PageIcon icon={page.icon} size={16} />
            <span>{page.title || t('Untitled')}</span>
          </button>
          <div className="tree-actions">
            <button
              aria-label={t('Options for ') + page.title}
              onClick={(e) => setContext({ page, x: e.clientX, y: e.clientY })}
            >
              <MoreHorizontal size={15} />
            </button>
            <button aria-label={t('Add page inside ') + page.title} onClick={() => create(page)}>
              <Plus size={14} />
            </button>
          </div>
        </div>
        {expanded && children.map((child) => renderPage(child, depth + 1))}
      </div>
    )
  }
  return (
    <aside className="sidebar" style={{ width: resizeWidth ?? w.ui.sidebarWidth }}>
      <div
        className="sidebar-resizer"
        role="separator"
        tabIndex={0}
        aria-label={t('Resize sidebar')}
        aria-orientation="vertical"
        aria-valuemin={220}
        aria-valuemax={560}
        aria-valuenow={resizeWidth ?? w.ui.sidebarWidth}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          event.preventDefault()
          event.currentTarget.setPointerCapture(event.pointerId)
          resize.current = {
            pointer: event.pointerId,
            startX: event.clientX,
            startWidth: w.ui.sidebarWidth,
            width: w.ui.sidebarWidth,
          }
          document.body.classList.add('resizing-sidebar')
        }}
        onPointerMove={(event) => {
          const current = resize.current
          if (!current || current.pointer !== event.pointerId) return
          current.width = Math.round(
            Math.max(
              220,
              Math.min(
                560,
                window.innerWidth - 480,
                current.startWidth + event.clientX - current.startX,
              ),
            ),
          )
          setResizeWidth(current.width)
        }}
        onPointerUp={(event) => {
          const current = resize.current
          if (!current || current.pointer !== event.pointerId) return
          resize.current = null
          event.currentTarget.releasePointerCapture(event.pointerId)
          document.body.classList.remove('resizing-sidebar')
          update((workspace) => ({
            ...workspace,
            ui: { ...workspace.ui, sidebarWidth: current.width },
          }))
          setResizeWidth(null)
        }}
        onLostPointerCapture={() => {
          resize.current = null
          setResizeWidth(null)
          document.body.classList.remove('resizing-sidebar')
        }}
        onDoubleClick={() =>
          update((workspace) => ({ ...workspace, ui: { ...workspace.ui, sidebarWidth: 252 } }))
        }
        onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
          event.preventDefault()
          const width =
            event.key === 'Home'
              ? 220
              : event.key === 'End'
                ? Math.min(560, window.innerWidth - 480)
                : w.ui.sidebarWidth + (event.key === 'ArrowLeft' ? -20 : 20)
          update((workspace) => ({
            ...workspace,
            ui: {
              ...workspace.ui,
              sidebarWidth: Math.max(220, Math.min(560, window.innerWidth - 480, width)),
            },
          }))
        }}
      />
      <div className="sidebar-drag-area" />
      <div className="sidebar-brand">
        <div className="brand-lockup">
          <Logo />
          <strong>sheco</strong>
        </div>
        <div className="brand-actions">
          <IconButton title={t('Quick search')} onClick={onSearch}>
            <Search size={17} />
          </IconButton>
          <IconButton title={t('Collapse sidebar')} onClick={onCollapse}>
            <PanelLeftClose size={16} />
          </IconButton>
        </div>
      </div>
      <div className="space-switcher">
        <button onClick={() => setSpaceMenu(!spaceMenu)}>
          <span className="space-avatar">{w.name.slice(0, 1).toUpperCase()}</span>
          <span>
            <strong>{w.name}</strong>
            <small>{t('Personal workspace')}</small>
          </span>
          <ChevronDown size={14} />
        </button>
        {spaceMenu && (
          <Popover className="space-menu" onClose={() => setSpaceMenu(false)}>
            <div className="popover-title">{t('Your workspaces')}</div>
            {data.spaces.map((space) => (
              <MenuItem
                key={space.id}
                selected={space.id === w.id}
                icon={<span className="mini-avatar">{space.name[0]}</span>}
                onClick={() => {
                  setSpaceMenu(false)
                  run(async () => {
                    await switchSpace(space.id)
                    onNavigate('page')
                  })
                }}
              >
                {space.name}
              </MenuItem>
            ))}
            <div className="menu-separator" />
            <MenuItem
              icon={<Plus size={16} />}
              onClick={() => {
                setSpaceMenu(false)
                setNewSpace(true)
                setSpaceName('')
              }}
            >
              {t('New workspace')}
            </MenuItem>
            <MenuItem
              icon={<FolderOpen size={16} />}
              onClick={() => {
                setSpaceMenu(false)
                run(async () => {
                  await openSpace()
                  onNavigate('page')
                })
              }}
            >
              {t('Open workspace folder')}
            </MenuItem>
          </Popover>
        )}
      </div>
      <div className="sidebar-scroll">
        <div className="sidebar-section-label">
          <span>{t('Favorites')}</span>
          <Star size={11} />
        </div>
        <div className="favorite-pages">
          {w.ui.favorites
            .map((id) => w.pages.find((p) => p.id === id && !p.deletedAt))
            .filter((p): p is Page => !!p)
            .map((page) => (
              <button
                className={screen === 'page' && w.ui.activeId === page.id ? 'active' : ''}
                key={page.id}
                onClick={(e) => navigate(page.id, e.metaKey || e.ctrlKey)}
              >
                <PageIcon icon={page.icon} />
                <span>{page.title || t('Untitled')}</span>
              </button>
            ))}
          {!w.ui.favorites.length && (
            <p className="sidebar-hint">{t('Star a page to keep it close.')}</p>
          )}
        </div>
        <div className="sidebar-section-label pages-label">
          <span>{t('Pages')}</span>
          <IconButton title={t('New page')} onClick={() => create()}>
            <Plus size={14} />
          </IconButton>
        </div>
        <div className="page-tree">{roots.map((p) => renderPage(p))}</div>
        <button
          className={'sidebar-add ' + (drop?.id === 'root' ? 'drop-target' : '')}
          onClick={() => create()}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes('application/sheco-page')) {
              const valid = !!draggingPage.current && canDrop(draggingPage.current, null)
              if (valid) e.preventDefault()
              e.dataTransfer.dropEffect = valid ? 'move' : 'none'
              setDrop(valid ? { id: 'root', position: 'inside' } : null)
            }
          }}
          onDragLeave={() => setDrop(null)}
          onDrop={(e) => {
            e.preventDefault()
            const id = e.dataTransfer.getData('application/sheco-page')
            finishDrag()
            if (id && canDrop(id, null))
              try {
                update((w) => movePage(w, id, null))
              } catch (error) {
                notify((error as Error).message)
              }
          }}
        >
          <Plus size={16} />
          {t('New page')}
        </button>
      </div>
      <footer className="sidebar-footer">
        <button
          ref={pluginAnchor}
          aria-haspopup="menu"
          aria-expanded={pluginMenu}
          onClick={() => setPluginMenu(!pluginMenu)}
        >
          <Puzzle size={15} />
          {t('Plugins')}
          <span>{w.plugins.commandBuilder.enabled ? '1' : ''}</span>
        </button>
        {pluginMenu && (
          <Popover
            anchor={pluginAnchor}
            className="plugins-menu"
            onClose={() => setPluginMenu(false)}
          >
            <div className="popover-title">{t('Enabled plugins')}</div>
            {w.plugins.commandBuilder.enabled ? (
              <MenuItem
                icon={<Terminal size={16} />}
                onClick={() => {
                  navigate(commandBuilderTab, true)
                  setPluginMenu(false)
                }}
              >
                {t('Command builder')}
              </MenuItem>
            ) : (
              <p className="plugins-menu-empty">{t('No plugins enabled')}</p>
            )}
            <div className="menu-separator" />
            <MenuItem
              icon={<Settings size={15} />}
              onClick={() => {
                setPluginMenu(false)
                onPluginSettings()
              }}
            >
              {t('Manage plugins')}
            </MenuItem>
          </Popover>
        )}
        <button
          className={screen === 'trash' ? 'selected' : ''}
          onClick={() => onNavigate('trash')}
        >
          <Trash2 size={15} />
          {t('Trash')}
          <span>{w.pages.filter((p) => p.deletedAt).length || ''}</span>
        </button>
        <button onClick={onSettings}>
          <Settings size={15} />
          {t('Settings')}
        </button>
      </footer>
      {context && (
        <>
          <div className="click-away" onClick={() => setContext(null)} />
          <div
            className="popover context-menu"
            style={{
              left: Math.min(context.x, window.innerWidth - 260),
              top: Math.min(context.y, window.innerHeight - 390),
            }}
          >
            <div className="popover-title">{context.page.title || t('Untitled')}</div>
            <MenuItem
              icon={<FilePlus2 size={15} />}
              onClick={() => {
                create(context.page)
                setContext(null)
              }}
            >
              {context.page.kind === 'database' ? t('New entry') : t('New subpage')}
            </MenuItem>
            <MenuItem
              icon={<ArrowRight size={15} />}
              onClick={() => {
                navigate(context.page.id, true)
                setContext(null)
              }}
            >
              {t('Open in new tab')}
            </MenuItem>
            <MenuItem
              icon={<Pencil size={15} />}
              onClick={() => {
                setRename(context.page)
                setTitle(context.page.title)
                setContext(null)
              }}
            >
              {t('Rename')}
            </MenuItem>
            <MenuItem
              icon={<Copy size={15} />}
              onClick={() => {
                duplicate(context.page.id)
                onNavigate('page')
                setContext(null)
              }}
            >
              {t('Duplicate')}
            </MenuItem>
            {!context.page.databaseId && (
              <MenuItem
                icon={<Layers size={15} />}
                onClick={() => {
                  setMove(context.page)
                  setContext(null)
                }}
              >
                {t('Move to…')}
              </MenuItem>
            )}
            <MenuItem
              icon={<Link size={15} />}
              onClick={() => {
                run(async () => {
                  await window.sheco.copyText('sheco://page/' + context.page.id)
                  notify(t('Page link copied.'))
                })
                setContext(null)
              }}
            >
              {t('Copy link')}
            </MenuItem>
            <MenuItem
              icon={<Download size={15} />}
              onClick={() => {
                const id = context.page.id
                setContext(null)
                run(async () => {
                  await flush()
                  const file = await window.sheco.exportPage(id, 'markdown')
                  if (file) notify(t('Markdown exported.'))
                })
              }}
            >
              {t('Export Markdown…')}
            </MenuItem>
            <div className="menu-separator" />
            <MenuItem
              danger
              icon={<Trash2 size={15} />}
              onClick={() => {
                removePage(context.page.id)
                setContext(null)
              }}
            >
              {t('Move to Trash')}
            </MenuItem>
          </div>
        </>
      )}
      {newSpace && (
        <Modal title={t('Create a workspace')} onClose={() => setNewSpace(false)}>
          <form
            className="modal-content"
            onSubmit={(e) => {
              e.preventDefault()
              run(async () => {
                await createSpace(spaceName.trim())
                setNewSpace(false)
                onNavigate('page')
              })
            }}
          >
            <p className="muted">
              {t('Give your ideas a separate home. You’ll choose where its folder is saved.')}
            </p>
            <label>
              {t('Workspace name')}
              <input
                autoFocus
                maxLength={100}
                value={spaceName}
                placeholder={t('e.g. Work, Personal, Research')}
                onChange={(e) => setSpaceName(e.target.value)}
                required
              />
            </label>
            <div className="modal-actions">
              <button className="button" type="button" onClick={() => setNewSpace(false)}>
                {t('Cancel')}
              </button>
              <button className="button primary" disabled={!spaceName.trim()}>
                {t('Choose location')}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {rename && (
        <Modal title={t('Rename page')} onClose={() => setRename(null)}>
          <form
            className="modal-content"
            onSubmit={(e) => {
              e.preventDefault()
              editPage(rename.id, { title: title.trim() })
              setRename(null)
            }}
          >
            <label>
              {t('Page title')}
              <input
                autoFocus
                maxLength={500}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <div className="modal-actions">
              <button className="button primary" type="submit">
                {t('Save title')}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {move && (
        <Modal title={t('Move ') + move.title} onClose={() => setMove(null)}>
          <div className="modal-content">
            <p className="muted">{t('Choose a parent page.')}</p>
            <div className="picker-list">
              <button
                onClick={() => {
                  update((w) => movePage(w, move.id, null))
                  setMove(null)
                }}
              >
                <Layers size={16} />
                {t('Workspace root')}
              </button>
              {w.pages
                .filter(
                  (p) =>
                    !p.deletedAt &&
                    !p.databaseId &&
                    p.kind !== 'database' &&
                    !descendants(w, move.id).includes(p.id),
                )
                .map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      update((w) => movePage(w, move.id, p.id))
                      setMove(null)
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
    </aside>
  )
}
