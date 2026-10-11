import { translate, type Language } from '../src/shared/i18n'
import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  Menu,
  protocol,
  session,
  shell,
  net,
  clipboard,
} from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { WorkspaceStore, atomicWrite, validateWorkspace } from './storage'
import { McpService } from './mcp'
import type { McpReply } from '../src/shared/mcp'
import { randomUUID } from 'node:crypto'
import { seedWorkspace } from '../src/shared/seed'
import { commandBuilderConfigSchema, parsePluginJson, pluginJsonLimit } from '../src/shared/plugins'
import { safeName, pageFilename, pageMarkdown, databaseCSV } from '../src/shared/export'
import {
  ancestors,
  type BootData,
  type SpaceInfo,
  type Attachment,
  type Workspace,
} from '../src/shared/model'

protocol.registerSchemesAsPrivileged([
  { scheme: 'sheco', privileges: { standard: true, secure: true, supportFetchAPI: true } },
  {
    scheme: 'sheco-asset',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
])
if (process.env.SHECO_DATA_DIR) app.setPath('userData', process.env.SHECO_DATA_DIR)
const devURL = process.env.SHECO_DEV_URL
if (devURL && devURL !== 'http://127.0.0.1:5173') throw new Error('Invalid development origin')
const registrySchema = z.object({
  activeId: z.string().uuid(),
  spaces: z.array(
    z.object({ id: z.string().uuid(), name: z.string(), icon: z.string(), path: z.string() }),
  ),
})
let registry: z.infer<typeof registrySchema>
let store: WorkspaceStore
let win: BrowserWindow
let allowClose = false
let quitting = false
let mcp: McpService
const mcpReplies = new Map<
  string,
  { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }
>()
async function requestMcpTool(
  tool: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!win || win.isDestroyed() || allowClose || quitting)
    throw new Error('Open Sheco before connecting an agent')
  const id = randomUUID()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      mcpReplies.delete(id)
      reject(new Error('The editor did not respond. Reconnect after Sheco is ready.'))
    }, 25000)
    mcpReplies.set(id, {
      resolve: (value) => {
        clearTimeout(timer)
        mcpReplies.delete(id)
        resolve(value)
      },
      reject: (error) => {
        clearTimeout(timer)
        mcpReplies.delete(id)
        reject(error)
      },
    })
    win.webContents.send('mcp-request', { id, tool, args, deadline: Date.now() + 25000 })
  })
}
async function executeMcpTool(
  tool: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (tool !== 'read_attachment' && tool !== 'upload_attachment') return requestMcpTool(tool, args)
  await requestMcpTool('get_workspace', { workspaceId: args.workspaceId })
  const target = store
  if (target.state.id !== args.workspaceId) throw new Error('The authorized workspace is not open')
  if (tool === 'read_attachment') {
    const attachment = target.state.attachments.find((a) => a.id === args.attachmentId)
    if (!attachment) throw new Error('Attachment not found')
    if (attachment.bytes > 8 * 1024 * 1024)
      throw new Error('MCP reads support attachments up to 8 MiB')
    const file = await target.attachmentPath(attachment.file)
    if ((await fs.stat(file)).size > 8 * 1024 * 1024) throw new Error('Attachment exceeds 8 MiB')
    return { attachment, base64: (await fs.readFile(file)).toString('base64') }
  }
  const encoded = String(args.base64)
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))
    throw new Error('Invalid base64 data')
  const bytes = Buffer.from(encoded, 'base64')
  if (!bytes.length || bytes.length > 8 * 1024 * 1024)
    throw new Error('MCP uploads support files from 1 byte to 8 MiB')
  const attachment = await target.addAttachment(String(args.name), bytes)
  await requestMcpTool('_register_attachment', { workspaceId: target.state.id, attachment })
  const assetUrl = `sheco-asset://${target.state.id}/${attachment.file}`
  return {
    attachment,
    assetUrl,
    block: /^image\/(png|jpeg|gif|webp|avif)$/.test(attachment.mime)
      ? { type: 'image', attrs: { src: assetUrl, alt: attachment.name, caption: '' } }
      : {
          type: 'attachment',
          attrs: {
            id: attachment.id,
            file: attachment.file,
            name: attachment.name,
            bytes: attachment.bytes,
          },
        },
  }
}
const pendingAttachments = new Map<string, Attachment>()
const registryPath = () => path.join(app.getPath('userData'), 'spaces.json')
async function persistRegistry() {
  await atomicWrite(registryPath(), JSON.stringify(registry, null, 2))
}
const spaceInfo = (s: WorkspaceStore): SpaceInfo => ({
  id: s.state.id,
  name: s.state.name,
  icon: s.state.icon,
  path: s.root,
})
const bootData = (): BootData => ({
  spaces: registry.spaces,
  active: store.state,
  path: store.root,
  recovered: store.recovered,
})
async function boot() {
  try {
    registry = registrySchema.parse(JSON.parse(await fs.readFile(registryPath(), 'utf8')))
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
      throw new Error(
        'The workspace registry is damaged. Original data is preserved. Please recover spaces.json from your backup.',
      )
    const root = process.env.SHECO_DATA_DIR
      ? path.join(process.env.SHECO_DATA_DIR, 'Knowledge')
      : path.join(app.getPath('documents'), 'Sheco', 'Pentest')
    store = new WorkspaceStore(root)
    if (
      await fs.stat(path.join(root, 'workspace.json')).then(
        () => true,
        () => false,
      )
    )
      await store.open()
    else await store.initialize(seedWorkspace())
    registry = { activeId: store.state.id, spaces: [spaceInfo(store)] }
    await persistRegistry()
    return
  }
  const info = registry.spaces.find((s) => s.id === registry.activeId) ?? registry.spaces[0]
  if (!info) throw new Error('No workspaces found.')
  store = new WorkspaceStore(info.path)
  try {
    await store.open()
  } catch (error) {
    const choice = await dialog.showMessageBox({
      type: 'warning',
      message: t('Your workspace could not be opened.'),
      detail:
        (error as Error).message +
        '\nYou can locate a moved folder or open a complete backup. Original files are preserved.',
      buttons: [t('Locate workspace folder'), t('Cancel')],
      defaultId: 0,
      cancelId: 1,
    })
    if (choice.response !== 0) throw error
    const result = await dialog.showOpenDialog({
      title: t('Locate a workspace or backup folder'),
      properties: ['openDirectory'],
    })
    if (result.canceled) throw error
    store = new WorkspaceStore(result.filePaths[0])
    await store.open()
    const next = spaceInfo(store)
    const index = registry.spaces.findIndex((s) => s.id === next.id)
    if (index < 0) registry.spaces.push(next)
    else registry.spaces[index] = next
    registry.activeId = next.id
    await persistRegistry()
  }
}
function handle(name: string, callback: (...args: any[]) => unknown) {
  ipcMain.handle(name, async (event, ...args) => {
    const url = event.senderFrame?.url ?? ''
    if (
      event.sender !== win.webContents ||
      event.senderFrame !== win.webContents.mainFrame ||
      (devURL ? new URL(url).origin !== devURL : !url.startsWith('sheco://app/'))
    )
      throw new Error('Unauthorized IPC sender')
    return callback(...args)
  })
}
async function activate(next: WorkspaceStore): Promise<BootData> {
  const prior = store
  store = next
  pendingAttachments.clear()
  registry.activeId = next.state.id
  const info = spaceInfo(next)
  const index = registry.spaces.findIndex((s) => s.id === info.id)
  if (index < 0) registry.spaces.push(info)
  else registry.spaces[index] = info
  try {
    await persistRegistry()
  } catch (e) {
    store = prior
    await next.close()
    throw e
  }
  await prior.close()
  return bootData()
}
function installIPC() {
  handle('import-plugin-settings', async () => {
    const result = await dialog.showOpenDialog(win, {
      title: t('Import plugin JSON'),
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    })
    if (result.canceled || !result.filePaths[0]) return null
    if ((await fs.stat(result.filePaths[0])).size > pluginJsonLimit)
      throw new Error(t('Plugin JSON is limited to 1 MB.'))
    try {
      return parsePluginJson(await fs.readFile(result.filePaths[0], 'utf8'))
    } catch {
      throw new Error(t('Invalid plugin JSON. Check the version, tools and parameters.'))
    }
  })
  handle('export-plugin-settings', async (input: unknown) => {
    const config = commandBuilderConfigSchema.parse(input)
    const text = JSON.stringify(config, null, 2)
    if (Buffer.byteLength(text) > pluginJsonLimit)
      throw new Error(t('Plugin JSON is limited to 1 MB.'))
    const result = await dialog.showSaveDialog(win, {
      title: t('Export plugin JSON'),
      defaultPath: 'sheco-command-builder.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (result.canceled || !result.filePath) return null
    await atomicWrite(result.filePath, text)
    return result.filePath
  })
  handle('copy-text', (text: string) =>
    clipboard.writeText(
      z
        .string()
        .max(2 * 1024 * 1024)
        .parse(text),
    ),
  )
  handle('mcp-status', () => mcp.status())
  handle('mcp-configure', (config: unknown) => mcp.configure(config))
  handle('mcp-rotate-token', () => mcp.rotateToken())
  handle('mcp-reply', (input: McpReply) => {
    const reply = z
      .object({
        id: z.string().uuid(),
        result: z.record(z.string(), z.unknown()).optional(),
        error: z.string().max(10000).optional(),
      })
      .parse(input)
    const pending = mcpReplies.get(reply.id)
    if (!pending) return
    if (reply.error) pending.reject(new Error(reply.error))
    else pending.resolve(reply.result ?? {})
  })
  handle('boot', () => bootData())
  handle('save', async (w: Workspace, revision: number) => {
    z.number().int().nonnegative().parse(revision)
    const result = await store.save(w, revision)
    const info = registry.spaces.find((s) => s.id === store.state.id)
    if (info && info.name !== store.state.name) {
      info.name = store.state.name
      await persistRegistry()
    }
    return result
  })
  handle('switch-space', async (id: string) => {
    z.string().uuid().parse(id)
    if (id === store.state.id) return bootData()
    const info = registry.spaces.find((s) => s.id === id)
    if (!info) throw new Error('Unknown workspace')
    const next = new WorkspaceStore(info.path)
    await next.open()
    return activate(next)
  })
  handle('create-space', async (name: string) => {
    name = z.string().trim().min(1).max(100).parse(name)
    const result = await dialog.showOpenDialog(win, {
      title: t('Choose a folder for your new workspace'),
      buttonLabel: 'Create here',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled) return null
    const root = path.join(result.filePaths[0], safeName(name))
    if ((await fs.readdir(root).catch(() => [])).length)
      throw new Error(
        'A non-empty folder already has this name. Choose a different name or location.',
      )
    const next = new WorkspaceStore(root)
    try {
      await next.initialize(seedWorkspace(name, false))
      return await activate(next)
    } catch (e) {
      await next.close()
      throw e
    }
  })
  handle('open-space', async () => {
    const result = await dialog.showOpenDialog(win, {
      title: t('Open a Sheco workspace folder'),
      properties: ['openDirectory'],
    })
    if (result.canceled) return null
    const root = await fs.realpath(result.filePaths[0])
    if (root === (await fs.realpath(store.root))) return bootData()
    const next = new WorkspaceStore(root)
    await next.open()
    if (next.state.id === store.state.id) {
      await next.close()
      throw new Error(
        'This is a copy of the active workspace. Close the original before opening its copy.',
      )
    }
    return activate(next)
  })
  handle('rename-space', async (name: string) => {
    name = z.string().trim().min(1).max(100).parse(name)
    await store.save({ ...store.state, name }, store.state.revision)
    const info = registry.spaces.find((s) => s.id === store.state.id)!
    info.name = name
    await persistRegistry()
  })
  handle('attach', async () => {
    const result = await dialog.showOpenDialog(win, {
      title: t('Add attachments'),
      properties: ['openFile', 'multiSelections'],
    })
    if (result.canceled) return []
    const out: Attachment[] = []
    for (const file of result.filePaths) {
      const stat = await fs.stat(file)
      if (stat.size > 200 * 1024 * 1024) throw new Error('The attachment exceeds 200 MB.')
      const a = await store.addAttachment(path.basename(file), await fs.readFile(file))
      pendingAttachments.set(a.id, a)
      out.push(a)
    }
    return out
  })
  handle('attach-bytes', async (name: string, bytes: ArrayBuffer) => {
    z.string().max(500).parse(name)
    if (!(bytes instanceof ArrayBuffer)) throw new Error('Invalid attachment data')
    const a = await store.addAttachment(name, new Uint8Array(bytes))
    pendingAttachments.set(a.id, a)
    return a
  })
  handle('open-attachment', async (id: string) => {
    z.string().uuid().parse(id)
    const a = store.state.attachments.find((a) => a.id === id) ?? pendingAttachments.get(id)
    if (!a) throw new Error('Attachment not found')
    const result = await shell.openPath(await store.attachmentPath(a.file))
    if (result) throw new Error(result)
  })
  handle('external', async (url: string) => {
    z.string().max(10000).parse(url)
    const parsed = new URL(url)
    if (
      !['https:', 'http:', 'mailto:'].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password
    )
      throw new Error('Only web and email links are supported.')
    await shell.openExternal(parsed.href)
  })
  handle('export-page', async (id: string, format: string) => {
    z.string().uuid().parse(id)
    z.enum(['markdown', 'pdf']).parse(format)
    const page = store.state.pages.find((p) => p.id === id)
    if (!page) throw new Error('Page not found')
    const result = await dialog.showSaveDialog(win, {
      title: `Export ${page.title}`,
      defaultPath: `${safeName(page.title)}.${format === 'pdf' ? 'pdf' : 'md'}`,
      filters: [
        {
          name: format === 'pdf' ? 'PDF' : 'Markdown',
          extensions: [format === 'pdf' ? 'pdf' : 'md'],
        },
      ],
    })
    if (result.canceled || !result.filePath) return null
    if (format === 'pdf') {
      if (store.state.ui.activeId !== id)
        throw new Error('Open this page before exporting it as PDF.')
      await atomicWrite(
        result.filePath,
        await win.webContents.printToPDF({
          printBackground: true,
          pageSize: 'A4',
          preferCSSPageSize: true,
        }),
      )
    } else {
      const assets = await copyAssets(store, path.dirname(result.filePath), 'attachments')
      const links = Object.fromEntries(store.state.pages.map((p) => [p.id, `sheco://page/${p.id}`]))
      await atomicWrite(result.filePath, pageMarkdown(page, store.state, links, assets))
    }
    return result.filePath
  })
  handle('export-database', async (id: string) => {
    z.string().uuid().parse(id)
    const db = store.state.databases.find((d) => d.id === id)
    if (!db) throw new Error('Database not found')
    const page = store.state.pages.find((p) => p.id === db.pageId)!
    const result = await dialog.showSaveDialog(win, {
      defaultPath: `${safeName(page.title)}.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    })
    if (result.canceled || !result.filePath) return null
    await atomicWrite(result.filePath, databaseCSV(db, store.state))
    return result.filePath
  })
  handle('export-workspace', async () => {
    const result = await dialog.showOpenDialog(win, {
      title: t('Choose an export destination'),
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled) return null
    const root = path.join(
      result.filePaths[0],
      `${safeName(store.state.name)}-export-${Date.now()}`,
    )
    await fs.mkdir(root, { recursive: false })
    await atomicWrite(path.join(root, 'workspace.json'), JSON.stringify(store.state, null, 2))
    await copyAssets(store, root, 'attachments')
    const paths = Object.fromEntries(
      store.state.pages
        .filter((p) => !p.deletedAt)
        .map((p) => [
          p.id,
          ancestors(store.state, p.id)
            .slice(0, -1)
            .map((a) => safeName(a.title) + '--' + a.id.slice(0, 8))
            .concat(pageFilename(p))
            .join('/'),
        ]),
    )
    for (const page of store.state.pages.filter((p) => !p.deletedAt)) {
      const target = paths[page.id]
      const folder = path.posix.dirname(target)
      const links = Object.fromEntries(
        Object.entries(paths).map(([id, p]) => [id, path.posix.relative(folder, p)]),
      )
      const prefix = path.posix.relative(folder, 'attachments') + '/'
      await atomicWrite(path.join(root, target), pageMarkdown(page, store.state, links, prefix))
      const db = store.state.databases.find((d) => d.pageId === page.id)
      if (db)
        await atomicWrite(
          path.join(root, target.replace(/\.md$/, '.csv')),
          databaseCSV(db, store.state),
        )
    }
    return root
  })
  handle('backup', async () => {
    const root = path.join(store.root, 'metadata', 'manual-backups', `backup-${Date.now()}`)
    await fs.mkdir(root, { recursive: true })
    await atomicWrite(path.join(root, 'workspace.json'), JSON.stringify(store.state, null, 2))
    await copyAssets(store, root, 'attachments')
    return root
  })
  handle('recovery', async (w: Workspace) => {
    const validated = validateWorkspace(w)
    const result = await dialog.showSaveDialog(win, {
      title: t('Save unsaved edits for recovery'),
      defaultPath: `Sheco-recovery-${Date.now()}.json`,
      filters: [{ name: 'Sheco recovery', extensions: ['json'] }],
    })
    if (result.canceled || !result.filePath) return null
    await atomicWrite(result.filePath, JSON.stringify(validated, null, 2))
    return result.filePath
  })
  handle('import-markdown', async () => {
    const result = await dialog.showOpenDialog(win, {
      title: t('Import a Markdown page'),
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }],
      properties: ['openFile'],
    })
    if (result.canceled) return null
    const file = result.filePaths[0]
    if ((await fs.stat(file)).size > 10 * 1024 * 1024)
      throw new Error('Markdown imports are limited to 10 MB.')
    let text = await fs.readFile(file, 'utf8')
    // Import only relative images within the selected document's folder; never fetch URLs.
    const directory = await fs.realpath(path.dirname(file))
    const matches = [...text.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)]
    const assets: Attachment[] = []
    for (const match of matches) {
      let source = match[2].replace(/^<|>$/g, '').split(/\s+"/)[0]
      if (/^[a-z]+:|^[/\\]/i.test(source)) continue
      try {
        source = decodeURIComponent(source)
        const target = await fs.realpath(path.resolve(directory, source))
        if (!target.startsWith(directory + path.sep)) continue
        if ((await fs.stat(target)).size > 200 * 1024 * 1024) continue
        const a = await store.addAttachment(path.basename(target), await fs.readFile(target))
        pendingAttachments.set(a.id, a)
        assets.push(a)
        text = text.replace(match[0], `![${match[1]}](sheco-asset://${store.state.id}/${a.file})`)
      } catch {
        /* Missing local images remain explicit Markdown text. */
      }
    }
    return { title: path.basename(file, path.extname(file)), text, attachments: assets }
  })
  handle('set-language', (value: string) => {
    if (value !== 'en' && value !== 'ru') throw new Error('Unsupported language.')
    language = value
    menu()
  })
  handle('show-folder', () => shell.openPath(store.root))
  ipcMain.on('ready-close', async (event) => {
    if (event.sender !== win.webContents) return
    await mcp.stop()
    await store.close()
    allowClose = true
    win.close()
    if (quitting) app.quit()
  })
}
async function copyAssets(s: WorkspaceStore, root: string, folder: string): Promise<string> {
  const target = path.join(root, folder)
  await fs.mkdir(target, { recursive: true })
  for (const a of s.state.attachments) {
    const source = await s.attachmentPath(a.file)
    await fs.copyFile(source, path.join(target, a.file))
  }
  return folder + '/'
}
let language: Language = 'en'
const t = (key: string) => translate(key, language)
function menu() {
  const send = (action: string) => () => win.webContents.send('menu', action)
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === 'darwin'
        ? [
            {
              label: 'Sheco',
              submenu: [
                { role: 'about' as const },
                { type: 'separator' as const },
                { label: t('Settings…'), accelerator: 'CmdOrCtrl+,', click: send('settings') },
                { type: 'separator' as const },
                { role: 'hide' as const },
                { role: 'hideOthers' as const },
                { role: 'unhide' as const },
                { type: 'separator' as const },
                { role: 'quit' as const },
              ],
            },
          ]
        : []),
      {
        label: t('File'),
        submenu: [
          { label: t('New page'), accelerator: 'CmdOrCtrl+N', click: send('newPage') },
          { label: t('New tab'), accelerator: 'CmdOrCtrl+T', click: send('newTab') },
          { label: t('Close tab'), accelerator: 'CmdOrCtrl+W', click: send('closeTab') },
          { type: 'separator' },
          { label: t('Import Markdown…'), click: send('import') },
          { label: t('Export Markdown…'), click: send('exportMarkdown') },
          { label: t('Export PDF…'), click: send('exportPDF') },
          ...(process.platform !== 'darwin'
            ? [{ type: 'separator' as const }, { role: 'quit' as const }]
            : []),
        ],
      },
      {
        label: t('Edit'),
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' },
          { type: 'separator' },
          { label: t('Quick search'), accelerator: 'CmdOrCtrl+K', click: send('search') },
        ],
      },
      {
        label: t('View'),
        submenu: [
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { role: 'resetZoom' },
          { type: 'separator' },
          { role: 'togglefullscreen' },
          ...(devURL ? [{ role: 'toggleDevTools' as const }] : []),
        ],
      },
      { label: t('Window'), submenu: [{ role: 'minimize' }, { role: 'zoom' }] },
    ]),
  )
  if (process.platform === 'win32') {
    // Keep menu accelerators active without exposing the bar, including on Alt.
    win.setAutoHideMenuBar(false)
    win.setMenuBarVisibility(false)
  }
}
async function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 900,
    minHeight: 640,
    title: 'Sheco',
    backgroundColor: '#ffffff',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 20, y: 20 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => {
    if (devURL ? new URL(url).origin !== devURL : !url.startsWith('sheco://app/'))
      event.preventDefault()
  })
  win.webContents.on('will-attach-webview', (event) => event.preventDefault())
  win.on('close', (event) => {
    if (!allowClose) {
      event.preventDefault()
      win.webContents.send('close-request')
    }
  })
  win.webContents.on('render-process-gone', async () => {
    const choice = await dialog.showMessageBox(win, {
      type: 'error',
      message: t('The editor stopped unexpectedly.'),
      detail: 'Saved documents are safe in your workspace folder.',
      buttons: [t('Reload editor'), t('Close')],
      defaultId: 0,
    })
    if (choice.response === 0) win.reload()
    else {
      allowClose = true
      win.close()
    }
  })
  installIPC()
  menu()
  await win.loadURL(devURL ?? 'sheco://app/index.html')
}
if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })
  app
    .whenReady()
    .then(async () => {
      if (!app.isPackaged && process.platform === 'darwin')
        app.dock?.setIcon(path.resolve(__dirname, '../build/icon.png'))
      session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) =>
        callback(false),
      )
      session.defaultSession.setPermissionCheckHandler(() => false)
      session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
        const url = details.url
        const local =
          url.startsWith('sheco://') ||
          url.startsWith('sheco-asset://') ||
          url.startsWith('data:') ||
          url.startsWith('blob:') ||
          (!!devURL && (url.startsWith(devURL + '/') || url.startsWith('ws://127.0.0.1:5173/')))
        callback({ cancel: !local })
      })
      protocol.handle('sheco', async (request) => {
        const url = new URL(request.url)
        if (url.host !== 'app') return new Response('Not found', { status: 404 })
        const base = path.resolve(__dirname, '../dist')
        let target = path.resolve(base, '.' + decodeURIComponent(url.pathname))
        if (!target.startsWith(base + path.sep)) return new Response('Forbidden', { status: 403 })
        try {
          target = await fs.realpath(target)
          if (!target.startsWith(base + path.sep)) throw new Error('Invalid path')
          const types: Record<string, string> = {
            '.html': 'text/html',
            '.js': 'text/javascript',
            '.css': 'text/css',
            '.woff': 'font/woff',
            '.woff2': 'font/woff2',
            '.ttf': 'font/ttf',
            '.png': 'image/png',
            '.svg': 'image/svg+xml',
            '.map': 'application/json',
          }
          return new Response(await fs.readFile(target), {
            headers: {
              'Content-Type': types[path.extname(target)] ?? 'application/octet-stream',
              'X-Content-Type-Options': 'nosniff',
            },
          })
        } catch {
          return new Response('Not found', { status: 404 })
        }
      })
      protocol.handle('sheco-asset', async (request) => {
        try {
          const url = new URL(request.url)
          if (url.host !== store.state.id) throw new Error('Unknown workspace')
          const file = decodeURIComponent(url.pathname.slice(1))
          const a =
            store.state.attachments.find((a) => a.file === file) ??
            [...pendingAttachments.values()].find((a) => a.file === file)
          if (!a || !/^image\/(png|jpeg|gif|webp|avif)$/.test(a.mime))
            throw new Error('Unsupported preview')
          return new Response(await fs.readFile(await store.attachmentPath(file)), {
            headers: {
              'Content-Type': a.mime,
              'Access-Control-Allow-Origin': devURL ?? 'sheco://app',
              'Content-Security-Policy': "default-src 'none'",
              'X-Content-Type-Options': 'nosniff',
            },
          })
        } catch {
          return new Response('Not found', { status: 404 })
        }
      })
      await boot()
      mcp = new McpService(
        path.join(app.getPath('userData'), 'mcp.json'),
        executeMcpTool,
        () => store.state.id,
      )
      await mcp.initialize()
      await createWindow()
    })
    .catch(async (error) => {
      await dialog.showMessageBox({
        type: 'error',
        message: t('Sheco could not start'),
        detail: error instanceof Error ? error.message : String(error),
      })
      await store?.close()
      app.exit(1)
    })
}
app.on('before-quit', (event) => {
  quitting = true
  if (win && !win.isDestroyed() && !allowClose) {
    event.preventDefault()
    win.webContents.send('close-request')
  }
})
app.on('window-all-closed', () => app.quit())
app.on('will-quit', () => {
  void mcp?.stop()
  void store?.close()
})
