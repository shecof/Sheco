import { _electron as electron, expect } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sheco-media-'))
const output = path.resolve('test-results/media')
await fs.mkdir(output, { recursive: true })
const files = []
for (const [i, color] of ['#67879c', '#aa8b74', '#838878'].entries()) {
  const file = path.join(root, `photo-${i + 1}.png`)
  await sharp({ create: { width: 600, height: 320, channels: 3, background: color } })
    .png()
    .toFile(file)
  files.push(file)
}
const notes = [path.join(root, 'one.txt'), path.join(root, 'two.txt')]
await Promise.all(notes.map((file, i) => fs.writeFile(file, 'Attachment ' + i)))
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
}
async function choose(files) {
  await app.evaluate(({ dialog }, files) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: files })
  }, files)
}
async function slash(command) {
  await page.locator('.document-editor > p').last().click()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End')
  await page.keyboard.type('/' + command)
  await page.keyboard.press('Enter')
}
async function snapshot() {
  await saved()
  return JSON.parse(await fs.readFile(path.join(root, 'Knowledge', 'workspace.json'), 'utf8'))
}
async function drop(target, names) {
  const payload = await Promise.all(
    names.map(async (file) => ({
      name: path.basename(file),
      data: [...(await fs.readFile(file))],
      type: 'image/png',
    })),
  )
  const transfer = await page.evaluateHandle((payload) => {
    const dt = new DataTransfer()
    for (const file of payload)
      dt.items.add(new File([new Uint8Array(file.data)], file.name, { type: file.type }))
    return dt
  }, payload)
  await target.dispatchEvent('dragover', { dataTransfer: transfer })
  await target.dispatchEvent('drop', { dataTransfer: transfer, clientX: 500, clientY: 260 })
  await transfer.dispose()
}
try {
  await launch()
  await expect(page.getByRole('button', { name: 'New database', exact: true })).toHaveCount(0)
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.send('menu', 'newPage'),
  )
  await page.getByLabel('Page title').fill('Media review')
  await expect(page.locator('.document-editor')).toBeVisible()
  // Drop on page heading, outside the editor/dropcursor, imports every image.
  await drop(page.locator('.page-heading'), files)
  await expect(page.getByRole('dialog', { name: 'Insert images' })).toBeVisible()
  await page.screenshot({ path: path.join(output, 'import-choice.png') })
  await page.getByRole('button', { name: 'Separate images', exact: false }).click()
  await expect(page.locator('.image-block')).toHaveCount(3)
  await expect(page.locator('.image-frame img').nth(2)).toHaveAttribute('alt', 'photo-3.png')
  const first = page.locator('.image-block').first()
  await first.locator('img').click()
  await first.getByRole('button', { name: 'Caption', exact: true }).click()
  await first.getByLabel('Image caption').fill('Caption with [brackets] and *stars*')
  await first.getByLabel('Image caption').press('Enter')
  await expect(first.getByLabel('Image caption')).not.toBeFocused()
  await expect(first.getByLabel('Image caption')).toHaveValue('Caption with [brackets] and *stars*')
  // Native selection of multiple images supports a slider.
  await choose(files.slice(0, 2))
  await slash('image')
  await expect(page.locator('.image-block')).toHaveCount(3)
  await page.getByRole('button', { name: 'Image slider', exact: false }).click()
  await expect(page.locator('.image-gallery')).toHaveCount(1)
  await expect(page.locator('.gallery-active img')).toHaveAttribute('alt', 'photo-1.png')
  await page.getByRole('button', { name: 'Next image', exact: true }).click()
  await expect(page.locator('.gallery-active img')).toHaveAttribute('alt', 'photo-2.png')
  const gallery = page.locator('.image-gallery')
  await gallery.locator('.image-frame img').click()
  await gallery.getByRole('button', { name: 'Caption', exact: true }).click()
  await gallery.getByLabel('Image caption').fill('Second slide')
  await gallery.getByLabel('Image caption').press('Enter')
  await expect(gallery.getByLabel('Image caption')).not.toBeFocused()
  await expect(gallery.getByLabel('Image caption')).toHaveValue('Second slide')
  await gallery.getByRole('button', { name: 'Full width', exact: true }).click()
  // Attachment command keeps even image files as attachments; nothing replaces earlier nodes.
  await choose([...notes, files[0]])
  await slash('attachment')
  await expect(page.locator('.attachment-block')).toHaveCount(3)
  // Code title and gutter preserve code, including the empty last line.
  await slash('code')
  await page.keyboard.type('const value = 1;\nconsole.log(value);\n')
  await page.getByRole('button', { name: 'Code block settings', exact: true }).click()
  const toggleBounds = await page
    .getByRole('checkbox', { name: 'Show line numbers', exact: true })
    .locator('..')
    .boundingBox()
  const checkBounds = await page
    .getByRole('checkbox', { name: 'Show line numbers', exact: true })
    .boundingBox()
  expect(checkBounds.width).toBeLessThan(20)
  expect(checkBounds.x - toggleBounds.x).toBeLessThan(2)
  expect(
    Math.abs(checkBounds.y + checkBounds.height / 2 - toggleBounds.y - toggleBounds.height / 2),
  ).toBeLessThan(2)
  await page.getByLabel('Block title', { exact: true }).fill('Example.ts')
  await page.getByRole('checkbox', { name: 'Show line numbers', exact: true }).check()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.locator('.code-title')).toHaveText('Example.ts')
  await expect(page.locator('.code-line-numbers > span')).toHaveCount(3)
  expect(
    await page.locator('.code-block code').evaluate((el) => getComputedStyle(el).fontFamily),
  ).toContain('Consolas')
  await expect(page.locator('.code-block')).toHaveAttribute('spellcheck', 'false')
  // Localized controls react without recreating the document or changing its data.
  await page
    .locator('.sidebar-footer')
    .getByRole('button', { name: 'Settings', exact: true })
    .click()
  await page.getByRole('button', { name: 'Русский', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Настройки', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Настройки блока кода', exact: true }),
  ).toBeVisible()
  await expect(page.getByLabel('Название страницы')).toHaveValue('Media review')
  await page.screenshot({ path: path.join(output, 'media-russian.png') })
  const data = await snapshot()
  const doc = data.pages.find((p) => p.title === 'Media review').content.content
  await fs.writeFile(path.join(output, 'document.json'), JSON.stringify(doc, null, 2))
  expect(doc.filter((n) => n.type === 'image')).toHaveLength(3)
  expect(doc.find((n) => n.type === 'image').attrs.caption).toContain('[brackets]')
  expect(doc.find((n) => n.type === 'imageGallery').attrs.images).toHaveLength(2)
  expect(doc.find((n) => n.type === 'imageGallery').attrs.images[1].caption).toBe('Second slide')
  expect(doc.filter((n) => n.type === 'attachment')).toHaveLength(3)
  expect(doc.find((n) => n.type === 'codeBlock').content[0].text).toBe(
    'const value = 1;\nconsole.log(value);\n',
  )
  // Print includes every slide; interactive controls/caption fields stay hidden.
  await page.emulateMedia({ media: 'print' })
  await expect(page.locator('.gallery-print img')).toHaveCount(2)
  await expect(page.locator('.gallery-print')).toBeVisible()
  await expect(first.locator('.image-caption-print')).toHaveText(
    'Caption with [brackets] and *stars*',
  )
  await expect(first.getByLabel('Подпись изображения')).toBeHidden()
  await page.emulateMedia({ media: null })
  await close()
  await launch()
  await expect(page.getByLabel('Название страницы')).toHaveValue('Media review')
  await expect(page.locator('.image-gallery')).toHaveCount(1)
  await expect(page.locator('.code-title')).toHaveText('Example.ts')
  await page.getByRole('button', { name: 'Следующее изображение', exact: true }).click()
  await expect(page.getByLabel('Подпись изображения').last()).toHaveValue('Second slide')
  // Split the slider without losing the caption, size, or other blocks.
  await page
    .locator('.image-gallery')
    .getByRole('button', { name: 'Отдельные изображения', exact: true })
    .click()
  await expect(page.locator('.image-gallery')).toHaveCount(0)
  await expect(page.locator('.image-block')).toHaveCount(5)
  await page
    .locator('.sidebar-footer')
    .getByRole('button', { name: 'Настройки', exact: true })
    .click()
  await page.getByRole('button', { name: 'English', exact: true }).click()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.getByLabel('Page title')).toHaveValue('Media review')
  await close()
  expect(errors).toEqual([])
  console.log(
    'Passed: page-wide batch drops, separate images, slider navigation/splitting, captions, multi-file attachments, code settings, print, language switching, and restart persistence.',
  )
} catch (error) {
  if (page) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {})
  throw error
} finally {
  if (app) await app.close().catch(() => {})
  await fs.rm(root, { recursive: true, force: true })
}
