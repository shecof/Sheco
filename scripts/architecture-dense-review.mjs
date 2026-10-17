import { _electron as electron, expect } from '@playwright/test'
import fs from 'node:fs/promises'
import { build } from 'esbuild'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID as id } from 'node:crypto'
const output = path.resolve('test-results/architecture-audit-fixes')
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sheco-architecture-audit-dense-')),
  workspace = path.join(root, 'Knowledge')
await fs.mkdir(workspace)
await fs.mkdir(output, { recursive: true })
await build({
  stdin: {
    contents:
      "export * from './src/shared/projectArchitecture';export { seedWorkspace } from './src/shared/seed';export {workspaceSchema,createPage} from './src/shared/model';export {projectArchitectureTab} from './src/shared/plugins'",
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: path.join(root, 'model.mjs'),
})
const api = await import(pathToFileURL(path.join(root, 'model.mjs')).href)
const p = api.createArchitectureProject('Dense connected diagram')
p.presentation = { showTitle: false, showResources: true, showBalances: false }
p.sites = Array.from({ length: 100 }, (_, i) => ({ id: id(), name: 'Site ' + i }))
p.objects = p.sites.flatMap((site, i) =>
  Array.from({ length: 5 }, (_, j) => ({
    id: id(),
    siteId: site.id,
    name: `server-${i}-${j}`,
    type: 'server',
    os: 'Debian',
    resources: {},
    parameters: [],
  })),
)
p.links = Array.from({ length: 1000 }, (_, i) => ({
  id: id(),
  from: p.objects[i % 500].id,
  to: p.objects[((i % 500) + (Math.floor(i / 500) + 1) * 7) % 500].id,
  label: 'HTTPS ' + i,
}))
const w = api.seedWorkspace('Dense architecture audit', false)
w.plugins.projectArchitecture.enabled = true
const owner = api.createPage(w, p.name, null, 'architecture')
owner.architecture = p
w.pages.push(owner)
w.ui.tabs = [owner.id]
w.ui.activeId = owner.id
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
try {
  app = await electron.launch({ args: ['.'], env: { ...process.env, SHECO_DATA_DIR: root } })
  const page = await app.firstWindow()
  page.setDefaultTimeout(15000)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1500, 1100))
  const planner = page.locator('.architecture-page:visible'),
    canvas = planner.locator('.architecture-diagram'),
    svg = canvas.locator('.architecture-diagram-canvas > div > svg')
  await expect(planner.locator('[data-architecture-object]')).toHaveCount(500)
  await expect(planner.locator('[data-architecture-link]')).toHaveCount(1000)
  const missing = 1000 - (await planner.locator('[data-architecture-link-label]').count())
  await page.screenshot({ path: path.join(output, '08-dense-fit.png') })
  const box = await canvas.boundingBox()
  await canvas.evaluate(
    (node, center) => {
      for (let i = 0; i < 8; i++)
        node.dispatchEvent(
          new WheelEvent('wheel', {
            bubbles: true,
            cancelable: true,
            ctrlKey: true,
            deltaY: -500,
            clientX: center.x,
            clientY: center.y,
          }),
        )
    },
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
  )
  const first = api.architectureDiagramLayout(p, undefined, undefined, false).nodes[0]
  const view = await svg.evaluate((node) => ({
    x: node.viewBox.baseVal.x,
    y: node.viewBox.baseVal.y,
    width: node.viewBox.baseVal.width,
    height: node.viewBox.baseVal.height,
    zoom: node.getScreenCTM().a,
  }))
  await canvas.evaluate(
    (node, delta) =>
      node.dispatchEvent(
        new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          deltaX: delta.x,
          deltaY: delta.y,
        }),
      ),
    {
      x: (first.x + first.width / 2 - view.x - view.width / 2) * view.zoom,
      y: (first.y + first.height / 2 - view.y - view.height / 2) * view.zoom,
    },
  )
  await planner.locator(`[data-architecture-properties-object="${p.objects[0].id}"]`).click()
  await page.getByRole('menuitem', { name: 'Edit properties', exact: true }).hover()
  await page
    .getByRole('menu', { name: 'Edit properties', exact: true })
    .getByRole('menuitem', { name: 'General', exact: true })
    .click()
  const input = page
    .locator('.architecture-inspector:visible')
    .getByRole('textbox', { name: 'Object name', exact: true })
  await input.press('End')
  const timings = []
  let name = p.objects[0].name
  for (const char of ['A', 'B', 'C']) {
    const start = performance.now()
    await input.press(char)
    name += char
    await expect(
      planner.locator(`[data-architecture-object="${p.objects[0].id}"] text[font-weight="600"]`),
    ).toHaveText(name)
    timings.push(Math.round(performance.now() - start))
  }
  await expect(page.locator('.save-status')).toHaveClass(/\bsaved\b/)
  await page.screenshot({ path: path.join(output, '09-dense-edit.png') })
  await page
    .locator('.architecture-inspector:visible')
    .getByRole('button', { name: 'Close properties', exact: true })
    .click()
  const labelNode = planner.locator(`[data-architecture-link-label="${p.links[0].id}"] > rect`)
  const labelBox = await labelNode.evaluate((node) => ({
    x: node.x.baseVal.value,
    y: node.y.baseVal.value,
    width: node.width.baseVal.value,
    height: node.height.baseVal.value,
  }))
  const labelCamera = await svg.evaluate((node) => ({
    x: node.viewBox.baseVal.x,
    y: node.viewBox.baseVal.y,
    width: node.viewBox.baseVal.width,
    height: node.viewBox.baseVal.height,
    zoom: node.getScreenCTM().a,
  }))
  await canvas.evaluate(
    (node, delta) =>
      node.dispatchEvent(
        new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          deltaX: delta.x,
          deltaY: delta.y,
        }),
      ),
    {
      x:
        (labelBox.x + labelBox.width / 2 - labelCamera.x - labelCamera.width / 2) *
        labelCamera.zoom,
      y:
        (labelBox.y + labelBox.height / 2 - labelCamera.y - labelCamera.height / 2) *
        labelCamera.zoom,
    },
  )
  await labelNode.dblclick()
  const labelInput = page
    .locator('.architecture-link-label-editor:visible')
    .getByRole('textbox', { name: 'Connection label', exact: true })
  const labelTimings = []
  let label = p.links[0].label
  for (const char of ['A', 'B', 'C']) {
    const start = performance.now()
    await labelInput.press('End')
    await labelInput.press(char)
    label += char
    await expect(
      planner.locator(`[data-architecture-link-label="${p.links[0].id}"]`),
    ).toContainText(label)
    labelTimings.push(Math.round(performance.now() - start))
  }
  const observed = {
    root,
    nodes: 500,
    labelKeystrokeToDiagramMs: labelTimings,
    links: 1000,
    missingLabels: missing,
    keystrokeToDiagramMs: timings,
    meanMs: Math.round(timings.reduce((a, b) => a + b, 0) / timings.length),
  }
  const labels = await planner
    .locator('[data-architecture-link-label]')
    .evaluateAll((nodes) =>
      nodes.map((node) => [node.getAttribute('data-architecture-link-label'), node.textContent]),
    )
  for (const link of p.links)
    expect(labels.find(([id]) => id === link.id)?.[1]).toContain(link.label)
  expect(missing).toBe(0)
  expect(labelTimings.reduce((a, b) => a + b, 0) / labelTimings.length).toBeLessThan(500)
  expect(observed.meanMs).toBeLessThan(500)
  await fs.writeFile(path.join(output, 'dense-ui.json'), JSON.stringify(observed, null, 2))
  console.log(JSON.stringify(observed))
} finally {
  if (app) {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
    await app.close()
  }
}
