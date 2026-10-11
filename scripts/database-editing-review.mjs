import { _electron as electron, expect } from '@playwright/test'
import { build } from 'esbuild'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sheco-database-editing-'))
const workspace = path.join(root, 'Knowledge')
const output = path.resolve('test-results/database-editing')
await fs.mkdir(workspace)
await fs.mkdir(output, { recursive: true })
const bundled = await build({
  stdin: {
    contents:
      "export { seedWorkspace } from './src/shared/seed'; export { createPage, databaseRows, workspaceSchema } from './src/shared/model'",
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
})
const modulePath = path.join(root, 'fixtures.mjs')
await fs.writeFile(modulePath, bundled.outputFiles[0].contents)
const { seedWorkspace, createPage, databaseRows, workspaceSchema } = await import(
  pathToFileURL(modulePath).href
)
const w = seedWorkspace('Database editing review')
const tools = w.pages.find((page) => page.title === 'Tools')
const db = w.databases.find((database) => database.pageId === tools.id)
delete db.titleWidth // Legacy snapshots retain the previous 220px default.
const description = db.columns.find((column) => column.name === 'Description')
description.width = 220
const type = db.columns.find((column) => column.name === 'Type')
const category = db.columns.find((column) => column.name === 'Category')
const records = w.pages.filter((page) => page.databaseId === db.id)
const nmap = records.find((page) => page.title === 'Nmap')
const jwt = records.find((page) => page.title === 'jwt.io')
const imported = records.find((page) => page.title === 'Wireshark')
const longText =
  'Search for permission and configuration errors associated with local privilege escalation in Unix and Linux. Keep the complete description visible while editing, including wrapped lines and punctuation.'
nmap.properties[description.id] = longText
imported.properties[type.id] = 'Imported choice'
for (const record of records) record.properties[category.id] = []
nmap.properties[category.id] = ['Web', 'JWT']
jwt.properties[category.id] = ['JWT']
const status = {
  ...type,
  id: crypto.randomUUID(),
  name: 'Workflow',
  type: 'status',
  options: ['Not started', 'Done'],
  width: 180,
}
const relation = {
  ...type,
  id: crypto.randomUUID(),
  name: 'Reference',
  type: 'relation',
  options: [],
  width: 180,
}
const checkbox = {
  ...type,
  id: crypto.randomUUID(),
  name: 'Reviewed',
  type: 'checkbox',
  options: [],
  width: 120,
}
db.columns.push(status, relation, checkbox)
records.forEach((record, index) => {
  record.properties[status.id] = index % 2 ? 'Done' : 'Not started'
})
const related = createPage(w, 'Checked') // A user page title must not be translated in Russian.
w.pages.push(related)
nmap.properties[relation.id] = related.id
nmap.properties[checkbox.id] = true
const inline = createPage(w, 'Inline editing')
inline.content = {
  type: 'doc',
  content: [
    ...Array.from({ length: 12 }, (_, index) => ({
      type: 'paragraph',
      content: [{ type: 'text', text: 'Before database ' + index }],
    })),
    { type: 'databaseEmbed', attrs: { pageId: tools.id, label: tools.title } },
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'Retain the document after database edits.' }],
    },
  ],
}
w.pages.push(inline)
w.ui.activeId = tools.id
w.ui.tabs = [tools.id, inline.id]
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
async function launch() {
  app = await electron.launch({ args: ['.'], env: { ...process.env, SHECO_DATA_DIR: root } })
  page = await app.firstWindow()
  page.on('pageerror', (error) => errors.push(error.message))
  await expect(page.locator('.page-title')).toBeVisible({ timeout: 20000 })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 900))
}
async function saved() {
  await expect(page.locator('.save-status')).toHaveClass(/\bsaved\b/)
}
async function snapshot() {
  await saved()
  return JSON.parse(await fs.readFile(path.join(workspace, 'workspace.json'), 'utf8'))
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
  await expect(page.locator('.page-title')).toBeVisible()
}
async function floating(locator) {
  await expect(locator).toBeVisible()
  expect(await locator.evaluate((element) => element.parentElement === document.body)).toBe(true)
  const box = await locator.boundingBox()
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  expect(box.x).toBeGreaterThanOrEqual(8)
  expect(box.y).toBeGreaterThanOrEqual(8)
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width - 7)
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height - 7)
}
const databaseIn = (snapshot) => snapshot.databases.find((database) => database.id === db.id)
const indexOf = (column) =>
  column === 'title' ? 0 : db.columns.findIndex((item) => item.id === column) + 1
const header = (scope, column) => scope.locator('.database-table th').nth(indexOf(column))
async function beginResize(scope, column) {
  const handle = header(scope, column).locator('.column-resize')
  await handle.scrollIntoViewIfNeeded()
  const box = await handle.boundingBox()
  const x = box.x + box.width / 2,
    y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  return { x, y }
}
async function liveResize(scope, column, delta, filename) {
  const before = await snapshot()
  const initial = databaseIn(before)
  const stored =
    column === 'title'
      ? (initial.titleWidth ?? 220)
      : initial.columns.find((item) => item.id === column).width
  const original = (await header(scope, column).boundingBox()).width
  const point = await beginResize(scope, column)
  for (const distance of [delta / 2, delta]) {
    await page.mouse.move(point.x + distance, point.y, { steps: 8 })
    await expect
      .poll(async () => (await header(scope, column).boundingBox()).width)
      .toBeCloseTo(original + distance, 0)
    const cell = await scope
      .locator('.database-table tbody tr')
      .first()
      .locator('td')
      .nth(indexOf(column))
      .boundingBox()
    expect(cell.width).toBeCloseTo(original + distance, 0)
    expect(databaseIn(await snapshot())).toEqual(initial)
  }
  if (filename) await page.screenshot({ path: path.join(output, filename) })
  await page.mouse.up()
  const after = await snapshot()
  const current = databaseIn(after)
  expect(
    column === 'title'
      ? current.titleWidth
      : current.columns.find((item) => item.id === column).width,
  ).toBe(stored + delta)
  expect(after.revision).toBe(before.revision + 1)
  return current
}
async function editingChecks(scope, russian = false) {
  const row = scope
    .locator('.database-table tbody tr')
    .filter({ has: page.locator('.record-title', { hasText: /^Nmap$/ }) })
  const field = row.locator('td').nth(indexOf(description.id)).locator('.property-field')
  const before = await snapshot()
  const original = before.pages.find((item) => item.id === nmap.id).properties[description.id]
  const height = (await field.boundingBox()).height
  await field.click()
  const editor = field.locator('textarea')
  await expect(editor).toBeFocused()
  expect((await field.boundingBox()).height).toBeGreaterThanOrEqual(height - 1)
  expect(await editor.evaluate((element) => element.scrollHeight <= element.clientHeight + 1)).toBe(
    true,
  )
  await page.screenshot({ path: path.join(output, `multiline-${russian ? 'ru' : 'en'}.png`) })
  await editor.fill(original + ' Temporary edit')
  await editor.press('Escape')
  expect((await snapshot()).pages.find((item) => item.id === nmap.id).properties).toEqual(
    before.pages.find((item) => item.id === nmap.id).properties,
  )
  await field.click()
  await editor.press('ControlOrMeta+a')
  await editor.press('ArrowRight')
  await editor.press('Shift+Enter')
  await page.keyboard.type(russian ? 'Another saved line.' : 'Additional line.')
  expect(await editor.evaluate((element) => element.scrollHeight <= element.clientHeight + 1)).toBe(
    true,
  )
  const draft = await editor.inputValue()
  expect(draft).toContain('\n')
  // Resizing retains an in-progress cell edit and adjusts its wrapping before saving it.
  await liveResize(scope, description.id, 20)
  await expect(editor).toHaveValue(draft)
  expect(
    (await snapshot()).pages.find((item) => item.id === nmap.id).properties[description.id],
  ).toBe(original)
  expect(await editor.evaluate((element) => element.scrollHeight <= element.clientHeight + 1)).toBe(
    true,
  )
  await editor.press('Enter')
  await expect(editor).toHaveCount(0)
  expect(
    (await snapshot()).pages.find((item) => item.id === nmap.id).properties[description.id],
  ).toBe(draft)
  expect(
    await field
      .locator('.property-text')
      .evaluate((element) => getComputedStyle(element).whiteSpace),
  ).toBe('pre-wrap')
}
async function filteredRows(scope) {
  const current = await snapshot()
  const expected = databaseRows(current, databaseIn(current)).map(
    (record) => record.title || 'Untitled',
  )
  await expect(scope.locator('.record-title')).toHaveText(expected)
  return expected
}
async function filterChecks(scope, russian = false) {
  const text = (en, ru) => (russian ? ru : en)
  await scope.locator('.database-toolbar').scrollIntoViewIfNeeded()
  await scope.getByTitle(text('Filter entries', 'Фильтр записей'), { exact: true }).click()
  const filters = page.locator('.filter-popover')
  await floating(filters)
  expect((await filters.boundingBox()).width).toBeLessThanOrEqual(330)
  await filters
    .getByRole('button', { name: text('Add filter', 'Добавить фильтр'), exact: true })
    .click()
  await filters
    .getByRole('button', { name: text('Filter property', 'Свойство фильтра'), exact: true })
    .click()
  await page.getByRole('option', { name: 'Type', exact: true }).click()
  const value = filters.getByRole('textbox', {
    name: text('Filter value', 'Значение фильтра'),
    exact: true,
  })
  await value.fill('Util')
  await filteredRows(scope)
  const choose = filters.getByRole('button', {
    name: text('Choose filter value', 'Выбрать значение фильтра'),
    exact: true,
  })
  await choose.click()
  const choices = page.locator('.filter-value-popover')
  await floating(choices)
  await expect(choices.getByRole('option', { name: 'Utility', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(choose).toBeFocused()
  await expect(filters).toBeVisible()
  await value.fill('')
  await choose.click()
  await expect(choices.getByRole('option', { name: 'Imported choice', exact: true })).toBeVisible()
  await choices.getByRole('option', { name: 'Utility', exact: true }).click()
  await expect(value).toBeFocused()
  await expect(filters).toBeVisible()
  await filters
    .getByRole('button', { name: text('Filter operator', 'Условие фильтра'), exact: true })
    .click()
  await page.getByRole('option', { name: text('is', 'равно'), exact: true }).click()
  await filteredRows(scope)
  await page.screenshot({ path: path.join(output, `filter-${russian ? 'ru' : 'en'}.png`) })
  await filters
    .getByRole('button', { name: text('Clear all filters', 'Сбросить все фильтры'), exact: true })
    .click()
  await page.keyboard.press('Escape')
  // Header arrows filter immediately without opening a property editor or storing an empty rule.
  const before = databaseIn(await snapshot())
  await header(scope, type.id).locator('.column-header').click()
  const quick = page.locator('.quick-filter-popover')
  await floating(quick)
  await expect(page.locator('.column-editor-popover')).toHaveCount(0)
  expect(databaseIn(await snapshot()).filters).toEqual(before.filters)
  await quick.getByRole('option', { name: 'Imported choice', exact: true }).click()
  expect(await filteredRows(scope)).toEqual([imported.title])
  await page.keyboard.press('Escape')
  await expect(header(scope, type.id).locator('.column-header')).toBeFocused()
  await header(scope, type.id).locator('.column-header').click()
  await quick
    .getByRole('button', {
      name: text('Clear column filters', 'Сбросить фильтры колонки'),
      exact: true,
    })
    .click()
  await page.keyboard.press('Escape')
  for (const [column, choice, count] of [
    [category.id, 'JWT', 2],
    [status.id, 'Done', 5],
    [relation.id, 'Checked', 1],
    [checkbox.id, text('Unchecked', 'Не отмечено'), 9],
  ]) {
    await header(scope, column).locator('.column-header').click()
    await floating(quick)
    await quick.getByRole('option', { name: choice, exact: true }).click()
    expect((await filteredRows(scope)).length).toBe(count)
    await expect(quick).toBeVisible()
    if (column === category.id)
      await page.screenshot({
        path: path.join(output, `quick-filter-${russian ? 'ru' : 'en'}.png`),
      })
    await quick
      .getByRole('button', {
        name: text('Clear column filters', 'Сбросить фильтры колонки'),
        exact: true,
      })
      .click()
    await page.keyboard.press('Escape')
  }
  // A typed title rule coexists with and survives a different column's quick filter.
  await header(scope, 'title').locator('.column-header').click()
  await quick.getByRole('textbox').fill('Nmap')
  expect(await filteredRows(scope)).toEqual(['Nmap'])
  await page.keyboard.press('Escape')
  await header(scope, category.id).locator('.column-header').click()
  await quick.getByRole('option', { name: 'JWT', exact: true }).click()
  expect(databaseIn(await snapshot()).filters).toHaveLength(2)
  await quick
    .getByRole('button', {
      name: text('Clear column filters', 'Сбросить фильтры колонки'),
      exact: true,
    })
    .click()
  expect(databaseIn(await snapshot()).filters).toEqual([
    { column: 'title', operator: 'contains', value: 'Nmap' },
  ])
  await page.mouse.click(5, 5)
  await expect(quick).toHaveCount(0)
  await header(scope, 'title').locator('.column-header').click()
  await quick
    .getByRole('button', {
      name: text('Clear column filters', 'Сбросить фильтры колонки'),
      exact: true,
    })
    .click()
  await page.keyboard.press('Escape')
  await scope
    .getByRole('button', { name: text('Database properties', 'Свойства базы'), exact: true })
    .click()
  await page
    .locator('.columns-popover')
    .getByRole('button', { name: text('Edit Type', 'Изменить Type'), exact: true })
    .click()
  await expect(page.locator('.column-editor-popover')).toBeVisible()
  await expect(page.locator('.columns-popover')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
}
try {
  await launch()
  const main = page.locator('.database-view')
  await liveResize(main, description.id, 60, 'live-resize-en.png')
  await liveResize(main, 'title', 70)
  const beforeCancel = databaseIn(await snapshot())
  const point = await beginResize(main, description.id)
  await page.mouse.move(point.x + 100, point.y, { steps: 8 })
  await expect(main).toHaveClass(/resizing-database/)
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await expect(main).not.toHaveClass(/resizing-database/)
  expect(databaseIn(await snapshot())).toEqual(beforeCancel)
  const nameHandle = header(main, 'title').locator('.column-resize')
  await nameHandle.focus()
  await page.keyboard.press('ArrowRight')
  expect(databaseIn(await snapshot()).titleWidth).toBe(300)
  await page.keyboard.press('ArrowLeft')
  expect(databaseIn(await snapshot()).titleWidth).toBe(290)
  await editingChecks(main)
  await filterChecks(main)
  checks.push(
    'Live table/colgroup/cell resizing before release, one saved revision, title width/keyboard, Escape rollback, multiline height/wrapping/newlines/draft retention, select/status/multi-select/relation/checkbox filters, imported choices, quick header filters and retained property settings in light English',
  )
  const baseline = await snapshot()
  const gesture = await beginResize(main, description.id)
  await page.mouse.move(gesture.x + 80, gesture.y, { steps: 8 })
  await open(inline.id)
  await page.mouse.up()
  expect(databaseIn(await snapshot())).toEqual(databaseIn(baseline))
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByTitle('Dark', { exact: true }).click()
  await page.getByRole('button', { name: 'Русский', exact: true }).click()
  await page.keyboard.press('Escape')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 720))
  const embed = page.locator('.database-embed .database-view')
  await embed.locator('.database-toolbar').scrollIntoViewIfNeeded()
  await liveResize(embed, description.id, 30, 'live-resize-inline-ru.png')
  await editingChecks(embed, true)
  await filterChecks(embed, true)
  checks.push(
    'Unmount rollback, live resizing and multiline editing in a narrow inline database, compact contained filter popovers and all choice types in dark Russian; user page title Checked remains untranslated',
  )
  const beforeRestart = await snapshot()
  expect(workspaceSchema.safeParse(beforeRestart).success).toBe(true)
  for (const record of records) {
    const actual = beforeRestart.pages.find((page) => page.id === record.id)
    expect(actual.content).toEqual(record.content)
    expect(actual.title).toBe(record.title)
    if (record.id !== nmap.id) expect(actual.properties).toEqual(record.properties)
    else
      for (const column of db.columns.filter((column) => column.id !== description.id))
        expect(actual.properties[column.id]).toEqual(record.properties[column.id])
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
    JSON.stringify(
      {
        checks,
        rendererErrors: errors,
        titleWidth: databaseIn(after).titleWidth,
        descriptionWidth: databaseIn(after).columns.find((column) => column.id === description.id)
          .width,
        restartPreserved: true,
      },
      null,
      2,
    ) + '\n',
  )
  console.log('Passed: ' + checks.join('; ') + '; data preservation and restart.')
} finally {
  await page?.mouse.up().catch(() => {})
  if (app) await close().catch(async () => app?.close())
}
