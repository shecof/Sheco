import { _electron as electron, expect } from '@playwright/test'
import { build } from 'esbuild'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sheco-tables-'))
const workspace = path.join(root, 'Knowledge')
const output = path.resolve('test-results/tables')
await fs.mkdir(workspace)
await fs.mkdir(output, { recursive: true })
const bundled = await build({
  stdin: {
    contents: "export { seedWorkspace } from './src/shared/seed'",
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
})
const modulePath = path.join(root, 'seed.mjs')
await fs.writeFile(modulePath, bundled.outputFiles[0].contents)
const { seedWorkspace } = await import(pathToFileURL(modulePath).href)
const w = seedWorkspace('Table review', false)
const note = w.pages[0]
note.title = 'Table controls'
note.description = 'Rows, columns, headers, and comfortable reading'
const text = (text, marks) => ({ type: 'text', text, ...(marks ? { marks } : {}) })
const p = (value) => ({ type: 'paragraph', content: value ? [text(value)] : [] })
const table = (prefix, widths = null) => ({
  type: 'table',
  content: Array.from({ length: 3 }, (_, row) => ({
    type: 'tableRow',
    content: Array.from({ length: 3 }, (_, col) => ({
      type: row ? 'tableCell' : 'tableHeader',
      attrs: { colwidth: widths ? [widths[col]] : null },
      content: [p(prefix + (row ? `${col + 1}.${row}` : ['Source', 'Description', 'Status'][col]))],
    })),
  })),
})
note.content = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [text('Useful context')] },
    p('Select this short text from its trailing whitespace.'),
    {
      type: 'paragraph',
      content: [text('BOLA', [{ type: 'link', attrs: { href: 'https://example.com' } }])],
    },
    p(''),
    table('', [100, 150, 200]),
    p('Between the tables'),
    table('Other ', [90, 0, 160]),
    ...Array.from({ length: 15 }, (_, i) =>
      p(`Paragraph ${i + 1}. Keep the controls attached to the table while scrolling.`),
    ),
  ],
}
w.ui.tabs = [note.id]
w.ui.activeId = note.id
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
const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
async function launch() {
  app = await electron.launch({ args: ['.'], env: { ...process.env, SHECO_DATA_DIR: root } })
  page = await app.firstWindow()
  page.on('pageerror', (error) => errors.push(error.message))
  await expect(page.locator('.page-title')).toBeVisible({ timeout: 20000 })
  await expect(page.locator('.document-editor')).toBeVisible()
}
async function saved() {
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
  await expect(page.locator('.save-status')).toHaveClass(/\bsaved\b/)
}
async function close() {
  await saved()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await app.close()
  app = null
}
async function json() {
  await saved()
  return JSON.parse(await fs.readFile(path.join(workspace, 'workspace.json'), 'utf8'))
    .pages.find((p) => p.id === note.id)
    .content.content.filter((n) => n.type === 'table')
}
async function dragHandle(name, x, y, marker) {
  const box = await page.getByRole('button', { name, exact: true }).boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(x, y, { steps: 18 })
  await expect(page.locator('.table-reorder-marker.' + marker)).toBeVisible()
  await page.screenshot({ path: path.join(output, marker + '-drag.png') })
  await page.mouse.up()
}
async function appendAcrossGap(table, axis) {
  const button = page.getByRole('button', {
    name: axis === 'row' ? 'Add row' : 'Add column',
    exact: true,
  })
  const bounds = await table.locator('table').boundingBox()
  const strip = await button.boundingBox()
  await page.mouse.move(
    bounds.x + (axis === 'row' ? bounds.width / 2 : bounds.width + 2),
    bounds.y + (axis === 'row' ? bounds.height + 2 : bounds.height / 2),
    { steps: 12 },
  )
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
  await expect(button).toBeVisible()
  await page.mouse.move(strip.x + strip.width / 2, strip.y + strip.height / 2, { steps: 12 })
  await expect(button).toBeVisible()
  await page.mouse.click(strip.x + strip.width / 2, strip.y + strip.height / 2)
}
try {
  await launch()
  const first = page.locator('.tableWrapper').first()
  const last = page.locator('.tableWrapper').last()
  // Short manual widths fill the frame without stretching the preceding columns.
  async function manualWidths() {
    return first.evaluate((wrapper) => ({
      available: wrapper.clientWidth,
      table: wrapper.querySelector('table').getBoundingClientRect().width,
      columns: [...wrapper.querySelectorAll('col')].map((col) => col.getBoundingClientRect().width),
    }))
  }
  await expect
    .poll(async () => {
      const widths = await manualWidths()
      return Math.abs(widths.available - widths.table)
    })
    .toBeLessThan(2)
  const filled = await manualWidths()
  expect(filled.columns[0]).toBeCloseTo(100, 0)
  expect(filled.columns[1]).toBeCloseTo(150, 0)
  expect(filled.columns[2]).toBeCloseTo(filled.available - 250, 0)
  await page.screenshot({ path: path.join(output, 'manual-fill-light-en.png') })
  await first.locator('td').first().click()
  async function resizeColumn(column, delta) {
    const bounds = await first.locator('col').nth(column).boundingBox()
    const header = await first.locator('tr').first().boundingBox()
    const x = bounds.x + bounds.width - 1
    const y = header.y + header.height / 2
    await page.mouse.move(x, y)
    await expect(page.locator('.document-editor')).toHaveClass(/resize-cursor/)
    await expect(
      first
        .locator('tr')
        .first()
        .locator(':is(td, th)')
        .nth(column)
        .locator('.column-resize-handle'),
    ).toBeVisible()
    await page.mouse.down()
    await page.mouse.move(x + delta, y, { steps: 12 })
  }
  await resizeColumn(0, 35)
  expect((await manualWidths()).columns[0]).toBeCloseTo(135, 0)
  expect((await manualWidths()).table).toBeCloseTo(filled.available, 0)
  await page.mouse.up()
  expect((await json())[0].content.every((row) => row.content[0].attrs.colwidth[0] === 135)).toBe(
    true,
  )
  await page.keyboard.press(mod + '+z')
  expect((await json())[0].content[0].content[0].attrs.colwidth).toEqual([100])
  expect((await manualWidths()).columns[0]).toBeCloseTo(100, 0)
  await resizeColumn(2, 45)
  expect((await manualWidths()).table).toBeCloseTo(filled.available + 45, 0)
  expect((await manualWidths()).columns[2]).toBeCloseTo(filled.columns[2] + 45, 0)
  await page.mouse.up()
  expect((await json())[0].content[0].content[2].attrs.colwidth[0]).toBeCloseTo(
    filled.columns[2] + 45,
    0,
  )
  await page.keyboard.press(mod + '+z')
  expect((await json())[0].content[0].content[2].attrs.colwidth).toEqual([200])
  expect((await manualWidths()).table).toBeCloseTo(filled.available, 0)
  const windowSize = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].getSize(),
  )
  for (const width of [1500, 1150]) {
    await app.evaluate(
      ({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 900),
      width,
    )
    await expect
      .poll(async () => {
        const widths = await manualWidths()
        return Math.abs(widths.available - widths.table)
      })
      .toBeLessThan(2)
    const widths = await manualWidths()
    expect(widths.columns[0]).toBeCloseTo(100, 0)
    expect(widths.columns[1]).toBeCloseTo(150, 0)
    expect(widths.columns[2]).toBeCloseTo(widths.available - 250, 0)
  }
  await app.evaluate(
    ({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(...size),
    windowSize,
  )
  await page.emulateMedia({ media: 'print' })
  const printed = await manualWidths()
  expect(printed.table).toBeCloseTo(printed.available, 0)
  expect(printed.columns[0]).toBeCloseTo(100, 0)
  expect(printed.columns[1]).toBeCloseTo(150, 0)
  await page.emulateMedia({ media: 'screen' })
  expect((await json())[0].content[0].content.map((cell) => cell.attrs.colwidth)).toEqual([
    [100],
    [150],
    [200],
  ])
  // Handles follow the caret, even when the mouse moves to a different cell.
  await first.locator('tr').nth(1).locator('td').nth(1).click()
  await expect(page.locator('.table-row-handle')).toHaveCount(1)
  await expect(page.locator('.table-column-handle')).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Row 2 options', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Column 2 options', exact: true })).toBeVisible()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Column 3 options', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Column 2 options', exact: true })).toHaveCount(0)
  await page.keyboard.press('Shift+Tab')
  await first.locator('tr').last().locator('td').last().hover()
  await expect(page.getByRole('button', { name: 'Row 2 options', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Column 2 options', exact: true })).toBeVisible()
  await first.locator('th').first().click()
  await expect(page.locator('.table-row-handle')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Column 1 options', exact: true })).toBeVisible()
  // Keyboard entry updates controls without moving the pointer across the table boundary.
  await page.locator('.document-editor > p').nth(2).click()
  await page.mouse.move(20, 20)
  await expect(page.getByRole('toolbar', { name: 'Table settings', exact: true })).toHaveCount(0)
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('toolbar', { name: 'Table settings', exact: true })).toBeVisible()
  // Hover alone shows controls while the pointer is still inside the table.
  await first.locator('td').first().hover()
  await expect(page.getByRole('toolbar', { name: 'Table settings', exact: true })).toBeVisible()
  await first.locator('tr').last().locator('td').last().hover()
  const manualTable = await first.locator('table').boundingBox()
  const manualAddColumn = await page
    .getByRole('button', { name: 'Add column', exact: true })
    .boundingBox()
  expect(Math.abs(manualAddColumn.x - manualTable.x - manualTable.width)).toBeLessThan(6)
  await first.locator('td').first().click()
  await page.getByRole('button', { name: 'Auto-fit columns', exact: true }).click()
  expect(
    (await json())[0].content
      .flatMap((row) => row.content)
      .every((cell) => cell.attrs.colwidth === null),
  ).toBe(true)
  const available = await first.boundingBox(),
    fitted = await first.locator('table').boundingBox()
  expect(Math.abs(available.width - fitted.width)).toBeLessThan(3)
  for (const width of (await manualWidths()).columns)
    expect(width).toBeCloseTo((await manualWidths()).available / 3, 0)
  await page.keyboard.press(mod + '+z')
  expect((await json())[0].content[0].content[0].attrs.colwidth).toEqual([100])
  await page.getByRole('button', { name: 'Auto-fit columns', exact: true }).click()
  // Independent row/column headers and keyboard undo from a toolbar trigger.
  await page.getByRole('button', { name: 'Table headers', exact: true }).click()
  await expect(page.getByRole('switch', { name: 'Header row', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  )
  await page.getByRole('switch', { name: 'Header column', exact: true }).click()
  await expect(page.locator('.table-row-handle')).toHaveCount(0)
  await expect(page.locator('.table-column-handle')).toHaveCount(0)
  await page.getByRole('switch', { name: 'Header row', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Row 1 options', exact: true })).toBeVisible()
  await expect(page.getByRole('switch', { name: 'Header column', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  )
  await expect(page.getByRole('switch', { name: 'Header row', exact: true })).toHaveAttribute(
    'aria-checked',
    'false',
  )
  await page.keyboard.press('Escape')
  await page.keyboard.press(mod + '+z')
  expect((await json())[0].content[0].content.every((cell) => cell.type === 'tableHeader')).toBe(
    true,
  )
  await page.getByRole('button', { name: 'Table headers', exact: true }).click()
  await page.screenshot({ path: path.join(output, 'headers-light-en.png') })
  await page.keyboard.press('Escape')
  // Plus strips appear only while hovering the relevant outer cells.
  await first.locator('tr').nth(1).locator('td').first().hover()
  await expect(page.getByRole('button', { name: 'Add row', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Add column', exact: true })).toHaveCount(0)
  await first.locator('tr').last().locator('td').last().hover()
  await expect(page.getByRole('button', { name: 'Add row', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add column', exact: true })).toBeVisible()
  await first.locator('tr').last().locator('td').first().click()
  await first.locator('tr').last().locator('td').last().hover()
  await page.screenshot({ path: path.join(output, 'controls-light-en.png') })
  await appendAcrossGap(first, 'row')
  await expect(first.locator('tr')).toHaveCount(4)
  await page.keyboard.press(mod + '+z')
  await expect(first.locator('tr')).toHaveCount(3)
  await first.locator('tr').last().locator('td').last().hover()
  await appendAcrossGap(first, 'column')
  await expect(first.locator('tr').first().locator('th')).toHaveCount(4)
  await page.keyboard.press(mod + '+z')
  await expect(first.locator('tr').first().locator('th')).toHaveCount(3)
  // Native pointer drags move complete axes and expose destinations.
  await first.locator('tr').nth(1).locator('td').first().click()
  await page.getByRole('button', { name: 'Row 2 options', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Move up', exact: true })).toBeDisabled()
  await page.keyboard.press('Escape')
  const bottom = await first.locator('tr').last().boundingBox()
  await dragHandle('Row 2 options', bottom.x - 14, bottom.y + bottom.height + 2, 'row')
  expect((await json())[0].content[2].content[1].content[0].content[0].text).toBe('2.1')
  await page.keyboard.press(mod + '+z')
  expect((await json())[0].content[1].content[1].content[0].content[0].text).toBe('2.1')
  await first.locator('tr').nth(1).locator('td').first().click()
  const right = await first.boundingBox()
  await dragHandle('Column 2 options', right.x + right.width + 2, right.y - 14, 'column')
  expect((await json())[0].content[0].content[2].content[0].content[0].text).toBe('Description')
  await page.keyboard.press(mod + '+z')
  // The keyboard-accessible menu has whole-column alignment and reorder actions.
  await first.locator('tr').nth(1).locator('td').first().click()
  await page.getByRole('button', { name: 'Column 2 options', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: 'Move left', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Align column right', exact: true }).click()
  await page.keyboard.press('Escape')
  expect((await json())[0].content.every((row) => row.content[1].attrs.align === 'right')).toBe(
    true,
  )
  await last.locator('td').first().click()
  await page.getByRole('button', { name: 'Row 2 options', exact: true }).click()
  await page.getByRole('button', { name: 'Delete row', exact: true }).click()
  await expect(last.locator('tr')).toHaveCount(2)
  await expect(first.locator('tr')).toHaveCount(3)
  await page.keyboard.press(mod + '+z')
  // Both width modes work with the outline enabled, including a narrow viewport.
  for (const width of [1500, 1150]) {
    await app.evaluate(
      ({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 900),
      width,
    )
    await expect(page.locator('.page-outline')).toBeVisible()
    const fixed = await page.locator('.document-main').boundingBox()
    await page.getByRole('button', { name: 'Page options', exact: true }).click()
    await page.getByRole('switch', { name: 'Fixed content width', exact: true }).click()
    await page.keyboard.press('Escape')
    expect((await page.locator('.document-main').boundingBox()).width).toBeGreaterThan(
      fixed.width + 10,
    )
    await page.getByRole('button', { name: 'Page options', exact: true }).click()
    await page.getByRole('switch', { name: 'Fixed content width', exact: true }).click()
    await page.keyboard.press('Escape')
  }
  // Dragging inside the content, even from blank line space, stays native text selection.
  await page.locator('.document-editor > p').first().scrollIntoViewIfNeeded()
  const paragraph = await page.locator('.document-editor > p').first().boundingBox()
  await page.mouse.move(paragraph.x + paragraph.width - 2, paragraph.y + paragraph.height / 2)
  await page.mouse.down()
  await page.mouse.move(paragraph.x + 10, paragraph.y + paragraph.height / 2, { steps: 12 })
  await expect(page.locator('.block-selection-rectangle')).toHaveCount(0)
  await page.mouse.up()
  expect(await page.evaluate(() => window.getSelection()?.toString())).toContain('short text')
  const link = await page.locator('.document-editor a').boundingBox()
  await page.mouse.move(link.x + link.width + 20, link.y + link.height / 2)
  await page.mouse.down()
  await page.mouse.move(link.x + 1, link.y + link.height / 2, { steps: 12 })
  await expect(page.locator('.block-selection-rectangle')).toHaveCount(0)
  await page.mouse.up()
  expect(await page.evaluate(() => window.getSelection()?.toString())).toContain('BOLA')
  await expect(page.locator('.block-is-selected')).toHaveCount(0)
  await page.locator('.document-editor > p').nth(2).click()
  await page.keyboard.type('Empty paragraph still accepts typing')
  await expect(page.locator('.document-editor')).toContainText(
    'Empty paragraph still accepts typing',
  )
  // Russian/dark and scroll-aware, viewport-bounded settings.
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.send('menu', 'settings'),
  )
  await page.getByRole('button', { name: 'Русский', exact: true }).click()
  await page.getByRole('button', { name: 'Тёмная', exact: true }).click()
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click()
  await first.locator('td').first().click()
  await page.getByRole('button', { name: 'Заголовки таблицы', exact: true }).click()
  await page.screenshot({ path: path.join(output, 'headers-dark-ru.png') })
  const menu = await page.locator('.table-control-menu').boundingBox()
  expect(menu.x).toBeGreaterThanOrEqual(0)
  expect(menu.x + menu.width).toBeLessThanOrEqual(await page.evaluate(() => innerWidth))
  await page.keyboard.press('Escape')
  await page.locator('.content-scroll').evaluate((el) => {
    el.scrollTop += 40
  })
  await first.locator('td').last().click()
  const rowGrip = await page
    .getByRole('button', { name: 'Действия со строкой 3', exact: true })
    .boundingBox()
  const rowBounds = await first.locator('tr').last().boundingBox()
  expect(
    Math.abs(rowGrip.y + rowGrip.height / 2 - rowBounds.y - rowBounds.height / 2),
  ).toBeLessThan(2)
  await page.emulateMedia({ media: 'print' })
  await expect(page.locator('.table-controls')).toBeHidden()
  await page.emulateMedia({ media: 'screen' })
  await close()
  await launch()
  const persisted = (await json())[0]
  expect(persisted.content.every((row) => row.content[1].attrs.align === 'right')).toBe(true)
  expect(persisted.content[0].content.every((cell) => cell.type === 'tableHeader')).toBe(true)
  expect(persisted.content.every((row) => row.content[0].type === 'tableHeader')).toBe(true)
  expect(
    persisted.content.flatMap((row) => row.content).every((cell) => cell.attrs.colwidth === null),
  ).toBe(true)
  const partial = await page
    .locator('.tableWrapper')
    .last()
    .evaluate((wrapper) => ({
      available: wrapper.clientWidth,
      table: wrapper.querySelector('table').getBoundingClientRect().width,
      columns: [...wrapper.querySelectorAll('col')].map((col) => col.getBoundingClientRect().width),
    }))
  expect(partial.table).toBeCloseTo(partial.available, 0)
  expect(partial.columns[0]).toBeCloseTo(90, 0)
  expect(partial.columns[2]).toBeCloseTo(160, 0)
  expect((await json())[1].content[0].content.map((cell) => cell.attrs.colwidth)).toEqual([
    [90],
    [0],
    [160],
  ])
  await close()
  expect(errors).toEqual([])
  console.log(
    'Passed: last-column fill with preceding manual widths retained, live resizing/overflow/undo, viewport and print layout, automatic and partial widths after restart, caret-only handles with keyboard updates, hidden/fixed header axes, actual pointer transitions across both append gaps, immediate table controls, independent headers, native row/column reorder with markers/undo, keyboard menus/alignment, multiple tables, outline width modes, native text/link selection, empty paragraph typing, English/light and Russian/dark, scroll bounds, and restart persistence.',
  )
} catch (error) {
  if (page) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {})
  throw error
} finally {
  if (page) await page.mouse.up().catch(() => {})
  if (app) await app.close().catch(() => {})
  await fs.rm(root, { recursive: true, force: true })
}
