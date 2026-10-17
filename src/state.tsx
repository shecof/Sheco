import { filePreviewTab, filePreviewId, attachmentPreviewKind } from './shared/filePreview'
import { useI18n } from './i18n'
import {
  isPluginAppTab,
  pluginAppEnabled,
  isPluginSettingsTab,
  isPluginTabVisible,
} from './shared/plugins'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  createPage,
  createDatabase,
  descendants,
  uid,
  nextTimestamp,
  type Workspace,
  type Page,
  type BootData,
  type DocNode,
  type Database,
  type Attachment,
} from './shared/model'
import type {} from './shared/api'
import { executeWorkspaceTool } from './shared/mcp'

type Status = 'saved' | 'saving' | 'unsaved' | 'error'
interface State {
  data: BootData | null
  w: Workspace | null
  status: Status
  error: string
  toast: string
  busy: boolean
  remoteEdits: Record<string, number>
  titleFocusId: string | null
  clearTitleFocus: () => void
  update: (fn: (w: Workspace) => Workspace) => void
  canNavigate: () => boolean
  registerNavigationGuard: (guard: () => boolean) => () => void
  editPage: (id: string, patch: Partial<Page>) => void
  editDB: (id: string, patch: Partial<Database>) => void
  openPage: (id: string, newTab?: boolean) => void
  openAttachment: (id: string) => Promise<void>
  closeTab: (id: string) => void
  newPage: (
    parent?: string | null,
    kind?: Page['kind'],
    databaseId?: string | null,
    open?: boolean,
  ) => Page
  removePage: (id: string) => void
  duplicate: (id: string) => void
  restore: (id: string) => void
  flush: () => Promise<void>
  switchSpace: (id: string) => Promise<void>
  createSpace: (name: string) => Promise<void>
  openSpace: () => Promise<void>
  notify: (text: string) => void
  run: (fn: () => Promise<unknown>) => void
  addAttachments: (items: Attachment[]) => void
  importPage: (parentId?: string | null) => Promise<boolean>
}
const Context = createContext<State>(null!)
export const useApp = () => useContext(Context)
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { t, language } = useI18n()

  const [data, setData] = useState<BootData | null>(null)
  const [w, setW] = useState<Workspace | null>(null)
  const [status, setStatus] = useState<Status>('saved')
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [busy, setBusy] = useState(false)
  const [remoteEdits, setRemoteEdits] = useState<Record<string, number>>({})
  const [titleFocusId, setTitleFocusId] = useState<string | null>(null)
  const changingSpace = useRef(false)
  const attachmentOpenSequence = useRef(0)
  const navigationSequence = useRef(0)
  const current = useRef<Workspace | null>(null)
  const seq = useRef(0)
  const saved = useRef(0)
  const inFlight = useRef<Promise<void> | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const failed = useRef(false)
  const mcpOperation = useRef<Promise<void> | null>(null)
  const navigationGuard = useRef<(() => boolean) | null>(null)
  const registerNavigationGuard = useCallback((guard: () => boolean) => {
    navigationGuard.current = guard
    return () => {
      if (navigationGuard.current === guard) navigationGuard.current = null
    }
  }, [])
  const notify = useCallback((text: string) => setToast(text), [])
  const canNavigate = useCallback(() => {
    if (navigationGuard.current?.() !== false) return true
    notify(t('Correct or reset the property draft before leaving this diagram.'))
    return false
  }, [notify, t])
  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(''), 5500)
    return () => clearTimeout(id)
  }, [toast])
  const load = useCallback(
    (next: BootData) => {
      current.current = next.active
      seq.current = 0
      saved.current = 0
      failed.current = false
      setData(next)
      setW(next.active)
      setStatus('saved')
      setError('')
      if (next.recovered)
        notify(
          t(
            'Recovered a valid backup. Recent edits may be missing. The damaged file was preserved in metadata.',
          ),
        )
    },
    [notify],
  )
  useEffect(() => {
    window.sheco
      .boot()
      .then(load)
      .catch((e) => setError(String(e)))
  }, [load])
  const flush = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    if (inFlight.current) {
      await inFlight.current
      return flush()
    }
    if (!current.current || seq.current === saved.current) return
    const snapshot = current.current
    const version = seq.current
    setStatus('saving')
    failed.current = false
    const operation = (async () => {
      try {
        const result = await window.sheco.save(snapshot, snapshot.revision)
        if (current.current?.id === snapshot.id) {
          current.current = { ...current.current, ...result }
          setW(current.current)
          saved.current = version
          setStatus(seq.current === saved.current ? 'saved' : 'unsaved')
          setError('')
        }
      } catch (e) {
        failed.current = true
        setStatus('error')
        setError(e instanceof Error ? e.message : String(e))
        throw e
      } finally {
        inFlight.current = null
      }
    })()
    inFlight.current = operation
    await operation
    if (seq.current !== saved.current) await flush()
  }, [])
  const update = useCallback(
    (fn: (w: Workspace) => Workspace) => {
      if (!current.current || changingSpace.current) return
      const before = current.current
      let next = fn(before)
      if (next === before) return
      const active = before.ui.activeId
      if (
        next.ui.activeId !== active ||
        (before.plugins.projectArchitecture.enabled && !next.plugins.projectArchitecture.enabled) ||
        (active && next.pages.some((page) => page.id === active && page.deletedAt))
      ) {
        if (!canNavigate()) return
        // A successful flush can itself save the draft. Rebase navigation on that state.
        if (current.current !== before) next = fn(current.current)
      }
      current.current = next
      seq.current++
      setW(next)
      if (!failed.current) setStatus('unsaved')
      if (timer.current) clearTimeout(timer.current)
      if (!failed.current) timer.current = setTimeout(() => void flush().catch(() => {}), 500)
    },
    [flush, canNavigate],
  )
  useEffect(
    () =>
      window.sheco.onMcpRequest((request) => {
        const operation = (async () => {
          try {
            if (
              changingSpace.current ||
              !current.current ||
              current.current.id !== request.args.workspaceId
            )
              throw new Error('The authorized workspace is not open')
            await flush()
            const { validateEditorDocument } = await import('./editor/documentSchema')
            await flush()
            if (
              changingSpace.current ||
              !current.current ||
              current.current.id !== request.args.workspaceId
            )
              throw new Error('The workspace changed. Retry after it is ready.')
            if (Date.now() >= request.deadline)
              throw new Error('This MCP request expired. Read the latest data before retrying.')
            const output = executeWorkspaceTool(
              current.current,
              request.tool,
              request.args,
              validateEditorDocument,
            )
            if (output.workspace !== current.current) {
              const changed = output.workspace.pages
                .filter(
                  (p) =>
                    p.content !== current.current!.pages.find((old) => old.id === p.id)?.content,
                )
                .map((p) => p.id)
              update(() => output.workspace)
              setRemoteEdits((prior) => {
                const next = { ...prior }
                for (const id of changed) next[id] = (next[id] ?? 0) + 1
                return next
              })
              await flush()
            }
            await window.sheco.replyMcp({
              id: request.id,
              result: { ...output.result, revision: current.current.revision },
            })
          } catch (e) {
            await window.sheco.replyMcp({
              id: request.id,
              error: e instanceof Error ? e.message : String(e),
            })
          }
        })()
        mcpOperation.current = operation
        void operation
          .finally(() => {
            if (mcpOperation.current === operation) mcpOperation.current = null
          })
          .catch(() => {})
      }),
    [flush, update],
  )
  useEffect(
    () =>
      window.sheco.onClose(() => {
        if (!canNavigate()) return
        void Promise.resolve(mcpOperation.current)
          .then(flush)
          .then(() => window.sheco.readyToClose())
          .catch(() =>
            notify(
              t(
                'Sheco stayed open because your changes could not be saved. Export a recovery file in Settings before closing.',
              ),
            ),
          )
      }),
    [flush, notify, canNavigate],
  )
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )
  const run = useCallback(
    (fn: () => Promise<unknown>) => {
      void fn().catch((e) => notify(e instanceof Error ? e.message : String(e)))
    },
    [notify],
  )
  const openPage = useCallback(
    (id: string, newTab = false) => {
      if (!isPluginTabVisible(id)) return
      navigationSequence.current++
      update((w) => {
        const plugin =
          isPluginSettingsTab(id) ||
          (isPluginAppTab(id) && pluginAppEnabled(w.plugins, id)) ||
          (w.plugins.filePreview.enabled &&
            w.attachments.some((a) => a.id === filePreviewId(id) && attachmentPreviewKind(a)))
        if (!plugin && !w.pages.some((p) => p.id === id && !p.deletedAt)) return w
        let tabs = [...w.ui.tabs]
        if (!tabs.includes(id)) {
          if (
            newTab ||
            plugin ||
            (w.ui.activeId && isPluginAppTab(w.ui.activeId)) ||
            (w.ui.activeId && isPluginSettingsTab(w.ui.activeId)) ||
            (w.ui.activeId && filePreviewId(w.ui.activeId)) ||
            !w.ui.activeId
          ) {
            if (tabs.length >= 40) {
              notify(t('Close a tab before opening another.'))
              return w
            }
            tabs.push(id)
          } else {
            const index = tabs.indexOf(w.ui.activeId)
            if (index < 0) tabs.push(id)
            else tabs[index] = id
          }
        }
        return { ...w, ui: { ...w.ui, tabs, activeId: id } }
      })
    },
    [update, notify],
  )
  const openAttachment = useCallback(
    async (id: string) => {
      const request = ++attachmentOpenSequence.current
      const navigation = navigationSequence.current
      const workspace = current.current
      const attachment = workspace?.attachments.find((a) => a.id === id)
      if (!workspace || !attachment) return
      if (workspace.plugins.filePreview.enabled && attachmentPreviewKind(attachment)) {
        await flush()
        if (
          current.current?.id !== workspace.id ||
          changingSpace.current ||
          attachmentOpenSequence.current !== request ||
          navigationSequence.current !== navigation ||
          current.current.ui.activeId !== workspace.ui.activeId
        )
          return
        openPage(filePreviewTab(id), true)
      } else await window.sheco.openAttachment(id)
    },
    [flush, openPage],
  )
  const closeTab = useCallback(
    (id: string) =>
      update((w) => {
        const index = w.ui.tabs.indexOf(id)
        const tabs = w.ui.tabs.filter((t) => t !== id)
        return {
          ...w,
          ui: {
            ...w.ui,
            tabs,
            activeId: w.ui.activeId === id ? (tabs[Math.max(0, index - 1)] ?? null) : w.ui.activeId,
          },
        }
      }),
    [update],
  )
  const editPage = useCallback(
    (id: string, patch: Partial<Page>) =>
      update((w) => ({
        ...w,
        pages: w.pages.map((p) =>
          p.id === id
            ? {
                ...p,
                ...patch,
                ...(p.kind === 'architecture' &&
                  p.architecture &&
                  patch.title !== undefined && {
                    architecture: {
                      ...(patch.architecture ?? p.architecture),
                      name: patch.title.trim().slice(0, 120) || t('Untitled architecture'),
                    },
                  }),
                updatedAt: nextTimestamp(p.updatedAt),
              }
            : p,
        ),
      })),
    [update, t],
  )
  const editDB = useCallback(
    (id: string, patch: Partial<Database>) =>
      update((w) => ({
        ...w,
        databases: w.databases.map((d) => (d.id === id ? { ...d, ...patch } : d)),
      })),
    [update],
  )
  const newPage = useCallback(
    (
      parent: string | null = null,
      kind: Page['kind'] = 'page',
      databaseId: string | null = null,
      open = true,
    ) => {
      const w = current.current!
      const p = createPage(w, t('Untitled'), parent, kind, databaseId)
      update((w) => ({
        ...w,
        pages: [...w.pages, p],
        databases: kind === 'database' ? [...w.databases, createDatabase(p.id)] : w.databases,
        ui: {
          ...w.ui,
          expanded: parent ? [...new Set([...w.ui.expanded, parent])] : w.ui.expanded,
        },
      }))
      if (open) {
        setTitleFocusId(p.id)
        openPage(p.id, true)
      }
      return p
    },
    [update, openPage],
  )
  const removePage = useCallback(
    (id: string) =>
      update((w) => {
        const ids = descendants(w, id)
        const now = new Date().toISOString()
        const tabs = w.ui.tabs.filter((t) => !ids.includes(t))
        notify(t('Moved to Trash. You can restore it at any time.'))
        return {
          ...w,
          pages: w.pages.map((p) => (ids.includes(p.id) ? { ...p, deletedAt: now } : p)),
          ui: {
            ...w.ui,
            tabs,
            activeId: ids.includes(w.ui.activeId ?? '') ? (tabs.at(-1) ?? null) : w.ui.activeId,
            favorites: w.ui.favorites.filter((f) => !ids.includes(f)),
          },
        }
      }),
    [update, notify],
  )
  const duplicate = useCallback(
    (id: string) => {
      const w = current.current!
      const ids = descendants(w, id).filter((id) =>
        w.pages.some((p) => p.id === id && !p.deletedAt),
      )
      const map = Object.fromEntries(ids.map((id) => [id, uid()]))
      const dbMap = Object.fromEntries(
        w.databases.filter((d) => ids.includes(d.pageId)).map((d) => [d.id, uid()]),
      )
      const now = new Date().toISOString()
      const rewrite = (n: DocNode): DocNode => ({
        ...n,
        attrs:
          n.attrs?.pageId && map[String(n.attrs.pageId)]
            ? { ...n.attrs, pageId: map[String(n.attrs.pageId)] }
            : n.attrs,
        content: n.content?.map(rewrite),
      })
      const pages = w.pages
        .filter((p) => ids.includes(p.id))
        .map((p) => ({
          ...p,
          id: map[p.id],
          title: p.id === id ? p.title + ' (copy)' : p.title,
          ...(p.architecture && {
            architecture: {
              ...p.architecture,
              name:
                (p.id === id ? p.title + ' (copy)' : p.title).trim().slice(0, 120) ||
                t('Untitled architecture'),
            },
          }),
          parentId: map[p.parentId ?? ''] ?? p.parentId,
          databaseId: dbMap[p.databaseId ?? ''] ?? p.databaseId,
          order: p.id === id ? p.order + 0.5 : p.order,
          content: rewrite(p.content),
          createdAt: now,
          updatedAt: now,
        }))
      update((w) => ({
        ...w,
        pages: [...w.pages, ...pages],
        databases: [
          ...w.databases,
          ...w.databases
            .filter((d) => dbMap[d.id])
            .map((d) => ({ ...d, id: dbMap[d.id], pageId: map[d.pageId] })),
        ],
      }))
      openPage(map[id], true)
    },
    [update, openPage, t],
  )
  const restore = useCallback(
    (id: string) =>
      update((w) => {
        const ids = new Set(descendants(w, id))
        let p = w.pages.find((p) => p.id === id)
        while (p?.parentId) {
          ids.add(p.parentId)
          p = w.pages.find((a) => a.id === p!.parentId)
        }
        notify(t('Page restored.'))
        return { ...w, pages: w.pages.map((p) => (ids.has(p.id) ? { ...p, deletedAt: null } : p)) }
      }),
    [update, notify],
  )
  const transitionSpace = useCallback(
    async (operation: () => Promise<BootData | null>) => {
      if (changingSpace.current || !canNavigate()) return
      await mcpOperation.current
      if (changingSpace.current) return
      changingSpace.current = true
      setBusy(true)
      try {
        await flush()
        const next = await operation()
        if (next) load(next)
      } finally {
        changingSpace.current = false
        setBusy(false)
      }
    },
    [flush, load, canNavigate],
  )
  const switchSpace = useCallback(
    (id: string) => transitionSpace(() => window.sheco.switchSpace(id)),
    [transitionSpace],
  )
  const createSpace = useCallback(
    (name: string) => transitionSpace(() => window.sheco.createSpace(name)),
    [transitionSpace],
  )
  const openSpace = useCallback(
    () => transitionSpace(() => window.sheco.openSpace()),
    [transitionSpace],
  )
  const addAttachments = useCallback(
    (items: Attachment[]) =>
      update((w) => ({
        ...w,
        attachments: [
          ...w.attachments,
          ...items.filter((a) => !w.attachments.some((b) => b.id === a.id)),
        ],
      })),
    [update],
  )
  const importPage = useCallback(
    async (parentId: string | null = null) => {
      const workspaceId = current.current?.id
      if (!workspaceId || changingSpace.current) return false
      await flush()
      if (current.current?.id !== workspaceId || changingSpace.current) return false
      const result = await window.sheco.importMarkdown()
      if (!result || current.current?.id !== workspaceId || changingSpace.current) return false
      const workspace = current.current
      const parent = workspace.pages.find((page) => page.id === parentId && !page.deletedAt)
      if (parentId && !parent) {
        notify(t('The destination page is no longer available.'))
        return false
      }
      const page = newPage(
        parentId,
        'page',
        parent?.kind === 'database'
          ? (workspace.databases.find((database) => database.pageId === parentId)?.id ?? null)
          : null,
      )
      editPage(page.id, {
        title: result.title,
        description: 'Imported from Markdown',
        content: {
          type: 'doc',
          content: [{ type: 'paragraph', attrs: { importMarkdown: result.text } }],
        },
      })
      const assets = (result as typeof result & { attachments?: Attachment[] }).attachments
      if (assets) addAttachments(assets)
      return true
    },
    [flush, newPage, editPage, addAttachments, notify, t],
  )
  return (
    <Context.Provider
      value={{
        data,
        w,
        status,
        error,
        toast,
        busy,
        remoteEdits,
        update,
        canNavigate,
        registerNavigationGuard,
        editPage,
        editDB,
        openPage,
        closeTab,
        openAttachment,
        newPage,
        titleFocusId,
        clearTitleFocus: () => setTitleFocusId(null),
        removePage,
        duplicate,
        restore,
        flush,
        switchSpace,
        createSpace,
        openSpace,
        notify,
        run,
        addAttachments,
        importPage,
      }}
    >
      {children}
    </Context.Provider>
  )
}
