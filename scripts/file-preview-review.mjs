import { _electron as electron, expect } from '@playwright/test'
import { build } from 'esbuild'
import sharp from 'sharp'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sheco-file-preview-'))
const knowledge = path.join(root, 'Knowledge'),
  output = path.resolve('test-results/file-preview')
await fs.mkdir(path.join(knowledge, 'attachments'), { recursive: true })
await fs.mkdir(output, { recursive: true })
const bundle = await build({
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
const module = path.join(root, 'fixture.mjs')
await fs.writeFile(module, bundle.outputFiles[0].contents)
const { seedWorkspace, createPage, uid } = await import(pathToFileURL(module).href)
const w = seedWorkspace('File preview fixture'),
  note = createPage(w, 'Local files')
function makePdf() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R /Outlines 8 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R 12 0 R 14 0 R 16 0 R 18 0 R 20 0 R 22 0 R] /Count 8 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ...['Local PDF preview', 'Second page'].map((title) => {
      const stream = `0.2 0.35 0.65 rg 40 670 520 80 re f BT /F1 24 Tf 1 1 1 rg 60 704 Td (${title}) Tj ET`
      return `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
    }),
  ]
  const lastStream = '0.2 0.35 0.65 rg 40 670 520 80 re f'
  objects.push(
    '<< /Type /Outlines /First 9 0 R /Last 11 0 R /Count 3 >>',
    '<< /Title (First chapter) /Parent 8 0 R /Next 10 0 R /Dest [3 0 R /Fit] >>',
    '<< /Title (Second chapter) /Parent 8 0 R /Prev 9 0 R /Next 11 0 R /Dest [4 0 R /Fit] >>',
    '<< /Title (External link) /Parent 8 0 R /Prev 10 0 R /A << /S /URI /URI (https://example.com/private) >> >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 5 0 R >> >> /Contents 13 0 R >>',
    `<< /Length ${lastStream.length} >>\nstream\n${lastStream}\nendstream`,
  )
  for (let number = 4; number <= 8; number++) {
    const stream = `0.2 0.35 0.65 rg 40 670 520 80 re f BT /F1 24 Tf 1 1 1 rg 60 704 Td (Page ${number}) Tj ET`
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 5 0 R >> >> /Contents ${objects.length + 2} 0 R >>`,
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    )
  }
  let text = '%PDF-1.4\n',
    offsets = [0]
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(text))
    text += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const start = Buffer.byteLength(text)
  text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => String(offset).padStart(10, '0') + ' 00000 n \n')
    .join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`
  return Buffer.from(text)
}
const image = await sharp(
  Buffer.from(
    '<svg width="800" height="500"><rect width="800" height="500" fill="#eaf1f8"/><circle cx="230" cy="250" r="120" fill="#527dab"/><rect x="420" y="130" width="230" height="240" rx="30" fill="#88ab8f"/></svg>',
  ),
)
  .png()
  .toBuffer()
const assets = []
for (const [name, mime, bytes] of [
  ['Report.pdf', 'application/pdf', makePdf()],
  ['Picture.png', 'image/png', image],
  ['Invalid.pdf', 'application/pdf', Buffer.from('not a PDF')],
  [
    'Notes.txt',
    'text/plain',
    Buffer.from(
      '<script>window.previewInjected = true</script>\nТекстовый файл, данные без исполнения.\n' +
        'A very long unwrapped line '.repeat(80),
    ),
  ],
  ['Escape.pdf', 'application/pdf', Buffer.from('dummy')],
  ['Large.txt', 'text/plain', Buffer.alloc(4 * 1024 * 1024 + 1, 65)],
]) {
  const a = {
    id: uid(),
    file: uid() + '.' + name.split('.').at(-1).toLowerCase(),
    name,
    mime,
    bytes: bytes.length,
    createdAt: new Date().toISOString(),
  }
  await fs.writeFile(path.join(knowledge, 'attachments', a.file), bytes)
  assets.push(a)
}
await fs.writeFile(path.join(root, 'outside.pdf'), makePdf())
await fs.rm(path.join(knowledge, 'attachments', assets[4].file))
await fs.symlink(
  path.join(root, 'outside.pdf'),
  path.join(knowledge, 'attachments', assets[4].file),
)
w.attachments = assets
note.content = {
  type: 'doc',
  content: [
    ...assets.slice(0, 4).map((a) => ({
      type: 'attachment',
      attrs: { id: a.id, file: a.file, name: a.name, bytes: a.bytes },
    })),
    {
      type: 'image',
      attrs: { src: `sheco-asset://${w.id}/${assets[1].file}`, alt: 'Synthetic image', width: 300 },
    },
    { type: 'paragraph' },
  ],
}
w.pages.push(note)
w.ui.tabs = [note.id]
w.ui.activeId = note.id
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
async function launch(editor = true) {
  app = await electron.launch({
    args: [process.env.SHECO_TEST_MAIN ?? '.'],
    env: { ...process.env, SHECO_DATA_DIR: root },
  })
  page = await app.firstWindow()
  page.on('pageerror', (e) => errors.push(e.message))
  await expect(page.locator(editor ? '.document-editor' : '.pdf-preview')).toBeVisible({
    timeout: 20000,
  })
  await app.evaluate(({ BrowserWindow, shell }) => {
    BrowserWindow.getAllWindows()[0].setSize(1280, 900)
    shell.openPath = async (file) => {
      globalThis.__previewExternalFile = file
      return ''
    }
    shell.openExternal = async (url) => {
      globalThis.__previewExternalUrl = url
    }
  })
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
async function settings(ru = false) {
  await page
    .locator('.sidebar-footer')
    .getByRole('button', { name: ru ? 'Настройки' : 'Settings', exact: true })
    .click()
  await page.getByRole('tab', { name: ru ? 'Плагины' : 'Plugins', exact: true }).click()
}
async function showNote() {
  await page.locator('.page-tree').getByRole('button', { name: 'Local files', exact: true }).click()
  await expect(page.locator('.document-editor')).toBeVisible()
}
async function openFile(name) {
  await showNote()
  await page.getByRole('button', { name: `Open file ${name}`, exact: true }).click()
  await expect(page.locator('.file-preview')).toBeVisible()
}
async function fitCheck() {
  await expect
    .poll(() => page.locator('.pdf-stage>canvas').evaluate((el) => el.width))
    .toBeGreaterThan(200)
  const size = await page.locator('.pdf-stage').evaluate((el) => ({
    canvas: el.querySelector('canvas').getBoundingClientRect().height,
    available: el.clientHeight - 96,
    overflow: el.scrollHeight - el.clientHeight,
  }))
  expect(size.canvas).toBeLessThanOrEqual(size.available + 2)
  expect(size.overflow).toBeLessThanOrEqual(2)
}
async function fitHeight() {
  await page.getByRole('button', { name: 'PDF scale', exact: true }).click()
  await page.locator('.popover').getByRole('button', { name: 'Fit height', exact: true }).click()
}
try {
  await launch()
  await page.getByRole('button', { name: 'Open file Report.pdf', exact: true }).click()
  await expect
    .poll(() => app.evaluate(() => globalThis.__previewExternalFile))
    .toContain(assets[0].file)
  const refused = await page.evaluate(
    async (input) => {
      try {
        await window.sheco.readPreviewPdf(input)
        return ''
      } catch (e) {
        return String(e)
      }
    },
    { workspaceId: w.id, attachmentId: assets[0].id },
  )
  expect(refused).toContain('disabled')
  await settings()
  await expect(page.locator('.mcp-settings .plugin-commands')).toHaveCount(0)
  await expect(page.locator('.file-preview-settings .plugin-commands')).toHaveCount(0)
  await expect(page.locator('.plugin-commands')).toHaveCount(5)
  await expect(page.locator('.plugin-command-trigger code')).toHaveText([
    '/templates',
    '/template',
    '/data',
    '/architecture',
    '/commands',
    '/jira',
    '/jira-inline',
  ])
  await expect(page.locator('.plugin-commands[open]')).toHaveCount(0)
  await expect(page.locator('.jira-configuration')).toHaveCount(0)
  await page.screenshot({ path: path.join(output, 'plugins-light-en.png') })
  await page.getByRole('button', { name: 'Configure Jira', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Jira settings', exact: true })).toBeVisible()
  await page.getByLabel('Jira address', { exact: true }).fill('https://draft.example.com')
  await showNote()
  await page.locator('.tabs').getByRole('button', { name: 'Jira settings', exact: true }).click()
  await expect(page.getByLabel('Jira address', { exact: true })).toHaveValue(
    'https://draft.example.com',
  )
  await saved()
  expect((await page.evaluate(() => window.sheco.boot())).active.plugins.jira.connections).toEqual(
    [],
  )
  await settings()
  await page
    .locator('.mcp-settings')
    .getByRole('button', { name: 'Configure', exact: true })
    .click()
  await expect(page.getByRole('heading', { name: 'MCP settings', exact: true })).toBeVisible()
  await expect(page.getByRole('switch', { name: 'Enable MCP', exact: true })).toHaveAttribute(
    'aria-checked',
    'false',
  )
  await page.getByLabel('MCP port', { exact: true }).fill('31000')
  await showNote()
  await page.locator('.tabs').getByRole('button', { name: 'MCP settings', exact: true }).click()
  await expect(page.getByLabel('MCP port', { exact: true })).toHaveValue('31000')
  await page.screenshot({ path: path.join(output, 'mcp-settings-light-en.png') })
  await settings()
  await page
    .locator('.file-preview-settings')
    .getByRole('button', { name: 'Configure', exact: true })
    .click()
  await expect(
    page.getByRole('heading', { name: 'File preview settings', exact: true }),
  ).toBeVisible()
  await page.getByRole('switch', { name: 'Enable file preview', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Default PDF size', exact: true })).toContainText(
    'Fit height',
  )
  await page.screenshot({ path: path.join(output, 'preview-settings-light-en.png') })
  await showNote()
  await page
    .locator('.sidebar-footer')
    .getByRole('button', { name: 'Plugins', exact: false })
    .click()
  await page
    .locator('.plugins-menu')
    .getByRole('button', { name: 'File preview', exact: true })
    .click()
  await expect(
    page.getByRole('heading', { name: 'File preview settings', exact: true }),
  ).toBeVisible()
  await expect(page.locator('.tabs .tab')).toHaveCount(4)
  await openFile('Report.pdf')
  await expect(page.getByLabel('Page number', { exact: true })).toHaveValue('1')
  await expect(page.locator('.preview-page-controls')).toContainText('/ 8')
  await fitCheck()
  await expect(page.locator('.preview-zoom-controls button')).toHaveCount(3)
  await expect(page.getByRole('button', { name: 'Fit height', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'PDF scale', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Fit height', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.keyboard.press('Escape')
  await page.screenshot({ path: path.join(output, 'pdf-light-en.png') })
  const controls = await page.locator('.pdf-preview').evaluate((el) => {
    const dock = el.querySelector('.preview-zoom-controls').getBoundingClientRect(),
      input = el.querySelector('.preview-page-controls input').getBoundingClientRect(),
      buttons = Array.from(el.querySelectorAll('.preview-zoom-controls button'))
    return {
      height: dock.height,
      width: dock.width,
      input: input.width,
      aligned: buttons.every(
        (button) =>
          Math.abs(button.getBoundingClientRect().top - buttons[0].getBoundingClientRect().top) < 1,
      ),
    }
  })
  expect(controls.height).toBeLessThan(46)
  expect(controls.width).toBeGreaterThan(120)
  expect(controls.width).toBeLessThan(150)
  expect(controls.input).toBeLessThan(30)
  expect(controls.aligned).toBe(true)
  await page.getByLabel('Page number', { exact: true }).fill('8')
  await page.getByLabel('Page number', { exact: true }).press('NumpadEnter')
  await expect(page.locator('.pdf-stage')).toBeFocused()
  await expect(page.locator('.pdf-stage')).toHaveCSS('outline-style', 'none')
  await expect(page.getByRole('button', { name: 'Next page', exact: true })).toBeDisabled()
  await page.getByLabel('Page number', { exact: true }).fill('2')
  await page.getByLabel('Page number', { exact: true }).press('Enter')
  await page.getByRole('button', { name: 'Previous page', exact: true }).click()
  const before = await page.getByRole('button', { name: 'PDF scale', exact: true }).innerText()
  const pinch = await page.locator('.pdf-stage').evaluate((el) => {
    const box = el.querySelector('canvas').getBoundingClientRect()
    return !el.dispatchEvent(
      new WheelEvent('wheel', {
        ctrlKey: true,
        deltaY: -18,
        clientX: box.left + box.width / 2,
        clientY: box.top + box.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    )
  })
  expect(pinch).toBe(true)
  await expect
    .poll(() => page.getByRole('button', { name: 'PDF scale', exact: true }).innerText())
    .not.toBe(before)
  expect(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.getZoomFactor(),
    ),
  ).toBe(1)
  expect(await page.evaluate(() => visualViewport.scale)).toBe(1)
  const continuousPinch = await page.locator('.pdf-stage').evaluate(async (el) => {
    const canvas = el.querySelector('canvas'),
      samples = []
    for (let i = 0; i < 35; i++) {
      const box = canvas.getBoundingClientRect()
      el.dispatchEvent(
        new WheelEvent('wheel', {
          ctrlKey: true,
          deltaY: i < 18 ? -3 : 3,
          clientX: box.left + box.width / 2,
          clientY: box.top + box.height / 2,
          bubbles: true,
          cancelable: true,
        }),
      )
      await new Promise(requestAnimationFrame)
      const pixel = canvas
        .getContext('2d')
        .getImageData(Math.floor(canvas.width * 0.15), Math.floor(canvas.height * 0.1), 1, 1).data
      samples.push(pixel[3] === 255 && pixel[0] < 150)
    }
    return samples
  })
  expect(continuousPinch.every(Boolean)).toBe(true)
  await fitHeight()
  await fitCheck()
  // Small edge input holds the reading position before one deliberate turn.
  await page.locator('.pdf-stage').evaluate(async (el) => {
    for (let i = 0; i < 4; i++) {
      el.dispatchEvent(new WheelEvent('wheel', { deltaY: 20, bubbles: true, cancelable: true }))
      await new Promise((resolve) => setTimeout(resolve, 80))
    }
  })
  await expect(page.getByLabel('Page number', { exact: true })).toHaveValue('1')
  await page.locator('.pdf-stage').evaluate(async (el) => {
    for (let i = 0; i < 8; i++) {
      el.dispatchEvent(new WheelEvent('wheel', { deltaY: 20, bubbles: true, cancelable: true }))
      await new Promise((resolve) => setTimeout(resolve, 80))
    }
  })
  await expect(page.getByLabel('Page number', { exact: true })).toHaveValue('2')
  await page.getByLabel('Page number', { exact: true }).fill('1')
  await page.getByLabel('Page number', { exact: true }).press('Enter')
  // Sustained strong input crosses multiple pages, including while a new raster renders.
  await page.locator('.pdf-stage').evaluate(async (el) => {
    for (let i = 0; i < 25; i++) {
      el.dispatchEvent(new WheelEvent('wheel', { deltaY: 60, bubbles: true, cancelable: true }))
      await new Promise(requestAnimationFrame)
    }
  })
  await expect
    .poll(async () => Number(await page.getByLabel('Page number', { exact: true }).inputValue()))
    .toBeGreaterThan(3)
  await page.getByLabel('Page number', { exact: true }).fill('1')
  await page.getByLabel('Page number', { exact: true }).press('Enter')
  await page.waitForTimeout(240)
  await page.locator('.pdf-stage').hover()
  await page.mouse.wheel(0, 1600)
  await expect
    .poll(async () => Number(await page.getByLabel('Page number', { exact: true }).inputValue()))
    .toBeGreaterThan(3)
  await page.getByLabel('Page number', { exact: true }).fill('1')
  await page.getByLabel('Page number', { exact: true }).press('Enter')
  await page.mouse.wheel(0, 120)
  await expect(page.getByLabel('Page number', { exact: true })).toHaveValue('2')
  await page.locator('.pdf-stage').evaluate(async (el) => {
    for (const deltaY of [45, 30, 20, 10, 5, 2]) {
      el.dispatchEvent(new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true }))
      await new Promise(requestAnimationFrame)
    }
  })
  await expect(page.getByLabel('Page number', { exact: true })).toHaveValue('2')
  await page.getByLabel('Page number', { exact: true }).fill('8')
  await page.getByLabel('Page number', { exact: true }).press('Enter')
  await page.mouse.wheel(0, 120)
  await expect(page.getByLabel('Page number', { exact: true })).toHaveValue('8')
  await page.mouse.wheel(0, -120)
  await expect(page.getByLabel('Page number', { exact: true })).toHaveValue('7')
  await page.getByLabel('Page number', { exact: true }).fill('1')
  await page.getByLabel('Page number', { exact: true }).press('Enter')
  await page.getByRole('button', { name: 'PDF scale', exact: true }).click()
  await page.locator('.popover').getByRole('button', { name: '200%', exact: true }).click()
  await page.waitForTimeout(220)
  await page.locator('.pdf-stage').hover()
  await page.mouse.wheel(0, 90)
  await expect
    .poll(() => page.locator('.pdf-stage').evaluate((el) => el.scrollTop))
    .toBeGreaterThan(30)
  await expect(page.getByLabel('Page number', { exact: true })).toHaveValue('1')
  // Reaching a magnified page's end must consume the gesture, including its overshoot and tail.
  await page.mouse.wheel(0, 10000)
  await expect(page.getByLabel('Page number', { exact: true })).toHaveValue('1')
  await expect
    .poll(() =>
      page.locator('.pdf-stage').evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop),
    )
    .toBeLessThan(3)
  await page.locator('.pdf-stage').evaluate(async (el) => {
    for (const deltaY of [160, 140, 120, 100, 80, 60, 40, 20]) {
      el.dispatchEvent(new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true }))
      await new Promise(requestAnimationFrame)
    }
  })
  await expect(page.getByLabel('Page number', { exact: true })).toHaveValue('1')
  await page.waitForTimeout(240)
  await page.mouse.wheel(0, 20)
  await expect(page.getByLabel('Page number', { exact: true })).toHaveValue('1')
  await page.mouse.wheel(0, 120)
  await expect(page.getByLabel('Page number', { exact: true })).toHaveValue('2')
  await expect.poll(() => page.locator('.pdf-stage').evaluate((el) => el.scrollTop)).toBe(0)
  // The same protection applies when scrolling up to a page's top.
  await page.locator('.pdf-stage').evaluate((el) => {
    el.scrollTop = 300
  })
  await page.waitForTimeout(240)
  await page.mouse.wheel(0, -10000)
  await expect(page.getByLabel('Page number', { exact: true })).toHaveValue('2')
  await expect.poll(() => page.locator('.pdf-stage').evaluate((el) => el.scrollTop)).toBe(0)
  await page.mouse.wheel(0, -120)
  await expect(page.getByLabel('Page number', { exact: true })).toHaveValue('2')
  await page.waitForTimeout(240)
  await page.mouse.wheel(0, -120)
  await expect(page.getByLabel('Page number', { exact: true })).toHaveValue('1')
  await expect
    .poll(() =>
      page.locator('.pdf-stage').evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop),
    )
    .toBeLessThan(3)
  // Landing exactly at the edge, without an overshoot, must also hold the next momentum event.
  await page.locator('.pdf-stage').evaluate((el) => {
    el.scrollTop = el.scrollHeight - el.clientHeight - 60
  })
  await page.waitForTimeout(240)
  await page.mouse.wheel(0, 60)
  await page.mouse.wheel(0, 120)
  await expect(page.getByLabel('Page number', { exact: true })).toHaveValue('1')
  await fitHeight()
  await page.getByRole('button', { name: 'PDF scale', exact: true }).click()
  await page.locator('.popover').getByRole('button', { name: 'Fit width', exact: true }).click()
  await page.getByRole('button', { name: 'PDF scale', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Fit height', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
  await page.getByRole('button', { name: 'Fit height', exact: true }).click()
  await page.getByRole('button', { name: 'PDF navigation', exact: true }).click()
  await expect(page.locator('.pdf-thumbnails')).toBeVisible()
  await page.getByRole('button', { name: 'Page 2', exact: true }).click()
  await expect(page.getByLabel('Page number', { exact: true })).toHaveValue('2')
  await page.getByRole('tab', { name: 'PDF outline', exact: true }).click()
  await expect(page.getByRole('button', { name: 'External link', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'First chapter', exact: true }).click()
  await expect(page.getByLabel('Page number', { exact: true })).toHaveValue('1')
  await page.getByRole('button', { name: 'Second chapter', exact: true }).click()
  await expect(page.getByLabel('Page number', { exact: true })).toHaveValue('2')
  await page.screenshot({ path: path.join(output, 'pdf-outline-light-en.png') })
  expect(await app.evaluate(() => globalThis.__previewExternalUrl)).toBeUndefined()
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
  const restoredScale = await page
    .getByRole('button', { name: 'PDF scale', exact: true })
    .innerText()
  await showNote()
  await page.locator('.tabs').getByRole('button', { name: 'Report.pdf', exact: true }).click()
  await expect(page.getByLabel('Page number', { exact: true })).toHaveValue('2')
  await expect(page.getByRole('button', { name: 'PDF scale', exact: true })).toHaveText(
    restoredScale,
  )
  await page.getByRole('button', { name: 'Open externally', exact: true }).click()
  await expect
    .poll(() => app.evaluate(() => globalThis.__previewExternalFile))
    .toContain(assets[0].file)
  await showNote()
  await page.getByRole('button', { name: 'Open file Picture.png', exact: true }).click()
  await expect
    .poll(() => app.evaluate(() => globalThis.__previewExternalFile))
    .toContain(assets[1].file)
  await expect(page.getByRole('button', { name: 'Preview in a tab', exact: true })).toHaveCount(0)
  await openFile('Notes.txt')
  await expect(page.locator('.file-preview-text')).toContainText(
    '<script>window.previewInjected = true</script>',
  )
  expect(await page.evaluate(() => window.previewInjected)).toBeUndefined()
  await page.getByRole('button', { name: 'Wrap lines', exact: true }).click()
  await expect(page.locator('.file-preview-text')).not.toHaveClass(/wrap/)
  const textBounds = await page.locator('.file-preview-text').evaluate((el) => {
    const stage = el.parentElement,
      box = el.getBoundingClientRect()
    el.scrollLeft = 1000
    return {
      internalScroll: el.scrollLeft,
      overflow: stage.scrollWidth - stage.clientWidth,
      right: box.right,
      stageRight: stage.getBoundingClientRect().right,
    }
  })
  expect(textBounds.internalScroll).toBeGreaterThan(0)
  expect(textBounds.overflow).toBeLessThanOrEqual(1)
  expect(textBounds.right).toBeLessThan(textBounds.stageRight)
  await page.locator('.file-preview-text').evaluate((el) => {
    el.scrollLeft = 0
  })
  await page.screenshot({ path: path.join(output, 'text-light-en.png') })
  const denied = await page.evaluate(
    async ({ workspaceId, escape, large }) => {
      const failures = []
      for (const [method, input] of [
        ['readPreviewPdf', { workspaceId, attachmentId: escape }],
        ['readPreviewText', { workspaceId, attachmentId: large }],
        [
          'readPreviewText',
          { workspaceId: '00000000-0000-4000-8000-000000000000', attachmentId: large },
        ],
      ]) {
        try {
          await window.sheco[method](input)
        } catch (e) {
          failures.push(String(e))
        }
      }
      return failures
    },
    { workspaceId: w.id, escape: assets[4].id, large: assets[5].id },
  )
  expect(denied).toHaveLength(3)
  await openFile('Invalid.pdf')
  await expect(page.locator('.file-preview [role="alert"]')).toBeVisible()
  await showNote()
  await page
    .locator('.document-editor')
    .evaluate((el) =>
      el.editor.commands.insertContentAt(
        el.editor.state.doc.content.size - 1,
        'Pending local save.',
      ),
    )
  await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('.attachment-open')]
    buttons.find((el) => el.title === 'Report.pdf').click()
    const pages = [...document.querySelectorAll('.page-tree button')]
    pages.find((el) => el.textContent === 'Local files').click()
  })
  await saved()
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
  await expect(page.locator('.document-editor')).toBeVisible()
  await expect(page.locator('.file-preview')).toHaveCount(0)
  const video = await page.evaluate(async () => {
    const c = document.createElement('canvas')
    c.width = 320
    c.height = 180
    const ctx = c.getContext('2d'),
      stream = c.captureStream(10),
      recorder = new MediaRecorder(stream, { mimeType: 'video/webm' }),
      chunks = []
    recorder.ondataavailable = (e) => chunks.push(e.data)
    const stopped = new Promise((resolve) => (recorder.onstop = resolve))
    recorder.start()
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = i % 2 ? '#527dab' : '#88ab8f'
      ctx.fillRect(0, 0, 320, 180)
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    recorder.stop()
    await stopped
    stream.getTracks().forEach((track) => track.stop())
    return [...new Uint8Array(await new Blob(chunks).arrayBuffer())]
  })
  const videoPath = path.join(root, 'Clip.webm')
  await fs.writeFile(videoPath, Buffer.from(video))
  await app.evaluate(
    ({ dialog }, file) =>
      (dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })),
    videoPath,
  )
  await page
    .locator('.document-editor')
    .evaluate((el) =>
      el.editor.commands.insertContentAt(el.editor.state.doc.content.size, { type: 'paragraph' }),
    )
  await page.locator('.document-editor>p').last().click()
  await page.keyboard.type('/attachment')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: 'Open file Clip.webm', exact: true })).toBeVisible()
  await openFile('Clip.webm')
  await expect.poll(() => page.locator('video').evaluate((el) => el.videoWidth)).toBe(320)
  await page.locator('video').evaluate((el) => el.play())
  await expect.poll(() => page.locator('video').evaluate((el) => el.currentTime)).toBeGreaterThan(0)
  await openFile('Report.pdf')
  await close()
  await launch(false)
  await expect(page.getByLabel('Page number', { exact: true })).toHaveValue('1')
  await fitCheck()
  await expect(
    page.locator('.tabs').getByRole('button', { name: 'Jira settings', exact: true }),
  ).toBeVisible()
  await settings()
  await page.getByRole('switch', { name: 'Enable file preview', exact: true }).click()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.locator('.tabs .tab')).toHaveCount(4)
  await showNote()
  const md = path.join(root, 'Imported.md')
  await fs.writeFile(md, '# Imported text\n\nLocal import from the sidebar.')
  await app.evaluate(
    ({ dialog }, file) =>
      (dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })),
    md,
  )
  await page
    .locator('.pages-label')
    .getByRole('button', { name: 'Pages menu', exact: true })
    .click()
  await page.getByRole('menuitem', { name: 'Import Markdown', exact: true }).click()
  await expect(page.getByLabel('Page title', { exact: true })).toHaveValue('Imported')
  await settings()
  await page.getByRole('tab', { name: 'General', exact: true }).click()
  await page.getByRole('button', { name: 'Dark', exact: true }).click()
  await page.getByRole('button', { name: 'Русский', exact: true }).click()
  await page.getByRole('tab', { name: 'Плагины', exact: true }).click()
  await page.screenshot({ path: path.join(output, 'plugins-dark-ru.png') })
  await page.getByRole('switch', { name: 'Включить предпросмотр файлов', exact: true }).click()
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click()
  await page.locator('.page-tree').getByRole('button', { name: 'Local files', exact: true }).click()
  await page.getByRole('button', { name: 'Открыть файл «Report.pdf»', exact: true }).click()
  await expect(page.getByLabel('Номер страницы', { exact: true })).toHaveValue('1')
  await fitCheck()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 760))
  await fitCheck()
  await page.getByRole('button', { name: 'Навигация PDF', exact: true }).click()
  await page.getByRole('tab', { name: 'Страницы', exact: true }).click()
  await fitCheck()
  await page.screenshot({ path: path.join(output, 'pdf-dark-ru.png') })
  const dockGap = await page
    .locator('.pdf-viewport')
    .evaluate(
      (el) =>
        el.querySelector('.preview-zoom-controls').getBoundingClientRect().top -
        el.querySelector('canvas').getBoundingClientRect().bottom,
    )
  expect(dockGap).toBeGreaterThan(10)
  await page.getByRole('button', { name: 'Масштаб PDF', exact: true }).click()
  await expect(page.locator('.popover')).toBeVisible()
  await page.screenshot({ path: path.join(output, 'pdf-scale-menu-dark-ru.png') })
  await page.keyboard.press('Escape')
  const overflow = await page
    .locator('.pdf-toolbar')
    .evaluate((el) => el.scrollWidth - el.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
  expect(errors).toEqual([])
  await close()
  console.log(
    'Passed: PDF fit/controls/outline/thumbnails/pinch/tab sessions, text/video, image retirement, separate plugin settings/drafts/restart, scope/containment/limits, import, both themes/languages. Fixture: ' +
      root,
  )
} finally {
  if (app) {
    await page?.screenshot({ path: path.join(output, 'last-state.png') }).catch(() => {})
    await app.close()
  }
}
