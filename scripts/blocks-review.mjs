import { _electron as electron, expect } from '@playwright/test'
import { build } from 'esbuild'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import sharp from 'sharp'
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sheco-blocks-'))
const output = path.resolve('test-results/blocks')
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
const w = seedWorkspace('Block review')
const knowledge = path.join(root, 'Knowledge')
await fs.mkdir(path.join(knowledge, 'attachments'), { recursive: true })
const images = []
for (const [i, color] of ['#737c83', '#b19b8c'].entries()) {
  const id = uid(),
    file = `${id}.png`
  const bytes = await sharp({
    create: { width: 500 + i * 200, height: 240 + i * 100, channels: 3, background: color },
  })
    .png()
    .toBuffer()
  await fs.writeFile(path.join(knowledge, 'attachments', file), bytes)
  w.attachments.push({
    id,
    file,
    name: `photo-${i}.png`,
    mime: 'image/png',
    bytes: bytes.length,
    createdAt: new Date().toISOString(),
  })
  images.push({
    src: `sheco-asset://${w.id}/${file}`,
    alt: `Photo ${i}`,
    caption: `Caption ${i}`,
    width: i ? 280 : 180,
  })
}
const p = (text) => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] })
const note = createPage(w, 'Blocks')
note.content = {
  type: 'doc',
  content: [
    { type: 'codeBlock', attrs: { language: null } },
    { type: 'callout', attrs: { emoji: '📌', color: 'gray' }, content: [p('Context block')] },
    p('Alpha paragraph'),
    { type: 'image', attrs: { ...images[0], width: 120 } },
    { type: 'imageGallery', attrs: { images } },
    { type: 'horizontalRule' },
    p('Omega paragraph'),
    p(''),
  ],
}
const child = createPage(w, 'Short child', note.id)
const listDrops = createPage(w, 'List drops')
const listNode = (type) => {
  const itemType = type === 'taskList' ? 'taskItem' : 'listItem'
  const item = (text, extra = []) => ({
    type: itemType,
    ...(itemType === 'taskItem' ? { attrs: { checked: true } } : {}),
    content: [p(text), ...extra],
  })
  return {
    type,
    content: [
      item(`${type} first`),
      item(
        `${type} second`,
        type === 'orderedList'
          ? [{ type: 'bulletList', content: [{ type: 'listItem', content: [p('Nested target')] }] }]
          : [],
      ),
    ],
  }
}
listDrops.content = {
  type: 'doc',
  content: [
    {
      type: 'codeBlock',
      attrs: {
        language: 'bash',
        title: 'Movable code',
        lineNumbers: true,
        comments: [{ id: 'drop-note', from: 0, to: 4, text: 'Retain this note' }],
      },
      content: [{ type: 'text', text: 'echo example' }],
    },
    { type: 'image', attrs: images[0] },
    { type: 'imageGallery', attrs: { images, width: 180 } },
    ...['orderedList', 'bulletList', 'taskList'].map(listNode),
    p('After lists'),
  ],
}
const nested = createPage(w, 'Long nested child', child.id)
const foldDrops = createPage(w, 'Collapsible pictures')
foldDrops.content = {
  type: 'doc',
  content: [
    p('Before collapsible block'),
    {
      type: 'details',
      attrs: { open: true },
      content: [
        { type: 'detailsSummary', content: [{ type: 'text', text: 'Keep this summary' }] },
        {
          type: 'detailsContent',
          content: [
            p('Context inside the fold'),
            {
              type: 'image',
              attrs: {
                ...images[0],
                alt: 'Fold photo',
                width: 160,
                originalSrc: images[0].src,
                crop: { x: 0, y: 0, width: 1, height: 1 },
              },
            },
            {
              type: 'details',
              attrs: { open: true },
              content: [
                { type: 'detailsSummary', content: [{ type: 'text', text: 'Inner summary' }] },
                {
                  type: 'detailsContent',
                  content: [
                    { type: 'image', attrs: { ...images[1], alt: 'Deep photo', width: 140 } },
                  ],
                },
              ],
            },
            { type: 'imageGallery', attrs: { images, width: 150 } },
            p('Keep this trailing text'),
          ],
        },
      ],
    },
    p('Outside drop target'),
  ],
}
nested.content = {
  type: 'doc',
  content: Array.from({ length: 70 }, (_, i) => p('Long paragraph ' + i)),
}
w.pages.push(note, child, nested, listDrops, foldDrops)
w.ui.tabs = [note.id, child.id, nested.id, listDrops.id, foldDrops.id]
w.ui.activeId = note.id
w.ui.accent = 'blue'
w.ui.expanded = [note.id, child.id]
await fs.writeFile(path.join(knowledge, 'workspace.json'), JSON.stringify(w))
await fs.writeFile(
  path.join(root, 'spaces.json'),
  JSON.stringify({
    activeId: w.id,
    spaces: [{ id: w.id, name: w.name, icon: w.icon, path: knowledge }],
  }),
)
let app,
  page,
  succeeded = false
const errors = []
const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
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
async function tab(title) {
  await page.locator('.tab').filter({ hasText: title }).locator('.tab-open').click()
  await expect(page.getByLabel('Page title')).toHaveValue(title)
}
async function marquee(first, last, shift = false, reverse = false) {
  await first.scrollIntoViewIfNeeded()
  const a = await first.boundingBox(),
    b = await last.boundingBox()
  const editor = await page.locator('.document-editor').boundingBox()
  const start = { x: editor.x - 52, y: a.y + 3 }
  const end = { x: editor.x + editor.width + 14, y: b.y + b.height - 3 }
  if (shift) await page.keyboard.down('Shift')
  await page.mouse.move(reverse ? end.x : start.x, reverse ? end.y : start.y)
  await page.mouse.down()
  await page.mouse.move(reverse ? start.x : end.x, reverse ? start.y : end.y, { steps: 14 })
  await expect(page.locator('.block-selection-rectangle')).toBeVisible()
  await page.mouse.up()
  if (shift) await page.keyboard.up('Shift')
  await expect(page.locator('.block-selection-rectangle')).toHaveCount(0)
}
async function json(pageId = note.id) {
  await saved()
  const data = JSON.parse(await fs.readFile(path.join(knowledge, 'workspace.json'), 'utf8'))
  return data.pages.find((p) => p.id === pageId).content.content
}
async function dragToItem(
  source,
  paragraph,
  { picture = false, gap = false, gutter = false, filename } = {},
) {
  await source.scrollIntoViewIfNeeded()
  let origin
  if (picture) origin = await source.boundingBox()
  else {
    await source.hover()
    const grip = page.getByRole('button', { name: 'Block options', exact: true })
    await expect(grip).toBeVisible()
    origin = await grip.boundingBox()
  }
  const start = { x: origin.x + origin.width / 2, y: origin.y + origin.height / 2 }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x + 12, start.y + 4, { steps: 3 })
  await paragraph.evaluate((el) => el.scrollIntoView({ block: 'center' }))
  const bounds = await paragraph.boundingBox()
  await page.mouse.move(
    bounds.x + (gutter ? -18 : 20),
    gap ? bounds.y + bounds.height + 6 : bounds.y + bounds.height / 2,
    { steps: 20 },
  )
  const marker = page.locator('.block-batch-drop-marker,.editor-drop-cursor')
  await expect(marker).toBeVisible()
  const markerBounds = await marker.boundingBox()
  if (filename) await page.screenshot({ path: path.join(output, filename) })
  await page.mouse.up()
  return { markerBounds, paragraphBounds: bounds }
}
async function listDropChecks() {
  await tab('List drops')
  const baseline = await page
    .locator('.document-editor')
    .evaluate((el) => el.editor.getJSON().content)
  const code = page.locator('.code-block')
  const picture = page.locator('.document-editor > .react-renderer > .image-block img')
  const restore = async () => {
    await page.keyboard.press(mod + '+z')
    expect(await json(listDrops.id)).toEqual(baseline)
    await page.keyboard.press('Escape')
  }
  for (const type of ['orderedList', 'bulletList', 'taskList']) {
    const target = page
      .locator('.document-editor p')
      .filter({ hasText: new RegExp(`^${type} first$`) })
    const item = target.locator('xpath=ancestor::li[1]')
    const { markerBounds, paragraphBounds } = await dragToItem(code, target, {
      gap: type === 'bulletList',
      filename: `list-drop-${type}-light-en.png`,
    })
    await expect(item.locator('.code-block')).toBeVisible()
    if (type === 'orderedList')
      await page.screenshot({ path: path.join(output, 'list-drop-inside-ordered-light-en.png') })
    expect(markerBounds.x).toBeCloseTo(paragraphBounds.x, 0)
    expect(markerBounds.height).toBe(3)
    const moved = await json(listDrops.id)
    const list = moved.find((n) => n.type === type)
    expect(list.content[0].content.map((n) => n.type)).toEqual(['paragraph', 'codeBlock'])
    expect(list.content[0].content[1]).toEqual(baseline[0])
    expect(list.content[1]).toEqual(baseline.find((n) => n.type === type).content[1])
    if (type === 'taskList') expect(list.content[0].attrs.checked).toBe(true)
    await restore()
    await dragToItem(picture, target, { picture: true })
    await expect(item.locator('.image-block')).toBeVisible()
    expect((await json(listDrops.id)).find((n) => n.type === type).content[0].content[1]).toEqual(
      baseline[1],
    )
    await restore()
  }
  const nestedTarget = page.locator('.document-editor p').filter({ hasText: /^Nested target$/ })
  await dragToItem(code, nestedTarget, { filename: 'list-drop-nested-light-en.png' })
  await expect(nestedTarget.locator('xpath=ancestor::li[1]').locator('.code-block')).toBeVisible()
  const ordered = (await json(listDrops.id)).find((n) => n.type === 'orderedList')
  expect(ordered.content[1].content[1].content[0].content.map((n) => n.type)).toEqual([
    'paragraph',
    'codeBlock',
  ])
  expect(ordered.content[1].content[1].content[0].content[1]).toEqual(baseline[0])
  await restore()
  const taskTarget = page.locator('.document-editor p').filter({ hasText: /^taskList first$/ })
  await marquee(code, page.locator('.document-editor > .react-renderer > .image-block'))
  await expect(page.locator('.block-is-selected')).toHaveCount(2)
  await dragToItem(code, taskTarget, { filename: 'list-drop-group-light-en.png' })
  const task = (await json(listDrops.id)).find((n) => n.type === 'taskList')
  expect(task.content[0].content).toEqual([
    baseline.find((n) => n.type === 'taskList').content[0].content[0],
    baseline[0],
    baseline[1],
  ])
  await restore()
  // The numbering gutter still places blocks outside the entire list.
  const firstTarget = page.locator('.document-editor p').filter({ hasText: /^orderedList first$/ })
  const { markerBounds } = await dragToItem(code, firstTarget, { gutter: true })
  expect(markerBounds.x).toBeCloseTo((await page.locator('.document-editor').boundingBox()).x, 0)
  const outer = await json(listDrops.id)
  expect(outer.find((n) => n.type === 'codeBlock')).toEqual(baseline[0])
  expect(outer.find((n) => n.type === 'orderedList')).toEqual(
    baseline.find((n) => n.type === 'orderedList'),
  )
  await restore()
  await page
    .locator('.sidebar-footer')
    .getByRole('button', { name: 'Settings', exact: true })
    .click()
  await page.getByRole('button', { name: 'Русский', exact: true }).click()
  await page.getByRole('button', { name: 'Тёмная', exact: true }).click()
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click()
  const galleryPicture = page.locator('.gallery-active img')
  await dragToItem(galleryPicture, taskTarget, {
    picture: true,
    gap: true,
    filename: 'list-drop-gallery-dark-ru.png',
  })
  await expect(taskTarget.locator('xpath=ancestor::li[1]').locator('.image-gallery')).toBeVisible()
  await page.screenshot({ path: path.join(output, 'list-drop-inside-task-dark-ru.png') })
  const persisted = await json(listDrops.id)
  expect(persisted.find((n) => n.type === 'taskList').content[0].content[1]).toEqual(baseline[2])
  await close()
  await launch()
  await expect(page.getByLabel('Название страницы')).toHaveValue('List drops')
  expect(await json(listDrops.id)).toEqual(persisted)
  await expect(
    page
      .locator('.document-editor p')
      .filter({ hasText: /^taskList first$/ })
      .locator('xpath=ancestor::li[1]')
      .locator('.image-gallery'),
  ).toBeVisible()
  await page
    .locator('.sidebar-footer')
    .getByRole('button', { name: 'Настройки', exact: true })
    .click()
  await page.getByRole('button', { name: 'English', exact: true }).click()
  await page.getByRole('button', { name: 'Light', exact: true }).click()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await tab('Blocks')
}
async function collapsiblePictureChecks() {
  await tab('Collapsible pictures')
  let editor = page.locator('.document-editor')
  const baseline = await editor.evaluate((el) => el.editor.getJSON())
  const outside = editor.locator(':scope > p').last()
  async function dragOut(picture, handle, filename) {
    await outside.scrollIntoViewIfNeeded()
    await picture.scrollIntoViewIfNeeded()
    const expected = await picture.evaluate((el) => {
      const e = el.closest('.document-editor').editor
      let result
      e.state.doc.descendants((node, pos) => {
        if (['image', 'imageGallery'].includes(node.type.name) && e.view.nodeDOM(pos).contains(el))
          result = node.toJSON()
      })
      return result
    })
    let origin = await picture.boundingBox()
    if (handle) {
      await picture.hover()
      const grip = page.getByRole('button', { name: 'Block options', exact: true })
      await expect(grip).toBeVisible()
      origin = await grip.boundingBox()
    }
    const startY = origin.y + (handle ? origin.height / 2 : origin.height - 8)
    await page.mouse.move(origin.x + origin.width / 2, startY)
    await page.mouse.down()
    await page.mouse.move(origin.x + origin.width / 2 + 10, startY - 10, {
      steps: 3,
    })
    await expect(page.locator('.block-batch-drop-marker')).toBeVisible()
    // The destination may be below the viewport. Scroll during the native drag and then
    // use its current coordinates, rather than dropping at a stale offscreen position.
    await page.locator('.content-scroll').evaluate((el) => {
      el.scrollTop = el.scrollHeight
    })
    const destination = await outside.boundingBox()
    await page.mouse.move(destination.x + 30, destination.y + destination.height - 2, { steps: 24 })
    await expect(page.locator('.block-batch-drop-marker')).toBeVisible()
    await expect(editor.locator('.block-is-selected')).toHaveCount(1)
    await expect(editor.locator('[data-type="details"].block-is-selected')).toHaveCount(0)
    await expect(editor.locator('.block-is-selected img')).toHaveCount(
      expected.type === 'imageGallery' ? 3 : 1,
    )
    await page.screenshot({ path: path.join(output, filename) })
    await page.mouse.up()
    const after = await editor.evaluate((el) => el.editor.getJSON())
    expect(after.content.slice(-3)).toEqual([
      baseline.content.at(-1),
      expected,
      { type: 'paragraph' },
    ])
    expect(after.content[1].type).toBe('details')
    expect(after.content[1].attrs.open).toBe(true)
    expect(after.content[1].content[0]).toEqual(baseline.content[1].content[0])
    expect(after.content[1].content[1].content[0]).toEqual(
      baseline.content[1].content[1].content[0],
    )
    expect(after.content[1].content[1].content.at(-1)).toEqual(
      baseline.content[1].content[1].content.at(-1),
    )
    return after
  }
  for (const [selector, handle, filename] of [
    ['img[alt="Fold photo"]', false, 'fold-picture-drag-light-en.png'],
    ['img[alt="Fold photo"]', true, 'fold-picture-handle-light-en.png'],
    ['img[alt="Deep photo"]', false, 'deep-fold-picture-drag-light-en.png'],
    ['.gallery-active img', false, 'fold-gallery-drag-light-en.png'],
  ]) {
    await dragOut(
      editor.locator('[data-type="detailsContent"] ' + selector).first(),
      handle,
      filename,
    )
    await page.keyboard.press(mod + '+z')
    expect(await editor.evaluate((el) => el.editor.getJSON())).toEqual(baseline)
    await page.keyboard.press('Escape')
  }
  // Deleting the only media child keeps a valid empty inner fold and restores exactly.
  await outside.click()
  await editor.locator('img[alt="Deep photo"]').click({ modifiers: ['Shift'] })
  await expect(editor.locator('.block-is-selected')).toHaveCount(1)
  await page.keyboard.press('Backspace')
  await expect(editor.locator('img[alt="Deep photo"]')).toHaveCount(0)
  await expect(editor.locator('summary')).toHaveText(['Keep this summary', 'Inner summary'])
  await page.keyboard.press(mod + '+z')
  expect(await editor.evaluate((el) => el.editor.getJSON())).toEqual(baseline)
  await page.keyboard.press('Escape')
  const toggle = editor.locator('[data-type="details"]').first().locator(':scope > button')
  await toggle.click()
  await expect(editor.locator('img[alt="Fold photo"]')).toBeHidden()
  await toggle.click()
  await expect(editor.locator('img[alt="Fold photo"]')).toBeVisible()
  await page
    .locator('.sidebar-footer')
    .getByRole('button', { name: 'Settings', exact: true })
    .click()
  await page.getByRole('button', { name: 'Dark', exact: true }).click()
  await page.getByRole('button', { name: 'Русский', exact: true }).click()
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click()
  const persisted = await dragOut(
    editor.locator('img[alt="Deep photo"]'),
    false,
    'deep-fold-picture-drag-dark-ru.png',
  )
  await close()
  await launch()
  editor = page.locator('.document-editor')
  expect(await editor.evaluate((el) => el.editor.getJSON())).toEqual(persisted)
  await expect(
    editor.locator(':scope > .react-renderer > .image-block img[alt="Deep photo"]'),
  ).toBeVisible()
  await expect(editor.locator('summary')).toHaveText(['Keep this summary', 'Inner summary'])
  await page
    .locator('.sidebar-footer')
    .getByRole('button', { name: 'Настройки', exact: true })
    .click()
  await page.getByRole('button', { name: 'English', exact: true }).click()
  await page.getByRole('button', { name: 'Light', exact: true }).click()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await tab('Blocks')
}
try {
  await launch()
  await collapsiblePictureChecks()
  await listDropChecks()
  // An empty code block has no document-level placeholder above its header.
  await expect(page.locator('.code-block')).toBeVisible()
  expect(
    await page.locator('.code-block').evaluate((el) => getComputedStyle(el, '::before').content),
  ).toBe('none')
  // Small, anchored settings with a default collapse preference.
  await page.getByRole('button', { name: 'Code block settings', exact: true }).click()
  const settings = page.locator('.code-settings-popover')
  await expect(settings).toBeVisible()
  expect(await settings.evaluate((el) => el.parentElement === document.body)).toBe(true)
  expect((await settings.boundingBox()).width).toBeLessThan(310)
  await expect(page.locator('.modal-overlay')).toHaveCount(0)
  await page.getByLabel('Block title', { exact: true }).fill('Request example')
  await page.getByRole('checkbox', { name: 'Show line numbers', exact: true }).check()
  await page.getByRole('checkbox', { name: 'Collapsed by default', exact: true }).check()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.locator('.code-block pre')).toBeHidden()
  await page.getByRole('button', { name: 'Expand code', exact: true }).click()
  await page.locator('.code-block code').click()
  await page.keyboard.type('a\nb\nc')
  await expect(page.locator('.code-line-numbers > span')).toHaveCount(3)
  await page.getByRole('button', { name: 'Collapse code', exact: true }).click()
  await expect(page.locator('.code-block pre')).toBeHidden()
  await page.getByRole('button', { name: 'Code block settings', exact: true }).click()
  await page.screenshot({ path: path.join(output, 'code-settings.png') })
  await page.keyboard.press('Escape')
  await expect(settings).toHaveCount(0)
  // A single native block drag uses the accent and a three-pixel insertion cursor.
  const beforeSingleDrag = await json()
  await page.locator('.callout-block').hover()
  const singleGrip = page.getByRole('button', { name: 'Block options', exact: true })
  await expect(singleGrip).toBeVisible()
  const singleFrom = await singleGrip.boundingBox()
  const singleEnd = await page.locator('.document-editor > p').last().boundingBox()
  await page.mouse.move(singleFrom.x + singleFrom.width / 2, singleFrom.y + singleFrom.height / 2)
  await page.mouse.down()
  await page.mouse.move(singleEnd.x + 20, singleEnd.y + 3, { steps: 20 })
  const cursor = page.locator('.block-batch-drop-marker')
  await expect(cursor).toBeVisible()
  const cursorBounds = await cursor.boundingBox()
  expect(Math.min(cursorBounds.width, cursorBounds.height)).toBe(3)
  expect(await cursor.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
    'rgb(40, 90, 199)',
  )
  await page.screenshot({ path: path.join(output, 'single-drop-accent.png') })
  await page.mouse.up()
  await page.keyboard.press(mod + '+z')
  expect(await json()).toEqual(beforeSingleDrag)
  // Marquee selection works across different node types, in both directions.
  await marquee(page.locator('.code-block'), page.locator('.document-editor > p').first())
  await expect(page.locator('.block-is-selected')).toHaveCount(3)
  await page.screenshot({ path: path.join(output, 'selection.png') })
  // Right click keeps the whole selection and exposes batch actions.
  await page.locator('.callout-block').click({ button: 'right' })
  await expect(page.locator('.block-menu')).toContainText('3 blocks selected')
  await page.locator('.block-menu').getByRole('button', { name: 'Move down', exact: true }).click()
  expect((await json()).slice(0, 4).map((n) => n.type)).toEqual([
    'image',
    'codeBlock',
    'callout',
    'paragraph',
  ])
  await page.keyboard.press(mod + '+z')
  expect((await json()).slice(0, 4).map((n) => n.type)).toEqual([
    'codeBlock',
    'callout',
    'paragraph',
    'image',
  ])
  // A real native drag on any selected handle moves the complete group.
  await marquee(page.locator('.code-block'), page.locator('.document-editor > p').first())
  await page.locator('.callout-block').hover()
  const grip = page.getByRole('button', { name: 'Block options', exact: true })
  await expect(grip).toBeVisible()
  const from = await grip.boundingBox(),
    image = await page
      .locator('.document-editor > .react-renderer')
      .filter({ has: page.locator('.image-block') })
      .first()
      .boundingBox()
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(image.x + 50, image.y + image.height - 4, { steps: 20 })
  await expect(page.locator('.block-batch-drop-marker')).toBeVisible()
  expect((await page.locator('.block-batch-drop-marker').boundingBox()).height).toBe(3)
  expect(
    await page
      .locator('.block-batch-drop-marker')
      .evaluate((el) => getComputedStyle(el).backgroundColor),
  ).toBe('rgb(40, 90, 199)')
  await page.screenshot({ path: path.join(output, 'batch-drop.png') })
  await page.mouse.up()
  expect((await json()).slice(0, 4).map((n) => n.type)).toEqual([
    'image',
    'codeBlock',
    'callout',
    'paragraph',
  ])
  await expect(page.locator('.block-is-selected')).toHaveCount(3)
  await page.keyboard.press(mod + '+z')
  // Reverse marquee, deletion, and undo preserve each selected block.
  await marquee(
    page.locator('.code-block'),
    page.locator('.document-editor > p').first(),
    false,
    true,
  )
  await expect(page.locator('.block-is-selected')).toHaveCount(3)
  await page.keyboard.press('Backspace')
  await expect(page.locator('.code-block')).toHaveCount(0)
  await expect(page.locator('.callout-block')).toHaveCount(0)
  await page.keyboard.press(mod + '+z')
  await expect(page.locator('.code-block')).toBeVisible()
  await expect(page.locator('.callout-block')).toBeVisible()
  // Additive marquee, normal text selection, and context menu on an image.
  await marquee(page.locator('.code-block'), page.locator('.code-block'))
  await marquee(page.locator('.image-gallery'), page.locator('.image-gallery'), true)
  await expect(page.locator('.block-is-selected')).toHaveCount(2)
  // Typing with media selected must preserve the entire group.
  await page.keyboard.type('New paragraph after selection')
  await expect(
    page.locator('.document-editor > p').filter({ hasText: 'New paragraph after selection' }),
  ).toHaveCount(1)
  await expect(page.locator('.code-block')).toHaveCount(1)
  await expect(page.locator('.image-gallery')).toHaveCount(1)
  await page.keyboard.press(mod + '+z')
  await expect(
    page.locator('.document-editor > p').filter({ hasText: 'New paragraph after selection' }),
  ).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.locator('.block-is-selected')).toHaveCount(0)
  const alpha = page.locator('.document-editor > p').first()
  await alpha.click({ clickCount: 3, position: { x: 20, y: 10 } })
  expect(await page.evaluate(() => window.getSelection()?.toString())).toContain('Alpha')
  await expect(page.locator('.block-selection-rectangle')).toHaveCount(0)
  await page.locator('.image-gallery img').first().click({ button: 'right' })
  await expect(page.locator('.block-menu')).toBeVisible()
  await page.keyboard.press('Escape')
  // One slider width applies to all images with different original dimensions.
  const gallery = page.locator('.image-gallery')
  await gallery.scrollIntoViewIfNeeded()
  const width = async () => (await gallery.locator('.image-frame').boundingBox()).width
  expect(await width()).toBeCloseTo(180, 0)
  await gallery.getByRole('button', { name: 'Next image', exact: true }).click()
  expect(await width()).toBeCloseTo(180, 0)
  await gallery.locator('img').first().click()
  await gallery.getByRole('slider', { name: 'Resize image from right', exact: true }).focus()
  await page.keyboard.press('Shift+ArrowRight')
  expect(await width()).toBeCloseTo(190, 0)
  await gallery.getByRole('button', { name: 'Previous image', exact: true }).click()
  expect(await width()).toBeCloseTo(190, 0)
  await page.emulateMedia({ media: 'print' })
  await expect(page.locator('.code-block pre')).toBeVisible()
  await page.emulateMedia({ media: null })
  // Page geometry remains identical when a nested page needs a scrollbar.
  await tab('Short child')
  const geometry = async () =>
    page
      .locator('.page-icon-large,.page-title,.page-description,.block-editor')
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().left))
  const short = await geometry()
  await tab('Long nested child')
  const long = await geometry()
  expect(long).toEqual(short)
  await tab('Blocks')
  const doc = await json()
  expect(doc.find((n) => n.type === 'imageGallery').attrs.width).toBe(190)
  expect(doc.find((n) => n.type === 'codeBlock').attrs.collapsedByDefault).toBe(true)
  await close()
  await launch()
  await expect(page.locator('.code-block pre')).toBeHidden()
  await page.locator('.image-gallery').scrollIntoViewIfNeeded()
  expect((await page.locator('.image-gallery .image-frame').boundingBox()).width).toBeCloseTo(
    190,
    0,
  )
  await page.getByRole('button', { name: 'Next image', exact: true }).click()
  expect((await page.locator('.image-gallery .image-frame').boundingBox()).width).toBeCloseTo(
    190,
    0,
  )
  await close()
  expect(errors).toEqual([])
  succeeded = true
  console.log(
    'Passed: independent picture/handle/gallery drags from collapsible content and nested folds, preserved summaries/siblings/attributes, last-child deletion, exact undo, scrolling and dark/Russian restart; native single/group/code/picture/gallery drops into numbered, bullet, task and nested list items without extra paragraphs; indented 3px markers; retained attributes/siblings/checks; outside-list gutter drops; mixed-block marquee selection, batch actions/delete/undo, additive selection, normal text selection, context menu, compact code settings/collapse, shared gallery width, stable page alignment, print, and restart.',
  )
} catch (error) {
  if (page) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {})
  throw error
} finally {
  if (page) await page.mouse.up().catch(() => {})
  if (app) await app.close().catch(() => {})
  if (succeeded) await fs.rm(root, { recursive: true, force: true })
  else console.error('Fixture preserved for investigation:', root)
}
