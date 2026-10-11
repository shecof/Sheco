import { _electron as electron, expect } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sheco-e2e-'))
const output = path.resolve('test-results')
await fs.mkdir(output, { recursive: true })
const errors = []
let app
let page
async function launch() {
  app = await electron.launch({
    ...(process.env.SHECO_TEST_EXECUTABLE
      ? { executablePath: process.env.SHECO_TEST_EXECUTABLE, args: [] }
      : { args: ['.'] }),
    env: { ...process.env, SHECO_DATA_DIR: root },
  })
  page = await app.firstWindow()
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (
      message.type() === 'error' &&
      !message.text().includes('Content Security Policy') &&
      !message.text().includes('ERR_BLOCKED')
    )
      errors.push(message.text())
  })
  await expect(page.getByLabel('Page title')).toBeVisible({ timeout: 20000 })
}
async function menu(action) {
  await app.evaluate(
    ({ BrowserWindow }, action) =>
      BrowserWindow.getAllWindows()[0].webContents.send('menu', action),
    action,
  )
}
async function saved() {
  await expect(page.locator('.save-status')).toHaveClass(/\bsaved\b/)
}
async function dialogSave(file) {
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file })
  }, file)
}
try {
  await launch()
  await expect(page.getByLabel('Page title')).toHaveValue('Tools')
  await expect(page.locator('.database-table tbody tr')).toHaveCount(10)
  await page.screenshot({ path: path.join(output, 'database.png') })
  for (const [view, selector] of [
    ['List', '.database-list'],
    ['Board', '.database-board'],
    ['Gallery', '.database-gallery'],
    ['Table', '.database-table'],
  ]) {
    await page.locator('.view-tab').click()
    await page.getByRole('button', { name: view, exact: true }).last().click()
    await expect(page.locator(selector)).toBeVisible()
  }
  await page.getByTitle('Add property', { exact: true }).click()
  await page.getByLabel('Property name').fill('Reviewed')
  await page.getByRole('button', { name: 'Property type', exact: true }).click()
  await page.getByRole('option', { name: 'Checkbox', exact: true }).click()
  await page.getByRole('button', { name: 'Save property', exact: true }).click()
  await expect(page.locator('.database-table thead')).toContainText('Reviewed')
  await page.getByLabel('Reviewed for Nmap').check()
  await saved()
  // Database edits are real page properties and support search and filters.
  const row = page.locator('.database-table tbody tr').filter({ hasText: 'Nmap' })
  await row.locator('td').nth(1).click()
  const description = row.getByLabel('Description for Nmap')
  await description.fill('A durable network research note')
  await description.press('Enter')
  await saved()
  await page.getByTitle('Search database', { exact: true }).click()
  await page.getByRole('textbox', { name: 'Search database', exact: true }).fill('durable')
  await expect(page.locator('.database-table tbody tr')).toHaveCount(1)
  await page.getByLabel('Clear search').click()
  await page.getByTitle('Filter entries').click()
  await page.getByRole('button', { name: 'Add filter', exact: true }).click()
  await page.getByLabel('Filter value').fill('Nmap')
  await expect(page.locator('.database-table tbody tr')).toHaveCount(1)
  await page.getByRole('button', { name: 'Clear all filters', exact: true }).click()
  await page.keyboard.press('Escape')
  await page.getByTitle('Sort entries').click()
  await page.getByRole('button', { name: 'Sort property', exact: true }).click()
  await page.getByRole('option', { name: 'Name', exact: true }).click()
  await page.getByRole('button', { name: 'Sort direction', exact: true }).click()
  await page.getByRole('option', { name: 'Descending', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(page.locator('.record-name').first()).toContainText('Wireshark')
  await page.getByTitle('Sort entries').click()
  await page.getByRole('button', { name: 'Sort property', exact: true }).click()
  await page.getByRole('option', { name: 'Manual order', exact: true }).click()
  await page.keyboard.press('Escape')
  // Open a database record as a complete document.
  await page.getByRole('button', { name: 'Open Nmap', exact: true }).click()
  await expect(page.getByLabel('Page title')).toHaveValue('Nmap')
  await expect(page.locator('.document-editor')).toContainText('Host discovery')
  await expect(page.locator('.page-properties')).toContainText('A durable network research note')
  await expect(page.locator('.code-block')).toHaveCount(2)
  await page.screenshot({ path: path.join(output, 'note.png') })
  // A new page supports slash commands, undo, wiki links, and math.
  await menu('newPage')
  await page.getByLabel('Page title').fill('Integration note')
  await page.locator('.document-editor').click()
  await page.keyboard.type('/heading 2')
  await expect(page.locator('.command-palette')).toBeVisible()
  await page.screenshot({ path: path.join(output, 'slash-menu.png') })
  await page.keyboard.press('Enter')
  await page.keyboard.type('Persistent heading')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Saved after restart.')
  await page.keyboard.press('Enter')
  await page.keyboard.type('[[BOLA')
  await page.keyboard.press('Enter')
  await expect(page.locator('.wiki-link')).toContainText('BOLA')
  await page.keyboard.type('See [[Nmap]]')
  await expect(page.locator('.wiki-link')).toHaveCount(2)
  await page.keyboard.press('Enter')
  await page.keyboard.type('/math')
  await page.keyboard.press('Enter')
  await page.getByLabel('LaTeX expression').fill('\\frac{a}{b} = 2')
  await page.getByRole('button', { name: 'Save formula', exact: true }).click()
  await expect(page.locator('.tiptap-mathematics-render')).toBeVisible()
  await page.locator('.document-editor h2').hover()
  await page.getByLabel('Block options', { exact: true }).click()
  await page.getByRole('button', { name: 'Duplicate', exact: true }).click()
  await expect(page.locator('.document-editor h2')).toHaveCount(2)
  await page.locator('.document-editor h2').last().hover()
  await page.getByLabel('Block options', { exact: true }).click()
  await page.getByRole('button', { name: 'Delete block', exact: true }).click()
  await expect(page.locator('.document-editor h2')).toHaveCount(1)
  // Paste an image through the capability-limited desktop bridge.
  const attachment = await page.evaluate(async () => {
    const bytes = Uint8Array.from(
      atob(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOZYAAAAASUVORK5CYII=',
      ),
      (c) => c.charCodeAt(0),
    )
    return window.sheco.attachBytes('pixel.png', bytes.buffer)
  })
  await app.evaluate(
    ({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
    },
    path.join(root, 'Knowledge', 'attachments', attachment.file),
  )
  await page.locator('.document-editor').click()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('/image')
  await page.keyboard.press('Enter')
  await expect(page.locator('.document-editor img[src]')).toBeVisible()
  await saved()
  // Native export dialogs are replaced only in this isolated test process.
  const md = path.join(root, 'note.md')
  await dialogSave(md)
  await menu('exportMarkdown')
  await expect
    .poll(async () => fs.readFile(md, 'utf8').catch(() => ''), { timeout: 10000 })
    .toContain('Persistent heading')
  const text = await fs.readFile(md, 'utf8')
  expect(text).toContain('$$')
  expect(text).toContain('sheco://page/')
  expect(text).toContain('attachments/')
  const pdf = path.join(root, 'note.pdf')
  await dialogSave(pdf)
  await menu('exportPDF')
  await expect
    .poll(
      async () =>
        fs.stat(pdf).then(
          (s) => s.size,
          () => 0,
        ),
      { timeout: 15000 },
    )
    .toBeGreaterThan(1000)
  expect((await fs.readFile(pdf)).subarray(0, 4).toString()).toBe('%PDF')
  await fs.copyFile(pdf, path.join(output, 'export-example.pdf'))
  await page.emulateMedia({ media: 'print' })
  await expect(page.locator('.sidebar')).not.toBeVisible()
  await expect(page.locator('.format-toolbar')).not.toBeVisible()
  await page.screenshot({ path: path.join(output, 'print-layout.png'), fullPage: true })
  await page.emulateMedia({ media: null })
  await app.evaluate(({ dialog }, root) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] })
  }, root)
  const exported = await page.evaluate(() => window.sheco.exportWorkspace())
  expect(exported).toBeTruthy()
  const snapshot = JSON.parse(await fs.readFile(path.join(exported, 'workspace.json'), 'utf8'))
  expect(snapshot.attachments.length).toBeGreaterThan(0)
  expect((await fs.readdir(path.join(exported, 'attachments'))).length).toBeGreaterThan(0)
  const manualBackup = await page.evaluate(() => window.sheco.backup())
  expect(JSON.parse(await fs.readFile(path.join(manualBackup, 'workspace.json'), 'utf8')).id).toBe(
    snapshot.id,
  )
  const unsafe = await page.evaluate(() =>
    window.sheco.external('javascript:alert(1)').then(
      () => false,
      () => true,
    ),
  )
  expect(unsafe).toBe(true)
  const importedFile = path.join(root, 'Imported.md')
  await fs.writeFile(
    importedFile,
    '# Imported\n\n## Import heading\n\nA local Markdown document.\n\n```js\nconst answer = 42\n```\n\n| Port | Service |\n| --- | --- |\n| 22 | SSH |\n',
  )
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
  }, importedFile)
  await menu('import')
  await expect(page.getByLabel('Page title')).toHaveValue('Imported')
  await expect(page.locator('.document-editor h2')).toHaveText('Import heading')
  await expect(page.locator('.document-editor table')).toContainText('SSH')
  await expect(page.locator('.code-block')).toContainText('const answer = 42')
  await page.locator('.tab-open').filter({ hasText: 'Integration note' }).click()
  await expect(page.getByLabel('Page title')).toHaveValue('Integration note')
  // Search indexes document content and property values.
  await menu('search')
  await page.getByLabel('Search your workspace').fill('restart')
  await expect(page.locator('.search-results')).toContainText('Integration note')
  await page.screenshot({ path: path.join(output, 'search.png') })
  await page.keyboard.press('Escape')
  await saved()
  await app.close()
  app = null
  await launch()
  await expect(page.getByLabel('Page title')).toHaveValue('Integration note')
  await expect(page.locator('.document-editor')).toContainText('Saved after restart.')
  await expect(page.locator('.wiki-link')).toHaveCount(2)
  await expect(page.locator('.document-editor img[src]')).toHaveCount(1)
  // Trash preserves document and children, and can restore the page.
  await page.getByTitle('Page options', { exact: true }).click()
  await page.getByRole('button', { name: 'Move to Trash', exact: true }).click()
  await page.getByRole('button', { name: /^Trash/ }).click()
  await expect(page.locator('.trash-list')).toContainText('Integration note')
  await page.getByRole('button', { name: 'Restore', exact: true }).click()
  await expect(page.locator('.trash-list')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Home', exact: true })).toHaveCount(0)
  await page.locator('.breadcrumbs > button').click()
  await expect(page.locator('.home-page')).toHaveCount(0)
  await expect(
    page.locator('.brand-actions').getByRole('button', { name: 'Quick search' }),
  ).toBeVisible()
  await app.evaluate(({ dialog }, root) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] })
  }, root)
  await page.locator('.space-switcher > button').click()
  await page.getByRole('button', { name: 'New workspace', exact: true }).click()
  await page.getByLabel('Workspace name').fill('Second space')
  await app.evaluate(({ dialog }, root) => {
    dialog.showOpenDialog = async () => {
      await new Promise((resolve) => setTimeout(resolve, 600))
      return { canceled: false, filePaths: [root] }
    }
  }, root)
  await page.getByRole('button', { name: 'Choose location', exact: true }).click()
  await expect(page.locator('.app')).toHaveAttribute('inert', '')
  await expect(page.locator('.workspace-transition')).toBeVisible()
  await expect(page.getByLabel('Page title')).toHaveValue('Welcome to Second space')
  await expect(page.locator('.sidebar')).not.toContainText('Tools')
  await saved()
  await page.locator('.space-switcher > button').click()
  await page.locator('.space-menu .menu-item').filter({ hasText: 'Pentest' }).click()
  await expect(page.getByLabel('Page title')).toHaveValue('Imported')
  await page.locator('.breadcrumbs > button').click()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByTitle('Dark', { exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.keyboard.press('Escape')
  await page.screenshot({ path: path.join(output, 'dark.png') })
  await saved()
  expect(errors).toEqual([])
  console.log(
    'Passed: database edits, filtering, sorting, record documents, slash commands, wiki links, math, local images, Markdown/PDF export, global search, restart persistence, Trash, compact search, and dark theme.',
  )
  console.log('Screenshots:', output)
} finally {
  await app?.close()
  await fs.rm(root, { recursive: true, force: true })
}
