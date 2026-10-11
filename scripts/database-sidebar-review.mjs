import { _electron as electron, expect } from '@playwright/test'
import { build } from 'esbuild'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sheco-database-sidebar-'))
const knowledge = path.join(root, 'Knowledge')
const output = path.resolve('test-results/database-sidebar')
await fs.mkdir(knowledge, { recursive: true })
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
const w = seedWorkspace('Database and sidebar review')
const tools = w.pages.find((p) => p.title === 'Tools')
const db = w.databases.find((d) => d.pageId === tools.id)
const p = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
function add(title, parentId = null) {
  const page = createPage(w, title, parentId)
  page.content = { type: 'doc', content: [p('Retain content: ' + title)] }
  w.pages.push(page)
  return page
}
const learning = add('Learning reorder')
const arsenal = add('2. Arsenal', learning.id)
const info = add('3. Information', learning.id)
const tasks = add('Tasks', learning.id)
const task = add('Nested task', tasks.id)
const scan = add('5. Scanning', learning.id)
const development = add('Development reorder')
const inline = add('Inline database')
inline.content = {
  type: 'doc',
  content: [
    ...Array.from({ length: 16 }, (_, i) => p('Before database ' + i)),
    { type: 'databaseEmbed', attrs: { pageId: tools.id, label: tools.title } },
    ...Array.from({ length: 16 }, (_, i) => p('After database ' + i)),
  ],
}
w.ui.expanded = [...w.ui.expanded, learning.id, tasks.id, tools.id]
w.ui.activeId = tools.id
w.ui.tabs = [tools.id, inline.id]
await fs.writeFile(path.join(knowledge, 'workspace.json'), JSON.stringify(w, null, 2))
await fs.writeFile(
  path.join(root, 'spaces.json'),
  JSON.stringify({
    activeId: w.id,
    spaces: [{ id: w.id, name: w.name, icon: w.icon, path: knowledge }],
  }),
)
let app
let page
const errors = []
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
  return JSON.parse(await fs.readFile(path.join(knowledge, 'workspace.json'), 'utf8'))
}
async function close() {
  await saved()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await app.close()
  app = null
}
async function floating(locator) {
  await expect(locator).toBeVisible()
  expect(await locator.evaluate((el) => el.parentElement === document.body)).toBe(true)
  const box = await locator.boundingBox()
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  expect(box.x).toBeGreaterThanOrEqual(8)
  expect(box.y).toBeGreaterThanOrEqual(8)
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width - 7)
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height - 7)
}
const treeRow = (title) =>
  page.locator('.page-tree .tree-row').filter({
    has: page.getByRole('button', { name: title, exact: true }),
  })
async function startDrag(from, target, fraction = 0.5) {
  await from.scrollIntoViewIfNeeded()
  await target.scrollIntoViewIfNeeded()
  const a = await from.boundingBox()
  const b = await target.boundingBox()
  await page.mouse.move(a.x + 65, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(a.x + 80, a.y + a.height / 2, { steps: 5 })
  await page.mouse.move(b.x + 65, b.y + b.height * fraction, { steps: 15 })
  await page.mouse.move(b.x + 66, b.y + b.height * fraction)
}
async function drop(from, target, position, screenshot) {
  await startDrag(from, target, position === 'before' ? 0.1 : position === 'after' ? 0.9 : 0.5)
  const isRoot = await target.evaluate((el) => el.matches('.sidebar-add'))
  const marker = position === 'inside' ? target : target.locator('..')
  await expect(marker).toHaveClass(new RegExp(isRoot ? 'drop-target' : 'tree-drop-' + position))
  if (position !== 'inside') {
    expect(await marker.evaluate((el) => getComputedStyle(el, '::after').height)).toBe('2px')
  }
  if (screenshot) await page.screenshot({ path: path.join(output, screenshot) })
  await page.mouse.up()
  await expect(
    page.locator('.tree-dragging, .tree-drop-before, .tree-drop-after, .tree-drop-inside'),
  ).toHaveCount(0)
  await saved()
}
const titles = (workspace, parentId) =>
  workspace.pages
    .filter((p) => !p.deletedAt && p.parentId === parentId)
    .sort((a, b) => a.order - b.order)
    .map((p) => p.title)
async function databaseChecks(scope, language) {
  const ru = language === 'ru'
  await scope.locator('.database-toolbar').scrollIntoViewIfNeeded()
  const filterButton = scope.getByTitle(ru ? 'Фильтр записей' : 'Filter entries', { exact: true })
  await filterButton.click()
  const filters = page.locator('.filter-popover')
  await floating(filters)
  await filters
    .getByRole('button', { name: ru ? 'Добавить фильтр' : 'Add filter', exact: true })
    .click()
  await expect(filters.locator('select')).toHaveCount(0)
  const property = filters.getByRole('button', {
    name: ru ? 'Свойство фильтра' : 'Filter property',
    exact: true,
  })
  await property.focus()
  await page.keyboard.press('ArrowDown')
  const choices = page.locator('.database-picker-popover')
  await floating(choices)
  await page.getByRole('option', { name: 'Type', exact: true }).click()
  await expect(filters).toBeVisible()
  await expect(property).toBeFocused()
  const operator = filters.getByRole('button', {
    name: ru ? 'Условие фильтра' : 'Filter operator',
    exact: true,
  })
  await operator.click()
  await floating(choices)
  await page.keyboard.press('Home')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(operator).toHaveText(ru ? 'равно' : 'is')
  await filters
    .getByRole('textbox', { name: ru ? 'Значение фильтра' : 'Filter value', exact: true })
    .fill('Utility')
  let current = await snapshot()
  const currentDB = current.databases.find((d) => d.id === db.id)
  expect(currentDB.filters).toEqual([
    { column: db.columns.find((c) => c.name === 'Type').id, operator: 'equals', value: 'Utility' },
  ])
  await expect(scope.locator('.database-table tbody tr')).toHaveCount(
    databaseRows(current, currentDB).length,
  )
  await property.click()
  await page.keyboard.press('Escape')
  await expect(choices).toHaveCount(0)
  await expect(property).toBeFocused()
  await expect(filters).toBeVisible()
  await operator.click()
  await page.getByRole('option', { name: ru ? 'пусто' : 'is empty', exact: true }).click()
  await expect(filters.getByRole('textbox')).toHaveCount(0)
  await operator.click()
  await page.getByRole('option', { name: ru ? 'не пусто' : 'is not empty', exact: true }).click()
  await expect(scope.locator('.database-table tbody tr')).toHaveCount(
    w.pages.filter((p) => p.databaseId === db.id).length,
  )
  await operator.click()
  await page.screenshot({ path: path.join(output, `filter-${language}.png`) })
  await page.keyboard.press('Escape')
  await filters
    .getByRole('button', { name: ru ? 'Сбросить все фильтры' : 'Clear all filters', exact: true })
    .click()
  await page.keyboard.press('Escape')
  await expect(filters).toHaveCount(0)
  await expect(scope.locator('.database-footer')).toContainText(ru ? '5 свойств' : '5 properties')
  await expect(scope.locator('.database-footer')).not.toContainText(
    ru ? 'Каждая запись' : 'Each entry',
  )
  const tag = scope.locator('.property-field .tag').first()
  expect(
    await tag.evaluate((el) => ({
      font: getComputedStyle(el).fontSize,
      height: el.getBoundingClientRect().height,
      padding: getComputedStyle(el).paddingLeft,
    })),
  ).toEqual({ font: '11px', height: 18, padding: '5px' })
  await scope
    .getByRole('button', { name: ru ? 'Свойства базы' : 'Database properties', exact: true })
    .click()
  const settings = page.locator('.columns-popover')
  await floating(settings)
  const settingsWidth = (await settings.boundingBox()).width
  await settings
    .getByRole('button', { name: ru ? 'Изменить Link' : 'Edit Link', exact: true })
    .click()
  const edit = page.locator('.column-editor-popover')
  await floating(edit)
  await expect(settings).toBeVisible()
  expect(
    await edit.evaluate((el) => {
      const parent = document.querySelector('.columns-popover')
      return el.dataset.popoverOwners
        .split(' ')
        .includes(parent.dataset.popoverOwners.split(' ').at(-1))
    }),
  ).toBe(true)
  expect((await edit.boundingBox()).width).toBe(settingsWidth)
  expect((await edit.boundingBox()).height).toBeLessThan(270)
  await edit
    .getByRole('button', { name: ru ? 'Тип свойства' : 'Property type', exact: true })
    .click()
  await floating(page.locator('.property-type-popover'))
  await page.keyboard.press('Escape')
  await expect(edit).toBeVisible()
  await expect(settings).toBeVisible()
  await page.screenshot({ path: path.join(output, `property-${language}.png`) })
  await edit.getByRole('button', { name: ru ? 'Отмена' : 'Cancel', exact: true }).click()
  await expect(edit).toHaveCount(0)
  await expect(settings).toBeVisible()
  await expect(
    settings.getByRole('button', { name: ru ? 'Изменить Link' : 'Edit Link', exact: true }),
  ).toBeFocused()
  // Saving, cancelling and Escape return to the original properties menu.
  await settings
    .getByRole('button', { name: ru ? 'Изменить Link' : 'Edit Link', exact: true })
    .click()
  await edit.getByRole('textbox').first().fill('Link revised')
  await edit
    .getByRole('button', { name: ru ? 'Сохранить свойство' : 'Save property', exact: true })
    .click()
  await expect(edit).toHaveCount(0)
  await expect(settings).toBeVisible()
  await expect(settings).toContainText('Link revised')
  await settings
    .getByRole('button', { name: ru ? 'Изменить Link revised' : 'Edit Link revised', exact: true })
    .click()
  await edit.getByRole('textbox').first().fill('Link')
  await edit
    .getByRole('button', { name: ru ? 'Сохранить свойство' : 'Save property', exact: true })
    .click()
  await settings
    .getByRole('button', { name: ru ? 'Добавить свойство' : 'Add property', exact: true })
    .click()
  await expect(edit).toBeVisible()
  await expect(settings).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(edit).toHaveCount(0)
  await expect(settings).toBeVisible()
  await settings
    .getByRole('button', { name: ru ? 'Изменить Link' : 'Edit Link', exact: true })
    .click()
  await edit.getByRole('button', { name: ru ? 'Закрыть' : 'Close', exact: true }).click()
  await expect(edit).toHaveCount(0)
  await expect(settings).toBeVisible()
  await settings
    .getByRole('button', { name: ru ? 'Изменить Link' : 'Edit Link', exact: true })
    .click()
  await page.mouse.click(5, 5)
  await expect(edit).toHaveCount(0)
  await expect(settings).toHaveCount(0)
  // Sort pickers use the same nested menu behavior and preserve manual page order.
  const pageOrders = (await snapshot()).pages.map((p) => [p.id, p.order])
  await scope.getByTitle(ru ? 'Сортировка записей' : 'Sort entries', { exact: true }).click()
  const sort = page.locator('.sort-popover')
  await floating(sort)
  await expect(sort.locator('select')).toHaveCount(0)
  const sortProperty = sort.getByRole('button', {
    name: ru ? 'Свойство сортировки' : 'Sort property',
    exact: true,
  })
  await sortProperty.focus()
  await page.keyboard.press('ArrowDown')
  await floating(choices)
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(sortProperty).toBeFocused()
  await expect(sort).toBeVisible()
  const direction = sort.getByRole('button', {
    name: ru ? 'Направление сортировки' : 'Sort direction',
    exact: true,
  })
  async function sortedRows(column, order) {
    const current = await snapshot()
    const currentDB = current.databases.find((d) => d.id === db.id)
    expect(currentDB.sort).toEqual({ column, direction: order })
    expect(await scope.locator('.record-title').allTextContents()).toEqual(
      databaseRows(current, currentDB).map((p) => p.title),
    )
  }
  await sortedRows('title', 'asc')
  await direction.click()
  await floating(choices)
  await page.getByRole('option', { name: ru ? 'По убыванию' : 'Descending', exact: true }).click()
  await sortedRows('title', 'desc')
  await sortProperty.click()
  await page.getByRole('option', { name: 'Type', exact: true }).click()
  await sortedRows(db.columns.find((c) => c.name === 'Type').id, 'desc')
  await sortProperty.click()
  await page.screenshot({ path: path.join(output, `sort-${language}.png`) })
  await page.keyboard.press('Escape')
  await expect(choices).toHaveCount(0)
  await expect(sortProperty).toBeFocused()
  await expect(sort).toBeVisible()
  await sortProperty.click()
  await page
    .getByRole('option', { name: ru ? 'Ручной порядок' : 'Manual order', exact: true })
    .click()
  await expect(direction).toHaveCount(0)
  const manual = await snapshot()
  expect(manual.databases.find((d) => d.id === db.id).sort).toBe(null)
  expect(manual.pages.map((p) => [p.id, p.order])).toEqual(pageOrders)
  await page.keyboard.press('Escape')
  await expect(sort).toHaveCount(0)
  await saved()
}
try {
  await launch()
  await page.getByRole('tab').filter({ hasText: inline.title }).click()
  await page.getByRole('tab').filter({ hasText: tools.title }).click()
  const baseline = (await snapshot()).pages
  await databaseChecks(page.locator('.database-view'), 'en')
  console.log(
    'Database: custom filter selection/keyboard/Escape, values and compact property editor, light English',
  )
  await drop(treeRow(scan.title), treeRow(arsenal.title), 'before', 'sidebar-before-en.png')
  expect(titles(await snapshot(), learning.id)).toEqual([
    '5. Scanning',
    '2. Arsenal',
    '3. Information',
    'Tasks',
  ])
  await drop(treeRow(scan.title), treeRow(tasks.title), 'after', 'sidebar-after-en.png')
  expect(titles(await snapshot(), learning.id)).toEqual([
    '2. Arsenal',
    '3. Information',
    'Tasks',
    '5. Scanning',
  ])
  await drop(treeRow(tasks.title), treeRow(development.title), 'inside', 'sidebar-inside-en.png')
  let current = await snapshot()
  expect(titles(current, development.id)).toEqual(['Tasks'])
  expect(current.pages.find((p) => p.id === task.id).parentId).toBe(tasks.id)
  expect(current.ui.expanded).toContain(development.id)
  await drop(treeRow(development.title), treeRow(learning.title), 'before')
  current = await snapshot()
  const roots = titles(current, null)
  expect(roots.indexOf(development.title)).toBe(roots.indexOf(learning.title) - 1)
  const beforeInvalid = current.pages
  await startDrag(treeRow(development.title), treeRow(task.title))
  await expect(page.locator('.tree-drop-inside, .tree-drop-before, .tree-drop-after')).toHaveCount(
    0,
  )
  await page.mouse.up()
  expect((await snapshot()).pages).toEqual(beforeInvalid)
  await expect(treeRow('Nmap')).toHaveAttribute('draggable', 'false')
  await drop(treeRow(scan.title), page.locator('.sidebar-add'), 'inside')
  expect((await snapshot()).pages.find((p) => p.id === scan.id).parentId).toBe(null)
  console.log('Sidebar: native pointer reorder, subtrees, nesting, invalid cycle rejection')
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByTitle('Dark', { exact: true }).click()
  await page.getByRole('button', { name: 'Русский', exact: true }).click()
  await page.keyboard.press('Escape')
  await page.getByRole('tab').filter({ hasText: inline.title }).click()
  const scope = page.locator('.database-embed .database-view')
  await scope.locator('.database-toolbar').scrollIntoViewIfNeeded()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 720))
  await databaseChecks(scope, 'ru')
  await scope.screenshot({ path: path.join(output, 'database-dark-ru.png') })
  await drop(treeRow(arsenal.title), treeRow(info.title), 'after', 'sidebar-after-ru.png')
  current = await snapshot()
  expect(titles(current, learning.id)).toEqual(['3. Information', '2. Arsenal'])
  for (const original of baseline) {
    const actual = current.pages.find((p) => p.id === original.id)
    expect(actual.content).toEqual(original.content)
    expect(actual.properties).toEqual(original.properties)
  }
  expect(workspaceSchema.safeParse(current).success).toBe(true)
  const persisted = current.pages
  await close()
  await launch()
  expect((await snapshot()).pages).toEqual(persisted)
  expect(errors).toEqual([])
  console.log(
    'Passed: database controls, footer/tags, nested popovers, native sidebar drops, saved order/content after restart, light English and narrow dark Russian inline database',
  )
  await fs.writeFile(
    path.join(output, 'verification.json'),
    JSON.stringify({ fixture: root, errors, passed: true }, null, 2),
  )
} catch (error) {
  if (page) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {})
  console.error('Preserved fixture:', root)
  throw error
} finally {
  if (app) await close().catch(() => app?.close())
}
