import { _electron as electron, expect } from '@playwright/test'
import { build } from 'esbuild'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sheco-database-widths-'))
const workspace = path.join(root, 'Knowledge')
const extreme = process.env.SHECO_WIDTHS_CASE === 'extreme'
const output = path.resolve('test-results/database-widths', extreme ? 'extreme' : '.')
await fs.mkdir(workspace)
await fs.mkdir(output, { recursive: true })
const bundle = await build({
  stdin: {
    contents:
      "export { seedWorkspace } from './src/shared/seed'; export { createPage, workspaceSchema } from './src/shared/model'",
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
})
const modulePath = path.join(root, 'fixture.mjs')
await fs.writeFile(modulePath, bundle.outputFiles[0].contents)
const { seedWorkspace, createPage, workspaceSchema } = await import(pathToFileURL(modulePath).href)
const w = seedWorkspace('Database width review')
const tools = w.pages.find((page) => page.title === 'Tools')
const db = w.databases.find((database) => database.pageId === tools.id)
const type = db.columns.find((column) => column.type === 'select')
const category = db.columns.find((column) => column.type === 'multiSelect')
const statusLabel = 'Awaiting security and configuration review'
const status = {
  ...type,
  id: crypto.randomUUID(),
  name: 'Status',
  type: 'status',
  options: ['Not started', 'Done', statusLabel],
}
const importedLabel = 'Imported choice absent from the option list'
type.options = ['Website', 'Utility']
if (extreme) type.options.push('W'.repeat(100))
category.options = ['Web', 'JWT', 'Authentication and access controls']
db.columns = [status, type, category].map((column) => ({ ...column, width: 80 }))
db.titleWidth = 80 // Existing narrow snapshots must remain readable without being rewritten on load.
const records = w.pages.filter((page) => page.databaseId === db.id)
const nmap = records.find((page) => page.title === 'Nmap')
const imported = records.find((page) => page.title === 'Wireshark')
for (const record of records) {
  record.properties[status.id] = record.id === nmap.id ? 'Not started' : 'Done'
  record.properties[category.id] = ['Web', 'JWT']
}
imported.properties[type.id] = importedLabel
if (extreme) nmap.properties[type.id] = 'W'.repeat(100)
const note = createPage(w, 'Inline width review')
note.content = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'Retain this document during width checks.' }],
    },
    { type: 'databaseEmbed', attrs: { pageId: tools.id, label: tools.title } },
  ],
}
w.pages.push(note)
w.ui.activeId = tools.id
w.ui.tabs = [tools.id, note.id]
await fs.writeFile(path.join(workspace, 'workspace.json'), JSON.stringify(w))
await fs.writeFile(
  path.join(root, 'spaces.json'),
  JSON.stringify({
    activeId: w.id,
    spaces: [{ id: w.id, name: w.name, icon: w.icon, path: workspace }],
  }),
)

let app, page
const errors = []
const checks = []
const indexOf = (id) =>
  id === 'title' ? 0 : db.columns.findIndex((column) => column.id === id) + 1
const header = (scope, id) => scope.locator('.database-table th').nth(indexOf(id))
const handle = (scope, id) => header(scope, id).getByRole('separator')
const currentDB = (snapshot) => snapshot.databases.find((database) => database.id === db.id)
async function launch() {
  app = await electron.launch({ args: ['.'], env: { ...process.env, SHECO_DATA_DIR: root } })
  page = await app.firstWindow()
  page.on('pageerror', (error) => errors.push(error.message))
  await expect(page.locator('.page-title')).toBeVisible({ timeout: 20000 })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1600, 1000))
}
async function saved() {
  await expect(page.locator('.save-status')).toHaveClass(/\bsaved\b/)
}
async function snapshot() {
  await saved()
  return JSON.parse(await fs.readFile(path.join(workspace, 'workspace.json'), 'utf8'))
}
async function open(id) {
  await page.evaluate(
    (id) => window.dispatchEvent(new CustomEvent('open-page', { detail: { id } })),
    id,
  )
  await expect(page.locator('.page-title')).toBeVisible()
  await expect(page.locator('.page-title')).toHaveValue(
    w.pages.find((page) => page.id === id).title,
  )
}
async function close() {
  await saved()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await app.close()
  app = null
}
async function tagsFit(scope, id) {
  const cells = scope.locator('.database-table tbody tr td:nth-child(' + (indexOf(id) + 1) + ')')
  const dimensions = await cells.evaluateAll((cells) =>
    cells.flatMap((cell) =>
      [...cell.querySelectorAll('.tag')].map((tag) => {
        const c = cell.getBoundingClientRect(),
          t = tag.getBoundingClientRect()
        return {
          cellWidth: c.width,
          width: t.width,
          left: t.left - c.left,
          right: c.right - t.right,
        }
      }),
    ),
  )
  expect(dimensions.length).toBeGreaterThan(0)
  for (const box of dimensions) {
    expect(box.cellWidth).toBeGreaterThanOrEqual(box.width + 20)
    expect(box.left).toBeGreaterThanOrEqual(9)
    expect(box.right).toBeGreaterThanOrEqual(9)
  }
}
async function minimumChecks(scope) {
  for (const column of db.columns) await tagsFit(scope, column.id)
  expect((await header(scope, 'title').boundingBox()).width).toBeGreaterThanOrEqual(180)
  for (const id of ['title', ...db.columns.map((column) => column.id)]) {
    const separator = handle(scope, id)
    await separator.focus()
    await page.keyboard.press('Home')
    await saved()
    const minimum = Number(await separator.getAttribute('aria-valuemin'))
    expect((await header(scope, id).boundingBox()).width).toBeCloseTo(minimum, 0)
    await page.keyboard.press('ArrowLeft')
    await saved()
    expect((await header(scope, id).boundingBox()).width).toBeCloseTo(minimum, 0)
    await separator.scrollIntoViewIfNeeded()
    const rect = await separator.boundingBox()
    const before = await snapshot()
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2)
    await page.mouse.down()
    await page.mouse.move(5, rect.y + rect.height / 2, { steps: 10 })
    expect((await header(scope, id).boundingBox()).width).toBeCloseTo(minimum, 0)
    await page.mouse.up()
    expect(await snapshot()).toEqual(before)
  }
  expect(currentDB(await snapshot()).titleWidth).toBe(180)
  for (const column of db.columns) await tagsFit(scope, column.id)
}
async function chooseStatus(scope, value) {
  const row = scope
    .locator('.database-table tbody tr')
    .filter({ has: page.locator('.record-title', { hasText: /^Nmap$/ }) })
  await row.locator('td').nth(indexOf(status.id)).locator('.property-field').click()
  await page.locator('.property-popover').getByRole('button', { name: value, exact: true }).click()
  await saved()
}
async function fixedWidthChecks(russian = false) {
  await open(note.id)
  const noteWidth = (await page.locator('.page-content').boundingBox()).width
  await open(tools.id)
  const fixed = await page.locator('.page-content').boundingBox()
  expect(fixed.width).toBeCloseTo(noteWidth, 0)
  expect(fixed.width).toBe(950)
  const scroll = page.locator('.database-scroll')
  expect(await scroll.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true)
  await page
    .getByRole('button', { name: russian ? 'Действия со страницей' : 'Page options', exact: true })
    .click()
  await page
    .getByRole('switch', {
      name: russian ? 'Фиксированная ширина' : 'Fixed content width',
      exact: true,
    })
    .click()
  await page.keyboard.press('Escape')
  const full = await page.locator('.page-content').boundingBox()
  expect(full.width).toBeGreaterThan(fixed.width + 100)
  expect((await snapshot()).ui.fixedWidth).toBe(false)
  await page
    .getByRole('button', { name: russian ? 'Действия со страницей' : 'Page options', exact: true })
    .click()
  await page
    .getByRole('switch', {
      name: russian ? 'Фиксированная ширина' : 'Fixed content width',
      exact: true,
    })
    .click()
  await page.keyboard.press('Escape')
  expect((await page.locator('.page-content').boundingBox()).width).toBe(fixed.width)
  expect(
    await page
      .locator('.content-scroll')
      .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
  ).toBe(true)
  const heading = await page.locator('.page-heading').boundingBox()
  const content = await scroll.boundingBox()
  expect(heading.x).toBeCloseTo(content.x, 0)
  expect(heading.width).toBeCloseTo(content.width, 0)
  await saved()
  await page.screenshot({
    path: path.join(output, `fixed-width-${russian ? 'dark-ru' : 'light-en'}.png`),
  })
}

try {
  await launch()
  const baseline = await snapshot()
  if (process.env.SHECO_WIDTHS_CASE === 'fixed') {
    await fixedWidthChecks()
  } else {
    const main = page.locator('.database-view')
    for (const column of db.columns) await tagsFit(main, column.id)
    expect(currentDB(await snapshot()).titleWidth).toBe(80)
    expect(currentDB(await snapshot()).columns.map((column) => column.width)).toEqual([80, 80, 80])
    const beforeChoice = (await header(main, status.id).boundingBox()).width
    await chooseStatus(main, statusLabel)
    expect((await header(main, status.id).boundingBox()).width).toBe(beforeChoice)
    await minimumChecks(main)
    if (extreme) {
      expect(Number(await handle(main, type.id).getAttribute('aria-valuemin'))).toBeGreaterThan(
        1000,
      )
      expect(
        currentDB(await snapshot()).columns.find((column) => column.id === type.id).width,
      ).toBe(1000)
    }
    const row = main
      .locator('.database-table tbody tr')
      .filter({ has: page.locator('.record-title', { hasText: /^Nmap$/ }) })
    await row.locator('td').nth(indexOf(status.id)).locator('.property-field').click()
    const longer =
      'Awaiting comprehensive security, configuration, authentication and infrastructure review'
    await page.locator('.property-popover input').fill(longer)
    await page
      .locator('.property-popover')
      .getByRole('button', { name: 'Create “' + longer + '”', exact: true })
      .click()
    await saved()
    expect((await header(main, status.id).boundingBox()).width).toBeGreaterThan(beforeChoice)
    await tagsFit(main, status.id)
    await chooseStatus(main, 'Not started')
    await minimumChecks(main)
    checks.push(
      'Legacy narrow widths display safely without a load-time rewrite; Name minimum 180px; unused schema options, imported select values, wrapped multi-select tags, status dots, dynamic option growth and pointer/keyboard minima',
    )
    await fixedWidthChecks()
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByTitle('Dark', { exact: true }).click()
    await page.getByRole('button', { name: 'Русский', exact: true }).click()
    await page.keyboard.press('Escape')
    await fixedWidthChecks(true)
    await open(note.id)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 720))
    const embed = page.locator('.database-embed .database-view')
    await minimumChecks(embed)
    expect(
      await page.locator('.page-content').evaluate((element) => getComputedStyle(element).maxWidth),
    ).toBe('850px')
    expect(
      await page
        .locator('.content-scroll')
        .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
    ).toBe(true)
    await page.screenshot({ path: path.join(output, 'minimum-widths-inline-dark-ru.png') })
    checks.push(
      'Fixed/full width works on database pages with the same geometry as notes, contained horizontal table scrolling, light English/dark Russian and narrow inline databases',
    )
    const beforeRestart = await snapshot()
    expect(workspaceSchema.safeParse(beforeRestart).success).toBe(true)
    for (const record of records) {
      const before = baseline.pages.find((page) => page.id === record.id)
      const after = beforeRestart.pages.find((page) => page.id === record.id)
      expect(after.content).toEqual(before.content)
      expect(after.properties).toEqual(before.properties)
    }
    await close()
    await launch()
    const after = await snapshot()
    expect(after.databases).toEqual(beforeRestart.databases)
    expect(after.pages).toEqual(beforeRestart.pages)
    expect(after.ui).toEqual(beforeRestart.ui)
    expect(errors).toEqual([])
    await fs.writeFile(
      path.join(output, 'verification.json'),
      JSON.stringify({ checks, rendererErrors: errors, restartPreserved: true }, null, 2) + '\n',
    )
    console.log('Passed: ' + checks.join('; ') + '; preserved content/properties and restart.')
  }
} finally {
  await page?.mouse.up().catch(() => {})
  if (app) await close().catch(async () => app?.close())
}
