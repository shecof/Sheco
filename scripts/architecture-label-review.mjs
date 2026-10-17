import { _electron as electron, expect } from '@playwright/test'
import { build } from 'esbuild'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID as id } from 'node:crypto'

const output = path.resolve('test-results/architecture-labels')
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sheco-labels-'))
const workspace = path.join(root, 'Knowledge')
await fs.mkdir(workspace)
await fs.mkdir(output, { recursive: true })
await build({
  stdin: {
    contents:
      "export { seedWorkspace } from './src/shared/seed'; export { createPage, workspaceSchema } from './src/shared/model'; export { architectureDiagramLayout, architectureLabelAnchor } from './src/shared/projectArchitecture'",
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: path.join(root, 'model.mjs'),
})
const api = await import(pathToFileURL(path.join(root, 'model.mjs')).href)
const w = api.seedWorkspace('Connection label padding', false)
w.plugins.projectArchitecture.enabled = true
w.ui.fixedWidth = false
const parent = w.pages[0]
parent.title = 'Preview'
const child = api.createPage(w, 'Label measurements', parent.id, 'architecture')
const project = child.architecture
project.presentation = { showTitle: false, showResources: false, showBalances: false }
const labels = [
  '1',
  '1234567890124131231231231251623442',
  'W'.repeat(36),
  'i'.repeat(36),
  'Передача данных между серверами',
  'Ш'.repeat(36),
  '漢字'.repeat(18),
  '🔐 HTTPS',
]
project.objects = []
project.links = []
for (const vertical of [false, true]) {
  for (const [index, label] of labels.entries()) {
    const pair = [0, 1].map((end) => ({
      id: id(),
      name: `${vertical ? 'Vertical' : 'Horizontal'} ${index + 1}.${end + 1}`,
      type: 'server',
      os: '',
      resources: {},
      parameters: [],
      position: vertical
        ? { x: 1500 + index * 420, y: end * 1200 }
        : { x: end * 1000, y: index * 240 },
    }))
    project.objects.push(...pair)
    project.links.push({ id: id(), from: pair[0].id, to: pair[1].id, label })
  }
}
parent.content = {
  type: 'doc',
  content: [{ type: 'architectureEmbed', attrs: { pageId: child.id, label: child.title } }],
}
project.objects[3].position.y += 180
w.pages.push(child)
w.ui.tabs = [parent.id, child.id]
w.ui.activeId = child.id
w.ui.expanded = [parent.id]
api.workspaceSchema.parse(w)
await fs.writeFile(path.join(workspace, 'workspace.json'), JSON.stringify(w))
await fs.writeFile(
  path.join(root, 'spaces.json'),
  JSON.stringify({
    activeId: w.id,
    spaces: [{ id: w.id, name: w.name, icon: w.icon, path: workspace }],
  }),
)
let app
const results = []
async function checkLabels(container, context) {
  await expect(container.locator('[data-architecture-link-label]')).toHaveCount(labels.length * 2)
  const measured = await container.locator('[data-architecture-link-label]').evaluateAll((nodes) =>
    nodes.map((node) => {
      const rect = node.querySelector('rect').getBBox()
      const text = node.querySelector('text').getBBox()
      return {
        text: node.textContent,
        vertical: node.hasAttribute('transform'),
        left: text.x - rect.x,
        right: rect.x + rect.width - text.x - text.width,
      }
    }),
  )
  results.push({ context, measured })
  expect(measured).toHaveLength(labels.length * 2)
  expect(measured.filter((item) => item.vertical).length).toBeGreaterThan(0)
  for (const item of measured) {
    expect(item.left, `${context}: left padding of ${item.text}`).toBeCloseTo(8, 0)
    expect(item.right, `${context}: right padding of ${item.text}`).toBeCloseTo(8, 0)
  }
}
try {
  app = await electron.launch({ args: ['.'], env: { ...process.env, SHECO_DATA_DIR: root } })
  const page = await app.firstWindow()
  page.setDefaultTimeout(12000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await app.evaluate(({ BrowserWindow }, downloads) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.setSize(1500, 1050)
    win.webContents.session.on('will-download', (_event, item) =>
      item.setSavePath(downloads + '/' + item.getFilename()),
    )
  }, root)
  const canvas = page.locator('.architecture-diagram:visible')
  await expect(canvas.locator('[data-architecture-link-label]')).toHaveCount(labels.length * 2)
  await checkLabels(canvas, 'Editor, light/English')
  const routeBefore = await canvas
    .locator('.architecture-link-line')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('d')))
  // Keyboard editing exercises a growing draft without pointer/fit-scale dependence.
  const firstLabel = canvas.locator('[data-architecture-link-label]').first()
  await firstLabel.focus()
  await page.keyboard.press('Enter')
  const input = page
    .locator('.architecture-link-label-editor')
    .getByRole('textbox', { name: 'Connection label', exact: true })
  for (const text of ['1234567890', labels[1], 'W'.repeat(36)]) {
    await input.fill(text)
    await expect(firstLabel.locator('text')).toHaveText(text)
    await checkLabels(canvas, 'Growing live label: ' + text.length)
  }
  await input.fill(labels[0])
  await page.keyboard.press('Escape')
  expect(
    await canvas
      .locator('.architecture-link-line')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('d'))),
  ).toEqual(routeBefore)
  const workspaceFile = path.join(workspace, 'workspace.json')
  const currentLink = async () =>
    JSON.parse(await fs.readFile(workspaceFile, 'utf8')).pages.find((item) => item.id === child.id)
      .architecture.links[0]
  async function dragLabel(position, cancel, linkIndex = 0) {
    const targetLabel = canvas.locator(
      `[data-architecture-link-label="${project.links[linkIndex].id}"]`,
    )
    const start = await targetLabel.evaluate((node) => {
      const box = node.querySelector('rect').getBBox()
      const point = new DOMPoint(box.x + box.width / 2, box.y + 8).matrixTransform(
        node.getScreenCTM(),
      )
      return { x: point.x, y: point.y }
    })
    const edge = api.architectureDiagramLayout(project).edges[linkIndex]
    const anchor = api.architectureLabelAnchor(edge.points, position)
    const target = await canvas
      .locator('.architecture-diagram-canvas > div > svg')
      .evaluate((svg, point) => {
        const screen = new DOMPoint(point.x, point.y).matrixTransform(svg.getScreenCTM())
        return { x: screen.x, y: screen.y }
      }, anchor)
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(target.x, target.y, { steps: 5 })
    if (cancel === 'Escape') await page.keyboard.press('Escape')
    if (cancel === 'pointercancel') await canvas.dispatchEvent('pointercancel', { pointerId: 1 })
    await page.mouse.up()
  }
  await dragLabel(0.2)
  await expect.poll(async () => (await currentLink()).labelPosition).toBeCloseTo(0.2, 1)
  const dragged = (await currentLink()).labelPosition
  await page.getByRole('button', { name: 'Undo architecture change', exact: true }).click()
  await expect.poll(async () => (await currentLink()).labelPosition).toBeUndefined()
  await page.getByRole('button', { name: 'Redo architecture change', exact: true }).click()
  await expect.poll(async () => (await currentLink()).labelPosition).toBe(dragged)
  for (const cancel of ['Escape', 'pointercancel']) {
    await dragLabel(0.7, cancel)
    await expect(page.locator('.save-status')).toHaveClass(/\bsaved\b/)
    expect((await currentLink()).labelPosition).toBe(dragged)
  }
  const bent = api.architectureDiagramLayout(project).edges[1]
  const lengths = bent.points
    .slice(1)
    .map((point, index) =>
      Math.hypot(point.x - bent.points[index].x, point.y - bent.points[index].y),
    )
  const total = lengths.reduce((sum, length) => sum + length, 0)
  for (const vertical of [true, false]) {
    const index = lengths
      .map((length, index) => ({ length, index }))
      .filter(({ index }) => (bent.points[index].x === bent.points[index + 1].x) === vertical)
      .sort((a, b) => b.length - a.length)[0].index
    const position =
      (lengths.slice(0, index).reduce((sum, length) => sum + length, 0) + lengths[index] / 2) /
      total
    await dragLabel(position, undefined, 1)
    const label = canvas.locator(`[data-architecture-link-label="${bent.link.id}"]`)
    if (vertical) await expect(label).toHaveAttribute('transform', /^rotate\(90 /)
    else await expect(label).not.toHaveAttribute('transform')
  }
  // Rotation is a real pointer gesture on the selected label handle, with one history entry.
  await dragLabel(0.4)
  const rotationHandle = canvas.locator(`[data-architecture-label-rotate="${project.links[0].id}"]`)
  async function rotateLabel(angle, cancel) {
    const points = await rotationHandle.evaluate((node, angle) => {
      const start = new DOMPoint(0, 0).matrixTransform(
        node.querySelector('circle').parentElement.getScreenCTM(),
      )
      const circle = node.querySelector('.architecture-rotate-dot')
      const knob = new DOMPoint(0, 0).matrixTransform(circle.getScreenCTM())
      const label = document.querySelector(
        `[data-architecture-link-label="${node.dataset.architectureLabelRotate}"]`,
      )
      const box = label.querySelector('rect').getBBox()
      const center = new DOMPoint(box.x + box.width / 2, box.y + 8).matrixTransform(
        label.getScreenCTM(),
      )
      const radius = Math.hypot(knob.x - center.x, knob.y - center.y)
      const radians = ((angle - 90) * Math.PI) / 180
      return {
        start: { x: start.x, y: start.y },
        end: { x: center.x + radius * Math.cos(radians), y: center.y + radius * Math.sin(radians) },
      }
    }, angle)
    await page.mouse.move(points.start.x, points.start.y)
    await page.mouse.down()
    await page.mouse.move(points.end.x, points.end.y, { steps: 8 })
    if (cancel === 'Escape') await page.keyboard.press('Escape')
    if (cancel === 'pointercancel') await canvas.dispatchEvent('pointercancel', { pointerId: 1 })
    await page.mouse.up()
  }
  await rotateLabel(43)
  await expect.poll(async () => (await currentLink()).labelRotation).toBe(45)
  const rotated = (await currentLink()).labelRotation
  await page.getByRole('button', { name: 'Undo architecture change', exact: true }).click()
  await expect.poll(async () => (await currentLink()).labelRotation).toBeUndefined()
  await page.getByRole('button', { name: 'Redo architecture change', exact: true }).click()
  await expect.poll(async () => (await currentLink()).labelRotation).toBe(rotated)
  for (const cancel of ['Escape', 'pointercancel']) {
    await rotateLabel(-90, cancel)
    await expect(page.locator('.save-status')).toHaveClass(/\bsaved\b/)
    expect((await currentLink()).labelRotation).toBe(rotated)
  }
  await rotationHandle.focus()
  await page.keyboard.press('ArrowRight')
  await expect.poll(async () => (await currentLink()).labelRotation).toBe(rotated + 15)
  for (const [target, snapped] of [
    [89, 90],
    [178, -180],
    [-2, 0],
    [-178, -180],
    [-32.5, -30],
  ]) {
    await rotateLabel(target)
    await expect.poll(async () => (await currentLink()).labelRotation).toBe(snapped)
    if (snapped)
      await expect(firstLabel).toHaveAttribute('transform', new RegExp(`^rotate\\(${snapped} `))
    else await expect(firstLabel).not.toHaveAttribute('transform')
  }
  const placement = {
    labelPosition: (await currentLink()).labelPosition,
    labelRotation: (await currentLink()).labelRotation,
  }
  await firstLabel.dblclick()
  const menu = page.locator('.architecture-link-label-editor:visible')
  await expect(menu.getByRole('textbox')).toHaveCount(1)
  await expect(menu.getByText('Label position', { exact: true })).toHaveCount(0)
  await expect(menu.getByText('Label rotation', { exact: true })).toHaveCount(0)
  await expect(
    menu.getByRole('button', { name: 'Reset label placement', exact: true }),
  ).toHaveCount(0)
  await input.fill('HTTPS')
  await expect.poll(currentLink).toMatchObject({ label: 'HTTPS', ...placement })
  if (await page.locator('.toast > button').count()) await page.locator('.toast > button').click()
  await page.screenshot({ path: path.join(output, 'label-placement-light-en.png') })
  await page.keyboard.press('Escape')
  const canvasBox = await canvas.boundingBox()
  await canvas.evaluate((node, box) => {
    node.dispatchEvent(
      new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        deltaY: -5000,
        clientX: box.x + box.width / 2,
        clientY: box.y + box.height / 2,
      }),
    )
  }, canvasBox)
  await checkLabels(canvas, 'Zoomed editor')
  await expect(page.locator('.save-status')).toHaveClass(/\bsaved\b/)
  await page.getByRole('button', { name: 'Export diagram', exact: true }).click()
  await page.getByRole('option', { name: 'SVG', exact: true }).click()
  const svgFile = path.join(root, project.name + '.svg')
  await expect
    .poll(() =>
      fs
        .stat(svgFile)
        .then((stat) => stat.size)
        .catch(() => 0),
    )
    .toBeGreaterThan(0)
  const exported = await fs.readFile(svgFile, 'utf8')
  await page.evaluate((source) => {
    const mount = document.createElement('div')
    mount.id = 'label-export-review'
    mount.style.cssText = 'position:fixed;left:-10000px;top:0'
    mount.innerHTML = source
    document.body.append(mount)
  }, exported)
  await checkLabels(page.locator('#label-export-review'), 'Exported SVG')
  const fullScope = await page.locator('#label-export-review > svg').evaluate((svg) => {
    const view = svg.viewBox.baseVal
    return [...svg.querySelectorAll('[data-architecture-link-label]')].every((node) => {
      const box = node.querySelector('rect').getBBox()
      const matrix = svg.getCTM().inverse().multiply(node.getCTM())
      return [
        [box.x, box.y],
        [box.x + box.width, box.y],
        [box.x, box.y + box.height],
        [box.x + box.width, box.y + box.height],
      ]
        .map(([x, y]) => new DOMPoint(x, y).matrixTransform(matrix))
        .every(
          (point) =>
            point.x >= view.x &&
            point.y >= view.y &&
            point.x <= view.x + view.width &&
            point.y <= view.y + view.height,
        )
    })
  })
  expect(fullScope).toBe(true)
  await page.evaluate((labelId) => {
    const mount = document.querySelector('#label-export-review')
    const svg = mount.querySelector('svg')
    const box = svg.querySelector(`[data-architecture-link-label="${labelId}"] > rect`).getBBox()
    svg.setAttribute('viewBox', `${box.x - 32} ${box.y - 24} ${box.width + 64} 64`)
    svg.setAttribute('width', String((box.width + 64) * 2))
    svg.setAttribute('height', '128')
    mount.style.cssText = 'position:fixed;left:20px;top:100px;z-index:100000;background:white'
  }, project.links[1].id)
  await page
    .locator('#label-export-review')
    .screenshot({ path: path.join(output, 'long-label-padding.png') })
  await page.evaluate(() => document.querySelector('#label-export-review').remove())
  await page.locator('.page-tree').getByRole('button', { name: parent.title, exact: true }).click()
  await checkLabels(page.locator('.architecture-snapshot:visible'), 'Embedded preview')
  await page
    .locator('.sidebar-footer')
    .getByRole('button', { name: 'Settings', exact: true })
    .click()
  let settings = page.getByRole('dialog', { name: 'Settings', exact: true })
  await settings.getByRole('button', { name: 'Dark', exact: true }).click()
  await settings.getByRole('button', { name: 'Русский', exact: true }).click()
  settings = page.getByRole('dialog', { name: 'Настройки', exact: true })
  await settings.getByRole('button', { name: 'Закрыть', exact: true }).click()
  await page.locator('.page-tree').getByRole('button', { name: child.title, exact: true }).click()
  await checkLabels(canvas, 'Editor, dark/Russian')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(820, 920))
  await checkLabels(canvas, 'Narrow editor, dark/Russian')
  await firstLabel.focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('.architecture-link-label-editor').getByRole('textbox')).toHaveCount(1)
  await page.screenshot({ path: path.join(output, 'label-placement-dark-ru.png') })
  await page.keyboard.press('Escape')
  await expect(page.locator('body > svg[aria-hidden="true"][text-rendering]')).toHaveCount(0)
  await expect(page.locator('.save-status')).toHaveClass(/\bsaved\b/)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await app.close()
  app = await electron.launch({ args: ['.'], env: { ...process.env, SHECO_DATA_DIR: root } })
  const restarted = await app.firstWindow()
  restarted.on('pageerror', (error) => errors.push(error.message))
  await checkLabels(restarted.locator('.architecture-diagram:visible'), 'Restarted editor')
  expect(await currentLink()).toMatchObject(placement)
  api.workspaceSchema.parse(JSON.parse(await fs.readFile(workspaceFile, 'utf8')))
  expect(errors).toEqual([])
  await fs.writeFile(
    path.join(output, 'verification.json'),
    JSON.stringify({ status: 'passed', results }, null, 2),
  )
  console.log('Architecture label padding review passed:', output)
} catch (error) {
  if (app) {
    const window = await app.firstWindow()
    await window.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {})
    console.log(await window.locator('[data-architecture-link-label]').first().boundingBox())
  }
  throw error
} finally {
  if (app) {
    await app
      .evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close())
      .catch(() => {})
    await app.close().catch(() => {})
  }
  if (results.length)
    await fs.writeFile(path.join(output, 'measurements.json'), JSON.stringify(results, null, 2))
}
