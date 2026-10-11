import { _electron as electron, expect } from '@playwright/test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import http from 'node:http'
import sharp from 'sharp'

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sheco-mcp-'))
const output = path.resolve('test-results/mcp')
await fs.mkdir(output, { recursive: true })
const errors = []
let app, page, client, connection
const port = await new Promise((resolve, reject) => {
  const probe = net.createServer()
  probe.on('error', reject)
  probe.listen(0, '127.0.0.1', () => {
    const port = probe.address().port
    probe.close(() => resolve(port))
  })
})
async function launch() {
  app = await electron.launch({ args: ['.'], env: { ...process.env, SHECO_DATA_DIR: root } })
  page = await app.firstWindow()
  page.on('pageerror', (e) => errors.push(e.message))
  await expect(page.getByLabel('Page title')).toBeVisible({ timeout: 20000 })
}
async function connect() {
  connection = await page.evaluate(() => window.sheco.mcpStatus())
  client = new Client({ name: 'sheco-review', version: '1.0.0' })
  await client.connect(
    new StreamableHTTPClientTransport(new URL(connection.endpoint), {
      requestInit: { headers: { Authorization: 'Bearer ' + connection.config.token } },
    }),
  )
}
async function call(name, args = {}) {
  const response = await client.callTool({ name, arguments: args })
  if (response.isError) throw new Error(response.content.map((c) => c.text ?? '').join('\n'))
  return response.structuredContent ?? JSON.parse(response.content[0].text)
}
async function readPage(id) {
  return (await call('get_page', { workspaceId: connection.config.workspaceId, pageId: id })).page
}
async function rejected(name, args, text) {
  const response = await client.callTool({ name, arguments: args })
  expect(response.isError).toBe(true)
  expect(response.content[0].text).toContain(text)
}
async function configure(patch) {
  const status = await page.evaluate(async (patch) => {
    const prior = await window.sheco.mcpStatus()
    return window.sheco.configureMcp({ ...prior.config, ...patch })
  }, patch)
  connection = status
  return status
}
try {
  await launch()
  await expect(page.getByRole('button', { name: 'Home', exact: true })).toHaveCount(0)
  await expect(page.locator('.sidebar-shortcuts')).toHaveCount(0)
  await page.locator('.brand-actions').getByRole('button', { name: 'Quick search' }).click()
  await expect(page.getByLabel('Search your workspace')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
  const categories = settings.getByRole('tablist', { name: 'Settings categories' })
  await expect(categories.getByRole('tab')).toHaveCount(5)
  const general = categories.getByRole('tab', { name: 'General', exact: true })
  await expect(general).toBeFocused()
  await expect(settings.getByRole('tabpanel', { name: 'General', exact: true })).toBeVisible()
  await expect(settings.getByLabel('Workspace name')).toBeHidden()
  await page.screenshot({ path: path.join(output, 'settings-general-light.png') })
  // Keyboard navigation and hidden panels must retain draft fields without saving them.
  await general.press('ArrowDown')
  await expect(categories.getByRole('tab', { name: 'Workspace', exact: true })).toBeFocused()
  const workspaceName = settings.getByLabel('Workspace name')
  const originalName = await workspaceName.inputValue()
  await workspaceName.fill('Unsaved workspace name')
  await general.click()
  await expect(workspaceName).toBeHidden()
  await general.press('ArrowDown')
  await expect(workspaceName).toHaveValue('Unsaved workspace name')
  await workspaceName.fill(originalName)
  await general.click()
  // Tab trapping skips inactive panels and the non-selected sidebar tabs.
  const lastGeneralControl = settings.getByRole('button', { name: 'Font size +2', exact: true })
  await lastGeneralControl.press('Tab')
  await expect(settings.getByRole('button', { name: 'Close', exact: true })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(lastGeneralControl).toBeFocused()
  await categories.getByRole('tab', { name: 'AI agents · MCP', exact: true }).click()
  await expect(page.getByRole('switch', { name: 'Enable MCP' })).toHaveAttribute(
    'aria-checked',
    'false',
  )
  await page.getByLabel('MCP port').fill(String(port))
  await categories.getByRole('tab', { name: 'Data & backups', exact: true }).click()
  await expect(settings.getByRole('button', { name: 'Export', exact: true })).toBeVisible()
  await expect(page.getByLabel('MCP port')).toBeHidden()
  await categories.getByRole('tab', { name: 'AI agents · MCP', exact: true }).click()
  await expect(page.getByLabel('MCP port')).toHaveValue(String(port))
  await page.getByRole('button', { name: 'Apply', exact: true }).click()
  await page.getByRole('switch', { name: 'Enable MCP' }).click()
  await expect(page.locator('.mcp-state')).toContainText('Ready for agents')
  await page.locator('.mcp-settings').scrollIntoViewIfNeeded()
  await page.screenshot({ path: path.join(output, 'settings-light.png') })
  // Keep clipboard verification inside this fixture; do not replace the user's clipboard.
  await app.evaluate(({ clipboard }) => {
    clipboard.writeText = (text) => {
      globalThis.__mcpCopied = text
    }
  })
  await page.getByRole('button', { name: 'Copy connection settings', exact: true }).click()
  const copied = JSON.parse(await app.evaluate(() => globalThis.__mcpCopied))
  expect(copied.mcpServers.sheco.url).toContain('/mcp')
  expect(copied.mcpServers.sheco.headers.Authorization.startsWith('Bearer ')).toBe(true)
  await connect()
  const workspace = await call('get_workspace')
  const scope = { workspaceId: workspace.id }
  expect((await client.listTools()).tools.some((t) => t.name === 'create_page')).toBe(false)
  await rejected('create_page', { ...scope, title: 'Denied' }, 'not found')
  const auth = {
    Authorization: 'Bearer ' + connection.config.token,
    'Content-Type': 'application/json',
  }
  expect(
    (
      await fetch(connection.endpoint, {
        method: 'POST',
        body: '{}',
        headers: { 'Content-Type': 'application/json' },
      })
    ).status,
  ).toBe(401)
  expect(
    (
      await fetch(connection.endpoint, {
        method: 'POST',
        body: '{}',
        headers: { ...auth, Origin: 'https://untrusted.example' },
      })
    ).status,
  ).toBe(403)
  const foreignHostStatus = await new Promise((resolve, reject) => {
    const req = http.request(
      connection.endpoint,
      { method: 'POST', headers: { ...auth, Host: 'untrusted.example' } },
      (res) => {
        res.resume()
        resolve(res.statusCode)
      },
    )
    req.on('error', reject)
    req.end('{}')
  })
  expect(foreignHostStatus).toBe(403)
  await page.getByRole('switch', { name: 'Allow MCP writes' }).click()
  await expect(page.getByRole('switch', { name: 'Allow MCP writes' })).toHaveAttribute(
    'aria-checked',
    'true',
  )
  expect((await client.listTools()).tools).toHaveLength(18)
  await page.keyboard.press('Escape')

  const created = await call('create_page', {
    ...scope,
    title: 'Agent note',
    content: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Created by MCP.' }] }],
    },
  })
  const id = created.page.id
  await page.locator('.tree-page').filter({ hasText: 'Agent note' }).click()
  await expect(page.locator('.document-editor')).toContainText('Created by MCP.')
  // Agent reads include a local edit even before its normal save timer fires.
  await page.getByLabel('Page description').fill('A local edit before agent reading')
  expect((await readPage(id)).description).toBe('A local edit before agent reading')
  const before = await readPage(id)
  await page.getByLabel('Page description').fill('A newer local edit')
  await rejected(
    'update_page',
    {
      ...scope,
      pageId: id,
      expectedUpdatedAt: before.updatedAt,
      patch: { description: 'Stale agent edit' },
    },
    'conflict',
  )
  await expect(page.getByLabel('Page description')).toHaveValue('A newer local edit')
  const uploaded = await call('upload_attachment', {
    ...scope,
    name: 'agent-image.png',
    base64: (
      await sharp({ create: { width: 60, height: 40, channels: 3, background: '#999' } })
        .png()
        .toBuffer()
    ).toString('base64'),
  })
  const downloaded = await call('read_attachment', {
    ...scope,
    attachmentId: uploaded.attachment.id,
  })
  expect(Buffer.from(downloaded.base64, 'base64').length).toBe(uploaded.attachment.bytes)
  const file = await call('upload_attachment', {
    ...scope,
    name: 'note.txt',
    base64: Buffer.from('Local attachment data').toString('base64'),
  })
  const dbs = (await call('list_databases', scope)).databases
  const examples = (await call('get_block_catalog')).blocks.map((b) =>
    JSON.parse(
      JSON.stringify(b.example)
        .replaceAll('sheco-asset://WORKSPACE_ID/ATTACHMENT_FILE', uploaded.assetUrl)
        .replaceAll('DATABASE_PAGE_ID', dbs[0].pageId)
        .replaceAll('PAGE_ID', id)
        .replaceAll('ATTACHMENT_ID', file.attachment.id)
        .replaceAll('ATTACHMENT_FILE', file.attachment.file),
    ),
  )
  const attachmentIndex = examples.findIndex((b) => b.type === 'attachment')
  examples[attachmentIndex] = file.block
  const fresh = await readPage(id)
  await call('edit_blocks', {
    ...scope,
    pageId: id,
    expectedUpdatedAt: fresh.updatedAt,
    index: 1,
    blocks: examples,
  })
  await expect(page.locator('.document-editor .code-block')).toHaveCount(1)
  await expect(page.locator('.document-editor .image-gallery')).toHaveCount(1)
  await expect(page.locator('.document-editor .callout-block')).toHaveCount(1)
  await expect(page.locator('.document-editor .diagram-block')).toHaveCount(1)
  await expect(page.locator('.diagram-block .diagram-preview')).toHaveAttribute(
    'aria-busy',
    'false',
    { timeout: 30000 },
  )
  await expect(page.locator('.diagram-block .diagram-svg svg')).toBeVisible()
  await expect(page.locator('.document-editor table').first()).toBeVisible()
  await expect(page.locator('.document-editor')).toContainText('console.log')
  await expect(page.locator('.save-status')).toHaveClass(/\bsaved\b/)
  const updated = await readPage(id)
  expect(updated.content.content.length).toBe(fresh.content.content.length + examples.length)
  expect(updated.content.content.find((node) => node.type === 'mermaid')).toEqual(
    examples.find((node) => node.type === 'mermaid'),
  )
  await rejected(
    'edit_blocks',
    {
      ...scope,
      pageId: id,
      expectedUpdatedAt: updated.updatedAt,
      index: 0,
      blocks: [
        {
          type: 'mermaid',
          attrs: { source: 'flowchart TB\nA --> B', positions: { A: { x: -10001, y: 100 } } },
        },
      ],
    },
    'Invalid Mermaid',
  )
  expect((await readPage(id)).content).toEqual(updated.content)
  await rejected(
    'edit_blocks',
    {
      ...scope,
      pageId: id,
      expectedUpdatedAt: updated.updatedAt,
      index: 0,
      blocks: [{ type: 'mermaid', attrs: { source: 'flowchart TB\nA --> B', scale: 2.01 } }],
    },
    'Invalid Mermaid',
  )
  expect((await readPage(id)).content).toEqual(updated.content)
  await call('update_page', {
    ...scope,
    pageId: id,
    expectedUpdatedAt: updated.updatedAt,
    patch: { title: 'Agent and editor', description: 'All blocks are supported' },
  })
  await expect(page.getByLabel('Page title')).toHaveValue('Agent and editor')
  expect(
    (await call('search_pages', { ...scope, query: 'console.log' })).results.some(
      (p) => p.pageId === id,
    ),
  ).toBe(true)
  await rejected(
    'edit_blocks',
    {
      ...scope,
      pageId: id,
      expectedUpdatedAt: (await readPage(id)).updatedAt,
      index: 0,
      blocks: [{ type: 'invented' }],
    },
    'Unsupported block',
  )
  await rejected(
    'get_page',
    { workspaceId: crypto.randomUUID(), pageId: id },
    'authorized workspace',
  )

  const host = await call('create_page', { ...scope, title: 'Agent database host' })
  const database = await call('create_database', {
    ...scope,
    pageId: host.page.id,
    expectedUpdatedAt: host.page.updatedAt,
    title: 'Agent collection',
  })
  const db = database.database
  const record = await call('create_page', {
    ...scope,
    title: 'Agent entry',
    parentId: db.pageId,
    databaseId: db.id,
    properties: { [db.columns[0].id]: 'Done' },
    content: { type: 'doc', content: [examples.find((b) => b.type === 'codeBlock')] },
  })
  expect((await call('get_database', { ...scope, databaseId: db.id })).entries[0].id).toBe(
    record.page.id,
  )
  const current = await call('get_workspace')
  await call('update_database', {
    ...scope,
    databaseId: db.id,
    expectedRevision: current.revision,
    patch: { columns: db.columns.map((c) => ({ ...c, name: 'Progress' })) },
  })
  await page.locator('.tree-page').filter({ hasText: 'Agent database host' }).click()
  await expect(page.locator('.database-embed')).toContainText('Progress')
  await expect(page.locator('.database-embed')).toContainText('Agent entry')
  const moving = await readPage(id)
  await call('move_blocks', {
    ...scope,
    pageId: id,
    expectedUpdatedAt: moving.updatedAt,
    index: 0,
    count: 2,
    toIndex: moving.content.content.length - 2,
  })
  const latest = await readPage(id)
  await call('trash_page', { ...scope, pageId: id, expectedUpdatedAt: latest.updatedAt })
  expect((await call('list_pages', scope)).pages.some((p) => p.id === id)).toBe(false)
  const deleted = (await call('list_pages', { ...scope, includeTrash: true })).pages.find(
    (p) => p.id === id,
  )
  await call('restore_page', { ...scope, pageId: id, expectedUpdatedAt: deleted.updatedAt })
  expect((await readPage(id)).title).toBe('Agent and editor')

  // Real local typing remains intact after an agent changes an open document.
  await page.locator('.tree-page').filter({ hasText: 'Agent and editor' }).click()
  const editor = page.locator('.document-editor')
  await editor.click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Local typing after remote edits stays intact.')
  expect((await readPage(id)).content.content.map((b) => JSON.stringify(b)).join('')).toContain(
    'Local typing after remote edits stays intact.',
  )

  // A selected workspace stays the access boundary when the user switches spaces.
  await app.evaluate(({ dialog }, root) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] })
  }, root)
  await page.locator('.space-switcher > button').click()
  await page.getByRole('button', { name: 'New workspace', exact: true }).click()
  await page.getByLabel('Workspace name').fill('MCP second space')
  await page.getByRole('button', { name: 'Choose location', exact: true }).click()
  await expect(page.getByLabel('Page title')).toHaveValue('Welcome to MCP second space')
  await rejected('get_workspace', {}, 'authorized workspace')
  await page.locator('.space-switcher > button').click()
  await page.locator('.space-menu .menu-item').filter({ hasText: 'Pentest' }).click()
  await expect(page.getByLabel('Page title')).toHaveValue('Agent and editor')
  expect((await call('get_workspace')).id).toBe(workspace.id)
  await client.close()
  const oldToken = connection.config.token
  connection = await page.evaluate(() => window.sheco.rotateMcpToken())
  expect(
    (
      await fetch(connection.endpoint, {
        method: 'POST',
        body: '{}',
        headers: { ...auth, Authorization: 'Bearer ' + oldToken },
      })
    ).status,
  ).toBe(401)
  await connect()
  await call('get_workspace')
  await client.close()
  await configure({ allowWrites: false })
  await connect()
  expect((await client.listTools()).tools.some((t) => t.name === 'edit_blocks')).toBe(false)
  await client.close()

  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByTitle('Dark', { exact: true }).click()
  await page.getByRole('button', { name: 'Русский', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'Общие', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await page.screenshot({ path: path.join(output, 'settings-general-dark-ru.png') })
  await page.getByRole('tab', { name: 'ИИ-агенты · MCP', exact: true }).click()
  await expect(page.getByRole('switch', { name: 'Включить MCP' })).toBeVisible()
  await page.locator('.mcp-settings').scrollIntoViewIfNeeded()
  await page.screenshot({ path: path.join(output, 'settings-dark-ru.png') })
  await page.getByRole('tab', { name: 'ИИ-агенты · MCP', exact: true }).press('End')
  await expect(page.getByRole('tab', { name: 'О приложении', exact: true })).toBeFocused()
  await expect(page.getByRole('tabpanel', { name: 'О приложении', exact: true })).toContainText(
    'Версия 1.0.0',
  )
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 640))
  await expect(async () => {
    const width = await page.evaluate(() => window.innerWidth)
    expect(width).toBeLessThanOrEqual(900)
  }).toPass()
  const narrowPanel = page.getByRole('tabpanel', { name: 'О приложении', exact: true })
  expect(await narrowPanel.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  await page.getByRole('tab', { name: 'О приложении', exact: true }).press('Home')
  await expect(page.getByRole('tab', { name: 'Общие', exact: true })).toBeFocused()
  await page.screenshot({ path: path.join(output, 'settings-narrow-dark-ru.png') })
  await page.keyboard.press('Escape')
  await expect(page.locator('.save-status')).toHaveClass(/\bsaved\b/)
  await app.close()
  app = null
  app = await electron.launch({ args: ['.'], env: { ...process.env, SHECO_DATA_DIR: root } })
  page = await app.firstWindow()
  page.on('pageerror', (e) => errors.push(e.message))
  await expect(page.locator('.sidebar')).toBeVisible({ timeout: 20000 })
  await connect()
  expect((await readPage(id)).title).toBe('Agent and editor')
  expect((await readPage(id)).content.content.map((b) => JSON.stringify(b)).join('')).toContain(
    'Local typing after remote edits stays intact.',
  )
  await client.close()
  await configure({ enabled: false })
  expect((await page.evaluate(() => window.sheco.mcpStatus())).running).toBe(false)
  await expect(async () =>
    fetch(connection.endpoint, { method: 'POST', body: '{}', headers: auth }),
  ).rejects.toThrow()
  expect(errors).toEqual([])
  console.log(
    'Passed: settings sidebar categories, retained drafts, keyboard navigation/focus, narrow layout, MCP handshake, 18 tools, all editor block types, live edits, conflict protection, inline database CRUD, attachments, authentication, host/origin checks, read-only access, key rotation, restart persistence, languages and themes.',
  )
  console.log('Screenshots:', output)
} catch (e) {
  if (page && !page.isClosed())
    await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {})
  throw e
} finally {
  await client?.close().catch(() => {})
  if (app) await app.close()
  await fs.rm(root, { recursive: true, force: true })
}
