import { _electron as electron, expect } from '@playwright/test'
import { build } from 'esbuild'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sheco-database-cell-'))
const workspace = path.join(root, 'Knowledge')
const scrollCase = process.env.SHECO_CELL_CASE === 'scroll'
const nameCase = process.env.SHECO_CELL_CASE === 'name'
const output = path.resolve(
  'test-results',
  nameCase ? 'database-name-cell' : scrollCase ? 'database-cell-scroll' : 'database-cell',
)
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
const w = seedWorkspace('Full-height cell review')
const tools = w.pages.find((p) => p.title === 'Tools')
const db = w.databases.find((d) => d.pageId === tools.id)
const records = w.pages.filter((p) => p.databaseId === db.id)
const record = records.find((p) => p.title === 'Nmap')
record.order = -1
if (nameCase)
  record.content = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Retain this document while renaming the database entry.' },
        ],
      },
    ],
  }
const types = [
  'text',
  'email',
  'number',
  'date',
  'url',
  'select',
  'multiSelect',
  'status',
  'relation',
  'checkbox',
  'created',
  'modified',
]
const columns = Object.fromEntries(
  types.map((type) => [
    type,
    {
      id: crypto.randomUUID(),
      name: type,
      type,
      width: 180,
      hidden: false,
      options: ['First', 'Second'],
    },
  ]),
)
db.columns = nameCase
  ? ['text', 'email', 'number', 'date'].map((type) => columns[type])
  : Object.values(columns)
const longText = Array.from(
  { length: scrollCase || nameCase ? 24 : 14 },
  (_, i) => 'Retained line ' + (i + 1),
).join('\n')
const related = createPage(w, 'Related fixture')
const secondRelated = createPage(w, 'Other fixture')
const inline = createPage(w, 'Inline cell review')
inline.content = {
  type: 'doc',
  content: [
    ...(scrollCase || nameCase
      ? Array.from({ length: 20 }, (_, i) => ({
          type: 'paragraph',
          content: [{ type: 'text', text: 'Before database ' + i }],
        }))
      : []),
    { type: 'databaseEmbed', attrs: { pageId: tools.id, label: tools.title } },
    ...(scrollCase || nameCase
      ? Array.from({ length: 12 }, (_, i) => ({
          type: 'paragraph',
          content: [{ type: 'text', text: 'After database ' + i }],
        }))
      : []),
    { type: 'paragraph' },
  ],
}
w.pages.push(related, secondRelated, inline)
const initial = {
  text: longText,
  email: 'initial@example.test',
  number: 12,
  date: '2026-09-29',
  url: 'https://example.test',
  select: 'First',
  multiSelect: ['First'],
  status: 'First',
  relation: related.id,
  checkbox: false,
}
for (const p of records) p.properties = {}
for (const [type, value] of Object.entries(initial)) record.properties[columns[type].id] = value
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
const errors = [],
  checks = []
async function launch() {
  app = await electron.launch({ args: ['.'], env: { ...process.env, SHECO_DATA_DIR: root } })
  page = await app.firstWindow()
  page.on('pageerror', (error) => errors.push(error.message))
  await expect(page.locator('.page-title')).toBeVisible({ timeout: 20000 })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 900))
}
async function snapshot() {
  await expect(page.locator('.save-status')).toHaveClass(/\bsaved\b/)
  return JSON.parse(await fs.readFile(path.join(workspace, 'workspace.json'), 'utf8'))
}
const current = async () => (await snapshot()).pages.find((p) => p.id === record.id)
async function stored(type, value) {
  await expect.poll(async () => (await current()).properties[columns[type].id]).toEqual(value)
}
async function close() {
  await snapshot()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await app.close()
  app = null
}
async function open(id) {
  await page.evaluate(
    (id) => window.dispatchEvent(new CustomEvent('open-page', { detail: { id } })),
    id,
  )
  await expect(page.locator('.page-title')).toHaveValue(w.pages.find((p) => p.id === id).title)
}
const row = (scope) =>
  scope
    .locator('.database-table tbody tr')
    .filter({ has: page.locator('.record-title', { hasText: /^Nmap$/ }) })
const cell = (scope, type) =>
  row(scope)
    .locator('td')
    .nth(types.indexOf(type) + 1)
async function bottom(scope, type) {
  const td = cell(scope, type)
  await td.scrollIntoViewIfNeeded()
  const box = await td.boundingBox()
  expect(box.height).toBeGreaterThan(200)
  await page.mouse.click(box.x + box.width / 2, box.y + box.height - 12)
}
async function inputChecks(scope, type, next, original) {
  const td = cell(scope, type),
    input = td.locator('input')
  await bottom(scope, type)
  await expect(input).toBeFocused()
  await input.fill(String(next))
  await page.keyboard.press('Escape')
  await expect(input).toHaveCount(0)
  await stored(type, original)
  await bottom(scope, type)
  await input.fill(String(next))
  await bottom(scope, type)
  await expect(input).toBeFocused()
  await expect(input).toHaveValue(String(next))
  await stored(type, original)
  await page.keyboard.press('Enter')
  await stored(type, next)
  await bottom(scope, type)
  await expect(input).toBeFocused()
  await page.keyboard.press('Escape')
}
async function choice(scope, type, name) {
  await bottom(scope, type)
  const menu = page.locator('.property-popover')
  await expect(menu).toBeVisible()
  const box = await menu.boundingBox()
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  expect(box.x).toBeGreaterThanOrEqual(8)
  expect(box.y).toBeGreaterThanOrEqual(8)
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width - 7)
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height - 7)
  await menu.getByRole('button', { name, exact: true }).click()
  if (type === 'multiSelect') await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
}
async function readOnlyChecks(scope) {
  for (const type of ['created', 'modified']) {
    const before = await current()
    await bottom(scope, type)
    await expect(cell(scope, type).locator('input,textarea')).toHaveCount(0)
    expect(await current()).toEqual(before)
    expect(await cell(scope, type).locator('.property-field').getAttribute('title')).toMatch(
      /Automatically managed|Заполняется автоматически/,
    )
  }
}
async function scrollChecks(scope, label) {
  const scroller = page.locator('.content-scroll')
  const tableScroller = scope.locator('.database-scroll')
  const offsets = async () => ({
    content: await scroller.evaluate((element) => ({
      top: element.scrollTop,
      left: element.scrollLeft,
    })),
    database: await tableScroller.evaluate((element) => ({
      top: element.scrollTop,
      left: element.scrollLeft,
    })),
    row: await row(scope).boundingBox(),
  })
  for (const [type, offset] of [
    ['text', 145],
    ['number', 145],
    ['email', 145],
    ['date', 145],
    ['url', 145],
    ['text', -150],
    ['text', 350],
  ]) {
    const td = cell(scope, type)
    await td.evaluate((td, offset) => {
      const content = td.closest('.content-scroll')
      const database = td.closest('.database-scroll')
      database.scrollLeft +=
        td.getBoundingClientRect().left - database.getBoundingClientRect().left - 60
      content.scrollTop +=
        td.getBoundingClientRect().top - content.getBoundingClientRect().top - offset
    }, offset)
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    )
    const before = await offsets()
    const tdBox = await td.boundingBox(),
      viewport = await scroller.boundingBox()
    const y = Math.min(tdBox.y + tdBox.height - 12, viewport.y + viewport.height - 35)
    expect(y).toBeGreaterThan(Math.max(tdBox.y, viewport.y) + 10)
    await page.mouse.click(tdBox.x + tdBox.width / 2, y)
    const editor = td.locator('input,textarea')
    await expect(editor).toBeFocused()
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    )
    const after = await offsets()
    await fs.writeFile(
      path.join(output, 'latest-offsets.json'),
      JSON.stringify({ label, type, offset, before, after }, null, 2),
    )
    if (type === 'text' && offset === 145)
      await page.screenshot({ path: path.join(output, label + '-multiline.png') })
    expect(after.content).toEqual(before.content)
    expect(after.database).toEqual(before.database)
    expect(after.row.y).toBeCloseTo(before.row.y, 0)
    expect(after.row.height).toBeCloseTo(before.row.height, 0)
    await page.mouse.click(tdBox.x + tdBox.width - 12, y)
    await expect(editor).toBeFocused()
    expect((await offsets()).content).toEqual(before.content)
    await page.keyboard.press('Escape')
    await expect(editor).toHaveCount(0)
    expect((await offsets()).content).toEqual(before.content)
  }
  checks.push(
    label +
      ': opening editors retains vertical/horizontal scroll and row geometry, including partially visible multiline cells and repeated blank-area clicks',
  )
}
const nameRow = (scope) =>
  scope
    .locator('.database-table tbody tr')
    .filter({ has: page.locator('.property-text', { hasText: 'Retained line 24' }) })
async function namePointer(scope, offset = 145, modifier = false) {
  const td = nameRow(scope).locator('td').first()
  await td.evaluate((td, offset) => {
    const content = td.closest('.content-scroll'),
      database = td.closest('.database-scroll')
    database.scrollLeft = 0
    content.scrollTop +=
      td.getBoundingClientRect().top - content.getBoundingClientRect().top - offset
  }, offset)
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
  const box = await td.boundingBox(),
    viewport = await page.locator('.content-scroll').boundingBox()
  const before = await page.locator('.content-scroll').evaluate((element) => element.scrollTop)
  const y = Math.min(box.y + box.height - 12, viewport.y + viewport.height - 35)
  await fs.writeFile(
    path.join(output, 'name-pointer-diagnostic.json'),
    JSON.stringify(
      {
        offset,
        modifier,
        box,
        viewport,
        before,
        browser: await page.evaluate(
          ({ x, y }) => ({
            width: innerWidth,
            height: innerHeight,
            hit: document.elementFromPoint(x, y)?.outerHTML.slice(0, 300),
          }),
          { x: box.x + box.width / 2, y },
        ),
      },
      null,
      2,
    ),
  )
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
  if (modifier) await page.keyboard.down(mod)
  try {
    await page.mouse.click(box.x + box.width / 2, y)
  } finally {
    if (modifier) await page.keyboard.up(mod)
  }
  if (!modifier) {
    await expect(td.locator('.record-title-input')).toBeFocused()
    expect(await page.locator('.content-scroll').evaluate((element) => element.scrollTop)).toBe(
      before,
    )
  }
  return { td, box, y }
}
async function nameChecks(scope, label) {
  const before = await current()
  const { td, box, y } = await namePointer(scope)
  const input = td.locator('.record-title-input')
  await expect(input).toHaveValue(before.title)
  expect(await input.evaluate((element) => [element.selectionStart, element.selectionEnd])).toEqual(
    [0, before.title.length],
  )
  const dimensions = await td.evaluate((td) => ({
    cell: td.clientHeight,
    field: td.querySelector('.record-name').getBoundingClientRect().height,
  }))
  expect(Math.abs(dimensions.cell - dimensions.field)).toBeLessThanOrEqual(1)
  await input.fill('Draft name')
  await page.mouse.click(box.x + box.width - 12, y)
  await expect(input).toBeFocused()
  await expect(input).toHaveValue('Draft name')
  expect((await current()).title).toBe(before.title)
  await page.keyboard.press('Escape')
  await expect(input).toHaveCount(0)
  expect((await current()).title).toBe(before.title)
  await namePointer(scope, -150)
  await page.keyboard.press('Escape')
  await namePointer(scope)
  await input.fill('Saved name')
  await page.keyboard.press('Enter')
  await expect.poll(async () => (await current()).title).toBe('Saved name')
  await expect(td.locator('.record-title')).toHaveText('Saved name')
  await namePointer(scope)
  await page.screenshot({ path: path.join(output, label + '.png') })
  await input.fill(before.title)
  await page.keyboard.press('Enter')
  await expect.poll(async () => (await current()).title).toBe(before.title)
  await td.locator('.record-title').focus()
  await page.keyboard.press('Enter')
  await expect(input).toBeFocused()
  await page.keyboard.press('Escape')
  await td.locator('.row-handle').click()
  await expect(input).toHaveCount(0)
  const parent = await page.locator('.page-title').inputValue()
  await td.locator('.open-record-button').click()
  await expect(page.locator('.page-title')).toHaveValue(before.title)
  await open(w.pages.find((p) => p.title === parent).id)
  await namePointer(scope, 145, true)
  await expect(page.locator('.page-title')).toHaveValue(before.title)
  await open(w.pages.find((p) => p.title === parent).id)
  expect((await current()).properties).toEqual(before.properties)
  expect((await current()).content).toEqual(before.content)
  expect((await current()).order).toBe(before.order)
  checks.push(
    label +
      ': full-height Name editing, focus/selection without scroll, draft retention, cancellation/save, keyboard editing, separate opening/modifier action and handle clicks',
  )
}
async function nameExportCheck() {
  await page.emulateMedia({ media: 'print' })
  const title = nameRow(page.locator('.database-view')).locator('.record-title')
  await expect(title).toHaveText('Nmap')
  expect(await title.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
    true,
  )
  await page.emulateMedia({ media: null })
  const file = path.join(root, 'database-name.pdf')
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file })
  }, file)
  await page.getByRole('button', { name: 'Page options', exact: true }).click()
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  await page.getByRole('menuitem', { name: 'PDF (.pdf)', exact: true }).click()
  await expect
    .poll(async () =>
      fs
        .stat(file)
        .then((info) => info.size)
        .catch(() => 0),
    )
    .toBeGreaterThan(1000)
  expect((await fs.readFile(file)).subarray(0, 4).toString()).toBe('%PDF')
  await fs.copyFile(file, path.join(output, 'database-name.pdf'))
  const prefix = path.join(root, 'database-name')
  execFileSync('pdftoppm', ['-f', '1', '-l', '1', '-singlefile', '-r', '100', '-png', file, prefix])
  await fs.copyFile(prefix + '.png', path.join(output, 'database-name-export.png'))
  await expect(page.locator('.toast')).toHaveCount(0, { timeout: 10000 })
  checks.push(
    'Print layout fits the record name; actual database PDF exported and rasterized for inspection',
  )
}
async function review() {
  await launch()
  if (nameCase) {
    const baseline = await snapshot()
    await nameChecks(page.locator('.database-view'), 'page-light-en')
    await nameExportCheck()
    await open(inline.id)
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByTitle('Dark', { exact: true }).click()
    await page.getByRole('button', { name: 'Русский', exact: true }).click()
    await page.keyboard.press('Escape')
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 720))
    await expect.poll(() => page.evaluate(() => innerWidth)).toBe(900)
    await nameChecks(page.locator('.database-embed .database-view'), 'inline-dark-ru')
    const beforeRestart = await snapshot()
    for (const original of baseline.pages) {
      const after = beforeRestart.pages.find((p) => p.id === original.id)
      expect(after.title).toBe(original.title)
      expect(after.order).toBe(original.order)
      expect(after.properties).toEqual(original.properties)
      expect(after.content).toEqual(original.content)
    }
    expect(beforeRestart.databases).toEqual(baseline.databases)
    await close()
    await launch()
    const after = await snapshot()
    expect(after.pages).toEqual(beforeRestart.pages)
    expect(after.databases).toEqual(beforeRestart.databases)
    expect(after.ui).toEqual(beforeRestart.ui)
    expect(errors).toEqual([])
    await fs.writeFile(
      path.join(output, 'verification.json'),
      JSON.stringify({ checks, rendererErrors: errors, restartPreserved: true }, null, 2) + '\n',
    )
    console.log('Passed: ' + checks.join('; ') + '; preserved data and restart.')
    return
  }
  if (scrollCase) {
    const baseline = await snapshot()
    await open(inline.id)
    await scrollChecks(page.locator('.database-embed .database-view'), 'inline-light-en')
    await open(tools.id)
    await scrollChecks(page.locator('.database-view'), 'page-light-en')
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByTitle('Dark', { exact: true }).click()
    await page.getByRole('button', { name: 'Русский', exact: true }).click()
    await page.keyboard.press('Escape')
    await open(inline.id)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 720))
    await scrollChecks(page.locator('.database-embed .database-view'), 'inline-dark-ru')
    const after = await snapshot()
    expect(after.pages).toEqual(baseline.pages)
    expect(after.databases).toEqual(baseline.databases)
    expect(errors).toEqual([])
    await fs.writeFile(
      path.join(output, 'verification.json'),
      JSON.stringify(
        { checks, rendererErrors: errors, unchangedPagesAndDatabases: true },
        null,
        2,
      ) + '\n',
    )
    console.log('Passed: ' + checks.join('; '))
    return
  }
  const main = page.locator('.database-view')
  // Reproduce the user's pointer trigger before inspecting any sizing implementation.
  await bottom(main, 'email')
  await expect(cell(main, 'email').locator('input')).toBeFocused()
  await page.keyboard.press('Escape')
  for (const type of types) {
    const dimensions = await cell(main, type).evaluate((td) => ({
      cell: td.clientHeight,
      field: td.querySelector('.property-field').getBoundingClientRect().height,
    }))
    expect(Math.abs(dimensions.cell - dimensions.field)).toBeLessThanOrEqual(1)
  }
  for (const [type, next] of Object.entries({
    email: 'saved@example.test',
    number: 45,
    date: '2026-10-09',
    url: 'https://example.test/updated',
  })) {
    await inputChecks(main, type, next, initial[type])
  }
  // An empty value still leaves the whole cell available for editing.
  await bottom(main, 'email')
  await cell(main, 'email').locator('input').fill('')
  await page.keyboard.press('Enter')
  await stored('email', '')
  await inputChecks(main, 'email', 'saved@example.test', '')
  checks.push(
    'Email, number, date and URL: lower-cell pointer editing, empty values, cancellation, retained unsaved drafts, saving and reopening',
  )
  for (const type of ['select', 'status']) {
    await choice(main, type, 'Second')
    await stored(type, 'Second')
  }
  await choice(main, 'multiSelect', 'Second')
  await stored('multiSelect', ['First', 'Second'])
  await choice(main, 'relation', secondRelated.title)
  await stored('relation', secondRelated.id)
  await cell(main, 'relation').locator('.relation').click()
  await expect(page.locator('.page-title')).toHaveValue(secondRelated.title)
  await open(tools.id)
  await bottom(main, 'checkbox')
  await stored('checkbox', true)
  await cell(main, 'checkbox').locator('input').click()
  await stored('checkbox', false)
  await readOnlyChecks(main)
  expect((await current()).createdAt).toBe(record.createdAt)
  checks.push(
    'Choice/status/multi-select/relation menus and checkbox use the full height; relation links still open pages; automatic timestamps stay read-only',
  )
  await bottom(main, 'text')
  const textarea = cell(main, 'text').locator('textarea')
  await expect(textarea).toBeFocused()
  await expect(textarea).toHaveValue(longText)
  await page.screenshot({ path: path.join(output, 'full-height-light-en.png') })
  await page.keyboard.press('Escape')
  await bottom(main, 'text')
  await textarea.fill('Short')
  await page.keyboard.press('Enter')
  await stored('text', 'Short')
  await expect.poll(async () => (await row(main).boundingBox()).height).toBeLessThan(100)
  await cell(main, 'text').locator('.property-field').click()
  await textarea.fill(longText)
  await page.keyboard.press('Enter')
  await stored('text', longText)
  checks.push(
    'Multiline editor keeps the tall cell and row height shrinks again after a short value is saved',
  )
  await app.evaluate(({ shell }) => {
    globalThis.cellExternal = []
    shell.openExternal = async (url) => {
      globalThis.cellExternal.push(url)
    }
  })
  await cell(main, 'url')
    .locator('.property-link')
    .click({ modifiers: [process.platform === 'darwin' ? 'Meta' : 'Control'] })
  await cell(main, 'email')
    .locator('.property-link')
    .click({ modifiers: [process.platform === 'darwin' ? 'Meta' : 'Control'] })
  await expect
    .poll(() => app.evaluate(() => globalThis.cellExternal))
    .toEqual(['https://example.test/updated', 'mailto:saved@example.test'])
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByTitle('Dark', { exact: true }).click()
  await page.getByRole('button', { name: 'Русский', exact: true }).click()
  await page.keyboard.press('Escape')
  await open(inline.id)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 720))
  const embed = page.locator('.database-embed .database-view')
  await inputChecks(embed, 'number', 67, 45)
  await choice(embed, 'status', 'First')
  await stored('status', 'First')
  await readOnlyChecks(embed)
  await bottom(embed, 'date')
  await expect(cell(embed, 'date').locator('input')).toBeFocused()
  await page.screenshot({ path: path.join(output, 'full-height-inline-dark-ru.png') })
  await page.keyboard.press('Escape')
  checks.push(
    'Modifier links, dark Russian, narrow inline database, horizontal scrolling and contained choice popovers',
  )
  const beforeRestart = await snapshot()
  expect(workspaceSchema.safeParse(beforeRestart).success).toBe(true)
  expect(beforeRestart.databases).toEqual(w.databases)
  for (const original of w.pages) {
    const after = beforeRestart.pages.find((p) => p.id === original.id)
    expect(after.content).toEqual(original.content)
    if (original.id !== record.id) expect(after.properties).toEqual(original.properties)
  }
  await close()
  await launch()
  const afterRestart = await snapshot()
  expect(afterRestart.pages).toEqual(beforeRestart.pages)
  expect(afterRestart.databases).toEqual(beforeRestart.databases)
  expect(afterRestart.ui).toEqual(beforeRestart.ui)
  expect(errors).toEqual([])
  await fs.writeFile(
    path.join(output, 'verification.json'),
    JSON.stringify({ checks, rendererErrors: errors, restartPreserved: true }, null, 2) + '\n',
  )
  console.log('Passed: ' + checks.join('; ') + '; saved state preserved after restart.')
}
try {
  await review()
} catch (error) {
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {})
  throw error
} finally {
  if (app) await close().catch(async () => app?.close())
}
