import { _electron as electron, expect } from '@playwright/test'
import { build } from 'esbuild'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { pathToFileURL } from 'node:url'

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sheco-jira-review-'))
const output = path.resolve('test-results/jira')
const workspace = path.join(root, 'Knowledge')
await fs.mkdir(workspace)
await fs.mkdir(output, { recursive: true })
const bundled = await build({
  stdin: {
    contents:
      "export { seedWorkspace } from './src/shared/seed'; export { markdown } from './src/shared/export'",
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
})
const modulePath = path.join(root, 'seed.mjs')
await fs.writeFile(modulePath, bundled.outputFiles[0].contents)
const { seedWorkspace, markdown } = await import(pathToFileURL(modulePath).href)
const w = seedWorkspace('Jira plugin review', false)
w.plugins.jira.defaultDisplay = 'minimal'
w.pages[0].title = 'Release planning'
w.pages[0].content = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Jira tasks for the next release.' }] },
    { type: 'paragraph' },
  ],
}
const snapshot = path.join(workspace, 'workspace.json')
await fs.writeFile(snapshot, JSON.stringify(w))
await fs.writeFile(
  path.join(root, 'spaces.json'),
  JSON.stringify({
    activeId: w.id,
    spaces: [{ id: w.id, name: w.name, icon: w.icon, path: workspace }],
  }),
)
const requests = []
let status = 'In progress',
  responseStatus = 200,
  delayed
const server = http.createServer((request, response) => {
  // Record booleans rather than credentials in verification output.
  requests.push({
    url: request.url,
    method: request.method,
    authenticated:
      request.headers.authorization === 'Bearer synthetic-jira-review-pat' ||
      request.headers.authorization ===
        `Basic ${Buffer.from('synthetic@example.com:synthetic-cloud-api-token').toString('base64')}`,
    cloud: request.headers.authorization?.startsWith('Basic ') ?? false,
  })
  const key = request.url?.match(/\/issue\/([A-Z]+-\d+)/)?.[1]
  const reply = () => {
    response.writeHead(responseStatus, {
      'Content-Type': 'application/json',
      ...(responseStatus === 302 ? { Location: '/jira/redirect-target' } : {}),
    })
    response.end(
      JSON.stringify({
        key,
        fields: {
          summary:
            key === 'PROJECT-123' ? 'Prepare the desktop release' : 'Review plugin documentation',
          status: {
            name: status,
            statusCategory: { key: status === 'Done' ? 'done' : 'indeterminate' },
          },
          duedate: key === 'PROJECT-123' ? '2026-10-20' : null,
        },
      }),
    )
  }
  if (delayed) delayed = { ...delayed, reply }
  else reply()
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const baseUrl = `http://127.0.0.1:${server.address().port}/jira`
let app, page
const errors = []
async function launch() {
  app = await electron.launch({ args: ['.'], env: { ...process.env, SHECO_DATA_DIR: root } })
  page = await app.firstWindow()
  page.on('pageerror', (error) => errors.push(error.message))
  await expect(page.locator('.document-editor')).toBeVisible({ timeout: 20000 })
  await app.evaluate(({ BrowserWindow, shell }) => {
    BrowserWindow.getAllWindows()[0].setSize(1280, 900)
    shell.openExternal = async (url) => {
      globalThis.jiraOpenedUrl = url
    }
  })
}
async function saved() {
  await expect(page.locator('.save-status')).toHaveClass(/\bsaved\b/)
}
async function close() {
  await saved()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await app.close()
  app = null
}
async function settings(ru = false) {
  await page
    .locator('.sidebar-footer')
    .getByRole('button', { name: ru ? 'Настройки' : 'Settings', exact: true })
    .click()
}
async function pluginSettings(ru = false) {
  await settings(ru)
  await page.getByRole('tab', { name: ru ? 'Плагины' : 'Plugins', exact: true }).click()
}
async function exitSettings(ru = false) {
  const dialog = page.getByRole('dialog', { name: ru ? 'Настройки' : 'Settings', exact: true })
  if (await dialog.count())
    await dialog.getByRole('button', { name: ru ? 'Закрыть' : 'Close', exact: true }).click()
  else await page.locator('.tabs .tab.active .tab-close').click()
}
async function doc() {
  return page.locator('.document-editor').evaluate((element) => element.editor.getJSON())
}
async function slash() {
  await page.locator('.document-editor').evaluate((element) =>
    element.editor
      .chain()
      .focus()
      .setTextSelection(element.editor.state.doc.content.size - 1)
      .run(),
  )
  await expect(page.locator('.document-editor')).toBeFocused()
  await page.keyboard.type('/jira')
  await expect(page.locator('.command-palette')).toBeVisible()
  await page
    .locator('.command-palette')
    .getByRole('option')
    .filter({ has: page.getByText('Jira issue', { exact: true }) })
    .click()
}
async function setAppearance(theme, language, ru = false) {
  await settings(ru)
  await page.getByRole('tab', { name: ru ? 'Общие' : 'General', exact: true }).click()
  await page.getByRole('button', { name: theme, exact: true }).click()
  await page.getByRole('button', { name: language, exact: true }).click()
  await page
    .getByRole('button', { name: language === 'Русский' ? 'Закрыть' : 'Close', exact: true })
    .click()
  await saved()
}
async function view(index, label, ru = false) {
  const block = page.locator('.jira-block').nth(index)
  await block.hover()
  await block
    .getByRole('button', { name: ru ? 'Вид блока Jira' : 'Jira block view', exact: true })
    .click()
  await page.locator('.popover').getByRole('button', { name: label, exact: true }).click()
}
try {
  await launch()
  const beforeDisabled = await doc()
  await page.locator('.document-editor').evaluate((element) =>
    element.editor
      .chain()
      .focus()
      .setTextSelection(element.editor.state.doc.content.size - 1)
      .run(),
  )
  await expect(page.locator('.document-editor')).toBeFocused()
  await page.keyboard.type('/jira')
  await expect(page.locator('.command-palette')).toBeVisible()
  await expect(page.locator('.command-palette')).not.toContainText('Jira issue')
  await page.keyboard.press('Escape')
  await page.locator('.document-editor').evaluate((element) => element.editor.commands.undo())
  await expect.poll(doc).toEqual(beforeDisabled)
  await pluginSettings()
  await page.getByRole('switch', { name: 'Enable Jira', exact: true }).click()
  await page.getByRole('button', { name: 'Configure Jira', exact: true }).click()
  await page.getByRole('button', { name: 'Save Jira settings', exact: true }).click()
  await expect(page.locator('.jira-configuration [role=alert]')).toContainText(
    'Enter a Jira address',
  )
  await page.getByRole('textbox', { name: 'Jira address', exact: true }).fill(baseUrl)
  await page.getByRole('button', { name: 'Save Jira settings', exact: true }).click()
  await expect(page.locator('.jira-configuration [role=alert]')).toHaveText('Enter a Jira PAT.')
  await page.getByLabel('Jira PAT', { exact: true }).fill('invalid token with spaces')
  await page.getByRole('button', { name: 'Save Jira settings', exact: true }).click()
  await expect(page.locator('.jira-configuration [role=alert]')).toHaveText(
    'Enter a Jira PAT without spaces or control characters.',
  )
  await page.getByLabel('Jira PAT', { exact: true }).fill('synthetic-jira-review-pat')
  await page.getByRole('button', { name: 'Save Jira settings', exact: true }).click()
  await expect(page.locator('.jira-configuration [role=status]')).toHaveText('Jira settings saved')
  await expect(page.getByLabel('Jira PAT', { exact: true })).toHaveValue('')
  await expect(page.getByLabel('Jira PAT', { exact: true })).toHaveAttribute(
    'placeholder',
    '************',
  )
  await page
    .getByRole('textbox', { name: 'Jira address', exact: true })
    .fill('https://jira.example.com/jira')
  await page.locator('.plugin-settings-scroll:not([hidden])').evaluate((panel) => {
    panel.scrollTop = panel.scrollHeight
  })
  await page.screenshot({ path: path.join(output, 'settings-light-en.png') })
  await page.getByRole('textbox', { name: 'Jira address', exact: true }).fill(baseUrl)
  await exitSettings()
  await slash()
  await page
    .getByRole('textbox', { name: 'Jira issue key or URL', exact: true })
    .fill('PROJECT-123')
  await page.getByRole('button', { name: 'Add issue', exact: true }).click()
  await expect(page.locator('.jira-summary')).toHaveText('Prepare the desktop release')
  await expect(page.locator('.jira-status')).toHaveText('In progress')
  await pluginSettings()
  await page.getByRole('button', { name: 'Configure Jira', exact: true }).click()
  await expect(page.getByLabel('Jira PAT', { exact: true })).toHaveAttribute(
    'placeholder',
    '************',
  )
  await expect(
    page.getByRole('button', { name: 'Default Jira block view', exact: true }),
  ).toHaveCount(0)
  await expect(page.locator('.jira-configuration')).toBeVisible()
  await page.getByRole('button', { name: 'Save Jira settings', exact: true }).click()
  await expect(page.locator('.jira-configuration [role=status]')).toHaveText('Jira settings saved')
  await exitSettings()
  // Add a second block using a browse URL; it has no due date.
  await page.locator('.document-editor').evaluate((element) =>
    element.editor.commands.insertContentAt(element.editor.state.doc.content.size, {
      type: 'paragraph',
    }),
  )
  await slash()
  await expect(page.locator('.jira-block').nth(1)).toHaveClass(/detailed/)
  const beforeBadUrl = requests.length
  await page
    .getByRole('textbox', { name: 'Jira issue key or URL', exact: true })
    .fill('https://other.example.com/browse/PROJECT-456')
  await page.getByRole('button', { name: 'Add issue', exact: true }).click()
  await expect(page.locator('.jira-block').nth(1).getByRole('alert')).toContainText(
    'configured Jira',
  )
  expect(requests.length).toBe(beforeBadUrl)
  await page
    .getByRole('textbox', { name: 'Jira issue key or URL', exact: true })
    .fill(baseUrl + '/browse/PROJECT-456')
  await page.getByRole('textbox', { name: 'Jira issue key or URL', exact: true }).press('Enter')
  await expect(
    page.locator('.jira-block').nth(1).getByRole('button', { name: 'PROJECT-456', exact: true }),
  ).toBeVisible()
  await expect(page.locator('.jira-summary').nth(1)).toHaveText('Review plugin documentation')
  await expect(page.locator('.jira-due').nth(1)).toContainText('No due date')
  await view(1, 'Minimal')
  await expect(page.locator('.jira-block').nth(1)).not.toContainText('Review plugin documentation')
  await expect(page.locator('.jira-block').nth(1)).toHaveClass(/jira-inline/)
  await expect(page.locator('.jira-block').nth(1).locator('.jira-status')).toHaveText('In progress')
  await page.locator('.document-editor').evaluate((element) => element.editor.commands.undo())
  await expect(page.locator('.jira-block').nth(1)).toHaveClass(/detailed/)
  await page.locator('.document-editor').evaluate((element) => element.editor.commands.redo())
  await expect(page.locator('.jira-block').nth(1)).toHaveClass(/minimal/)
  await page.locator('.jira-key').first().click()
  expect(await app.evaluate(() => globalThis.jiraOpenedUrl)).toBe(baseUrl + '/browse/PROJECT-123')
  const roundTrip = await doc()
  const html = await page
    .locator('.document-editor')
    .evaluate((element) => element.editor.getHTML())
  await page
    .locator('.document-editor')
    .evaluate((element, html) => element.editor.commands.setContent(html), html)
  expect(await doc()).toEqual(roundTrip)
  const beforeRefresh = await doc()
  status = 'Done'
  await page.locator('.jira-block').first().hover()
  await page.getByRole('button', { name: 'Refresh Jira issue', exact: true }).first().click()
  await expect(page.locator('.jira-status').first()).toHaveText('Done')
  await page.locator('.document-editor').evaluate((element) => element.editor.commands.undo())
  expect(await doc()).toEqual(beforeRefresh)
  await page.locator('.document-editor').evaluate((element) => element.editor.commands.redo())
  await expect(page.locator('.jira-status').first()).toHaveText('Done')
  // Failed refreshes retain the saved snapshot.
  const beforeFailure = await doc()
  responseStatus = 401
  await page.getByRole('button', { name: 'Refresh Jira issue', exact: true }).first().click()
  await expect(page.locator('.jira-block').first().getByRole('alert')).toContainText(
    'Jira rejected',
  )
  expect(await doc()).toEqual(beforeFailure)
  responseStatus = 302
  const beforeRedirect = requests.length
  await page.getByRole('button', { name: 'Refresh Jira issue', exact: true }).first().click()
  await expect(page.locator('.jira-block').first().getByRole('alert')).toContainText('redirected')
  expect(requests.length).toBe(beforeRedirect + 1)
  expect(await doc()).toEqual(beforeFailure)
  responseStatus = 200
  await page.getByRole('button', { name: 'Refresh Jira issue', exact: true }).first().click()
  await expect(page.locator('.jira-block').first().getByRole('alert')).toHaveCount(0)
  await saved()
  // A delayed reply cannot recreate a deleted block or overwrite typing.
  delayed = {}
  await page.getByRole('button', { name: 'Refresh Jira issue', exact: true }).first().click()
  await expect.poll(() => !!delayed?.reply).toBe(true)
  await page.locator('.document-editor').evaluate((element) => {
    const e = element.editor
    let pos
    e.state.doc.descendants((node, at) => {
      if (pos === undefined && node.type.name === 'jiraIssue') pos = at
    })
    const node = e.state.doc.nodeAt(pos)
    e.commands.deleteRange({ from: pos, to: pos + node.nodeSize })
    e.commands.insertContentAt(e.state.doc.content.size, {
      type: 'paragraph',
      content: [{ type: 'text', text: 'Typing during refresh is retained.' }],
    })
  })
  const deleted = await doc()
  delayed.reply()
  delayed = undefined
  await page.waitForTimeout(250)
  expect(await doc()).toEqual(deleted)
  await page
    .locator('.document-editor')
    .evaluate((element, content) => element.editor.commands.setContent(content), beforeFailure)
  await saved()
  const count = requests.length
  // Disabling the plugin keeps snapshots but blocks network access and slash insertion.
  await pluginSettings()
  await page.getByRole('switch', { name: 'Enable Jira', exact: true }).click()
  await exitSettings()
  await expect(
    page.getByRole('button', { name: 'Refresh Jira issue', exact: true }).first(),
  ).toBeDisabled()
  await saved()
  const rejection = await page.evaluate(
    async ({ workspaceId, baseUrl }) => {
      try {
        await window.sheco.jiraIssue({ workspaceId, baseUrl, issueKey: 'PROJECT-123' })
        return ''
      } catch (error) {
        return error.message
      }
    },
    { workspaceId: w.id, baseUrl },
  )
  expect(rejection).toContain('Enable Jira')
  expect(requests.length).toBe(count)
  for (const scope of [
    { workspaceId: '00000000-0000-4000-8000-000000000000', baseUrl },
    { workspaceId: w.id, baseUrl: 'https://other.example.com' },
  ]) {
    const failure = await page.evaluate(async (input) => {
      try {
        await window.sheco.jiraIssue({ ...input, issueKey: 'PROJECT-123' })
        return ''
      } catch (error) {
        return error.message
      }
    }, scope)
    expect(failure).toMatch(/no longer open|configured server/)
  }
  expect(requests.length).toBe(count)
  await pluginSettings()
  await page.getByRole('switch', { name: 'Enable Jira', exact: true }).click()
  await exitSettings()
  const persisted = await doc()
  await close()
  await launch()
  expect(await doc()).toEqual(persisted)
  expect(await page.evaluate((id) => window.sheco.jiraStatus(id), w.id)).toMatchObject({
    hasToken: true,
    encryptionAvailable: true,
  })
  expect(requests.length).toBe(count)
  await page.screenshot({ path: path.join(output, 'blocks-light-en.png') })
  await page.emulateMedia({ media: 'print' })
  await expect(page.locator('.jira-actions').first()).toBeHidden()
  await expect(page.locator('.jira-summary')).toBeVisible()
  await page.emulateMedia({ media: null })
  await app.evaluate(
    ({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath })
    },
    path.join(output, 'jira.md'),
  )
  await page.evaluate((id) => window.sheco.exportPage(id, 'markdown'), w.pages[0].id)
  expect(await fs.readFile(path.join(output, 'jira.md'), 'utf8')).toContain(
    `${baseUrl}/browse/PROJECT-123`,
  )
  await app.evaluate(
    ({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath })
    },
    path.join(output, 'jira.pdf'),
  )
  await page.evaluate((id) => window.sheco.exportPage(id, 'pdf'), w.pages[0].id)
  expect((await fs.stat(path.join(output, 'jira.pdf'))).size).toBeGreaterThan(1000)
  await setAppearance('Dark', 'English')
  await page.screenshot({ path: path.join(output, 'blocks-dark-en.png') })
  await setAppearance('Dark', 'Русский')
  await page.screenshot({ path: path.join(output, 'blocks-dark-ru.png') })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(800, 700))
  const geometry = await page.locator('.jira-block').evaluateAll((blocks) =>
    blocks.map((block) => {
      const rect = block.getBoundingClientRect()
      return {
        inside: rect.left >= 0 && rect.right <= innerWidth,
        fits: block.scrollWidth <= block.clientWidth,
      }
    }),
  )
  expect(geometry.every((block) => block.inside && block.fits)).toBe(true)
  await view(1, 'Подробный', true)
  await view(1, 'Минимальный', true)
  await page.screenshot({ path: path.join(output, 'blocks-narrow-dark-ru.png') })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 900))
  await setAppearance('Светлая', 'Русский', true)
  await page.screenshot({ path: path.join(output, 'blocks-light-ru.png') })
  await pluginSettings(true)
  await page.getByRole('button', { name: 'Настроить Jira', exact: true }).click()
  await page
    .getByRole('textbox', { name: 'Адрес Jira', exact: true })
    .fill('https://jira.example.com/jira')
  await page.locator('.plugin-settings-scroll:not([hidden])').evaluate((panel) => {
    panel.scrollTop = panel.scrollHeight
  })
  await page.screenshot({ path: path.join(output, 'settings-light-ru.png') })
  await page.getByRole('textbox', { name: 'Адрес Jira', exact: true }).fill(baseUrl)
  await page.getByRole('button', { name: 'Удалить токен', exact: true }).click()
  await expect(page.locator('.jira-configuration [role=status]')).toHaveText('Токен Jira удалён')
  await exitSettings(true)
  await page.locator('.jira-block').first().hover()
  await page.getByRole('button', { name: 'Обновить задачу Jira', exact: true }).first().click()
  await expect(page.locator('.jira-block').first().getByRole('alert')).toContainText(
    'Сначала настройте Jira',
  )
  await saved()
  const final = JSON.parse(await fs.readFile(snapshot, 'utf8'))
  expect(JSON.stringify(final)).not.toContain('synthetic-jira-review-pat')
  expect(await fs.readFile(path.join(root, 'jira-credentials.json'), 'utf8')).not.toContain(
    'synthetic-jira-review-pat',
  )
  expect(markdown(final.pages[0].content)).toContain(`${baseUrl}/browse/PROJECT-123`)
  // Cloud uses a separate encrypted email/token record and REST v3 at the site root.
  await setAppearance('Светлая', 'English', true)
  await pluginSettings()
  await page.getByRole('button', { name: 'Configure Jira', exact: true }).click()
  await page.getByRole('button', { name: 'Jira connection', exact: true }).click()
  await page.getByRole('option', { name: 'Cloud · API token', exact: true }).click()
  await page.getByRole('textbox', { name: 'Jira address', exact: true }).fill(baseUrl + '/')
  await page.getByRole('button', { name: 'Save Jira settings', exact: true }).click()
  await expect(page.locator('.jira-configuration [role=alert]')).toContainText(
    'Atlassian account email',
  )
  await page.getByLabel('Atlassian email', { exact: true }).fill('synthetic@example.com')
  await page.getByRole('button', { name: 'Save Jira settings', exact: true }).click()
  await expect(page.locator('.jira-configuration [role=alert]')).toHaveText(
    'Enter a Jira API token.',
  )
  await page.getByLabel('Jira API token', { exact: true }).fill('synthetic-cloud-api-token')
  await page.getByRole('button', { name: 'Save Jira settings', exact: true }).click()
  await expect(page.locator('.jira-configuration [role=status]')).toHaveText('Jira settings saved')
  await expect(page.getByLabel('Jira address', { exact: true })).toHaveValue(
    new URL(baseUrl).origin,
  )
  await expect(page.getByLabel('Jira API token', { exact: true })).toHaveValue('')
  await expect(page.getByLabel('Jira API token', { exact: true })).toHaveAttribute(
    'placeholder',
    '************',
  )
  await exitSettings()
  await page.locator('.document-editor').evaluate((element) =>
    element.editor.commands.insertContentAt(element.editor.state.doc.content.size, {
      type: 'paragraph',
    }),
  )
  await slash()
  await page
    .getByRole('textbox', { name: 'Jira issue key or URL', exact: true })
    .fill('PROJECT-789')
  await page.getByRole('button', { name: 'Add issue', exact: true }).click()
  await expect(
    page.locator('.jira-block').nth(2).getByRole('button', { name: 'PROJECT-789', exact: true }),
  ).toBeVisible()
  const cloudCount = requests.length
  const cloudDoc = await doc()
  await close()
  await launch()
  expect(await doc()).toEqual(cloudDoc)
  expect(requests.length).toBe(cloudCount)
  const cloudStatus = await page.evaluate((id) => window.sheco.jiraStatus(id), w.id)
  expect(cloudStatus).toEqual({
    hasToken: true,
    encryptionAvailable: true,
    email: 'synthetic@example.com',
  })
  await pluginSettings()
  await page.getByRole('button', { name: 'Configure Jira', exact: true }).click()
  await expect(page.getByLabel('Jira API token', { exact: true })).toHaveAttribute(
    'placeholder',
    '************',
  )
  await page.getByLabel('Atlassian email', { exact: true }).fill('changed@example.com')
  await expect(page.getByLabel('Jira API token', { exact: true })).toHaveAttribute(
    'placeholder',
    '',
  )
  await page.getByRole('button', { name: 'Save Jira settings', exact: true }).click()
  await expect(page.locator('.jira-configuration [role=alert]')).toHaveText(
    'Enter a Jira API token.',
  )
  await exitSettings()
  const cloudWorkspace = await fs.readFile(snapshot, 'utf8')
  const cloudCredentials = await fs.readFile(path.join(root, 'jira-credentials.json'), 'utf8')
  expect(cloudWorkspace).not.toMatch(/synthetic@example|synthetic-cloud-api-token/)
  expect(cloudCredentials).not.toMatch(/synthetic@example|synthetic-cloud-api-token/)
  for (const [theme, language, ru, file] of [
    ['Light', 'English', false, 'settings-cloud-light-en.png'],
    ['Dark', 'English', false, 'settings-cloud-dark-en.png'],
    ['Dark', 'Русский', false, 'settings-cloud-dark-ru.png'],
    ['Светлая', 'Русский', true, 'settings-cloud-light-ru.png'],
  ]) {
    await setAppearance(theme, language, ru)
    const russian = language === 'Русский'
    await pluginSettings(russian)
    await page
      .getByRole('button', { name: russian ? 'Настроить Jira' : 'Configure Jira', exact: true })
      .click()
    await expect(
      page.getByLabel(russian ? 'Email Atlassian' : 'Atlassian email', { exact: true }),
    ).toHaveValue('synthetic@example.com')
    await expect(
      page.getByLabel(russian ? 'API-токен Jira' : 'Jira API token', { exact: true }),
    ).toHaveAttribute('placeholder', '************')
    await page.locator('.plugin-settings-scroll:not([hidden])').evaluate((panel) => {
      panel.scrollTop = panel.scrollHeight
    })
    await page.screenshot({ path: path.join(output, file) })
    await page
      .getByRole('button', { name: russian ? 'Подключение Jira' : 'Jira connection', exact: true })
      .click()
    await page
      .getByRole('option', {
        name: russian ? 'Cloud · API-токен со scopes' : 'Cloud · API token with scopes',
        exact: true,
      })
      .click()
    await expect(
      page.getByLabel(russian ? 'API-токен Jira' : 'Jira API token', { exact: true }),
    ).toHaveAttribute('placeholder', '')
    await exitSettings(russian)
  }
  await pluginSettings(true)
  await page.getByRole('button', { name: 'Настроить Jira', exact: true }).click()
  await page.getByRole('button', { name: 'Удалить токен', exact: true }).click()
  await expect(page.locator('.jira-configuration [role=status]')).toHaveText('Токен Jira удалён')
  expect(await page.evaluate((id) => window.sheco.jiraStatus(id), w.id)).toMatchObject({
    hasToken: false,
  })
  expect(
    requests.every(
      (request) =>
        request.method === 'GET' &&
        request.authenticated &&
        (request.cloud
          ? request.url.startsWith('/rest/api/3/issue/')
          : request.url.startsWith('/jira/rest/api/2/issue/')),
    ),
  ).toBe(true)
  expect(errors).toEqual([])
  await fs.writeFile(
    path.join(output, 'verification.json'),
    JSON.stringify(
      {
        fixture: root,
        requests,
        snapshotPreservedOnErrors: true,
        staleReplyIgnored: true,
        persistedAcrossRestart: true,
        credentialRemoved: true,
        cloudBasicAuthentication: true,
        cloudCredentialsEncrypted: true,
        cloudOfflineRestart: true,
        errors,
      },
      null,
      2,
    ),
  )
  console.log('Jira desktop review passed:', output)
} finally {
  if (app) {
    await page?.screenshot({ path: path.join(output, 'last-state.png') }).catch(() => {})
    await app
      .evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close())
      .catch(() => {})
    await app.close().catch(() => {})
  }
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
}
