import { _electron as electron, expect } from '@playwright/test'
import { build } from 'esbuild'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID as id } from 'node:crypto'

const output = path.resolve('test-results/architecture-save')
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sheco-architecture-save-'))
const workspace = path.join(root, 'Knowledge')
await fs.mkdir(workspace)
await fs.mkdir(output, { recursive: true })
await build({
  stdin: {
    contents:
      "export { seedWorkspace } from './src/shared/seed'; export { createPage, workspaceSchema } from './src/shared/model'; export { architectureDiagramLayout, architectureLabelAnchor } from './src/shared/projectArchitecture'; export { placeArchitectureSelection } from './src/shared/architecturePlacement'",
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: path.join(root, 'model.mjs'),
})
const api = await import(pathToFileURL(path.join(root, 'model.mjs')).href)
const w = api.seedWorkspace('Fast architecture moves', false)
w.plugins.projectArchitecture.enabled = true
w.ui.fixedWidth = false
const child = api.createPage(w, 'Rapid moves', w.pages[0].id, 'architecture')
const project = child.architecture
project.presentation = { showTitle: false, showResources: false, showBalances: false }
project.objects = [0, 1, 2].map((index) => ({
  id: id(),
  name: `server-${index}`,
  type: 'server',
  os: 'Debian',
  resources: { cpu: 4, ram: 8 },
  disks: [{ id: id(), name: 'System', resourceId: 'nvme', capacity: 20 }],
  parameters: [{ name: 'Environment', value: 'Production' }],
  position: { x: index * 600, y: 0 },
}))
project.links = [
  { id: id(), from: project.objects[0].id, to: project.objects[2].id, label: 'HTTPS' },
]
w.pages.push(child)
w.ui.activeId = child.id
w.ui.tabs = [child.id]
const file = path.join(workspace, 'workspace.json')
await fs.writeFile(file, JSON.stringify(api.workspaceSchema.parse(w)))
await fs.writeFile(
  path.join(root, 'spaces.json'),
  JSON.stringify({
    activeId: w.id,
    spaces: [{ id: w.id, name: w.name, icon: w.icon, path: workspace }],
  }),
)
let app, page
const errors = []
const checks = []
const canvas = () => page.locator('.architecture-diagram:visible')
async function live() {
  return page.locator('.save-status').evaluate((node, pageId) => {
    const key = Object.keys(node).find((key) => key.startsWith('__reactFiber$'))
    let root = node[key]
    while (root.return) root = root.return
    const pending = [root.stateNode.current]
    while (pending.length) {
      const fiber = pending.pop()
      if (fiber.sibling) pending.push(fiber.sibling)
      if (fiber.child) pending.push(fiber.child)
      const value = fiber.memoizedProps?.value
      if (value?.w?.pages && typeof value.flush === 'function')
        return value.w.pages.find((item) => item.id === pageId).architecture
    }
    throw new Error('Fixture provider missing')
  }, child.id)
}
async function flush() {
  await page.locator('.save-status').evaluate((node) => {
    const key = Object.keys(node).find((key) => key.startsWith('__reactFiber$'))
    let root = node[key]
    while (root.return) root = root.return
    const pending = [root.stateNode.current]
    while (pending.length) {
      const fiber = pending.pop()
      if (fiber.sibling) pending.push(fiber.sibling)
      if (fiber.child) pending.push(fiber.child)
      const value = fiber.memoizedProps?.value
      if (value?.w?.pages && typeof value.flush === 'function') {
        window.fixtureFlush = value.flush()
        return
      }
    }
    throw new Error('Fixture provider missing')
  })
}
async function launch() {
  app = await electron.launch({ args: ['.'], env: { ...process.env, SHECO_DATA_DIR: root } })
  page = await app.firstWindow()
  page.setDefaultTimeout(10000)
  page.on('pageerror', (error) => errors.push(error.message))
  await page.evaluate(() => {
    window.fixturePointerTrace = []
    for (const type of ['blur', 'focus'])
      window.addEventListener(type, () => window.fixturePointerTrace.push({ type }))
    for (const type of [
      'pointerdown',
      'pointermove',
      'pointerup',
      'pointercancel',
      'lostpointercapture',
    ])
      document.addEventListener(type, (event) => {
        const target = event.target instanceof Element ? event.target : null
        window.fixturePointerTrace.push({
          type,
          x: event.clientX,
          y: event.clientY,
          object: target
            ?.closest('[data-architecture-object]')
            ?.getAttribute('data-architecture-object'),
          label: target
            ?.closest('[data-architecture-link-label]')
            ?.getAttribute('data-architecture-link-label'),
        })
        if (window.fixturePointerTrace.length > 100) window.fixturePointerTrace.shift()
      })
  })
  await expect(canvas()).toBeVisible()
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.setSize(1500, 1050)
    win.webContents.setBackgroundThrottling(false)
    win.hide()
  })
}
async function dragObject(index, dx, dy, during, lateRelease = false) {
  const before = await live()
  const object = before.objects[index]
  const delta = { x: dx, y: dy }
  const layout = api.architectureDiagramLayout(before, undefined, undefined, false)
  const box = layout.nodes.find((node) => node.object.id === object.id)
  const expected = api.placeArchitectureSelection(before, layout, 'object', [object.id], delta, 0, {
    x: box.x + 28 + dx,
    y: box.y + 16 + dy,
  }).project
  const points = await canvas()
    .locator(`[data-architecture-object="${object.id}"] > rect`)
    .evaluate((node, delta) => {
      const box = node.getBBox()
      const matrix = node.getScreenCTM()
      const a = new DOMPoint(box.x + 28, box.y + 16).matrixTransform(matrix)
      const b = new DOMPoint(box.x + 28 + delta.x, box.y + 16 + delta.y).matrixTransform(matrix)
      return { a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } }
    }, delta)
  await page.mouse.move(points.a.x, points.a.y)
  await page.mouse.down()
  await page.mouse.move(
    lateRelease === 'only' ? points.a.x : lateRelease ? (points.a.x + points.b.x) / 2 : points.b.x,
    lateRelease === 'only' ? points.a.y : lateRelease ? (points.a.y + points.b.y) / 2 : points.b.y,
    { steps: 2 },
  )
  if (during) await during()
  if (lateRelease) {
    const session = await page.context().newCDPSession(page)
    await session.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: points.b.x,
      y: points.b.y,
      button: 'left',
      buttons: 0,
      clickCount: 1,
    })
    await session.detach()
  } else await page.mouse.up()
  await expect.poll(live).toEqual(expected)
  const settled = api
    .architectureDiagramLayout(expected, undefined, undefined, false)
    .nodes.find((node) => node.object.id === object.id)
  await expect
    .poll(() =>
      canvas()
        .locator(`[data-architecture-object="${object.id}"] > rect`)
        .evaluate((node) => {
          const box = node.getBBox()
          const matrix = node.ownerSVGElement.getCTM().inverse().multiply(node.getCTM())
          const point = new DOMPoint(box.x, box.y).matrixTransform(matrix)
          return { x: Math.round(point.x), y: Math.round(point.y) }
        }),
    )
    .toEqual({ x: settled.x, y: settled.y })
  checks.push({ action: 'object', index, position: expected.objects[index].position })
}
async function dragLabel(position, during, lateRelease = false) {
  const before = await live()
  const edge = api.architectureDiagramLayout(before).edges[0]
  const anchor = api.architectureLabelAnchor(edge.points, position)
  const label = canvas().locator(`[data-architecture-link-label="${edge.link.id}"]`)
  const a = await label.evaluate((node) => {
    const box = node.querySelector('rect').getBBox()
    const point = new DOMPoint(box.x + box.width / 2, box.y + 8).matrixTransform(
      node.getScreenCTM(),
    )
    return { x: point.x, y: point.y }
  })
  const b = await canvas()
    .locator('.architecture-diagram-canvas > div > svg')
    .evaluate((svg, point) => {
      const screen = new DOMPoint(point.x, point.y).matrixTransform(svg.getScreenCTM())
      return { x: screen.x, y: screen.y }
    }, anchor)
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move(
    lateRelease === 'only' ? a.x : lateRelease ? (a.x + b.x) / 2 : b.x,
    lateRelease === 'only' ? a.y : lateRelease ? (a.y + b.y) / 2 : b.y,
    { steps: 2 },
  )
  if (during) await during()
  if (lateRelease) {
    const session = await page.context().newCDPSession(page)
    await session.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: b.x,
      y: b.y,
      button: 'left',
      buttons: 0,
      clickCount: 1,
    })
    await session.detach()
  } else await page.mouse.up()
  await expect.poll(async () => (await live()).links[0].labelPosition).toBeCloseTo(position, 2)
  checks.push({ action: 'label', position })
}
try {
  await launch()
  await app.evaluate(({ ipcMain }) => {
    const handler = ipcMain._invokeHandlers.get('save')
    globalThis.fixtureSave = { count: 0, held: false, release: null, hold: true }
    ipcMain.removeHandler('save')
    ipcMain.handle('save', async (...args) => {
      const control = globalThis.fixtureSave
      control.count++
      const result = await handler(...args)
      if (control.hold) {
        control.held = true
        await new Promise((resolve) => (control.release = resolve))
        control.held = false
      }
      return result
    })
  })
  await dragObject(0, 0, 64, undefined, true)
  await dragObject(1, 0, 64, undefined, 'only')
  await flush()
  await expect.poll(() => app.evaluate(() => globalThis.fixtureSave.held)).toBe(true)
  for (let index = 0; index < 12; index++) {
    await dragObject(index % 2, 0, 32)
    await dragLabel(index % 2 ? 0.65 : 0.35, undefined, index % 2 ? 'only' : true)
  }
  expect(await app.evaluate(() => globalThis.fixtureSave.count)).toBe(1)
  const beforeAck = await live()
  await dragObject(1, 0, 32, async () => {
    await app.evaluate(() => {
      globalThis.fixtureSave.hold = false
      globalThis.fixtureSave.release()
    })
    await page.locator('.save-status').evaluate(() => window.fixtureFlush)
  })
  const beforeLastLabel = await live()
  await dragLabel(0.55, undefined, true)
  const afterLastLabel = await live()
  await page.getByRole('button', { name: 'Undo architecture change', exact: true }).click()
  await expect.poll(live).toEqual(beforeLastLabel)
  await page.getByRole('button', { name: 'Redo architecture change', exact: true }).click()
  await expect.poll(live).toEqual(afterLastLabel)
  await flush()
  await page.locator('.save-status').evaluate(() => window.fixtureFlush)
  await expect(page.locator('.save-status')).toHaveClass(/\bsaved\b/)
  expect(await app.evaluate(() => globalThis.fixtureSave.count)).toBeGreaterThanOrEqual(2)
  const final = await live()
  const disk = JSON.parse(await fs.readFile(file, 'utf8'))
  expect(disk.pages.find((item) => item.id === child.id).architecture).toEqual(final)
  expect(final.objects[0].position).toEqual(beforeAck.objects[0].position)
  expect(errors).toEqual([])
  expect(
    (await page.locator('.toast').allTextContents()).some((text) =>
      text.includes('The project changed. Reopen the form before saving.'),
    ),
  ).toBe(false)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await app.close()
  app = null
  await launch()
  expect(await live()).toEqual(final)
  api.workspaceSchema.parse(JSON.parse(await fs.readFile(file, 'utf8')))
  await fs.writeFile(
    path.join(output, 'verification.json'),
    JSON.stringify({ status: 'passed', root, checks, errors }, null, 2),
  )
  console.log('Rapid architecture save review passed:', output)
} catch (error) {
  if (page) {
    await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {})
    await fs.writeFile(
      path.join(output, 'failure.json'),
      JSON.stringify(
        {
          root,
          checks,
          current: await live().catch(() => null),
          trace: await page.evaluate(() => window.fixturePointerTrace),
        },
        null,
        2,
      ),
    )
  }
  throw error
} finally {
  if (app) {
    await app
      .evaluate(() => {
        if (globalThis.fixtureSave) {
          globalThis.fixtureSave.hold = false
          globalThis.fixtureSave.release?.()
        }
      })
      .catch(() => {})
    await app
      .evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close())
      .catch(() => {})
    await app.close().catch(() => {})
  }
}
