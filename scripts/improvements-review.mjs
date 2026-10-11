import { _electron as electron, expect } from '@playwright/test'
import { build } from 'esbuild'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import sharp from 'sharp'

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sheco-improvements-'))
const knowledge = path.join(root, 'Knowledge')
const output = path.resolve('test-results/improvements')
await fs.mkdir(path.join(knowledge, 'attachments'), { recursive: true })
await fs.mkdir(output, { recursive: true })
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
const w = seedWorkspace('Improvements review', false)
w.ui.accent = 'orange'
w.ui.showOutline = false
const note = w.pages[0]
note.title = 'Interactions'
const target = createPage(w, 'Clipboard target')
w.pages.push(target)
w.ui.tabs = [note.id, target.id]
const p = (text) => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] })
const files = []
for (const name of ['First.txt', 'Second.txt']) {
  const attachment = {
    id: uid(),
    file: uid() + '.txt',
    name,
    mime: 'text/plain',
    bytes: 12,
    createdAt: new Date().toISOString(),
  }
  w.attachments.push(attachment)
  await fs.writeFile(path.join(knowledge, 'attachments', attachment.file), 'Fixture file')
  files.push({ type: 'attachment', attrs: { ...attachment, display: 'compact' } })
}
const png = await sharp({ create: { width: 180, height: 70, channels: 3, background: '#8698a2' } })
  .png()
  .toBuffer()
const imageFile = uid() + '.png'
const imagePath = path.join(knowledge, 'attachments', imageFile)
await fs.writeFile(imagePath, png)
w.attachments.push({
  id: uid(),
  file: imageFile,
  name: 'Fixture.png',
  mime: 'image/png',
  bytes: png.length,
  createdAt: new Date().toISOString(),
})
const picture = {
  type: 'image',
  attrs: { src: `sheco-asset://${w.id}/${imageFile}`, caption: 'Retain caption', width: 180 },
}
note.content = {
  type: 'doc',
  content: [
    p('Before blocks'),
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Hello', marks: [{ type: 'bold' }] },
        { type: 'text', text: ' hello Привет' },
      ],
    },
    picture,
    {
      type: 'codeBlock',
      attrs: { language: 'javascript', title: 'Example' },
      content: [{ type: 'text', text: 'hello code' }],
    },
    ...files,
    p('Before table'),
    {
      type: 'table',
      content: Array.from({ length: 2 }, (_, row) => ({
        type: 'tableRow',
        content: Array.from({ length: 2 }, (_, col) => ({
          type: row ? 'tableCell' : 'tableHeader',
          content: [p(`${row}:${col}`)],
        })),
      })),
    },
    p('After table'),
    {
      type: 'orderedList',
      attrs: { start: 1 },
      content: [
        { type: 'listItem', content: [p('List text'), picture] },
        { type: 'listItem', content: [p('Keep sibling')] },
      ],
    },
    p('End'),
  ],
}
await fs.writeFile(path.join(knowledge, 'workspace.json'), JSON.stringify(w))
await fs.writeFile(
  path.join(root, 'spaces.json'),
  JSON.stringify({
    activeId: w.id,
    spaces: [{ id: w.id, name: w.name, icon: w.icon, path: knowledge }],
  }),
)
let app, page
const errors = []
const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
async function launch() {
  app = await electron.launch({ args: ['.'], env: { ...process.env, SHECO_DATA_DIR: root } })
  page = await app.firstWindow()
  page.on('pageerror', (error) => errors.push(error.message))
  await expect(page.locator('.document-editor')).toBeVisible({ timeout: 20000 })
  await app.evaluate(({ BrowserWindow, shell }) => {
    BrowserWindow.getAllWindows()[0].setSize(1440, 1100)
    globalThis.fileOpens = []
    shell.openPath = async (file) => {
      globalThis.fileOpens.push(file)
      return ''
    }
  })
}
const editor = () => page.locator('.document-editor')
const doc = () => editor().evaluate((el) => el.editor.getJSON())
async function saved() {
  await expect(page.locator('.save-status')).toHaveClass(/\bsaved\b/)
}
async function close() {
  await saved()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await app.close()
  app = null
}
async function undo() {
  await editor().evaluate((el) => el.editor.view.focus())
  await page.keyboard.press(mod + '+z')
}
async function tab(title) {
  await page.getByRole('tab').filter({ hasText: title }).click()
  await expect(page.locator('.page-title')).toHaveValue(title)
}
async function select(types) {
  await editor().evaluate((el, types) => {
    const positions = []
    el.editor.state.doc.forEach((node, pos) => {
      if (types.includes(node.type.name)) positions.push(pos)
    })
    el.editor.view.dispatch(
      el.editor.state.tr.setMeta('blockSelection$', positions).setMeta('addToHistory', false),
    )
    el.editor.view.focus()
  }, types)
}
try {
  await launch()
  const baseline = await doc()
  // Disjoint mixed-block copy/cut, real editor clipboard handlers and HTML paste, no OS clipboard.
  await select(['paragraph', 'image', 'codeBlock', 'attachment'])
  await expect(page.locator('.block-is-selected')).toHaveCount(9)
  await expect(page.locator('.block-text-is-selected').first()).toHaveCSS('outline-style', 'none')
  await expect(
    page.locator('.node-attachment.block-is-selected .attachment-open').first(),
  ).toHaveCSS('outline-color', 'rgb(163, 81, 32)')
  await page.screenshot({ path: path.join(output, 'selection-light-en.png') })
  await page.evaluate(() => (document.documentElement.dataset.accent = 'neutral'))
  await expect(
    page.locator('.node-attachment.block-is-selected .attachment-open').first(),
  ).toHaveCSS('outline-color', 'rgb(37, 37, 37)')
  await expect(page.locator('.block-text-is-selected').first()).not.toHaveCSS(
    'background-color',
    'rgba(0, 0, 0, 0)',
  )
  await page.emulateMedia({ media: 'print' })
  await expect(
    page.locator('.node-attachment.block-is-selected .attachment-open').first(),
  ).toHaveCSS('outline-style', 'none')
  await expect(page.locator('.block-text-is-selected').first()).toHaveCSS(
    'background-color',
    'rgba(0, 0, 0, 0)',
  )
  await page.emulateMedia({ media: 'screen' })
  await page.evaluate(() => (document.documentElement.dataset.accent = 'orange'))
  const copied = await editor().evaluate((el) => {
    const data = new DataTransfer()
    el.dispatchEvent(
      new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: data }),
    )
    return { html: data.getData('text/html'), text: data.getData('text/plain') }
  })
  expect(copied.html).toContain('Retain caption')
  expect(copied.html).toContain('data-file-view="compact"')
  expect(copied.text).toContain('Before blocks')
  expect(await doc()).toEqual(baseline)
  const cut = await editor().evaluate((el) => {
    const data = new DataTransfer()
    el.dispatchEvent(
      new ClipboardEvent('cut', { bubbles: true, cancelable: true, clipboardData: data }),
    )
    return data.getData('text/html')
  })
  expect(cut).toEqual(copied.html)
  expect((await doc()).content).toEqual([
    ...baseline.content.filter((node) => ['table', 'orderedList'].includes(node.type)),
    { type: 'paragraph' },
  ])
  await undo()
  expect(await doc()).toEqual(baseline)
  await tab(target.title)
  await editor().evaluate((el, html) => {
    const data = new DataTransfer()
    data.setData('text/html', html)
    el.editor.commands.focus()
    el.dispatchEvent(
      new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }),
    )
  }, copied.html)
  const pasted = (await doc()).content.filter(
    (node) => node.type !== 'paragraph' || node.content?.length,
  )
  expect(pasted).toEqual(
    baseline.content.filter((node) =>
      ['paragraph', 'image', 'codeBlock', 'attachment'].includes(node.type),
    ),
  )
  await tab(note.title)
  await page.keyboard.press('Escape')
  // Ctrl+D on macOS must duplicate the list text without forward-deleting its picture.
  await page
    .locator('.document-editor li p')
    .filter({ hasText: /^List text$/ })
    .click()
  await page.keyboard.press('Control+d')
  let list = (await doc()).content.find((node) => node.type === 'orderedList')
  expect(list.content[0].content.map((node) => node.type)).toEqual([
    'paragraph',
    'paragraph',
    'image',
  ])
  expect(list.content[0].content[2]).toEqual(
    baseline.content.find((node) => node.type === 'orderedList').content[0].content[1],
  )
  await undo()
  expect(await doc()).toEqual(baseline)
  // Literal page search, case option, replacement in text and code, atomic undo.
  await editor().evaluate((el) => el.editor.commands.setTextSelection(1))
  await page.keyboard.press(mod + '+f')
  await page.getByLabel('Find in page', { exact: true }).fill('hello')
  await expect(page.locator('.find-count')).toHaveText('1 / 3')
  await page.getByLabel('Match case', { exact: true }).check()
  await expect(page.locator('.find-count')).toHaveText('1 / 2')
  await page.getByLabel('Match case', { exact: true }).uncheck()
  await page.getByRole('button', { name: 'Next match', exact: true }).click()
  await expect(page.locator('.find-count')).toHaveText('2 / 3')
  await page.getByRole('button', { name: 'Next match', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('.find-count')).toHaveText('3 / 3')
  await page.getByRole('button', { name: 'Show replacement', exact: true }).click()
  await page.getByLabel('Replace with', { exact: true }).fill('Welcome')
  await page.getByRole('button', { name: 'Replace all', exact: true }).click()
  await expect(page.locator('.find-count')).toHaveText('No matches')
  expect((await doc()).content[1].content[0]).toEqual({
    type: 'text',
    text: 'Welcome',
    marks: [{ type: 'bold' }],
  })
  await page.getByRole('button', { name: 'Close find and replace', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('.editor-find-panel')).toHaveCount(0)
  await undo()
  expect(await doc()).toEqual(baseline)
  // Table gaps and the handle after traversing the last-row append strip.
  const before = page.locator('.document-editor > p').filter({ hasText: /^Before table$/ })
  const after = page.locator('.document-editor > p').filter({ hasText: /^After table$/ })
  await before.scrollIntoViewIfNeeded()
  const table = page.locator('.tableWrapper').first()
  const b = await before.boundingBox(),
    t = await table.boundingBox()
  expect(t.y - b.y - b.height).toBeLessThan(35)
  await after.hover()
  const grip = page.getByRole('button', { name: 'Block options', exact: true })
  await expect(grip).toBeVisible()
  const normal = await grip.boundingBox()
  await table.locator('td').last().hover()
  await expect(page.locator('.table-add-row')).toBeVisible()
  await page.locator('.table-add-row').hover()
  await after.hover()
  await expect.poll(async () => (await grip.boundingBox())?.x).toBeCloseTo(normal.x, 0)
  // Direct card movement across a horizontal file row, with a card preview and vertical marker.
  const first = page.locator('.attachment-open').filter({ hasText: 'First.txt' })
  const second = page.locator('.attachment-open').filter({ hasText: 'Second.txt' })
  await first.scrollIntoViewIfNeeded()
  const a = await first.boundingBox(),
    c = await second.boundingBox()
  expect(a.y).toBeCloseTo(c.y, 0)
  await page.mouse.move(a.x + 45, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(a.x + 65, a.y + a.height / 2, { steps: 5 })
  await page.mouse.move(c.x + c.width - 15, c.y + c.height / 2, { steps: 20 })
  await expect(page.locator('.block-batch-drop-marker')).toBeVisible()
  const marker = await page.locator('.block-batch-drop-marker').boundingBox()
  expect(marker.width).toBe(3)
  expect(marker.height).toBeGreaterThan(40)
  await expect(page.locator('.block-file-drag-preview .attachment-open')).toHaveCount(1)
  await page.screenshot({ path: path.join(output, 'file-drag-light-en.png') })
  await page.mouse.up()
  expect(
    (await doc()).content
      .filter((node) => node.type === 'attachment')
      .map((node) => node.attrs.name),
  ).toEqual(['Second.txt', 'First.txt'])
  expect(await app.evaluate(() => globalThis.fileOpens.length)).toBe(0)
  await undo()
  expect(await doc()).toEqual(baseline)
  await page.keyboard.press('Escape')
  // An external image drop completes the native cursor lifecycle before async import finishes.
  await app.evaluate(({ dialog }) => {
    dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] })
  })
  const imageData = [...png]
  await editor().evaluate((el, bytes) => {
    const data = new DataTransfer()
    data.items.add(new File([new Uint8Array(bytes)], 'Dropped.png', { type: 'image/png' }))
    const r = el.getBoundingClientRect()
    const options = {
      bubbles: true,
      cancelable: true,
      dataTransfer: data,
      clientX: r.left + 30,
      clientY: r.top + 20,
    }
    el.dispatchEvent(new DragEvent('dragover', options))
    el.dispatchEvent(new DragEvent('drop', options))
  }, imageData)
  await expect(page.locator('.editor-drop-cursor')).toHaveCount(0, { timeout: 1000 })
  await expect
    .poll(async () => (await doc()).content.filter((node) => node.type === 'image').length)
    .toBe(2)
  await undo()
  expect(await doc()).toEqual(baseline)
  // Sidebar pointer resizing, keyboard support and saved width after restart.
  const resizer = page.getByRole('separator', { name: 'Resize sidebar', exact: true })
  const bounds = await resizer.boundingBox()
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 120)
  await page.mouse.down()
  await page.mouse.move(bounds.x + bounds.width / 2 + 108, bounds.y + 120, { steps: 12 })
  await page.mouse.up()
  await expect(resizer).toHaveAttribute('aria-valuenow', '360')
  await resizer.focus()
  await page.keyboard.press('ArrowRight')
  await expect(resizer).toHaveAttribute('aria-valuenow', '380')
  await close()
  await launch()
  await expect(
    page.getByRole('separator', { name: 'Resize sidebar', exact: true }),
  ).toHaveAttribute('aria-valuenow', '380')
  expect((await fs.readFile(imagePath)).equals(png)).toBe(true)
  // Both themes and languages use accent selection and the translated search controls.
  await page
    .locator('.sidebar-footer')
    .getByRole('button', { name: 'Settings', exact: true })
    .click()
  await page.getByRole('button', { name: 'Dark', exact: true }).click()
  await page.getByRole('button', { name: 'Русский', exact: true }).click()
  await page.keyboard.press('Escape')
  await select(['paragraph', 'image', 'attachment'])
  await page.locator('.content-scroll').evaluate((el) => {
    el.scrollTop = 0
  })
  await page.screenshot({ path: path.join(output, 'selection-dark-ru.png') })
  await editor().evaluate((el) => el.editor.commands.setTextSelection(1))
  await page.keyboard.press(mod + '+f')
  await page.getByLabel('Найти на странице', { exact: true }).fill('hello')
  await page.getByRole('button', { name: 'Показать замену', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Заменить все', exact: true })).toBeVisible()
  await page.screenshot({ path: path.join(output, 'find-replace-dark-ru.png') })
  await page.keyboard.press('Escape')
  expect(errors).toEqual([])
  await close()
  console.log(
    JSON.stringify(
      {
        checks:
          'Mixed clipboard/cut/paste, Ctrl+D, find/replace/undo, table gap/handle, direct file drag, drop cursor cleanup, sidebar persistence, light/en and dark/ru',
        screenshots: output,
        fixture: root,
        rendererErrors: errors,
      },
      null,
      2,
    ),
  )
} catch (error) {
  if (page && !page.isClosed())
    await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {})
  console.error('Preserved fixture:', root)
  throw error
} finally {
  if (app) {
    await app
      .evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close())
      .catch(() => {})
    await app.close().catch(() => {})
  }
}
