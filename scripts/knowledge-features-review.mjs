import { _electron as electron, expect } from '@playwright/test'
import { build } from 'esbuild'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import sharp from 'sharp'
import { execFileSync } from 'node:child_process'

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sheco-knowledge-features-'))
console.log('Fixture:', root)
const knowledge = path.join(root, 'Knowledge')
const output = path.resolve('test-results/knowledge-features')
await fs.mkdir(path.join(knowledge, 'attachments'), { recursive: true })
await fs.mkdir(output, { recursive: true })
const bundled = await build({
  stdin: {
    contents:
      "export { seedWorkspace } from './src/shared/seed'; export { createPage, uid, workspaceSchema } from './src/shared/model'; export { defaultDiagramSource } from './src/shared/diagram'",
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
})
const modulePath = path.join(root, 'fixture.mjs')
await fs.writeFile(modulePath, bundled.outputFiles[0].contents)
const { seedWorkspace, createPage, uid, workspaceSchema, defaultDiagramSource } = await import(
  pathToFileURL(modulePath).href
)
const w = seedWorkspace('Knowledge features', false)
const note = createPage(w, 'Files and reading')
const diagrams = createPage(w, 'Diagrams')
const slashNote = createPage(w, 'Create diagram')
const text = (text) => ({ type: 'text', text })
const p = (value) => ({ type: 'paragraph', content: value ? [text(value)] : [] })
const h = (value) => ({ type: 'heading', attrs: { level: 2 }, content: [text(value)] })
const filler = () =>
  Array.from({ length: 18 }, (_, i) =>
    p(
      `Reading paragraph ${i + 1}. Useful context stays in this document. More text makes the page tall enough to test navigation to the upper edge of the reading viewport.`,
    ),
  )
const bytes = await sharp({
  create: { width: 400, height: 160, channels: 3, background: '#8a9fa6' },
})
  .png()
  .toBuffer()
const attachment = {
  id: uid(),
  file: uid() + '.png',
  name: 'План проекта 2026.png',
  mime: 'image/png',
  bytes: bytes.length,
  createdAt: new Date().toISOString(),
}
await fs.writeFile(path.join(knowledge, 'attachments', attachment.file), bytes)
w.attachments.push(attachment)
const image = {
  src: `sheco-asset://${w.id}/${attachment.file}`,
  alt: 'Picture',
  caption: 'Before text after',
  width: 280,
}
note.content = {
  type: 'doc',
  content: [
    h('First section'),
    { type: 'image', attrs: image },
    {
      type: 'imageGallery',
      attrs: { width: 280, images: [image, { ...image, caption: 'Second caption' }] },
    },
    {
      type: 'attachment',
      attrs: {
        id: attachment.id,
        file: attachment.file,
        name: attachment.name,
        bytes: attachment.bytes,
      },
    },
    ...filler(),
    {
      type: 'details',
      attrs: { open: false },
      content: [
        { type: 'detailsSummary', content: [text('Folded content')] },
        {
          type: 'detailsContent',
          content: [
            {
              type: 'details',
              attrs: { open: false },
              content: [
                { type: 'detailsSummary', content: [text('Inner fold')] },
                {
                  type: 'detailsContent',
                  content: [h('Folded heading'), p('The first click reveals both folds.')],
                },
              ],
            },
          ],
        },
      ],
    },
    ...filler(),
    h('Last section'),
    ...filler(),
  ],
}
diagrams.content = {
  type: 'doc',
  content: [{ type: 'mermaid', attrs: { source: defaultDiagramSource, positions: {} } }, p()],
}
w.pages.push(note, diagrams, slashNote)
w.ui.activeId = note.id
w.ui.tabs = [note.id, diagrams.id]
w.ui.theme = 'light'
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
const caseName = process.env.SHECO_FEATURE_CASE
async function launch() {
  app = await electron.launch({ args: ['.'], env: { ...process.env, SHECO_DATA_DIR: root } })
  page = await app.firstWindow()
  page.on('pageerror', (error) => errors.push(error.message))
  await expect(page.locator('.page-title')).toBeVisible({ timeout: 20000 })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1200, 850))
}
async function saved() {
  await expect(page.locator('.save-status')).toHaveClass(/\bsaved\b/)
}
async function snapshot() {
  await saved()
  return JSON.parse(await fs.readFile(path.join(knowledge, 'workspace.json'), 'utf8'))
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
  await expect(page.locator('.page-title')).toHaveValue(w.pages.find((p) => p.id === id).title)
}
async function close() {
  if (!app) return
  await saved()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await app.close()
  app = null
}
async function caretInsertion(input, before, offset, insert) {
  await input.fill(before)
  await input.evaluate((element, offset) => {
    element.focus()
    element.setSelectionRange(offset, offset)
  }, offset)
  await input.pressSequentially(insert, { delay: 70 })
  await expect(input).toHaveValue(before.slice(0, offset) + insert + before.slice(offset))
  expect(await input.evaluate((element) => element.selectionStart)).toBe(offset + insert.length)
  await input.press('Enter')
  await expect(input).not.toBeFocused()
}
async function captions() {
  await open(note.id)
  await caretInsertion(
    page.locator('.image-block').first().getByLabel('Image caption'),
    'Before text after',
    7,
    'middle ',
  )
  await caretInsertion(
    page.locator('.image-gallery').getByLabel('Image caption'),
    'Gallery caption',
    7,
    'middle ',
  )
  await page.getByRole('button', { name: 'Next image', exact: true }).click()
  await caretInsertion(
    page.locator('.image-gallery').getByLabel('Image caption'),
    'Second caption',
    7,
    'middle ',
  )
  const current = (await snapshot()).pages.find((p) => p.id === note.id).content.content
  expect(current.find((n) => n.type === 'image').attrs.caption).toBe('Before middle text after')
  expect(current.find((n) => n.type === 'imageGallery').attrs.images.map((n) => n.caption)).toEqual(
    ['Gallerymiddle  caption', 'Second middle caption'],
  )
}
async function filenames() {
  await menu('search')
  await page.locator('.quick-search-input input').fill('ПЛАН 2026')
  await expect(page.locator('.search-result')).toHaveCount(1)
  await expect(page.locator('.search-result strong')).toContainText(attachment.name)
  await expect(page.locator('.search-path')).toContainText(note.title)
  await page.locator('.quick-search-input input').press('Enter')
  await expect(page.locator('.modal-overlay')).toHaveCount(0)
  await expect(page.locator('.page-title')).toHaveValue(note.title)
}
async function outline() {
  await open(note.id)
  for (const name of ['Last section', 'First section', 'Folded heading', 'Last section']) {
    await page.locator('.page-outline').getByRole('button', { name, exact: true }).click()
    await expect
      .poll(() =>
        page
          .locator('.document-editor h2')
          .filter({ hasText: name })
          .evaluate(
            (element) =>
              element.getBoundingClientRect().top -
              element.closest('.content-scroll').getBoundingClientRect().top,
          ),
      )
      .toBeCloseTo(24, 0)
  }
  expect(
    (await snapshot()).pages
      .find((p) => p.id === note.id)
      .content.content.filter((n) => n.type === 'details')[0].attrs.open,
  ).toBe(true)
}
async function previewReady(locator) {
  await expect(locator.locator('.diagram-preview, .diagram-canvas')).toHaveAttribute(
    'aria-busy',
    'false',
    {
      timeout: 30000,
    },
  )
  await expect(locator.locator('.diagram-svg svg, .diagram-canvas-svg svg')).toBeVisible()
  await expect(locator.locator('.diagram-error')).toHaveCount(0)
}
async function diagramEditing() {
  await open(diagrams.id)
  const block = page.locator('.diagram-block').first()
  await previewReady(block)
  const preview = block.locator('.diagram-svg svg')
  const initialSize = await preview.boundingBox()
  await expect(block.getByRole('button', { name: 'Reset diagram scale' })).toHaveText('65%')
  expect((await block.locator('.diagram-toolbar').boundingBox()).height).toBeLessThanOrEqual(40)
  expect(
    (await block.getByRole('button', { name: 'Edit diagram', exact: true }).boundingBox()).width,
  ).toBeLessThanOrEqual(28)
  await block.getByRole('button', { name: 'Zoom out', exact: true }).click()
  await expect(block.getByRole('button', { name: 'Reset diagram scale' })).toHaveText('55%')
  const smallerSize = await preview.boundingBox()
  expect(smallerSize.height / initialSize.height).toBeCloseTo(0.55 / 0.65, 2)
  expect(
    (await snapshot()).pages.find((p) => p.id === diagrams.id).content.content[0].attrs.scale,
  ).toBe(0.55)
  await page.locator('.document-editor').evaluate((element) => element.editor.commands.undo())
  await expect(block.getByRole('button', { name: 'Reset diagram scale' })).toHaveText('65%')
  await page.locator('.document-editor').evaluate((element) => element.editor.commands.redo())
  await expect(block.getByRole('button', { name: 'Reset diagram scale' })).toHaveText('55%')
  await block.getByRole('button', { name: 'Reset diagram scale' }).click()
  await block.getByRole('button', { name: 'Zoom in', exact: true }).click()
  await expect(block.getByRole('button', { name: 'Reset diagram scale' })).toHaveText('75%')
  await page.screenshot({ path: path.join(output, 'diagram-block-scale-light-en.png') })
  await block.getByRole('button', { name: 'Edit diagram', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit diagram', exact: true })
  await previewReady(dialog)
  const header = await dialog.locator('header').boundingBox()
  const title = await dialog.locator('header h2').boundingBox()
  const tabs = await dialog.getByRole('tablist').boundingBox()
  expect(tabs.x).toBeGreaterThan(title.x + title.width + 8)
  expect(tabs.y + tabs.height).toBeLessThan(header.y + header.height - 6)
  expect(tabs.y + tabs.height / 2).toBeCloseTo(title.y + title.height / 2, 0)
  await expect(dialog.locator('[data-diagram-node]')).toHaveCount(3)
  await expect(dialog.locator('select')).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Diagram layout', exact: true }).click()
  await expect(page.locator('.diagram-properties select')).toHaveCount(0, { timeout: 1000 })
  const direction = page.getByRole('button', { name: 'Layout direction', exact: true })
  await direction.press('ArrowDown')
  const directionList = page.getByRole('listbox', { name: 'Layout direction', exact: true })
  await expect(
    directionList.getByRole('option', { name: 'Top to bottom', exact: true }),
  ).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await expect(
    directionList.getByRole('option', { name: 'Left to right', exact: true }),
  ).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(directionList).toHaveCount(0)
  await expect(direction).toBeFocused()
  await expect(direction).toHaveText('Left to right')
  await expect(page.locator('.diagram-properties')).toBeVisible()
  await previewReady(dialog)
  await direction.press('Escape')
  await expect(page.locator('.diagram-properties')).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: 'Diagram layout', exact: true })).toBeFocused()
  await dialog.getByRole('button', { name: 'Add diagram block', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Rounded rectangle', exact: true }).click()
  const canvas = dialog.locator('.diagram-canvas')
  let canvasBox = await canvas.boundingBox()
  await canvas.click({ position: { x: canvasBox.width - 180, y: 180 } })
  const properties = page.locator('.diagram-properties')
  await expect(properties).toBeVisible()
  await previewReady(dialog)
  const placed = await dialog.locator('[data-diagram-node="N1"]').boundingBox()
  expect(placed.x + placed.width / 2).toBeCloseTo(canvasBox.x + canvasBox.width - 180, 0)
  expect(placed.y + placed.height / 2).toBeCloseTo(canvasBox.y + 180, 0)
  await page.getByLabel('Block label', { exact: true }).fill('Review "project"')
  await previewReady(dialog)
  const shapePicker = page.getByRole('button', { name: 'Block shape', exact: true })
  await expect(shapePicker).toHaveText('Rounded rectangle')
  await shapePicker.click()
  const shapeList = page.getByRole('listbox', { name: 'Block shape', exact: true })
  await expect(shapeList.getByRole('option')).toHaveCount(5)
  await expect(
    shapeList.getByRole('option', { name: 'Rounded rectangle', exact: true }),
  ).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Home')
  await expect(shapeList.getByRole('option', { name: 'Rectangle', exact: true })).toBeFocused()
  await page.keyboard.press('End')
  await expect(shapeList.getByRole('option', { name: 'Cylinder', exact: true })).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('Enter')
  await expect(shapeList).toHaveCount(0)
  await expect(properties).toBeVisible()
  await expect(shapePicker).toBeFocused()
  await expect(shapePicker).toHaveText('Circle')
  await previewReady(dialog)
  await expect(dialog.locator('[data-diagram-node="N1"] circle:not(.diagram-port)')).toHaveCount(1)
  await shapePicker.click()
  await shapeList.getByRole('option', { name: 'Rounded rectangle', exact: true }).click()
  await previewReady(dialog)
  await expect(properties).toBeVisible()
  await expect(shapePicker).toBeFocused()
  await shapePicker.click()
  await page.screenshot({ path: path.join(output, 'shape-picker-light-en.png') })
  await shapeList.getByRole('option', { name: 'Cylinder', exact: true }).focus()
  await page.keyboard.press('Tab')
  await expect(dialog.getByRole('tab', { name: 'Visual editor', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(shapeList).toHaveCount(0)
  await expect(properties).toBeVisible()
  await expect(shapePicker).toBeFocused()
  // Outside dismissal closes the entire nested family, without discarding the draft.
  await shapePicker.click()
  await dialog.getByRole('heading', { name: 'Edit diagram', exact: true }).click()
  await expect(shapeList).toHaveCount(0)
  await expect(properties).toHaveCount(0)
  await dialog.locator('[data-diagram-node="N1"]').click()
  await expect(properties).toBeVisible()
  await expect(page.getByLabel('Block label', { exact: true })).toHaveValue('Review "project"')
  const cdp = await page.context().newCDPSession(page)
  const { nodes: accessibility } = await cdp.send('Accessibility.getFullAXTree')
  expect(
    accessibility.some(
      (node) =>
        !node.ignored && node.role?.value === 'textbox' && node.name?.value === 'Block label',
    ),
  ).toBe(true)
  await cdp.detach()
  await page.getByRole('button', { name: 'Delete diagram block', exact: true }).focus()
  await page.keyboard.press('Tab')
  await expect(dialog.getByRole('tab', { name: 'Visual editor', exact: true })).toBeFocused()
  // Escape dismisses just the popup and returns focus to its canvas anchor.
  await page.getByLabel('Block label', { exact: true }).press('Escape')
  await expect(properties).toHaveCount(0)
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Element settings' })).toBeFocused()
  async function center(id) {
    const rect = await dialog.locator(`[data-diagram-node="${id}"]`).boundingBox()
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
  }
  // Draw an arrow by dragging directly between blocks.
  await dialog.getByRole('button', { name: 'Draw arrow', exact: true }).click()
  const from = await center('N1'),
    to = await center('C')
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 8 })
  await expect(dialog.locator('.diagram-connection-preview')).toBeVisible()
  await page.mouse.up()
  await expect(properties).toBeVisible()
  await page.getByLabel('Connection label', { exact: true }).fill('Ready')
  await previewReady(dialog)
  await page.getByLabel('Connection label', { exact: true }).press('Escape')
  // Ordinary connections use a two-click gesture and retain their own type/label.
  await dialog.getByRole('button', { name: 'Draw connection', exact: true }).click()
  await dialog.locator('[data-diagram-node="A"]').click()
  await expect(dialog.locator('.diagram-connection-preview')).toBeVisible()
  await dialog.locator('[data-diagram-node="N1"]').click()
  await expect(properties).toBeVisible()
  await page.getByLabel('Connection label', { exact: true }).fill('Context')
  await expect(page.getByRole('button', { name: 'Connection type', exact: true })).toHaveText(
    'Connection',
  )
  await previewReady(dialog)
  expect(
    await dialog.locator('path.flowchart-link[data-id="L_A_N1_0"]').getAttribute('marker-end'),
  ).toBeNull()
  await page.getByLabel('Connection label', { exact: true }).press('Escape')
  // Edge hit areas reopen settings; deletion operates on this one edge.
  await dialog.locator('[data-diagram-edge="3"]').focus()
  await dialog.locator('[data-diagram-edge="3"]').press('Enter')
  await expect(properties).toBeVisible()
  await expect(page.getByLabel('Connection label', { exact: true })).toHaveValue('Context')
  await page.getByRole('button', { name: 'Connection type', exact: true }).click()
  await page
    .getByRole('listbox', { name: 'Connection type', exact: true })
    .getByRole('option', { name: 'Arrow', exact: true })
    .click()
  await previewReady(dialog)
  expect(
    await dialog.locator('path.flowchart-link[data-id="L_A_N1_0"]').getAttribute('marker-end'),
  ).toBeTruthy()
  await page.getByRole('button', { name: 'Connection type', exact: true }).click()
  await page
    .getByRole('listbox', { name: 'Connection type', exact: true })
    .getByRole('option', { name: 'Connection', exact: true })
    .click()
  await previewReady(dialog)
  await page.getByLabel('Connection label', { exact: true }).press('Escape')
  const node = dialog.locator('[data-diagram-node="N1"]')
  const originalTransform = await node.getAttribute('transform')
  const originalView = await dialog.locator('.diagram-canvas-svg svg').getAttribute('viewBox')
  const rect = await node.boundingBox()
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2)
  await page.mouse.down()
  await page.mouse.move(rect.x + rect.width / 2 + 60, rect.y + rect.height / 2 + 70, { steps: 8 })
  await page.mouse.up()
  expect(await dialog.locator('.diagram-canvas-svg svg').getAttribute('viewBox')).toBe(originalView)
  const moved = await node.boundingBox()
  expect(moved.x - rect.x).toBeCloseTo(60, 0)
  expect(moved.y - rect.y).toBeCloseTo(70, 0)
  await node.focus()
  await node.press('ArrowDown')
  expect(await node.getAttribute('transform')).not.toBe(originalTransform)
  await expect(node.locator('text')).toHaveText('Review "project"')
  // Moving above the automatic layout preserves signed coordinates and remains visible after fit/save.
  for (let i = 0; i < 10; i++) await node.press('Shift+ArrowUp')
  await dialog.getByRole('button', { name: 'Zoom in', exact: true }).click()
  expect(await dialog.locator('.diagram-canvas-svg svg').getAttribute('viewBox')).not.toBe(
    originalView,
  )
  const zoomView = await dialog.locator('.diagram-canvas-svg svg').getAttribute('viewBox')
  await dialog.getByRole('button', { name: 'Pan canvas', exact: true }).click()
  canvasBox = await canvas.boundingBox()
  await page.mouse.move(canvasBox.x + 50, canvasBox.y + 150)
  await page.mouse.down()
  await page.mouse.move(canvasBox.x + 100, canvasBox.y + 180, { steps: 5 })
  await page.mouse.up()
  expect(await dialog.locator('.diagram-canvas-svg svg').getAttribute('viewBox')).not.toBe(zoomView)
  await dialog.getByRole('button', { name: 'Select elements', exact: true }).click()
  await dialog.getByRole('button', { name: 'Fit diagram', exact: true }).click()
  await node.click()
  await expect(properties).toBeVisible()
  const popup = await properties.boundingBox()
  expect(popup.x).toBeGreaterThanOrEqual(8)
  expect(popup.x + popup.width).toBeLessThanOrEqual(1192)
  expect(popup.y + popup.height).toBeLessThanOrEqual(842)
  await page.screenshot({ path: path.join(output, 'visual-editor-light-en.png') })
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await previewReady(block)
  const edited = (await snapshot()).pages.find((p) => p.id === diagrams.id).content.content[0]
  expect(edited.attrs.scale).toBe(0.75)
  const connectors = await block
    .locator('path.flowchart-link')
    .evaluateAll((paths) => paths.map((path) => path.getAttribute('d')))
  for (const connector of connectors) {
    const points = [...connector.matchAll(/[ML] ([\d.e+-]+) ([\d.e+-]+)/g)].map(([, x, y]) => ({
      x: Number(x),
      y: Number(y),
    }))
    expect(points.length).toBeGreaterThanOrEqual(2)
    points
      .slice(1)
      .forEach((point, i) => expect(point.x === points[i].x || point.y === points[i].y).toBe(true))
  }
  // The Start-to-new-block link must go around the intervening Decision block.
  const crossesDecision = await block.evaluate((element) => {
    const connector = element.querySelector('path.flowchart-link[data-id="L_A_N1_0"]')
    const obstacle = element.querySelector('[data-diagram-node="B"]').getBoundingClientRect()
    const matrix = connector.getScreenCTM()
    const length = connector.getTotalLength()
    return Array.from({ length: 101 }, (_, i) => {
      const point = connector.getPointAtLength((length * i) / 100).matrixTransform(matrix)
      return (
        point.x > obstacle.left + 2 &&
        point.x < obstacle.right - 2 &&
        point.y > obstacle.top + 2 &&
        point.y < obstacle.bottom - 2
      )
    }).some(Boolean)
  })
  expect(crossesDecision).toBe(false)
  expect(edited.attrs.source).toContain('flowchart LR')
  expect(edited.attrs.source).toContain('N1("Review #34;project#34;")')
  expect(edited.attrs.source).toContain('N1 -->|Ready| C')
  expect(edited.attrs.source).toContain('A ---|Context| N1')
  expect(Object.keys(edited.attrs.positions)).toHaveLength(4)
  expect(edited.attrs.positions.N1.y).toBeLessThan(0)
  const svgBounds = await block.locator('.diagram-svg svg').boundingBox()
  const savedNode = await block.locator('[data-diagram-node="N1"]').boundingBox()
  expect(savedNode.y).toBeGreaterThanOrEqual(svgBounds.y)
  expect(savedNode.y + savedNode.height).toBeLessThanOrEqual(svgBounds.y + svgBounds.height)
  // Undo/redo restores one complete diagram edit.
  await page.locator('.document-editor').evaluate((element) => element.editor.commands.undo())
  await expect
    .poll(
      async () =>
        (await snapshot()).pages.find((p) => p.id === diagrams.id).content.content[0].attrs.source,
    )
    .toBe(defaultDiagramSource)
  await page.locator('.document-editor').evaluate((element) => element.editor.commands.redo())
  await expect
    .poll(async () => (await snapshot()).pages.find((p) => p.id === diagrams.id).content.content[0])
    .toEqual(edited)
  await block.getByRole('button', { name: 'Edit diagram', exact: true }).click()
  await previewReady(dialog)
  await dialog.getByRole('button', { name: 'Diagram layout', exact: true }).click()
  await page.getByRole('button', { name: 'Automatic layout', exact: true }).click()
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click()
  expect(
    (await snapshot()).pages.find((p) => p.id === diagrams.id).content.content[0].attrs.positions,
  ).toEqual({})
  await page.locator('.document-editor').evaluate((element) => element.editor.commands.undo())
  await expect
    .poll(async () => (await snapshot()).pages.find((p) => p.id === diagrams.id).content.content[0])
    .toEqual(edited)
  // Deleting a node also removes its links; cancelling preserves the saved diagram.
  await block.getByRole('button', { name: 'Edit diagram', exact: true }).click()
  await previewReady(dialog)
  await dialog.locator('[data-diagram-edge="3"]').focus()
  await dialog.locator('[data-diagram-edge="3"]').press('Enter')
  await page.getByRole('button', { name: 'Delete connection', exact: true }).click()
  await previewReady(dialog)
  await expect(dialog.locator('[data-diagram-edge]')).toHaveCount(3)
  await dialog.locator('[data-diagram-node="N1"]').click()
  await page.getByRole('button', { name: 'Delete diagram block', exact: true }).click()
  await previewReady(dialog)
  await expect(dialog.locator('[data-diagram-node]')).toHaveCount(3)
  await expect(dialog.locator('[data-diagram-edge]')).toHaveCount(2)
  for (const id of ['A', 'B', 'C']) {
    await dialog.locator(`[data-diagram-node="${id}"]`).click()
    await page.getByRole('button', { name: 'Delete diagram block', exact: true }).click()
    await previewReady(dialog)
  }
  await expect(dialog.locator('[data-diagram-node]')).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Add diagram block', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Rectangle', exact: true }).click()
  await canvas.click({ position: { x: 350, y: 200 } })
  await previewReady(dialog)
  await expect(dialog.locator('[data-diagram-node]')).toHaveCount(1)
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect((await snapshot()).pages.find((p) => p.id === diagrams.id).content.content[0]).toEqual(
    edited,
  )
  // Invalid code keeps the document unchanged; other Mermaid types remain editable.
  await block.getByRole('button', { name: 'Edit diagram', exact: true }).click()
  await dialog.getByRole('tab', { name: 'Mermaid code', exact: true }).click()
  await dialog.getByLabel('Mermaid code', { exact: true }).fill('flowchart TB\nA[broken')
  await expect(dialog.locator('.diagram-error')).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect((await snapshot()).pages.find((p) => p.id === diagrams.id).content.content[0]).toEqual(
    edited,
  )
  await block.getByRole('button', { name: 'Edit diagram', exact: true }).click()
  await dialog.getByRole('tab', { name: 'Mermaid code', exact: true }).click()
  await dialog
    .getByLabel('Mermaid code', { exact: true })
    .fill('sequenceDiagram\nAlice->>Bob: Hello\nBob-->>Alice: Done')
  await previewReady(dialog)
  await dialog.getByRole('tab', { name: 'Visual editor', exact: true }).click()
  await expect(dialog.locator('.diagram-unsupported')).toContainText('simple flowcharts')
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click()
  await previewReady(block)
  await page.screenshot({ path: path.join(output, 'sequence-light-en.png') })
  // Markdown import turns a mermaid fence into a diagram rather than an ordinary code block.
  await page.locator('.document-editor').evaluate((element) =>
    element.editor
      .chain()
      .setTextSelection(element.editor.state.doc.content.size - 1)
      .insertContent('```mermaid\nflowchart TB\nX[Imported] --> Y[Retained]\n```', {
        contentType: 'markdown',
      })
      .run(),
  )
  await expect(page.locator('.diagram-block')).toHaveCount(2)
  await previewReady(page.locator('.diagram-block').last())
  await page
    .locator('.document-editor')
    .evaluate(
      (element, block) =>
        element.editor.commands.insertContentAt(element.editor.state.doc.content.size - 1, block),
      edited,
    )
  await expect(page.locator('.diagram-block')).toHaveCount(3)
  await previewReady(page.locator('.diagram-block').last())
  // Source and manual layout survive HTML clipboard serialization.
  const html = await page
    .locator('.document-editor')
    .evaluate((element) => element.editor.getHTML())
  expect(html).toContain('data-type="mermaid"')
  expect(html).toContain('data-source=')
  expect(html).toContain('data-positions=')
  expect(html).toContain('data-scale="0.75"')
  await page
    .locator('.document-editor')
    .evaluate((element, html) => element.editor.commands.setContent(html), html)
  await expect(page.locator('.diagram-block')).toHaveCount(3)
  await previewReady(page.locator('.diagram-block').first())
  await previewReady(page.locator('.diagram-block').last())
  expect(
    (await snapshot()).pages
      .find((p) => p.id === diagrams.id)
      .content.content.filter((n) => n.type === 'mermaid')
      .at(-1),
  ).toEqual(edited)
  return edited
}
async function exports() {
  for (const format of ['markdown', 'pdf']) {
    const file = path.join(root, format === 'pdf' ? 'diagrams.pdf' : 'diagrams.md')
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file })
    }, file)
    await saved()
    await page.evaluate(({ id, format }) => window.sheco.exportPage(id, format), {
      id: diagrams.id,
      format,
    })
    const bytes = await fs.readFile(file)
    if (format === 'markdown') {
      const body = bytes.toString()
      expect(body).toContain('```mermaid\nsequenceDiagram')
      expect(body).toContain('N1("Review #34;project#34;")')
      expect(body).toContain('Проверка')
    } else {
      expect(bytes.subarray(0, 4).toString()).toBe('%PDF')
      const png = path.join(output, 'actual-diagram-pdf')
      execFileSync('pdftoppm', [
        '-f',
        '1',
        '-l',
        '1',
        '-singlefile',
        '-r',
        '100',
        '-png',
        file,
        png,
      ])
      const { data, info } = await sharp(png + '.png')
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true })
      for (const [x, y] of [
        [20, 20],
        [info.width - 20, info.height - 20],
      ]) {
        const offset = (y * info.width + x) * info.channels
        expect([...data.subarray(offset, offset + 3)]).toEqual([255, 255, 255])
      }
    }
    await fs.copyFile(file, path.join(output, path.basename(file)))
  }
}
try {
  await launch()
  if (caseName === 'diagram') {
    await open(diagrams.id)
    await previewReady(page.locator('.diagram-block'))
    await fs.writeFile(
      path.join(output, 'diagram-debug.svg'),
      await page.locator('.diagram-svg svg').evaluate((el) => el.outerHTML),
    )
    await close()
    process.exit(0)
  }
  if (!caseName || caseName === 'caption') await captions()
  if (!caseName || caseName === 'search') await filenames()
  if (!caseName || caseName === 'outline') await outline()
  if (caseName && caseName !== 'canvas') {
    console.log(`Passed ${caseName} regression`)
    await close()
    process.exit(0)
  }
  const edited = await diagramEditing()
  await open(slashNote.id)
  await page.locator('.document-editor').click()
  await page.keyboard.type('/mermaid')
  await expect(page.locator('.command-palette .is-selected')).toContainText('Mermaid diagram')
  await page.keyboard.press('Enter')
  await expect(page.locator('.diagram-block')).toHaveCount(1)
  await previewReady(page.locator('.diagram-block'))
  await open(diagrams.id)
  await menu('settings')
  await page.getByRole('button', { name: 'Dark', exact: true }).click()
  await page.getByRole('button', { name: 'Русский', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Закрыть', exact: true }).click()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 760))
  await page
    .locator('.diagram-block')
    .last()
    .getByRole('button', { name: 'Редактировать схему', exact: true })
    .click()
  const dialog = page.getByRole('dialog', { name: 'Редактировать схему', exact: true })
  await previewReady(dialog)
  await dialog.getByRole('button', { name: 'Добавить блок схемы', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Круг', exact: true }).click()
  const canvas = dialog.locator('.diagram-canvas'),
    canvasBox = await canvas.boundingBox()
  await canvas.click({ position: { x: canvasBox.width - 100, y: canvasBox.height - 160 } })
  await expect(page.locator('.diagram-properties')).toBeVisible()
  await page.getByLabel('Подпись блока', { exact: true }).fill('Проверка')
  await previewReady(dialog)
  const russianShapePicker = page.getByRole('button', { name: 'Форма блока', exact: true })
  await russianShapePicker.click()
  const russianShapeList = page.getByRole('listbox', { name: 'Форма блока', exact: true })
  await expect(russianShapeList.getByRole('option', { name: 'Круг', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(page.locator('.diagram-properties select')).toHaveCount(0)
  const choicePopup = await page.locator('.diagram-picker-popover').boundingBox()
  expect(choicePopup.x).toBeGreaterThanOrEqual(8)
  expect(choicePopup.x + choicePopup.width).toBeLessThanOrEqual(892)
  expect(choicePopup.y).toBeGreaterThanOrEqual(8)
  expect(choicePopup.y + choicePopup.height).toBeLessThanOrEqual(752)
  await page.screenshot({ path: path.join(output, 'shape-picker-dark-ru.png') })
  await page.keyboard.press('Escape')
  await expect(russianShapeList).toHaveCount(0)
  await expect(page.locator('.diagram-properties')).toBeVisible()
  await expect(russianShapePicker).toBeFocused()
  const box = await dialog.boundingBox()
  const russianTitle = await dialog.locator('header h2').boundingBox()
  const russianTabs = await dialog.getByRole('tablist').boundingBox()
  expect(russianTabs.x).toBeGreaterThan(russianTitle.x + russianTitle.width + 8)
  expect(russianTabs.y + russianTabs.height / 2).toBeCloseTo(
    russianTitle.y + russianTitle.height / 2,
    0,
  )
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(900)
  await page.screenshot({ path: path.join(output, 'visual-editor-dark-ru.png') })
  const popup = await page.locator('.diagram-properties').boundingBox()
  expect(popup.x + popup.width).toBeLessThanOrEqual(892)
  expect(popup.y + popup.height).toBeLessThanOrEqual(752)
  await dialog.getByRole('button', { name: 'Применить', exact: true }).click()
  await previewReady(page.locator('.diagram-block').last())
  await exports()
  // Print shows complete diagram SVGs and no editing chrome.
  await page.emulateMedia({ media: 'print' })
  await expect(page.locator('.diagram-toolbar').first()).toBeHidden()
  await expect(page.locator('.diagram-svg svg').first()).toBeVisible()
  for (const label of await page.locator('.diagram-block svg text tspan').all())
    expect(await label.evaluate((element) => getComputedStyle(element).fill)).toBe(
      'rgb(34, 34, 34)',
    )
  await page.screenshot({ path: path.join(output, 'print-diagrams.png') })
  await page.emulateMedia({ media: 'screen' })
  const before = await snapshot()
  workspaceSchema.parse(before)
  await close()
  await launch()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.getByRole('button', { name: 'Редактировать схему', exact: true })).toHaveCount(
    3,
  )
  await previewReady(page.locator('.diagram-block').last())
  const after = await snapshot()
  expect(after.pages).toEqual(before.pages)
  expect(after.ui).toEqual(before.ui)
  expect(errors).toEqual([])
  await fs.writeFile(
    path.join(output, 'verification.json'),
    JSON.stringify(
      {
        root,
        edited,
        pageCount: after.pages.length,
        errors,
        checks: [
          ...(!caseName
            ? [
                'caption caret and galleries',
                'registered filenames',
                'first-click upper-edge outline and nested folds',
              ]
            : []),
          'canvas tools and shape placement',
          'compact header tabs and edit button',
          'custom nested shape/type/layout pickers, keyboard selection and Escape focus',
          'per-block scale, undo/redo, HTML and restart persistence',
          'straight and right-angle connectors',
          'drag arrows and two-click undirected connections',
          'anchored block/edge properties and Escape focus',
          'node/edge deletion and cancelled drafts',
          'stable drag viewport, zoom/pan/fit and keyboard movement',
          'one-step undo/redo',
          'reset layout',
          'invalid code/cancellation',
          'sequence/code-only editing',
          'Mermaid Markdown import',
          'slash insertion',
          'actual Markdown/PDF exports and white PDF margins',
          'HTML clipboard attributes',
          'light English/dark Russian/narrow modal',
          'print',
          'restart',
        ],
      },
      null,
      2,
    ),
  )
  console.log('Passed knowledge feature desktop checks:', root)
} catch (error) {
  if (page)
    await page
      .screenshot({ path: path.join(output, `failure-${caseName ?? 'full'}.png`) })
      .catch(() => {})
  throw error
} finally {
  await close()
}
