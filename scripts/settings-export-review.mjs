import { _electron as electron, expect } from '@playwright/test'
import { build } from 'esbuild'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import net from 'node:net'
import { pathToFileURL } from 'node:url'

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sheco-settings-export-'))
const output = path.resolve('test-results/settings-export')
const workspace = path.join(root, 'Knowledge')
await fs.mkdir(workspace)
await fs.mkdir(output, { recursive: true })
const requests = []
let delayed
const server = http.createServer((request, response) => {
  const second = request.url.startsWith('/second/')
  requests.push({
    second,
    authenticated:
      request.headers.authorization === `Bearer synthetic-${second ? 'second' : 'first'}`,
  })
  const reply = () => {
    response.setHeader('Content-Type', 'application/json')
    response.end(
      JSON.stringify({
        key: 'PROJECT-123',
        fields: {
          summary: second ? 'Second server issue' : 'First server issue',
          status: { name: 'Done', statusCategory: { key: 'done' } },
          duedate: null,
        },
      }),
    )
  }
  if (delayed) delayed.reply = reply
  else reply()
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
const firstUrl = origin + '/first',
  secondUrl = origin + '/second'
const bundled = await build({
  stdin: {
    contents:
      "export { seedWorkspace } from './src/shared/seed'; export { createPage } from './src/shared/model'",
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
})
const modulePath = path.join(root, 'seed.mjs')
await fs.writeFile(modulePath, bundled.outputFiles[0].contents)
const { seedWorkspace, createPage } = await import(pathToFileURL(modulePath).href)
const w = seedWorkspace('Settings and export fixture', false)
const note = w.pages[0]
note.title = 'Selected export page'
note.content = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'ONLY_SELECTED_PAGE_CONTENT' }] },
    { type: 'paragraph' },
  ],
}
const other = createPage(w, 'OTHER_OPEN_PAGE_MUST_NOT_PRINT')
w.pages.push(other)
// Exercise migration from the original persisted single-server settings.
w.plugins.jira = { enabled: true, baseUrl: firstUrl, authType: 'pat', defaultDisplay: 'detailed' }
for (const key of [
  'commandBuilder',
  'documentTemplates',
  'dataTools',
  'filePreview',
  'projectArchitecture',
])
  w.plugins[key].enabled = true
const tabs = [
  'plugin:command-builder',
  'plugin:document-templates',
  'plugin:data-tools',
  'plugin:project-architecture-settings',
  'plugin:jira-settings',
  'plugin:mcp-settings',
  'plugin:file-preview-settings',
]
w.ui.tabs = [note.id, other.id, ...tabs]
w.ui.activeId = note.id
const snapshot = path.join(workspace, 'workspace.json')
await fs.writeFile(snapshot, JSON.stringify(w))
await fs.writeFile(
  path.join(root, 'spaces.json'),
  JSON.stringify({
    activeId: w.id,
    spaces: [{ id: w.id, name: w.name, icon: w.icon, path: workspace }],
  }),
)
const errors = []
let app, page
async function saved() {
  await expect(page.locator('.save-status')).toHaveClass(/\bsaved\b/)
}
async function launch() {
  app = await electron.launch({ args: ['.'], env: { ...process.env, SHECO_DATA_DIR: root } })
  page = await app.firstWindow()
  page.on('pageerror', (error) => errors.push(error.message))
  await expect(page.locator('.page-title')).toBeVisible({ timeout: 20000 })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 900))
}
async function close() {
  await saved()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await app.close()
  app = null
}
async function open(id) {
  await page.evaluate(
    (id) => window.dispatchEvent(new CustomEvent('open-page', { detail: { id } })),
    id,
  )
  await expect(page.locator('.content-scroll:not([hidden])')).toHaveCount(1)
}
async function choose(scope, label, option) {
  await scope.getByRole('button', { name: label, exact: true }).click()
  await page.getByRole('option', { name: option, exact: true }).click()
}
async function appearance(dark, ru) {
  await page
    .locator('.sidebar-footer')
    .getByRole('button', { name: ru ? 'Настройки' : 'Settings', exact: true })
    .click()
  await page.getByRole('tab', { name: ru ? 'Общие' : 'General', exact: true }).click()
  await page
    .getByRole('button', {
      name: ru ? (dark ? 'Тёмная' : 'Светлая') : dark ? 'Dark' : 'Light',
      exact: true,
    })
    .click()
  await page.getByRole('button', { name: ru ? 'English' : 'Русский', exact: true }).click()
  await page.getByRole('button', { name: ru ? 'Close' : 'Закрыть', exact: true }).click()
  await saved()
}
async function insert(serverName, url = '') {
  await page.locator('.document-editor').evaluate((element) =>
    element.editor
      .chain()
      .focus()
      .setTextSelection(element.editor.state.doc.content.size - 1)
      .insertContent('/jira')
      .run(),
  )
  await page
    .locator('.command-palette')
    .getByRole('option')
    .filter({ has: page.getByText('Jira issue', { exact: true }) })
    .click()
  const insertion = page.locator('.jira-insert')
  if (serverName) await choose(insertion, 'Jira server', serverName)
  await insertion.getByRole('textbox', { name: 'Jira issue key or URL' }).fill(url || 'PROJECT-123')
  await insertion.getByRole('button', { name: 'Add issue', exact: true }).click()
  await expect(insertion).toHaveCount(0)
  await saved()
}
async function pdf(name, ru = false) {
  await saved()
  const file = path.join(output, `${name}.pdf`)
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file })
  }, file)
  await page
    .getByRole('button', { name: ru ? 'Действия со страницей' : 'Page options', exact: true })
    .click()
  await page.getByRole('button', { name: ru ? 'Экспорт' : 'Export', exact: true }).click()
  await page.getByRole('menuitem', { name: 'PDF (.pdf)', exact: true }).click()
  await expect
    .poll(async () =>
      fs
        .stat(file)
        .then((stat) => stat.size)
        .catch(() => 0),
    )
    .toBeGreaterThan(1000)
  const task = getDocument({ data: new Uint8Array(await fs.readFile(file)), useSystemFonts: true })
  const document = await task.promise
  let text = ''
  for (let index = 1; index <= document.numPages; index++)
    text += (await (await document.getPage(index)).getTextContent()).items
      .map((item) => item.str)
      .join(' ')
  expect(document.numPages).toBe(1)
  expect(text).toContain('ONLY_SELECTED_PAGE_CONTENT')
  expect(text).not.toMatch(
    /OTHER_OPEN_PAGE|Command builder|Document templates|Data tools|Jira settings|Настройка Jira|Шаблоны документов|Конструктор команд/,
  )
  await task.destroy()
}
try {
  await launch()
  await open('plugin:jira-settings')
  let form = page.locator('.jira-configuration:not([hidden])')
  await form.getByLabel('Jira PAT', { exact: true }).fill('synthetic-first')
  await form.getByLabel('Server name (optional)').fill('First server')
  await form.getByRole('button', { name: 'Save Jira settings', exact: true }).click()
  await expect(form.getByRole('status')).toHaveText('Jira settings saved')
  await page.getByRole('button', { name: 'Add server', exact: true }).click()
  await form.getByLabel('Server name (optional)').fill('Second server')
  await form.getByLabel('Jira address', { exact: true }).fill(firstUrl + '/')
  await form.getByLabel('Jira PAT', { exact: true }).fill('synthetic-second')
  await form.getByRole('button', { name: 'Save Jira settings', exact: true }).click()
  await expect(form.getByRole('alert')).toHaveText('This Jira server is already configured.')
  await form.getByLabel('Jira address', { exact: true }).fill(secondUrl)
  await form.getByRole('button', { name: 'Save Jira settings', exact: true }).click()
  await expect(form.getByRole('status')).toHaveText('Jira settings saved')
  await expect(form.getByLabel('Jira PAT', { exact: true })).toHaveValue('')
  await form.getByLabel('Server name (optional)').fill('Retained server draft')
  await choose(page.locator('.jira-server-toolbar'), 'Jira server', 'First server')
  await expect(form.getByLabel('Server name (optional)')).toHaveValue('First server')
  await choose(page.locator('.jira-server-toolbar'), 'Jira server', 'Second server')
  await expect(form.getByLabel('Server name (optional)')).toHaveValue('Retained server draft')
  await open(note.id)
  await open('plugin:jira-settings')
  await expect(form.getByLabel('Server name (optional)')).toHaveValue('Retained server draft')
  await form.getByLabel('Server name (optional)').fill('Second server')
  await page.screenshot({ path: path.join(output, 'jira-light-en.png') })
  await page
    .locator('.jira-server-toolbar')
    .getByRole('button', { name: 'Jira server', exact: true })
    .click()
  await page.screenshot({ path: path.join(output, 'jira-servers-menu-light-en.png') })
  await page.keyboard.press('Escape')
  await open(note.id)
  await insert('Second server')
  await expect(page.locator('.jira-summary')).toHaveText('Second server issue')
  await insert(undefined, firstUrl + '/browse/PROJECT-123')
  await expect(page.locator('.jira-summary')).toHaveText([
    'Second server issue',
    'First server issue',
  ])
  const count = requests.length
  await pdf('selected-light-en')
  await close()
  await launch()
  form = page.locator('.jira-configuration:not([hidden])')
  expect(requests.length).toBe(count)
  expect(
    (await page.evaluate(() => window.sheco.boot())).active.plugins.jira.connections,
  ).toHaveLength(2)
  await page.locator('.jira-block').first().hover()
  await page
    .locator('.jira-block')
    .first()
    .getByRole('button', { name: 'Refresh Jira issue' })
    .click()
  await expect.poll(() => requests.length).toBe(count + 1)
  expect(requests.at(-1).second).toBe(true)
  await open('plugin:project-architecture-settings')
  expect(
    await page
      .getByText('Defaults for new diagrams', { exact: true })
      .evaluate((element) => parseFloat(getComputedStyle(element).marginTop)),
  ).toBe(0)
  for (const id of [
    'plugin:project-architecture-settings',
    'plugin:file-preview-settings',
    'plugin:mcp-settings',
  ]) {
    await open(id)
    await expect(page.locator('.content-scroll:not([hidden]) .setting-row').first()).toBeVisible()
    for (const border of await page
      .locator('.content-scroll:not([hidden]) .setting-row')
      .evaluateAll((elements) =>
        elements.map((element) => getComputedStyle(element).borderBottomWidth),
      ))
      expect(border).toBe('0px')
    await page.screenshot({ path: path.join(output, `${id.split(':')[1]}-light-en.png`) })
  }
  const port = await new Promise((resolve) => {
    const probe = net.createServer()
    probe.listen(0, '127.0.0.1', () => {
      const value = probe.address().port
      probe.close(() => resolve(value))
    })
  })
  await page.evaluate(
    async ({ workspaceId, port }) => {
      const status = await window.sheco.mcpStatus()
      await window.sheco.configureMcp({ ...status.config, enabled: true, workspaceId, port })
      window.dispatchEvent(new Event('sheco-mcp-changed'))
    },
    { workspaceId: w.id, port },
  )
  await expect(page.locator('.content-scroll:not([hidden]) .mcp-dot.online')).toBeVisible()
  expect(
    await page
      .locator('.mcp-dot.online')
      .evaluate((element) => getComputedStyle(element).backgroundColor),
  ).toBe('rgb(82, 114, 77)')
  // Screenshots use synthetic fixture credentials; avoid displaying their values.
  await page.screenshot({
    path: path.join(output, 'mcp-ready-light-en.png'),
    mask: [page.locator('.mcp-connection input')],
  })
  await appearance(true, false)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(980, 900))
  for (const id of [
    'plugin:project-architecture-settings',
    'plugin:file-preview-settings',
    'plugin:mcp-settings',
    'plugin:jira-settings',
    'plugin:document-templates',
  ]) {
    await open(id)
    await page.screenshot({
      path: path.join(output, `${id.split(':')[1]}-dark-ru.png`),
      mask: id === 'plugin:mcp-settings' ? [page.locator('.mcp-connection input')] : [],
    })
  }
  await expect(page.locator('.template-empty')).toContainText(
    'сохраните готовую страницу как шаблон через меню страницы',
  )
  await open(note.id)
  await pdf('selected-dark-ru', true)
  await appearance(false, true)
  await open('plugin:jira-settings')
  await choose(page.locator('.jira-server-toolbar'), 'Jira server', 'Second server')
  // Removing a connection invalidates an in-flight read and preserves its offline snapshot.
  delayed = {}
  const pending = page.evaluate(
    async ({ workspaceId, baseUrl }) => {
      try {
        await window.sheco.jiraIssue({ workspaceId, baseUrl, issueKey: 'PROJECT-123' })
        return ''
      } catch (error) {
        return error.message
      }
    },
    { workspaceId: w.id, baseUrl: secondUrl },
  )
  await expect.poll(() => !!delayed.reply).toBe(true)
  await form.getByRole('button', { name: 'Remove server', exact: true }).click()
  await saved()
  delayed.reply()
  delayed = undefined
  expect(await pending).toContain('configuration changed')
  expect(
    await page.evaluate(({ id, url }) => window.sheco.jiraStatus(id, url), {
      id: w.id,
      url: firstUrl,
    }),
  ).toMatchObject({ hasToken: true })
  expect(
    await page.evaluate(({ id, url }) => window.sheco.jiraStatus(id, url), {
      id: w.id,
      url: secondUrl,
    }),
  ).toMatchObject({ hasToken: false })
  await open(note.id)
  await expect(page.locator('.jira-summary')).toHaveText([
    'Second server issue',
    'First server issue',
  ])
  await expect(
    page.locator('.jira-block').first().getByRole('button', { name: 'Refresh Jira issue' }),
  ).toBeDisabled()
  expect(requests.every((request) => request.authenticated)).toBe(true)
  const disk = await fs.readFile(snapshot, 'utf8')
  expect(disk).not.toMatch(/synthetic-first|synthetic-second/)
  const device = await fs.readFile(path.join(root, 'jira-credentials.json'), 'utf8')
  expect(device).not.toMatch(/synthetic-first|synthetic-second/)
  expect(JSON.parse(device)[w.id].some((record) => record.baseUrl === secondUrl)).toBe(false)
  expect(errors).toEqual([])
  await fs.writeFile(
    path.join(output, 'verification.json'),
    JSON.stringify(
      {
        root,
        checks: [
          'legacy migration',
          'two independent servers and credentials',
          'duplicate rejection',
          'explicit server and URL selection',
          'restart without fetching',
          'refresh by snapshot server',
          'stale read rejection on removal',
          'isolated token deletion',
          'selected-page PDF with mounted hidden tabs in both themes/languages',
          'setting spacing and borders',
          'green MCP readiness',
        ],
        requests,
        errors,
      },
      null,
      2,
    ),
  )
  console.log('Settings, multi-server Jira and selected-page PDF review passed:', output)
} finally {
  if (delayed?.reply) delayed.reply()
  if (app) {
    await page
      .screenshot({
        path: path.join(output, 'last-state.png'),
        mask: [page.locator('.mcp-connection input')],
      })
      .catch(() => {})
    await close().catch(() => app?.close())
  }
  await new Promise((resolve) => server.close(resolve))
}
