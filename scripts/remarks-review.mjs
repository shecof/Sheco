import { _electron as electron, expect } from '@playwright/test'
import { build } from 'esbuild'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import sharp from 'sharp'
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sheco-remarks-'))
const output = path.resolve('test-results/remarks')
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
const w = seedWorkspace('Remarks fixture')
const knowledge = path.join(root, 'Knowledge')
await fs.mkdir(path.join(knowledge, 'attachments'), { recursive: true })
const images = []
for (const [i, color] of ['#8299a6', '#b09c85'].entries()) {
  const id = uid(),
    file = `${id}.png`
  const bytes = await sharp({ create: { width: 500, height: 180, channels: 3, background: color } })
    .png()
    .toBuffer()
  await fs.writeFile(path.join(knowledge, 'attachments', file), bytes)
  w.attachments.push({
    id,
    file,
    name: `sample-${i}.png`,
    mime: 'image/png',
    bytes: bytes.length,
    createdAt: new Date().toISOString(),
  })
  images.push({
    src: `sheco-asset://${w.id}/${file}`,
    alt: `Sample ${i}`,
    caption: `Caption ${i}`,
    width: 240,
    originalSrc: `sheco-asset://${w.id}/${file}`,
    crop: { x: 0, y: 0, width: 1, height: 1 },
  })
}
const p = (text = '') => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] })
const source = createPage(
  w,
  'A long title that should wrap over several lines when the window becomes narrow without hiding any words',
)
source.content = {
  type: 'doc',
  content: [
    p('Before images'),
    ...images.map((attrs) => ({ type: 'image', attrs })),
    { type: 'imageGallery', attrs: { images, width: 260 } },
    {
      type: 'codeBlock',
      attrs: { language: 'bash', title: 'Console output' },
      content: [{ type: 'text', text: 'first line\nimportant output\nlast line' }],
    },
    {
      type: 'orderedList',
      content: [
        {
          type: 'listItem',
          content: [
            p('First item'),
            { type: 'image', attrs: images[0] },
            p('Details after the image'),
          ],
        },
        { type: 'listItem', content: [p('Second item')] },
      ],
    },
    p(),
  ],
}
const target = createPage(w, 'Paste target')
const keyboard = createPage(w, 'Code keyboard')
const code = (text, comments = []) => ({
  type: 'codeBlock',
  attrs: { language: 'plaintext', title: 'Keyboard example', comments },
  content: [{ type: 'text', text }],
})
keyboard.content = {
  type: 'doc',
  content: [
    p('Ordinary text'),
    code('alpha\nbeta', [{ id: 'keyboard-note', from: 6, to: 10, text: 'Retain this note' }]),
    {
      type: 'orderedList',
      content: [
        { type: 'listItem', content: [p('First keyboard item')] },
        { type: 'listItem', content: [p('Second keyboard item'), code('nested code')] },
      ],
    },
    {
      type: 'table',
      content: [
        {
          type: 'tableRow',
          content: [code('cell code'), p('Middle cell'), p('Last cell')].map((node) => ({
            type: 'tableCell',
            content: [node],
          })),
        },
      ],
    },
    p('After keyboard examples'),
  ],
}
w.pages.push(source, target, keyboard)
w.ui.tabs = [source.id, target.id, keyboard.id]
w.ui.activeId = source.id
w.ui.accent = 'blue'
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
  page.on('pageerror', (e) => errors.push(e.message))
  await expect(page.locator('.document-editor')).toBeVisible({ timeout: 20000 })
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
async function tab(id) {
  await page
    .getByRole('tab')
    .filter({ hasText: w.pages.find((p) => p.id === id).title })
    .click()
}
async function editorSelection(from, to = from) {
  await page.locator('.document-editor').evaluate(
    (element, { from, to }) => {
      element.editor.commands.setTextSelection({ from, to })
      element.editor.view.focus()
    },
    { from, to },
  )
}
async function docPositions() {
  return page.locator('.document-editor').evaluate((element) => {
    const result = []
    element.editor.state.doc.descendants((node, pos) => {
      result.push({ type: node.type.name, pos, size: node.nodeSize, text: node.textContent })
    })
    return result
  })
}
async function insertControlHover(block, russian, filename) {
  const grip = page.getByRole('button', {
    name: russian ? 'Действия с блоком' : 'Block options',
    exact: true,
  })
  const above = page.getByRole('button', {
    name: russian ? 'Добавить блок сверху' : 'Insert block above',
    exact: true,
  })
  const below = page.getByRole('button', {
    name: russian ? 'Добавить блок снизу' : 'Insert block below',
    exact: true,
  })
  const opacity = (button) => button.evaluate((el) => getComputedStyle(el).opacity)
  await page.locator('.page-title').focus()
  await block.hover({ position: { x: 20, y: 10 } })
  await expect(grip).toBeVisible()
  await expect.poll(() => opacity(above)).toBe('0')
  await expect.poll(() => opacity(below)).toBe('0')
  expect(await above.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none')
  const position = await grip.boundingBox()
  await page.screenshot({ path: path.join(output, `${filename}-quiet.png`) })
  await grip.hover()
  for (const button of [above, below]) {
    await expect.poll(() => opacity(button)).toBe('1')
    await button.hover()
    expect(
      await button.evaluate((el) => {
        const r = el.getBoundingClientRect()
        return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))
      }),
    ).toBe(true)
    expect(await opacity(above)).toBe('1')
    expect(await opacity(below)).toBe('1')
  }
  expect((await grip.boundingBox()).x).toBeCloseTo(position.x, 0)
  expect((await grip.boundingBox()).y).toBeCloseTo(position.y, 0)
  await page.screenshot({ path: path.join(output, `${filename}-hover.png`) })
  await block.hover({ position: { x: 20, y: 10 } })
  await expect.poll(() => opacity(above)).toBe('0')
  await expect.poll(() => opacity(below)).toBe('0')
  await grip.focus()
  await page.keyboard.press('Shift+Tab')
  await expect(above).toBeFocused()
  expect(await opacity(above)).toBe('1')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  await expect(below).toBeFocused()
  expect(await opacity(below)).toBe('1')
  await page.locator('.page-title').focus()
  await block.hover({ position: { x: 20, y: 10 } })
  await expect.poll(() => opacity(above)).toBe('0')
}
async function codeTabChecks() {
  await tab(keyboard.id)
  await insertControlHover(
    page.locator('.document-editor > p').first(),
    false,
    'insert-controls-light-en',
  )
  const current = () => page.locator('.document-editor').evaluate((el) => el.editor.getJSON())
  const original = await current()
  const undo = async () => {
    await page.keyboard.press(`${mod}+z`)
    expect(await current()).toEqual(original)
  }
  for (let index = 0; index < 3; index++) {
    const node = (await docPositions()).filter((n) => n.type === 'codeBlock')[index]
    await editorSelection(node.pos + 1)
    await page.keyboard.press('Tab')
    expect(await page.locator('.code-block pre code').nth(index).textContent()).toBe(
      '\t' + node.text,
    )
    const changed = await current()
    if (index === 0)
      expect(changed.content[1].attrs.comments).toEqual([
        { ...original.content[1].attrs.comments[0], from: 7, to: 11 },
      ])
    // Code inside a list or cell stays in place rather than indenting the item or changing cells.
    expect(changed.content.map((n) => n.type)).toEqual(original.content.map((n) => n.type))
    expect(
      await page
        .locator('.document-editor')
        .evaluate((el) => el.editor.state.selection.$from.parent.type.name),
    ).toBe('codeBlock')
    await undo()
  }
  const rootCode = (await docPositions()).find((n) => n.type === 'codeBlock')
  await editorSelection(rootCode.pos + 1, rootCode.pos + 6)
  await page.keyboard.press('Tab')
  expect(await page.locator('.code-block pre code').first().textContent()).toBe('\t\nbeta')
  await undo()
  const paragraphs = (await docPositions()).filter((n) => n.type === 'paragraph')
  await editorSelection(rootCode.pos + 3, paragraphs[1].pos + 4)
  await page.keyboard.press('Tab')
  expect(await current()).toEqual(original)
  await editorSelection(paragraphs[0].pos + 1)
  await page.keyboard.press('Tab')
  expect(await current()).toEqual(original)
  await editorSelection(paragraphs[2].pos + 1)
  await page.keyboard.press('Tab')
  await expect(page.locator('.document-editor ol ol')).toHaveCount(1)
  await undo()
  await editorSelection(paragraphs[3].pos + 1)
  await page.keyboard.press('Tab')
  expect(
    await page
      .locator('.document-editor')
      .evaluate((el) => el.editor.state.selection.$from.parent.textContent),
  ).toBe('Last cell')
  expect(await current()).toEqual(original)
  await editorSelection(rootCode.pos + 1)
  await page.keyboard.press('Tab')
  const persisted = (await snapshot()).pages.find((p) => p.id === keyboard.id).content
  expect(persisted.content[1].content[0].text).toBe('\talpha\nbeta')
  await page.screenshot({ path: path.join(output, 'code-tab-light-en.png') })
  await tab(source.id)
  return persisted
}
async function dragPicture(picture, filename, color = 'rgb(40, 90, 199)') {
  await picture.scrollIntoViewIfNeeded()
  const destination = page.locator('.document-editor > p').first()
  const current = await picture.boundingBox()
  await page.mouse.move(current.x + current.width / 2, current.y + current.height / 2)
  await page.mouse.down()
  await page.mouse.move(current.x + current.width / 2 + 10, current.y + current.height / 2 - 10, {
    steps: 3,
  })
  await destination.scrollIntoViewIfNeeded()
  const destinationBounds = await destination.boundingBox()
  await page.mouse.move(destinationBounds.x + 15, destinationBounds.y + 1, { steps: 24 })
  const marker = page.locator('.block-batch-drop-marker')
  await expect(marker).toBeVisible()
  expect((await marker.boundingBox()).height).toBe(3)
  expect(await marker.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(color)
  await page.screenshot({ path: path.join(output, filename) })
  await page.mouse.up()
}
try {
  await launch()
  const keyboardSnapshot = await codeTabChecks()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1050, 900))
  const title = page.locator('.page-title')
  expect(
    await title.evaluate(
      (el) =>
        el.clientHeight > parseFloat(getComputedStyle(el).lineHeight) * 1.8 &&
        el.scrollHeight <= el.clientHeight + 1,
    ),
  ).toBe(true)
  // A self-drop is a no-op, with no toast or revision bump caused by the drop.
  const row = page
    .locator('.tree-row')
    .filter({ has: page.getByRole('button', { name: source.title, exact: true }) })
  const transfer = await page.evaluateHandle((id) => {
    const dt = new DataTransfer()
    dt.setData('application/sheco-page', id)
    return dt
  }, source.id)
  await row.dispatchEvent('dragover', { dataTransfer: transfer })
  await row.dispatchEvent('drop', { dataTransfer: transfer, clientY: 1000 })
  await expect(page.locator('.toast')).toHaveCount(0)
  await transfer.dispose()
  // New-page title is selected for immediate replacement by typing.
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.send('menu', 'newPage'),
  )
  await expect(page.getByLabel('Page title')).toBeFocused()
  expect(
    await page
      .getByLabel('Page title')
      .evaluate((el) => el.selectionStart === 0 && el.selectionEnd === el.value.length),
  ).toBe(true)
  await page.keyboard.type('Typed title')
  await expect(page.getByLabel('Page title')).toHaveValue('Typed title')
  await tab(source.id)
  // Use ProseMirror's real copy handler with an in-process DataTransfer; never replace the OS clipboard.
  const html = await page.locator('.document-editor').evaluate((element) => {
    const editor = element.editor
    editor.commands.selectAll()
    const data = new DataTransfer()
    element.dispatchEvent(
      new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }),
    )
    return data.getData('text/html')
  })
  expect(html).toContain('data-caption="Caption 0"')
  expect(html).toContain('data-images=')
  await tab(target.id)
  await page.locator('.document-editor').evaluate((element, html) => {
    element.editor.commands.focus()
    const data = new DataTransfer()
    data.setData('text/html', html)
    element.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    )
  }, html)
  await expect(page.locator('.document-editor > .react-renderer > .image-block')).toHaveCount(2)
  await expect(page.locator('.image-gallery')).toHaveCount(1)
  const pasted = (await snapshot()).pages.find((p) => p.id === target.id).content.content
  expect(pasted.filter((n) => n.type === 'image').map((n) => n.attrs.caption)).toEqual([
    'Caption 0',
    'Caption 1',
  ])
  const copiedGallery = pasted.find((n) => n.type === 'imageGallery')
  expect(copiedGallery.attrs.width).toBe(260)
  expect(copiedGallery.attrs.images.map((n) => n.caption)).toEqual(['Caption 0', 'Caption 1'])
  expect(pasted.find((n) => n.type === 'image').attrs.originalSrc).toBe(images[0].src)
  // The toolbar remains reachable through the gap without selecting the picture first.
  const firstImage = page.locator('.document-editor > .react-renderer > .image-block').first()
  await firstImage.scrollIntoViewIfNeeded()
  const firstFrame = firstImage.locator('.image-frame')
  await firstFrame.hover()
  await expect(firstImage).not.toHaveClass(/is-selected/)
  const captionButton = firstImage.getByRole('button', { name: 'Caption', exact: true })
  const buttonBounds = await captionButton.boundingBox()
  const frameBounds = await firstFrame.boundingBox()
  const pointerX = buttonBounds.x + buttonBounds.width / 2
  await page.mouse.move(pointerX, frameBounds.y + 2)
  await page.mouse.move(pointerX, frameBounds.y - 3, { steps: 3 })
  expect(
    await firstImage.locator('.image-toolbar').evaluate((el) => getComputedStyle(el).pointerEvents),
  ).toBe('auto')
  await page.mouse.move(pointerX, buttonBounds.y + buttonBounds.height / 2, { steps: 4 })
  await page.mouse.down()
  await page.mouse.up()
  await expect(firstImage.getByLabel('Image caption')).toBeFocused()
  const caption = firstImage.getByLabel('Image caption')
  await caption.press('Enter')
  await expect(caption).not.toBeFocused()
  await expect(caption).toHaveValue('Caption 0')
  await caption.fill('Caption 0')
  await caption.press('End')
  await caption.press('Shift+Enter')
  await page.keyboard.type('Second line')
  await expect(caption).toHaveValue('Caption 0\nSecond line')
  await caption.press('Enter')
  await expect(caption).not.toBeFocused()
  expect(
    (await snapshot()).pages.find((p) => p.id === target.id).content.content[1].attrs.caption,
  ).toBe('Caption 0\nSecond line')
  await caption.fill('Caption 0')
  await caption.press('Enter')
  const beforePictureDrag = (await snapshot()).pages.find((p) => p.id === target.id).content
  // Native drags start on the picture itself, retaining attributes and one-step undo.
  for (const [picture, type, filename] of [
    [firstImage.locator('img'), 'image', 'picture-drag-light-en.png'],
    [page.locator('.gallery-active img'), 'imageGallery', 'gallery-drag-light-en.png'],
    [
      page.locator('.document-editor ol .image-frame img'),
      'image',
      'nested-picture-drag-light-en.png',
    ],
  ]) {
    const movedAttrs = await picture.evaluate((el) => {
      const editor = el.closest('.document-editor').editor
      let attrs
      editor.state.doc.descendants((node, pos) => {
        if (
          ['image', 'imageGallery'].includes(node.type.name) &&
          editor.view.nodeDOM(pos).contains(el)
        )
          attrs = node.attrs
      })
      return attrs
    })
    await dragPicture(picture, filename)
    const moved = (await snapshot()).pages.find((p) => p.id === target.id).content.content
    expect(moved[0].type).toBe(type)
    expect(moved[0].attrs).toEqual(movedAttrs)
    await page.keyboard.press(`${mod}+z`)
    expect((await snapshot()).pages.find((p) => p.id === target.id).content).toEqual(
      beforePictureDrag,
    )
    await page.keyboard.press('Escape')
  }
  // Modifier-click selects existing images; combine retains captions/crops/order, and undoes once.
  const pictures = page.locator(
    '.document-editor > .react-renderer > .image-block .image-frame img',
  )
  await pictures.nth(0).click()
  await pictures.nth(1).click({ modifiers: ['Shift'] })
  await expect(page.locator('.document-editor > .block-is-selected')).toHaveCount(2)
  await dragPicture(pictures.nth(0), 'picture-group-drag-light-en.png')
  const movedGroup = (await snapshot()).pages.find((p) => p.id === target.id).content.content
  expect(movedGroup.slice(0, 2).map((node) => node.attrs.caption)).toEqual([
    'Caption 0',
    'Caption 1',
  ])
  await page.keyboard.press(`${mod}+z`)
  expect((await snapshot()).pages.find((p) => p.id === target.id).content).toEqual(
    beforePictureDrag,
  )
  await pictures.nth(0).click()
  await pictures.nth(1).click({ modifiers: ['Shift'] })
  await pictures.nth(1).click({ button: 'right' })
  await page.getByRole('button', { name: 'Combine into slider', exact: true }).click()
  await expect(page.locator('.document-editor > .react-renderer > .image-block')).toHaveCount(0)
  const combined = (await snapshot()).pages
    .find((p) => p.id === target.id)
    .content.content.filter((n) => n.type === 'imageGallery')
  expect(combined).toHaveLength(2)
  expect(combined[0].attrs.images.map((n) => n.caption)).toEqual(['Caption 0', 'Caption 1'])
  expect(combined[0].attrs.images[0].crop).toEqual(images[0].crop)
  await page.keyboard.press(`${mod}+z`)
  await expect(page.locator('.document-editor > .react-renderer > .image-block')).toHaveCount(2)
  // Nested marquee selects just the picture, and delete/undo retain both list items and all text.
  const nested = page.locator('.document-editor ol .image-block')
  await nested.scrollIntoViewIfNeeded()
  const bounds = await nested.boundingBox()
  const editorBounds = await page.locator('.document-editor').boundingBox()
  await page.mouse.move(editorBounds.x - 35, bounds.y + 5)
  await page.mouse.down()
  await page.mouse.move(bounds.x + bounds.width + 5, bounds.y + bounds.height - 5, { steps: 8 })
  await page.mouse.up()
  await expect(page.locator('ol .block-is-selected')).toHaveCount(1)
  await expect(page.locator('ol.block-is-selected')).toHaveCount(0)
  await page.keyboard.press('Backspace')
  await expect(nested).toHaveCount(0)
  await expect(page.locator('.document-editor ol > li')).toHaveCount(2)
  await expect(page.locator('.document-editor ol')).toContainText('Details after the image')
  await page.keyboard.press(`${mod}+z`)
  await expect(nested).toHaveCount(1)
  await page.keyboard.press('Escape')
  const spacing = await page
    .locator('.document-editor ol > li')
    .nth(1)
    .evaluate((el) => parseFloat(getComputedStyle(el).marginTop))
  expect(spacing).toBeGreaterThanOrEqual(14)
  // Nested paragraphs use the same gutter as ordinary blocks, clear of the list marker.
  const ordinary = page.locator('.document-editor > p').first()
  await ordinary.scrollIntoViewIfNeeded()
  await ordinary.hover({ position: { x: 20, y: 10 } })
  const grip = page.getByRole('button', { name: 'Block options', exact: true })
  await expect(grip).toBeVisible()
  const ordinaryGrip = await grip.boundingBox()
  const listText = page.locator('.document-editor ol > li').first().locator('p').first()
  await listText.scrollIntoViewIfNeeded()
  await listText.hover()
  await expect(grip).toBeVisible()
  await expect.poll(async () => (await grip.boundingBox()).x).toBeCloseTo(ordinaryGrip.x, 0)
  expect((await grip.boundingBox()).x + ordinaryGrip.width).toBeLessThan(editorBounds.x)
  await page.screenshot({ path: path.join(output, 'list-gutter-light-en.png') })
  // Language chooser is anchored to its trigger and closes on Escape with focus restored.
  await page.locator('.code-block').scrollIntoViewIfNeeded()
  await page.getByRole('button', { name: 'Code language', exact: true }).click()
  await expect(page.locator('.code-language-popover')).toBeVisible()
  await expect(page.locator('.modal-overlay')).toHaveCount(0)
  await page.getByLabel('Search languages', { exact: true }).fill('python')
  await page.getByRole('option', { name: 'python', exact: true }).click()
  await expect(page.locator('.code-language')).toContainText('python')
  await page.getByRole('button', { name: 'Code language', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Code language', exact: true })).toBeFocused()
  // Select output, add a comment, edit earlier text, and verify the range follows it.
  const codeHeight = (await page.locator('.code-block').boundingBox()).height
  const codePos = (await docPositions()).find((n) => n.type === 'codeBlock').pos
  await editorSelection(codePos + 1 + 11, codePos + 1 + 27)
  const commentPoint = await page.locator('.document-editor').evaluate(
    (el, pos) => {
      const bounds = el.editor.view.coordsAtPos(pos)
      return { x: bounds.left + 3, y: (bounds.top + bounds.bottom) / 2 }
    },
    codePos + 1 + 11,
  )
  await page.mouse.click(commentPoint.x, commentPoint.y, { button: 'right' })
  await expect(
    page.locator('.block-menu').getByRole('button', { name: 'Add comment', exact: true }),
  ).toBeVisible()
  await page.screenshot({ path: path.join(output, 'comment-menu-light-en.png') })
  await page.getByRole('button', { name: 'Add comment', exact: true }).click()
  await page.getByLabel('Comment', { exact: true }).fill('This output needs attention')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.locator('.code-comment-highlight')).toHaveText('important output')
  await expect(page.locator('.code-comments-print')).toHaveCount(1)
  await expect(page.locator('.code-comments-print')).toBeHidden()
  expect((await page.locator('.code-block').boundingBox()).height).toBe(codeHeight)
  await page.locator('.code-comment-highlight').hover()
  await expect(page.locator('.code-comment-preview')).toContainText('This output needs attention')
  expect((await page.locator('.code-comment-preview').boundingBox()).height).toBeLessThan(36)
  await expect(page.getByLabel('Comment', { exact: true })).toHaveCount(0)
  await page.locator('.code-comment-preview').hover({ position: { x: 3, y: 3 } })
  await page.waitForTimeout(250)
  await expect(page.locator('.code-comment-preview')).toBeVisible()
  await page.getByRole('button', { name: 'Edit comment', exact: true }).click()
  await expect(page.getByLabel('Comment', { exact: true })).toHaveValue(
    'This output needs attention',
  )
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.locator('.code-comment-highlight').click()
  await expect(page.locator('.code-comment-preview')).toBeVisible()
  await page.mouse.move(10, 10)
  await expect(page.locator('.code-comment-preview')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.code-comment-preview')).toHaveCount(0)
  // A focused range opens by keyboard without adding a newline to the code.
  await page.locator('.code-comment-highlight').focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('.code-comment-preview')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.locator('.code-comment-highlight').hover()
  await page.screenshot({ path: path.join(output, 'comment-hover-light-en.png') })
  await page.mouse.move(10, 10)
  await expect(page.locator('.code-comment-preview')).toHaveCount(0)
  // Switching between ranges reanchors the popup; overlapping annotations expose both notes.
  for (const [from, to, text] of [
    [0, 5, 'Note'],
    [28, 37, 'Last-line note'],
    [14, 21, 'Overlapping note'],
  ]) {
    await editorSelection(codePos + 1 + from, codePos + 1 + to)
    await page.getByRole('button', { name: 'Comment on selection', exact: true }).click()
    await page.getByLabel('Comment', { exact: true }).fill(text)
    await page.getByRole('button', { name: 'Save', exact: true }).click()
  }
  const firstRange = page.locator('.code-comment-highlight').filter({ hasText: /^first$/ })
  const lastRange = page.locator('.code-comment-highlight').filter({ hasText: /^last line$/ })
  await firstRange.hover()
  await expect(page.locator('.code-comment-preview')).toContainText('Note')
  expect((await page.locator('.code-comment-preview').boundingBox()).width).toBeLessThan(110)
  await page.screenshot({ path: path.join(output, 'comment-short-light-en.png') })
  await lastRange.hover()
  await expect(page.locator('.code-comment-preview')).toContainText('Last-line note')
  const lastBounds = await lastRange.boundingBox()
  await expect
    .poll(async () => {
      const popup = await page.locator('.code-comment-preview').boundingBox()
      return Math.min(
        Math.abs(popup.y - (lastBounds.y + lastBounds.height + 4)),
        Math.abs(popup.y + popup.height - (lastBounds.y - 4)),
      )
    })
    .toBeLessThan(1)
  const overlap = page.locator('.code-comment-highlight').filter({ hasText: /^ortant $/ })
  await overlap.hover()
  await expect(page.locator('.code-comment-preview-item')).toHaveCount(2)
  await expect(page.locator('.code-comment-preview')).toContainText('This output needs attention')
  await expect(page.locator('.code-comment-preview')).toContainText('Overlapping note')
  await page.keyboard.press('Escape')
  for (const [range, text] of [
    [firstRange, 'Note'],
    [lastRange, 'Last-line note'],
    [overlap, 'Overlapping note'],
  ]) {
    await range.hover()
    await page
      .locator('.code-comment-preview-item')
      .filter({ hasText: text })
      .getByRole('button', { name: 'Edit comment', exact: true })
      .click()
    await page.getByRole('button', { name: 'Delete comment', exact: true }).click()
  }
  await expect(page.locator('.code-comment-highlight')).toHaveText('important output')
  await editorSelection(codePos + 1)
  await page.keyboard.type('prefix ')
  const commented = (await snapshot()).pages
    .find((p) => p.id === target.id)
    .content.content.find((n) => n.type === 'codeBlock')
  expect(commented.attrs.comments[0].from).toBe(18)
  expect(commented.attrs.comments[0].to).toBe(34)
  await expect(page.locator('.code-comment-highlight')).toHaveText('important output')
  // A copied annotated block retains its code settings and ranges on another page.
  const annotatedHTML = await page.locator('.document-editor').evaluate((element) => {
    element.editor.commands.selectAll()
    const data = new DataTransfer()
    element.dispatchEvent(
      new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }),
    )
    return data.getData('text/html')
  })
  await page.getByRole('tab').filter({ hasText: 'Typed title' }).click()
  await page.locator('.document-editor').evaluate((element, html) => {
    element.editor.commands.focus()
    const data = new DataTransfer()
    data.setData('text/html', html)
    element.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    )
  }, annotatedHTML)
  await expect(page.locator('.code-title')).toHaveText('Console output')
  await expect(page.locator('.code-comment-highlight')).toHaveText('important output')
  await expect(page.locator('.code-comments-print')).toContainText('This output needs attention')
  await tab(target.id)
  await page.locator('.code-block').scrollIntoViewIfNeeded()
  await page.screenshot({ path: path.join(output, 'light-en.png') })
  await page
    .locator('.sidebar-footer')
    .getByRole('button', { name: 'Settings', exact: true })
    .click()
  await page.getByRole('button', { name: 'Русский', exact: true }).click()
  await page.getByRole('button', { name: 'Тёмная', exact: true }).click()
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click()
  const beforeDarkDrag = (await snapshot()).pages.find((p) => p.id === target.id).content
  await dragPicture(firstImage.locator('img'), 'picture-drag-dark-ru.png', 'rgb(150, 185, 255)')
  expect((await snapshot()).pages.find((p) => p.id === target.id).content.content[0].type).toBe(
    'image',
  )
  await page.keyboard.press(`${mod}+z`)
  expect((await snapshot()).pages.find((p) => p.id === target.id).content).toEqual(beforeDarkDrag)
  await page.keyboard.press('Escape')
  await page.locator('.code-block').scrollIntoViewIfNeeded()
  await editorSelection(codePos + 1 + 18, codePos + 1 + 34)
  const darkCommentPoint = await page.locator('.document-editor').evaluate(
    (el, pos) => {
      const bounds = el.editor.view.coordsAtPos(pos)
      return { x: bounds.left + 3, y: (bounds.top + bounds.bottom) / 2 }
    },
    codePos + 1 + 18,
  )
  await page.mouse.click(darkCommentPoint.x, darkCommentPoint.y, { button: 'right' })
  await expect(
    page.getByRole('button', { name: 'Добавить комментарий', exact: true }),
  ).toBeVisible()
  await page.screenshot({ path: path.join(output, 'comment-menu-dark-ru.png') })
  const duplicateAction = page.locator('.block-menu').getByRole('button', {
    name: 'Дублировать',
    exact: true,
  })
  expect(
    await duplicateAction.evaluate((el) => {
      const r = el.getBoundingClientRect()
      return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2))
    }),
  ).toBe(true)
  await page.getByRole('button', { name: 'Добавить комментарий', exact: true }).click()
  await expect(page.getByLabel('Комментарий', { exact: true })).toBeFocused()
  await page.getByRole('button', { name: 'Отмена', exact: true }).click()
  await page.getByRole('button', { name: 'Язык кода', exact: true }).click()
  await page.screenshot({ path: path.join(output, 'language-dark-ru.png') })
  await page.keyboard.press('Escape')
  await expect(page.locator('.code-comments-print')).toBeHidden()
  await page.locator('.code-comment-highlight').hover()
  await expect(page.locator('.code-comment-preview')).toBeVisible()
  await page.screenshot({ path: path.join(output, 'comments-dark-ru.png') })
  await page.keyboard.press('Escape')
  await listText.hover()
  const darkGrip = page.getByRole('button', { name: 'Действия с блоком', exact: true })
  await expect(darkGrip).toBeVisible()
  expect((await darkGrip.boundingBox()).x).toBeCloseTo(ordinaryGrip.x, 0)
  await page.screenshot({ path: path.join(output, 'list-gutter-dark-ru.png') })
  await insertControlHover(listText, true, 'insert-controls-dark-ru')
  await page.emulateMedia({ media: 'print' })
  await expect(page.locator('.code-comments-print')).toBeVisible()
  await expect(page.locator('.code-comments-print')).toContainText('This output needs attention')
  await page.emulateMedia({ media: null })
  await close()
  await launch()
  await tab(keyboard.id)
  expect(await page.locator('.document-editor').evaluate((el) => el.editor.getJSON())).toEqual(
    keyboardSnapshot,
  )
  expect(await page.locator('.code-block pre code').first().textContent()).toBe('\talpha\nbeta')
  await page.screenshot({ path: path.join(output, 'code-tab-dark-ru.png') })
  await tab(target.id)
  await expect(page.locator('.code-comment-highlight')).toHaveText('important output')
  await expect(page.locator('.code-comments-print')).toContainText('This output needs attention')
  await page.locator('.code-comment-highlight').click()
  await page.getByRole('button', { name: 'Редактировать комментарий', exact: true }).click()
  await page.getByLabel('Комментарий', { exact: true }).fill('Updated explanation')
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await page.locator('.code-comment-highlight').hover()
  await expect(page.locator('.code-comment-preview')).toContainText('Updated explanation')
  await page.keyboard.press('Escape')
  await page.locator('.code-comment-highlight').click()
  await page.getByRole('button', { name: 'Редактировать комментарий', exact: true }).click()
  await page.getByRole('button', { name: 'Удалить комментарий', exact: true }).click()
  await expect(page.locator('.code-comment-highlight')).toHaveCount(0)
  await expect(page.locator('.code-comments-print')).toHaveCount(0)
  await close()
  expect(errors).toEqual([])
  console.log(
    'Passed: literal code Tab at cursor/selection, nested list/cell scope, unchanged ordinary Tab/list indentation/table navigation, retained comments, exact undo and restart; wrapped titles, new-title selection, silent self-drop, real HTML copy/paste of captions/gallery/crops, reachable image toolbar without selection, caption Enter/Shift+Enter, native picture/gallery/nested/group drag with retained attributes and undo, 3px accent insertion line in both themes, image multi-selection/combine/undo, nested selection/delete/undo, shared list gutter, anchored language picker, English/Russian selection-comment context actions, compact content-sized code comments/hover/click/keyboard/dismissal/reanchoring/overlap/range mapping/edit/delete/restart/print, light English and dark Russian.',
  )
} catch (error) {
  if (page) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {})
  console.error('Fixture preserved for investigation:', root)
  throw error
} finally {
  if (app) await app.close().catch(() => {})
}
