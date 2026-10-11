import { _electron as electron, expect } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sheco-images-'))
const output = path.resolve('test-results/images')
await fs.mkdir(output, { recursive: true })
const fixture = path.join(root, 'image-fixture.png')
await sharp(
  Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="600"><rect width="1000" height="600" fill="#e9edf2"/><rect width="500" height="300" fill="#b9c9d7"/><rect x="500" width="500" height="300" fill="#526778"/><rect y="300" width="500" height="300" fill="#8695a2"/><circle cx="740" cy="410" r="90" fill="#fafafa"/></svg>',
  ),
)
  .png()
  .toFile(fixture)
let app,
  page,
  succeeded = false
const errors = []
const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
async function launch() {
  app = await electron.launch({ args: ['.'], env: { ...process.env, SHECO_DATA_DIR: root } })
  page = await app.firstWindow()
  page.on('pageerror', (e) => errors.push(e.message))
  await expect(page.getByLabel('Page title')).toBeVisible({ timeout: 20000 })
}
async function saved() {
  await expect(page.locator('.save-status')).toHaveClass(/\bsaved\b/)
}
async function close() {
  await saved()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await app.close()
}
async function imageNode() {
  const data = JSON.parse(await fs.readFile(path.join(root, 'Knowledge', 'workspace.json'), 'utf8'))
  return data.pages
    .find((p) => p.title === 'Image review')
    .content.content.find((n) => n.type === 'image')
}
async function compactCropControls(russian = false) {
  const dialog = page.getByRole('dialog', { name: russian ? 'Обрезка изображения' : 'Crop image' })
  await expect(dialog).toBeVisible()
  for (const name of [
    russian ? 'Свободные' : 'Free',
    russian ? 'Исходные' : 'Original',
    '1:1',
    '4:3',
    '16:9',
    '3:4',
  ])
    await expect(dialog.getByRole('button', { name, exact: true })).toHaveCount(0)
  await expect(
    dialog.getByText(
      russian
        ? 'Перетащите рамку или её углы. Клавиши со стрелками изменяют область на один пиксель.'
        : 'Drag the frame or its corners. Arrow keys adjust by a pixel.',
      { exact: true },
    ),
  ).toHaveCount(0)
  await expect(
    dialog.getByText(
      russian
        ? 'Оригинал сохраняется. Обрезка сохраняется отдельным изображением.'
        : 'Your original is kept. The crop is saved as a still image.',
      { exact: true },
    ),
  ).toHaveCount(0)
  await expect(
    dialog.getByRole('button', {
      name: russian ? 'Сбросить выделение' : 'Reset selection',
      exact: true,
    }),
  ).toBeEnabled()
}
try {
  await launch()
  await app.evaluate(({ BrowserWindow, dialog }, fixture) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixture] })
    BrowserWindow.getAllWindows()[0].webContents.send('menu', 'newPage')
  }, fixture)
  await expect(page.getByLabel('Page title')).toHaveValue('Untitled')
  await page.getByLabel('Page title').fill('Image review')
  await page.locator('.document-editor p').last().click()
  await page.keyboard.type('/image')
  await page.keyboard.press('Enter')
  let frame = page.locator('.image-frame')
  let img = frame.locator('img')
  await expect(img).toBeVisible()
  await expect(page.getByRole('button', { name: 'Crop', exact: true })).toBeEnabled()
  await img.click()
  await page.getByRole('button', { name: 'Full width', exact: true }).click()
  const full = await frame.boundingBox()
  const handle = page.getByRole('slider', { name: 'Resize image from right' })
  const box = await handle.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 - 100, box.y + box.height / 2, { steps: 10 })
  await page.mouse.up()
  await saved()
  const resized = await imageNode()
  expect(resized.attrs.width).toBeCloseTo(full.width - 200, 0)
  expect((await frame.boundingBox()).height / (await frame.boundingBox()).width).toBeCloseTo(0.6)
  await page.keyboard.press(`${mod}+z`)
  expect((await frame.boundingBox()).width).toBeCloseTo(full.width, 0)
  await page.keyboard.press(`${mod}+Shift+z`)
  await saved()
  expect((await imageNode()).attrs.width).toBe(resized.attrs.width)
  await handle.focus()
  await handle.press('ArrowRight')
  await saved()
  expect((await imageNode()).attrs.width).toBe(resized.attrs.width + 1)
  await page.screenshot({ path: path.join(output, 'resize.png') })
  console.log('Images: drag resize, preserved aspect ratio, undo/redo and keyboard sizing passed')

  await page.getByRole('button', { name: 'Crop', exact: true }).click()
  await compactCropControls()
  await expect(page.getByLabel('Crop dimensions')).toHaveText('1000 × 600 px')
  const cropFrame = page.locator('.image-crop-selection')
  expect(await cropFrame.evaluate((el) => getComputedStyle(el).boxShadow)).toContain('inset')
  const stageBounds = await page.locator('.image-crop-stage').boundingBox()
  for (const corner of await page.locator('.crop-corner').all()) {
    const bounds = await corner.boundingBox()
    expect(bounds.x).toBeGreaterThanOrEqual(stageBounds.x)
    expect(bounds.y).toBeGreaterThanOrEqual(stageBounds.y)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(stageBounds.x + stageBounds.width)
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(stageBounds.y + stageBounds.height)
    expect(await corner.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
      'rgb(255, 255, 255)',
    )
  }
  await page.screenshot({ path: path.join(output, 'crop-full-frame-light.png') })
  // Free resizing changes width independently of height, including with the keyboard.
  const topLeft = page.getByRole('button', { name: 'Resize crop top left', exact: true })
  await topLeft.focus()
  for (let i = 0; i < 20; i++) await topLeft.press('Shift+ArrowRight')
  await expect(page.getByLabel('Crop dimensions')).toHaveText('800 × 600 px')
  const bottomRight = page.getByRole('button', { name: 'Resize crop bottom right', exact: true })
  await bottomRight.focus()
  for (let i = 0; i < 20; i++) await bottomRight.press('Shift+ArrowLeft')
  await expect(page.getByLabel('Crop dimensions')).toHaveText('600 × 600 px')
  await page.screenshot({ path: path.join(output, 'crop-dialog.png') })
  await page.getByRole('button', { name: 'Apply crop', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Crop image' })).toHaveCount(0)
  await saved()
  const cropped = await imageNode()
  expect(cropped.attrs.originalSrc).toBe(resized.attrs.src)
  expect(cropped.attrs.src).not.toBe(resized.attrs.src)
  expect(cropped.attrs.crop.x).toBeCloseTo(0.2)
  expect(cropped.attrs.crop.width).toBeCloseTo(0.6)
  expect(cropped.attrs.crop.y).toBe(0)
  expect(cropped.attrs.crop.height).toBe(1)
  const file = path.join(root, 'Knowledge', 'attachments', cropped.attrs.src.split('/').pop())
  const originalFile = path.join(
    root,
    'Knowledge',
    'attachments',
    resized.attrs.src.split('/').pop(),
  )
  expect(await fs.readFile(originalFile)).toEqual(await fs.readFile(fixture))
  const actual = await sharp(file).raw().toBuffer({ resolveWithObject: true })
  const expected = await sharp(fixture)
    .extract({ left: 200, top: 0, width: 600, height: 600 })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  expect(actual.info.width).toBe(600)
  expect(actual.info.height).toBe(600)
  const actualRgba = await sharp(file).ensureAlpha().raw().toBuffer()
  expect(actualRgba).toEqual(expected.data)
  expect((await frame.boundingBox()).height / (await frame.boundingBox()).width).toBeCloseTo(1)
  await img.click()
  await page.screenshot({ path: path.join(output, 'cropped.png') })
  console.log(
    'Images: local crop pixels match the selected source area; original attachment unchanged',
  )

  await page.getByRole('button', { name: 'Crop', exact: true }).click()
  await expect(page.getByLabel('Crop dimensions')).toHaveText('600 × 600 px')
  const move = page.getByRole('button', { name: 'Move crop selection', exact: true })
  await move.focus()
  await move.press('Shift+ArrowRight')
  const selection = page.locator('.image-crop-selection')
  expect(await selection.evaluate((el) => parseFloat(el.style.left))).toBeCloseTo(21)
  const corner = page.getByRole('button', { name: 'Resize crop bottom right', exact: true })
  const cornerBox = await corner.boundingBox()
  await page.mouse.move(cornerBox.x + cornerBox.width / 2, cornerBox.y + cornerBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(
    cornerBox.x + cornerBox.width / 2 - 60,
    cornerBox.y + cornerBox.height / 2 - 40,
    { steps: 8 },
  )
  await page.mouse.up()
  expect(await selection.evaluate((el) => parseFloat(el.style.width))).toBeLessThan(60)
  expect(await selection.evaluate((el) => parseFloat(el.style.height))).toBeLessThan(100)
  const freeDimensions = await page.getByLabel('Crop dimensions').textContent()
  const [freeWidth, freeHeight] = freeDimensions.match(/\d+/g).map(Number)
  expect(freeWidth).not.toBe(freeHeight)
  await page.getByRole('button', { name: 'Reset selection', exact: true }).click()
  await expect(page.getByLabel('Crop dimensions')).toHaveText('1000 × 600 px')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await saved()
  expect((await imageNode()).attrs.src).toBe(cropped.attrs.src)
  await page.getByRole('button', { name: 'Reset crop', exact: true }).click()
  await expect(img).toHaveAttribute('src', resized.attrs.src)
  await page.keyboard.press(`${mod}+z`)
  await expect(img).toHaveAttribute('src', cropped.attrs.src)
  await saved()
  console.log(
    'Images: recrop starts from original, move/corner controls work, cancel/reset/undo passed',
  )

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
  expect(await fs.readFile(path.join(output, 'Image review.md'), 'utf8')).toContain(
    cropped.attrs.src.split('/').pop(),
  )
  expect(
    await fs.readFile(path.join(output, 'attachments', cropped.attrs.src.split('/').pop())),
  ).toEqual(await fs.readFile(file))
  expect((await fs.readFile(path.join(output, 'Image review.pdf'))).subarray(0, 4).toString()).toBe(
    '%PDF',
  )
  console.log('Images: Markdown exports the cropped attachment and PDF export passed')
  await close()
  await launch()
  frame = page.locator('.image-frame')
  img = frame.locator('img')
  await expect(img).toHaveAttribute('src', cropped.attrs.src)
  const persisted = await imageNode()
  expect(persisted.attrs.crop).toEqual(cropped.attrs.crop)
  expect(persisted.attrs.width).toBe(cropped.attrs.width)
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Dark', exact: true }).click()
  await page.getByRole('button', { name: 'Русский', exact: true }).click()
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click()
  await img.click()
  await page.getByRole('button', { name: 'Обрезать', exact: true }).click()
  await compactCropControls(true)
  await expect(page.getByLabel('Размеры обрезки')).toHaveText('600 × 600 px')
  await page.locator('.crop-corner.se').press('ArrowLeft')
  await expect(page.getByLabel('Размеры обрезки')).toHaveText('599 × 600 px')
  await page.screenshot({ path: path.join(output, 'crop-dark.png') })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(590, 780))
  const dialogBounds = await page.getByRole('dialog', { name: 'Обрезка изображения' }).boundingBox()
  for (const name of ['Отмена', 'Применить']) {
    const button = page.getByRole('button', { name, exact: true })
    await expect(button).toBeVisible()
    const bounds = await button.boundingBox()
    expect(bounds.x).toBeGreaterThanOrEqual(dialogBounds.x)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(dialogBounds.x + dialogBounds.width)
  }
  await page.screenshot({ path: path.join(output, 'crop-dark-ru-narrow.png') })
  await page.getByRole('button', { name: 'Отмена', exact: true }).click()
  expect(errors).toEqual([])
  await close()
  console.log(
    'Images: free-only crop, no ratio presets or explanatory text, independent keyboard/pointer resizing, selection reset, original pixels, undo, exports and restart passed; light English/dark Russian and narrow layout checked; no renderer errors',
  )
  succeeded = true
} catch (e) {
  if (page) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {})
  console.error(e)
  console.error('Fixture preserved for investigation:', root)
  process.exitCode = 1
} finally {
  if (app) await app.close().catch(() => {})
  if (succeeded) await fs.rm(root, { recursive: true, force: true })
}
