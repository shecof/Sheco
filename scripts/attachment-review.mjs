import { _electron as electron, expect } from '@playwright/test'
import { build } from 'esbuild'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sheco-attachments-'))
const output = path.resolve('test-results/attachments')
const knowledge = path.join(root, 'Knowledge')
await fs.mkdir(output, { recursive: true })
await fs.mkdir(path.join(knowledge, 'attachments'), { recursive: true })
const bundled = await build({
  stdin: {
    contents:
      "export { seedWorkspace } from './src/shared/seed'; export { createPage, uid } from './src/shared/model'",
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
})
const modulePath = path.join(root, 'fixtures.mjs')
await fs.writeFile(modulePath, bundled.outputFiles[0].contents)
const { seedWorkspace, createPage, uid } = await import(pathToFileURL(modulePath).href)
const w = seedWorkspace('Attachment views fixture')
const legacy = {
  id: uid(),
  file: uid() + '.txt',
  name: 'Project notes.txt',
  mime: 'text/plain',
  bytes: 25,
  createdAt: new Date().toISOString(),
}
const legacyBytes = Buffer.from('Original local attachment')
await fs.writeFile(path.join(knowledge, 'attachments', legacy.file), legacyBytes)
w.attachments.push(legacy)
const note = createPage(w, 'File views')
note.content = {
  type: 'doc',
  content: [
    {
      type: 'attachment',
      attrs: { id: legacy.id, file: legacy.file, name: legacy.name, bytes: legacy.bytes },
    },
    { type: 'paragraph' },
  ],
}
const target = createPage(w, 'Paste files')
const rows = createPage(w, 'File rows')
const paragraph = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const attachment = (display) => ({
  type: 'attachment',
  attrs: { id: legacy.id, file: legacy.file, name: legacy.name, bytes: legacy.bytes, display },
})
rows.content = {
  type: 'doc',
  content: [
    paragraph('Compact rectangles'),
    ...Array.from({ length: 3 }, () => attachment('compact')),
    paragraph('Square tiles'),
    ...Array.from({ length: 5 }, () => attachment('tile')),
    paragraph('Mixed sizes'),
    attachment('compact'),
    attachment('tile'),
    paragraph('A text block separates file rows'),
    attachment('link'),
    attachment('card'),
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [paragraph('Files inside a list'), attachment('tile'), attachment('tile')],
        },
      ],
    },
    {
      type: 'details',
      attrs: { open: true },
      content: [
        { type: 'detailsSummary', content: [{ type: 'text', text: 'Files inside a fold' }] },
        { type: 'detailsContent', content: [attachment('compact'), attachment('compact')] },
      ],
    },
    { type: 'paragraph' },
  ],
}
w.pages.push(note, target, rows)
w.ui.tabs = [note.id, target.id]
w.ui.activeId = note.id
await fs.writeFile(path.join(knowledge, 'workspace.json'), JSON.stringify(w))
await fs.writeFile(
  path.join(root, 'spaces.json'),
  JSON.stringify({
    activeId: w.id,
    spaces: [{ id: w.id, name: w.name, icon: w.icon, path: knowledge }],
  }),
)
const names = [
  'Meeting agenda.txt',
  'Длинное название вложения с пояснением к плану проекта и итогами обсуждения.txt',
  'Budget.csv',
]
const imports = names.map((name) => path.join(root, name))
await Promise.all(imports.map((file, i) => fs.writeFile(file, 'Fixture attachment ' + i)))
let app,
  page,
  succeeded = false
const errors = []
const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
async function launch() {
  app = await electron.launch({ args: ['.'], env: { ...process.env, SHECO_DATA_DIR: root } })
  page = await app.firstWindow()
  page.on('pageerror', (e) => errors.push(e.message))
  await expect(page.locator('.document-editor')).toBeVisible({ timeout: 20000 })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 900))
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
async function doc() {
  return page.locator('.document-editor').evaluate((el) => el.editor.getJSON())
}
async function undo() {
  await page.locator('.document-editor').evaluate((el) => el.editor.view.focus())
  await page.keyboard.press(`${mod}+z`)
}
const files = () => page.locator('.attachment-block')
async function choose(index, label, russian = false) {
  const block = files().nth(index)
  await block.hover()
  await block
    .getByRole('button', { name: russian ? 'Вид файла' : 'File view', exact: true })
    .click()
  await page
    .locator('.attachment-view-menu')
    .getByRole('button', { name: label, exact: true })
    .click()
}
async function settings(russian = false) {
  await page
    .locator('.sidebar-footer')
    .getByRole('button', { name: russian ? 'Настройки' : 'Settings', exact: true })
    .click()
}
async function readingCopyAbsent(russian = false) {
  await page
    .getByRole('button', { name: russian ? 'Действия со страницей' : 'Page options', exact: true })
    .click()
  await expect(page.locator('.page-reading-options')).toBeVisible()
  await expect(page.locator('.page-reading-options')).not.toContainText(
    /Applies to all pages|Для всех страниц пространства/,
  )
  await expect(
    page.getByRole('switch', {
      name: russian ? 'Фиксированная ширина' : 'Fixed content width',
      exact: true,
    }),
  ).toBeVisible()
  await page.screenshot({
    path: path.join(output, russian ? 'reading-menu-dark-ru.png' : 'reading-menu-light-en.png'),
  })
  await page.keyboard.press('Escape')
}
async function fileRows(russian = false) {
  await page.locator('.page-tree').getByRole('button', { name: rows.title, exact: true }).click()
  await expect(page.getByLabel(russian ? 'Название страницы' : 'Page title')).toHaveValue(
    rows.title,
  )
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 1100))
  await expect.poll(() => page.evaluate(() => innerWidth)).toBe(1280)
  const before = await doc()
  const boxes = () =>
    files()
      .locator('.attachment-open')
      .evaluateAll((els) =>
        els.map((el) => {
          const { x, y, width, height } = el.getBoundingClientRect()
          const parent = el.closest('.node-attachment').parentElement.getBoundingClientRect()
          return { x, y, width, height, left: parent.left, right: parent.right }
        }),
      )
  const wide = await boxes()
  // Adjacent cards flow in document order; ordinary text, links and wide cards start new rows.
  expect(wide[1].y).toBeCloseTo(wide[0].y, 0)
  expect(wide[1].x - wide[0].x - wide[0].width).toBeCloseTo(12, 0)
  expect(wide[2].y).toBeGreaterThan(wide[0].y + wide[0].height)
  expect(wide[3].y).toBeGreaterThan(wide[2].y + wide[2].height)
  for (let i = 4; i < 8; i++) {
    expect(wide[i].y).toBeCloseTo(wide[3].y, 0)
    expect(wide[i].x - wide[i - 1].x - wide[i - 1].width).toBeCloseTo(12, 0)
  }
  expect(wide[9].y).toBeCloseTo(wide[8].y, 0)
  expect(wide[10].y).toBeGreaterThan(wide[9].y + wide[9].height)
  expect(wide[11].y).toBeGreaterThan(wide[10].y + wide[10].height)
  expect(wide[13].y).toBeCloseTo(wide[12].y, 0)
  expect(wide[15].y).toBeCloseTo(wide[14].y, 0)
  for (const box of wide) {
    expect(box.x).toBeGreaterThanOrEqual(box.left)
    expect(box.x + box.width).toBeLessThanOrEqual(box.right + 0.5)
  }
  await page.getByLabel(russian ? 'Название страницы' : 'Page title').focus()
  await page.mouse.move(10, 10)
  await page.screenshot({
    path: path.join(output, `file-rows-${russian ? 'dark-ru' : 'light-en'}.png`),
  })
  // Changing the middle card reflows only layout and remains one undoable edit.
  await choose(1, russian ? 'Широкая карточка' : 'Wide card', russian)
  const changed = await boxes()
  expect(changed[1].y).toBeGreaterThan(changed[0].y + changed[0].height)
  expect(changed[2].y).toBeGreaterThan(changed[1].y + changed[1].height)
  await undo()
  expect(await doc()).toEqual(before)
  await files().nth(1).click({ button: 'right' })
  await page
    .locator('.block-menu')
    .getByRole('button', {
      name: russian ? 'Дублировать' : 'Duplicate',
      exact: true,
    })
    .click()
  const duplicated = structuredClone(before)
  duplicated.content.splice(3, 0, structuredClone(before.content[2]))
  expect(await doc()).toEqual(duplicated)
  await undo()
  expect(await doc()).toEqual(before)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 780))
  await expect.poll(() => page.evaluate(() => innerWidth)).toBe(900)
  const narrow = await boxes()
  expect(narrow[1].y).toBeGreaterThan(narrow[0].y + narrow[0].height)
  expect(narrow[2].y).toBeGreaterThan(narrow[1].y + narrow[1].height)
  const tilesPerRow = Math.floor((narrow[3].right - narrow[3].left + 12) / (narrow[3].width + 12))
  expect(tilesPerRow).toBeGreaterThan(1)
  expect(tilesPerRow).toBeLessThan(5)
  for (let i = 1; i < tilesPerRow; i++) expect(narrow[3 + i].y).toBeCloseTo(narrow[3].y, 0)
  expect(narrow[3 + tilesPerRow].y).toBeGreaterThan(narrow[3].y + narrow[3].height)
  expect(narrow[3 + tilesPerRow].x).toBeCloseTo(narrow[3].x, 0)
  expect(narrow[9].y).toBeCloseTo(narrow[8].y, 0)
  expect(narrow[15].y).toBeGreaterThan(narrow[14].y + narrow[14].height)
  for (const box of narrow) {
    expect(box.x).toBeGreaterThanOrEqual(box.left)
    expect(box.x + box.width).toBeLessThanOrEqual(box.right + 0.5)
  }
  expect(await doc()).toEqual(before)
  await page.locator('.content-scroll').evaluate((el) => {
    el.scrollTop = 0
  })
  await page.screenshot({
    path: path.join(output, `file-rows-narrow-${russian ? 'dark-ru' : 'light-en'}.png`),
  })
  await page.emulateMedia({ media: 'print' })
  const print = await boxes()
  expect(print[4].y).toBeCloseTo(print[3].y, 0)
  await expect(files().first().locator('.attachment-view-button')).toBeHidden()
  await page.emulateMedia({ media: null })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 900))
  await page.locator('.page-tree').getByRole('button', { name: note.title, exact: true }).click()
  await expect(page.getByLabel(russian ? 'Название страницы' : 'Page title')).toHaveValue(
    note.title,
  )
}
try {
  await launch()
  await expect(files()).toHaveCount(1)
  await expect(files().first()).toHaveAttribute('data-file-view', 'card')
  await app.evaluate(({ dialog }, filePaths) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths })
  }, imports)
  await page.locator('.document-editor > p').last().click()
  await page.keyboard.type('/attachment')
  await page.keyboard.press('Enter')
  await expect(files()).toHaveCount(4)
  const initial = await doc()
  expect(initial.content.filter((n) => n.type === 'attachment').map((n) => n.attrs.name)).toEqual([
    legacy.name,
    ...names,
  ])
  for (const [index, label, display] of [
    [1, 'Compact rectangle', 'compact'],
    [2, 'Square tile', 'tile'],
    [3, 'Link with icon', 'link'],
  ]) {
    const before = await doc()
    await choose(index, label)
    await expect(files().nth(index)).toHaveAttribute('data-file-view', display)
    const after = await doc()
    const expected = structuredClone(before)
    expected.content.filter((n) => n.type === 'attachment')[index].attrs.display = display
    expect(after).toEqual(expected)
    await undo()
    expect(await doc()).toEqual(before)
    await choose(index, label)
  }
  const source = await doc()
  const sourceFiles = source.content.filter((n) => n.type === 'attachment')
  const wide = await files().nth(0).locator('.attachment-open').boundingBox()
  const compact = await files().nth(1).locator('.attachment-open').boundingBox()
  const tile = await files().nth(2).locator('.attachment-open').boundingBox()
  const link = await files().nth(3).locator('.attachment-open').boundingBox()
  expect(compact.width).toBeLessThan(wide.width)
  expect(tile.width).toBeLessThan(compact.width)
  expect(tile.height).toBeCloseTo(tile.width, 0)
  expect(link.height).toBeLessThan(compact.height)
  await expect(files().nth(3).locator('small')).toHaveCount(0)
  await page.getByLabel('Page title').focus()
  await page.mouse.move(10, 10)
  await expect(files().first().locator('.attachment-view-button')).toHaveCSS('opacity', '0')
  await page.screenshot({ path: path.join(output, 'file-views-light-en.png') })
  // Every variant opens the same registered file through the real IPC; only this fixture's shell is stubbed.
  await app.evaluate(({ shell }) => {
    globalThis.attachmentOpens = []
    shell.openPath = async (file) => {
      globalThis.attachmentOpens.push(file)
      return ''
    }
  })
  for (let i = 0; i < 4; i++) await files().nth(i).locator('.attachment-open').click()
  await expect.poll(() => app.evaluate(() => globalThis.attachmentOpens.length)).toBe(4)
  expect(await app.evaluate(() => globalThis.attachmentOpens)).toEqual(
    await Promise.all(
      sourceFiles.map((n) => fs.realpath(path.join(knowledge, 'attachments', n.attrs.file))),
    ),
  )
  // Keyboard selection, Escape/focus return, and anchored menu containment.
  await files().nth(2).hover()
  const trigger = files().nth(2).getByRole('button', { name: 'File view', exact: true })
  await trigger.focus()
  await trigger.press('Enter')
  await expect(page.getByRole('button', { name: 'Square tile', exact: true })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('button', { name: 'Link with icon', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(trigger).toBeFocused()
  // HTML clipboard uses the editor handlers and an in-memory transfer, leaving the OS clipboard untouched.
  const html = await page.locator('.document-editor').evaluate((el) => {
    el.editor.commands.selectAll()
    const data = new DataTransfer()
    el.dispatchEvent(
      new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }),
    )
    return data.getData('text/html')
  })
  for (const display of ['card', 'compact', 'tile', 'link'])
    expect(html).toContain(`data-file-view="${display}"`)
  await page.getByRole('tab').filter({ hasText: target.title }).click()
  await page.locator('.document-editor').evaluate((el, html) => {
    el.editor.commands.focus()
    const data = new DataTransfer()
    data.setData('text/html', html)
    el.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    )
  }, html)
  await expect(files()).toHaveCount(4)
  expect((await doc()).content.filter((n) => n.type === 'attachment')).toEqual(sourceFiles)
  await page.getByRole('tab').filter({ hasText: note.title }).click()
  await fileRows()
  await readingCopyAbsent()
  await settings()
  await expect(page.getByRole('dialog')).not.toContainText(
    'Applies to all pages in this workspace.',
  )
  await page.getByRole('button', { name: 'Dark', exact: true }).click()
  await page.getByRole('button', { name: 'Русский', exact: true }).click()
  await expect(page.getByRole('dialog')).not.toContainText('Для всех страниц пространства.')
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await fileRows(true)
  await readingCopyAbsent(true)
  await page.getByLabel('Название страницы').focus()
  await page.mouse.move(10, 10)
  await page.screenshot({ path: path.join(output, 'file-views-dark-ru.png') })
  await choose(1, 'Ссылка с иконкой', true)
  await choose(1, 'Компактный прямоугольник', true)
  expect(await doc()).toEqual(source)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 780))
  await files().nth(3).hover()
  await files().nth(3).getByRole('button', { name: 'Вид файла', exact: true }).click()
  const bounds = await page.locator('.attachment-view-menu').boundingBox()
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  expect(bounds.x).toBeGreaterThanOrEqual(8)
  expect(bounds.y).toBeGreaterThanOrEqual(8)
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width - 8)
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height - 8)
  await page.screenshot({ path: path.join(output, 'file-view-menu-dark-ru-narrow.png') })
  await page.locator('.content-scroll').evaluate((el) => {
    el.scrollTop = el.scrollHeight
  })
  await page.keyboard.press('Escape')
  // Print/PDF keep full filenames and the selected shape, with no editing controls.
  await page.emulateMedia({ media: 'print' })
  await expect(files().nth(2).locator('strong')).toHaveText(names[1])
  await expect(files().nth(2).locator('strong')).toHaveCSS('overflow', 'visible')
  await expect(files().first().locator('.attachment-view-button')).toBeHidden()
  await page.emulateMedia({ media: null })
  await saved()
  await app.evaluate(({ dialog }, output) => {
    dialog.showSaveDialog = async (_win, options) => ({
      canceled: false,
      filePath: `${output}/${options.defaultPath}`,
    })
  }, output)
  await page.evaluate(async () => {
    const w = (await window.sheco.boot()).active
    await window.sheco.exportPage(w.ui.activeId, 'markdown')
    await window.sheco.exportPage(w.ui.activeId, 'pdf')
  })
  const md = await fs.readFile(path.join(output, 'File views.md'), 'utf8')
  for (const node of sourceFiles) expect(md).toContain(`](attachments/${node.attrs.file})`)
  expect((await fs.readFile(path.join(output, 'File views.pdf'))).subarray(0, 4).toString()).toBe(
    '%PDF',
  )
  expect(await fs.readFile(path.join(knowledge, 'attachments', legacy.file))).toEqual(legacyBytes)
  const disk = JSON.parse(await fs.readFile(path.join(knowledge, 'workspace.json'), 'utf8'))
  expect(disk.pages.find((p) => p.id === note.id).content).toEqual(source)
  expect(
    disk.pages
      .find((p) => p.id === target.id)
      .content.content.filter((n) => n.type === 'attachment'),
  ).toEqual(sourceFiles)
  await close()
  await launch()
  await expect(page.getByLabel('Название страницы')).toHaveValue(note.title)
  for (const [i, display] of ['card', 'compact', 'tile', 'link'].entries())
    await expect(files().nth(i)).toHaveAttribute('data-file-view', display)
  expect(await doc()).toEqual(source)
  await close()
  expect(errors).toEqual([])
  succeeded = true
  console.log(
    'Passed: legacy/default cards, multi-file insertion, four views with exact undo, horizontal compact/tile rows with wrapping and nested containers, independent menus and duplication/undo, file identity and native open IPC, keyboard/focus, clipboard attributes, full filenames in print, Markdown/PDF exports, restart, light English/dark Russian and narrow menus; removed reading scope copy in both menus and Settings.',
  )
} catch (error) {
  if (page) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {})
  throw error
} finally {
  if (app) await app.close().catch(() => {})
  if (succeeded) await fs.rm(root, { recursive: true, force: true })
  else console.error('Fixture preserved for investigation:', root)
}
