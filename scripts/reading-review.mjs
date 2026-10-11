import { _electron as electron, expect } from '@playwright/test'
import { build } from 'esbuild'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import sharp from 'sharp'

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sheco-reading-'))
const workspace = path.join(root, 'Knowledge')
const output = path.resolve('test-results/reading')
await fs.mkdir(workspace)
await fs.mkdir(output, { recursive: true })
const bundled = await build({
  stdin: {
    contents:
      "export { seedWorkspace } from './src/shared/seed'; export { createPage, createDatabase } from './src/shared/model'",
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
})
const modulePath = path.join(root, 'seed.mjs')
await fs.writeFile(modulePath, bundled.outputFiles[0].contents)
const { seedWorkspace, createPage, createDatabase } = await import(pathToFileURL(modulePath).href)
const w = seedWorkspace('Reading review', false)
const note = w.pages[0]
note.title = 'A clearer page'
note.icon = '📖'
note.description = 'Reading preferences and editor details'
const fileChild = createPage(w, 'File icon page', note.id)
const emojiChild = createPage(w, 'Emoji icon page', note.id)
emojiChild.icon = '📜'
w.pages.push(fileChild, emojiChild)
const database = createPage(w, 'Export formats', null, 'database')
w.pages.push(database)
w.databases.push(createDatabase(database.id))
const trashPages = ['file', '🛸', '🎲', '👩‍💻'].map((icon, index) => {
  const page = createPage(w, 'Deleted page ' + index)
  page.icon = icon
  page.deletedAt = new Date().toISOString()
  w.pages.push(page)
  return page
})
const text = (value, marks) => ({ type: 'text', text: value, ...(marks ? { marks } : {}) })
const p = (value) => ({ type: 'paragraph', content: [text(value)] })
const h = (value, level = 2) => ({ type: 'heading', attrs: { level }, content: [text(value)] })
const cell = (value, header = false) => ({
  type: header ? 'tableHeader' : 'tableCell',
  content: [p(value)],
})
const code = 'const message = "Hello";\nconsole.log(message);\n'
note.content = {
  type: 'doc',
  content: [
    h('Readable details'),
    {
      type: 'paragraph',
      content: [
        text('Inline code: '),
        text('message.trim()', [{ type: 'code' }]),
        text(' and a '),
        text('web link', [{ type: 'link', attrs: { href: 'https://example.com' } }]),
        text('.'),
      ],
    },
    {
      type: 'blockquote',
      content: [p('A quote should be as easy to read as the surrounding text.')],
    },
    {
      type: 'callout',
      attrs: { emoji: '💡', color: 'gray' },
      content: [p('A useful idea with a centered icon.')],
    },
    {
      type: 'table',
      content: [
        { type: 'tableRow', content: [cell('Source', true), cell('Description', true)] },
        { type: 'tableRow', content: [cell('Notes'), cell('Keep useful context together.')] },
        { type: 'tableRow', content: [cell('Pages'), cell('Connect related ideas.')] },
      ],
    },
    {
      type: 'codeBlock',
      attrs: {
        language: 'javascript',
        title: 'Example',
        lineNumbers: true,
        collapsedByDefault: false,
      },
      content: [text(code)],
    },
    { type: 'pageLink', attrs: { pageId: fileChild.id } },
    { type: 'pageLink', attrs: { pageId: emojiChild.id } },
    {
      type: 'details',
      attrs: { open: false },
      content: [
        { type: 'detailsSummary', content: [text('More context')] },
        {
          type: 'detailsContent',
          content: [h('Nested heading', 3), p('An outline opens the folded section.')],
        },
      ],
    },
    ...Array.from({ length: 15 }, (_, index) =>
      p(
        `Paragraph ${index + 1}. A comfortable line length makes a long document easier to read. Keep the layout consistent as the content grows.`,
      ),
    ),
    h('Next steps'),
    p('The outline can navigate to this section.'),
  ],
}
w.ui.activeId = note.id
w.ui.tabs = [note.id]
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
async function launch() {
  app = await electron.launch({ args: ['.'], env: { ...process.env, SHECO_DATA_DIR: root } })
  page = await app.firstWindow()
  page.on('pageerror', (e) => errors.push(e.message))
  await expect(page.locator('.page-title')).toBeVisible({ timeout: 20000 })
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
async function menu(action) {
  await app.evaluate(
    ({ BrowserWindow }, action) =>
      BrowserWindow.getAllWindows()[0].webContents.send('menu', action),
    action,
  )
}
async function open(id) {
  await page.evaluate(
    (id) => window.dispatchEvent(new CustomEvent('open-page', { detail: { id } })),
    id,
  )
  await expect(page.locator('.page-title')).toBeVisible()
}
async function css(selector, property) {
  return page
    .locator(selector)
    .first()
    .evaluate((el, property) => getComputedStyle(el).getPropertyValue(property), property)
}
async function preferences() {
  await page.getByRole('button', { name: 'Page options', exact: true }).click()
}
async function settings() {
  await menu('settings')
  await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toBeVisible()
}
async function exportPDF(name, russian = false) {
  const file = path.join(root, `${name}.pdf`)
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file })
  }, file)
  await page
    .getByRole('button', { name: russian ? 'Действия со страницей' : 'Page options', exact: true })
    .click()
  await page.getByRole('button', { name: russian ? 'Экспорт' : 'Export', exact: true }).click()
  await expect(page.locator('.modal-overlay')).toHaveCount(0)
  await page.getByRole('menuitem', { name: 'PDF (.pdf)', exact: true }).click()
  await expect
    .poll(async () =>
      fs
        .stat(file)
        .then((s) => s.size)
        .catch(() => 0),
    )
    .toBeGreaterThan(1000)
  expect((await fs.readFile(file)).subarray(0, 4).toString()).toBe('%PDF')
  await fs.copyFile(file, path.join(output, `${name}.pdf`))
  const prefix = path.join(root, name)
  execFileSync('pdftoppm', ['-f', '1', '-l', '1', '-singlefile', '-r', '72', '-png', file, prefix])
  const { data, info } = await sharp(`${prefix}.png`)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  for (const [x, y] of [
    [0, 0],
    [20, 20],
    [Math.floor(info.width / 2), 20],
    [20, Math.floor(info.height / 2)],
    [info.width - 20, info.height - 20],
  ]) {
    const offset = (y * info.width + x) * info.channels
    expect([...data.subarray(offset, offset + 3)]).toEqual([255, 255, 255])
  }
  await fs.copyFile(`${prefix}.png`, path.join(output, `${name}.png`))
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
async function trashChecks(russian = false, restore = false) {
  await page.getByRole('button', { name: russian ? /^Корзина/ : /^Trash/ }).click()
  const rows = page.locator('.trash-list > div')
  await expect(rows).toHaveCount(4)
  const geometry = await rows.evaluateAll((rows) =>
    rows.map((row) => {
      const icon = row.children[0].getBoundingClientRect()
      const title = row.querySelector('strong').getBoundingClientRect()
      const button = row.querySelector('button').getBoundingClientRect()
      return { iconX: icon.x, iconWidth: icon.width, titleX: title.x, buttonX: button.x }
    }),
  )
  for (const row of geometry) {
    expect(row.iconX).toBeCloseTo(geometry[0].iconX, 0)
    expect(row.iconWidth).toBeCloseTo(16, 0)
    expect(row.titleX).toBeCloseTo(geometry[0].titleX, 0)
    expect(row.buttonX).toBeCloseTo(geometry[0].buttonX, 0)
  }
  await page.screenshot({
    path: path.join(output, `trash-${russian ? 'dark-ru' : 'light-en'}.png`),
  })
  if (restore) {
    await rows
      .filter({ hasText: trashPages[1].title })
      .getByRole('button', { name: 'Восстановить', exact: true })
      .click()
    await expect(rows).toHaveCount(3)
    await saved()
    const snapshot = JSON.parse(await fs.readFile(path.join(workspace, 'workspace.json'), 'utf8'))
    const restored = snapshot.pages.find((p) => p.id === trashPages[1].id)
    expect(restored.deletedAt).toBe(null)
    expect(restored.icon).toBe(trashPages[1].icon)
    expect(restored.content).toEqual(trashPages[1].content)
  }
  await open(note.id)
  await expect(page.locator('.trash-page')).toHaveCount(0)
}
async function exportMenuChecks() {
  await preferences()
  const trigger = page.getByRole('button', { name: 'Export', exact: true })
  await expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
  await expect(trigger.locator('svg')).toHaveCount(2)
  await trigger.focus()
  await page.keyboard.press('ArrowRight')
  const popup = page.locator('.page-export-popover')
  await floating(popup)
  await expect(page.locator('.page-options')).toBeVisible()
  await expect(page.locator('.modal-overlay')).toHaveCount(0)
  await expect(popup.locator('select')).toHaveCount(0)
  await expect(popup.getByRole('menuitem')).toHaveText(['Markdown (.md)', 'PDF (.pdf)'])
  await expect(popup.getByRole('menuitem', { name: 'Markdown (.md)', exact: true })).toBeFocused()
  await page.keyboard.press('End')
  await expect(popup.getByRole('menuitem', { name: 'PDF (.pdf)', exact: true })).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await expect(popup.getByRole('menuitem', { name: 'Markdown (.md)', exact: true })).toBeFocused()
  await page.screenshot({ path: path.join(output, 'export-popover-light-en.png') })
  await page.keyboard.press('Escape')
  await expect(popup).toHaveCount(0)
  await expect(trigger).toBeFocused()
  await expect(page.locator('.page-options')).toBeVisible()
  await trigger.click()
  await page.keyboard.press('ArrowLeft')
  await expect(popup).toHaveCount(0)
  await expect(trigger).toBeFocused()
  await trigger.click()
  await page.mouse.click(5, 5)
  await expect(popup).toHaveCount(0)
  await expect(page.locator('.page-options')).toHaveCount(0)
  // Selecting a format directly invokes the existing native save flow.
  await app.evaluate(({ dialog }) => {
    globalThis.exportDialogs = 0
    dialog.showSaveDialog = async () => {
      globalThis.exportDialogs++
      return { canceled: true }
    }
  })
  await preferences()
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  await popup.getByRole('menuitem', { name: 'Markdown (.md)', exact: true }).click()
  await expect.poll(() => app.evaluate(() => globalThis.exportDialogs)).toBe(1)
  await expect(popup).toHaveCount(0)
  await expect(page.locator('.page-options')).toHaveCount(0)
  const file = path.join(root, 'export-menu.md')
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file })
  }, file)
  await preferences()
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  await popup.getByRole('menuitem', { name: 'Markdown (.md)', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect
    .poll(async () => fs.readFile(file, 'utf8').catch(() => ''))
    .toContain('Readable details')
  expect(await fs.readFile(file, 'utf8')).toContain('const message')
  // Page changes dismiss the old page's export choices.
  await preferences()
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  await open(fileChild.id)
  await expect(popup).toHaveCount(0)
  await expect(page.locator('.page-options')).toHaveCount(0)
  await open(note.id)
}
try {
  await launch()
  await trashChecks()
  await exportMenuChecks()
  await expect(page.locator('.page-outline button')).toHaveCount(3)
  await page
    .locator('.page-outline')
    .getByRole('button', { name: 'Nested heading', exact: true })
    .click()
  await expect(page.locator('h3').filter({ hasText: 'Nested heading' })).toBeVisible()
  await page
    .locator('.page-outline')
    .getByRole('button', { name: 'Next steps', exact: true })
    .click()
  expect(await page.locator('.content-scroll').evaluate((el) => el.scrollTop)).toBeGreaterThan(300)
  await page
    .locator('.page-outline')
    .getByRole('button', { name: 'Readable details', exact: true })
    .click()
  await page.locator('.content-scroll').evaluate((el) => {
    el.scrollTop = 0
  })
  expect(await css('.document-editor code', 'background-color')).toBe('rgba(37, 37, 37, 0.055)')
  expect(await css('.document-editor blockquote', 'color')).toBe('rgb(48, 48, 48)')
  expect(await css('.document-editor a', 'color')).toBe('rgb(40, 90, 199)')
  expect(await css('.tableWrapper', 'border-top-left-radius')).toBe('8px')
  expect(await css('.document-editor th', 'background-color')).toBe('rgb(238, 238, 238)')
  expect(await css('.document-editor th', 'text-align')).toBe('left')
  const documentBounds = await page.locator('.document-main').boundingBox()
  const outlineBounds = await page.locator('.page-outline').boundingBox()
  expect(outlineBounds.x).toBeGreaterThanOrEqual(documentBounds.x + documentBounds.width)
  await page.locator('.document-editor td').first().click()
  await expect(page.getByRole('toolbar', { name: 'Table settings', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Column 1 options', exact: true }).click()
  await page.getByRole('button', { name: 'Align column center', exact: true }).click()
  expect(await css('.document-editor th', 'text-align')).toBe('center')
  expect(await css('.document-editor td', 'text-align')).toBe('center')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Meta+z')
  expect(await css('.document-editor th', 'text-align')).toBe('left')
  await page.getByRole('button', { name: 'Column 1 options', exact: true }).click()
  await page.getByRole('button', { name: 'Align column right', exact: true }).click()
  expect(await css('.document-editor th', 'text-align')).toBe('right')
  await page.keyboard.press('Escape')
  await page.locator('.document-editor tr').last().locator('td').first().hover()
  await page.getByRole('button', { name: 'Add row', exact: true }).click()
  await expect(page.locator('.document-editor tr')).toHaveCount(4)
  expect(await css('.document-editor tr:nth-child(4) td', 'text-align')).toBe('right')
  await page.keyboard.press('Meta+z')
  await expect(page.locator('.document-editor tr')).toHaveCount(3)
  expect(await css('.document-editor th', 'text-align')).toBe('right')
  await page.locator('.document-editor h2').first().click()
  await page.locator('.content-scroll').evaluate((el) => {
    el.scrollTop = 0
  })
  const titleX = await page
    .locator('.page-link-title')
    .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().x))
  expect(Math.abs(titleX[0] - titleX[1])).toBeLessThan(3)
  expect(await css('.page-link-block .page-emoji', 'flex-grow')).toBe('0')
  expect(await css('.callout-emoji', 'line-height')).toBe('20px')
  await page.screenshot({ path: path.join(output, 'page-light.png') })
  // Stub only this fixture's native writer: never touch the user's clipboard.
  await app.evaluate(({ clipboard }) => {
    clipboard.writeText = (text) => {
      globalThis.shecoTestCopied = text
    }
  })
  await page.evaluate(() => {
    Object.defineProperty(navigator.clipboard, 'writeText', {
      value: async () => {
        throw new Error('Browser clipboard denied')
      },
    })
  })
  await page.locator('.code-actions').getByRole('button', { name: 'Copy', exact: true }).click()
  await expect(page.locator('.code-actions')).toContainText('Copied')
  expect(await app.evaluate(() => globalThis.shecoTestCopied)).toBe(code)
  await preferences()
  await page.getByRole('button', { name: 'Copy page link', exact: true }).click()
  expect(await app.evaluate(() => globalThis.shecoTestCopied)).toBe(`sheco://page/${note.id}`)
  await page.locator('.tree-page').filter({ hasText: note.title }).click({ button: 'right' })
  await page.getByRole('button', { name: 'Copy link', exact: true }).click()
  expect(await app.evaluate(() => globalThis.shecoTestCopied)).toBe(`sheco://page/${note.id}`)
  const fixed = await page.locator('.document-main').boundingBox()
  await preferences()
  await page
    .locator('.document-editor')
    .evaluate((el) =>
      el.addEventListener('pointerdown', (e) => e.stopPropagation(), { once: true }),
    )
  await page.locator('.document-editor p').first().click()
  await expect(page.locator('.page-options')).toHaveCount(0)
  await preferences()
  await page.getByRole('switch', { name: 'Table of contents', exact: true }).click()
  await expect(page.locator('.page-outline')).toHaveCount(0)
  await page.getByRole('switch', { name: 'Fixed content width', exact: true }).click()
  await page.getByRole('button', { name: 'Font size +2', exact: true }).click()
  await page.screenshot({ path: path.join(output, 'page-options-light.png') })
  await page.keyboard.press('Escape')
  expect((await page.locator('.document-main').boundingBox()).width).toBeGreaterThan(fixed.width)
  expect(await css('.document-editor', 'font-size')).toBe('18px')
  await open(emojiChild.id)
  await expect(page.locator('.page-title')).toHaveValue(emojiChild.title)
  expect(await css('.document-editor', 'font-size')).toBe('18px')
  await settings()
  await expect(
    page.getByRole('switch', { name: 'Table of contents', exact: true }),
  ).toHaveAttribute('aria-checked', 'false')
  await expect(
    page.getByRole('switch', { name: 'Fixed content width', exact: true }),
  ).toHaveAttribute('aria-checked', 'false')
  await page.getByRole('switch', { name: 'Fixed content width', exact: true }).click()
  await page.getByRole('switch', { name: 'Table of contents', exact: true }).click()
  for (const size of [-2, -1, 0, 1, 2]) {
    await page
      .getByRole('button', { name: `Font size ${size > 0 ? '+' : ''}${size}`, exact: true })
      .click()
    expect(await css('.document-editor', 'font-size')).toBe(`${14 + size * 2}px`)
  }
  await page.getByRole('button', { name: 'Font size 0', exact: true }).click()
  for (const accent of ['Blue', 'Green', 'Purple', 'Orange', 'Neutral']) {
    await page.getByRole('button', { name: accent, exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('data-accent', accent.toLowerCase())
    expect(await css('.main-pane', 'background-color')).toBe('rgb(255, 255, 255)')
  }
  await page.screenshot({ path: path.join(output, 'settings-light.png') })
  await page.getByRole('button', { name: 'Green', exact: true }).click()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await open(note.id)
  await expect(page.locator('.page-outline button')).toHaveCount(3)
  expect(await css('.document-editor th', 'text-align')).toBe('right')
  await page.locator('.content-scroll').evaluate((el) => {
    el.scrollTop = 0
  })
  expect(await css('.document-editor code', 'background-color')).toContain('/ 0.09')
  await page.screenshot({ path: path.join(output, 'page-light-green.png') })
  await exportPDF('export-light')
  await settings()
  await page.getByRole('button', { name: 'Dark', exact: true }).click()
  await page.getByRole('button', { name: 'Blue', exact: true }).click()
  await page.getByRole('button', { name: 'Русский', exact: true }).click()
  await page.screenshot({ path: path.join(output, 'settings-dark-ru.png') })
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click()
  expect(await css('.document-editor code', 'background-color')).toContain('/ 0.09')
  expect(await css('.document-editor blockquote', 'color')).toBe('rgb(229, 229, 229)')
  expect(await css('.document-editor a', 'color')).toBe('rgb(150, 185, 255)')
  await page.screenshot({ path: path.join(output, 'page-dark-ru.png') })
  await exportPDF('export-dark-ru', true)
  await page.emulateMedia({ media: 'print' })
  for (const selector of [
    'html',
    'body',
    '#root',
    '.app',
    '.main-pane',
    '.content-scroll',
    '.page-content',
  ])
    expect(await css(selector, 'background-color')).toBe('rgb(255, 255, 255)')
  await expect(page.locator('.page-outline')).toBeHidden()
  expect(await css('.page-title', 'color')).toBe('rgb(32, 32, 32)')
  expect(await css('.document-editor h2', 'color')).toBe('rgb(32, 32, 32)')
  await page.emulateMedia({ media: 'screen' })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 640))
  await page.getByRole('button', { name: 'Действия со страницей', exact: true }).click()
  const bounds = await page.locator('.page-options').boundingBox()
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  expect(bounds.x).toBeGreaterThanOrEqual(0)
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width)
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height)
  await page.screenshot({ path: path.join(output, 'page-options-narrow-dark-ru.png') })
  await page.keyboard.press('Escape')
  await open(database.id)
  await page.getByRole('button', { name: 'Действия со страницей', exact: true }).click()
  await page.getByRole('button', { name: 'Экспорт', exact: true }).click()
  const exportChoices = page.locator('.page-export-popover')
  await floating(exportChoices)
  await expect(exportChoices.getByRole('menuitem')).toHaveText([
    'Markdown (.md)',
    'PDF (.pdf)',
    'CSV (.csv)',
  ])
  await expect(page.locator('.modal-overlay')).toHaveCount(0)
  await page.screenshot({ path: path.join(output, 'export-popover-narrow-dark-ru.png') })
  const csv = path.join(root, 'database.csv')
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file })
  }, csv)
  await exportChoices.getByRole('menuitem', { name: 'CSV (.csv)', exact: true }).click()
  await expect
    .poll(async () =>
      fs
        .stat(csv)
        .then((s) => s.size)
        .catch(() => 0),
    )
    .toBeGreaterThan(0)
  await page.getByRole('button', { name: 'Свойства базы', exact: true }).click()
  await page
    .locator('.columns-popover')
    .getByRole('button', { name: 'Изменить Status', exact: true })
    .click()
  await expect(page.getByRole('dialog', { name: 'Изменить свойство', exact: true })).toBeVisible()
  await expect(page.locator('.modal-overlay')).toHaveCount(0)
  await page.getByRole('button', { name: 'Тип свойства', exact: true }).click()
  await expect(page.getByRole('listbox', { name: 'Тип свойства', exact: true })).toBeVisible()
  await page.keyboard.press('Home')
  await expect(page.getByRole('option', { name: 'Текст', exact: true })).toBeFocused()
  const typeBounds = await page.locator('.property-type-popover').boundingBox()
  expect(typeBounds.y).toBeGreaterThanOrEqual(8)
  expect(typeBounds.y + typeBounds.height).toBeLessThanOrEqual(viewport.height - 7)
  await page.screenshot({ path: path.join(output, 'property-type-dark-ru.png') })
  await page.getByRole('option', { name: 'Множественный выбор', exact: true }).click()
  await expect(page.locator('.property-type-popover')).toHaveCount(0)
  await expect(page.getByRole('dialog', { name: 'Изменить свойство', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.column-editor-popover')).toHaveCount(0)
  await open(note.id)
  await page.getByTitle('Изменить иконку страницы', { exact: true }).click()
  expect(
    (await page.locator('.icon-picker-content .search-input').boundingBox()).height,
  ).toBeGreaterThanOrEqual(38)
  expect(
    await page
      .getByLabel('Поиск иконок', { exact: true })
      .evaluate((el) => el.scrollHeight <= el.clientHeight),
  ).toBe(true)
  await page.screenshot({ path: path.join(output, 'icon-search-dark-ru.png') })
  await page.keyboard.press('Escape')
  await trashChecks(true, true)
  await saved()
  const before = JSON.parse(await fs.readFile(path.join(workspace, 'workspace.json'), 'utf8'))
  await close()
  await launch()
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'blue')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.locator('.page-outline button')).toHaveCount(3)
  const after = JSON.parse(await fs.readFile(path.join(workspace, 'workspace.json'), 'utf8'))
  expect(after.ui).toEqual(before.ui)
  expect(after.pages).toEqual(before.pages)
  expect(errors).toEqual([])
  console.log(
    'Passed: reading controls across pages and restart, side outline navigation including folds, full-column table alignment with undo/new rows/persistence, outside dismissal despite stopped propagation, five accents/sizes, native code/page-link copy with browser clipboard denied, light/dark Russian/English, narrow nested property menus with keyboard/dismissal, icon search height, direct Markdown/PDF/CSV export menus with keyboard/escape/native-save cancellation, PDF white margins in both themes, and aligned SVG/emoji Trash rows with preserved restoration and restart.',
  )
} finally {
  if (app) await close().catch(async () => app?.close())
}
