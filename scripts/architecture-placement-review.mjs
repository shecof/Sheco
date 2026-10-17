import { _electron as electron, expect } from '@playwright/test'
import { build } from 'esbuild'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sheco-architecture-placement-')),
  workspace = path.join(root, 'Knowledge'),
  output = path.resolve('test-results/architecture-placement')
await fs.mkdir(workspace)
await fs.mkdir(output, { recursive: true })
const bundled = await build({
  stdin: {
    contents:
      "export { seedWorkspace } from './src/shared/seed'; export { workspaceSchema } from './src/shared/model'; export { projectArchitectureTab } from './src/shared/plugins'; export { createArchitectureProject, architectureDiagramLayout, architectureBalances } from './src/shared/projectArchitecture'",
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
})
const modulePath = path.join(root, 'fixture.mjs')
await fs.writeFile(modulePath, bundled.outputFiles[0].contents)
const {
  seedWorkspace,
  workspaceSchema,
  projectArchitectureTab,
  createArchitectureProject,
  architectureDiagramLayout,
  architectureBalances,
} = await import(pathToFileURL(modulePath).href)
const w = seedWorkspace('Spatial architecture review', false),
  blank = createArchitectureProject('Without sites'),
  initial = createArchitectureProject('Grid placement')
initial.presentation = { showBalances: false, showTitle: true, showResources: true }
initial.sites = [
  { id: randomUUID(), name: 'Moscow', position: { x: 32, y: 96 }, background: 'blue' },
  { id: randomUUID(), name: 'Novosibirsk', position: { x: 544, y: 96 }, background: 'purple' },
]
const node = (name, siteId, position, type = 'server') => ({
  id: randomUUID(),
  name,
  ...(siteId && { siteId }),
  position,
  type,
  os: 'Debian',
  resources: { cpu: 4, ram: 8 },
  disks: [{ id: randomUUID(), name: 'System', resourceId: 'nvme', capacity: 20 }],
  parameters: [{ name: 'Environment', value: 'Production' }],
})
initial.objects = [
  node('api-01', initial.sites[0].id, { x: 32, y: 64 }),
  node('api-02', initial.sites[0].id, { x: 32, y: 240 }),
  node('orders-db', initial.sites[1].id, { x: 32, y: 64 }, 'database'),
  node('store.example', undefined, { x: 64, y: 640 }, 'website'),
]
initial.links = [
  { id: randomUUID(), from: initial.objects[0].id, to: initial.objects[2].id, label: 'PostgreSQL' },
]
w.plugins.projectArchitecture = { enabled: true, projects: [blank, initial] }
w.ui.tabs = [projectArchitectureTab]
w.ui.activeId = projectArchitectureTab
const snapshotPath = path.join(workspace, 'workspace.json'),
  pages = structuredClone(w.pages)
workspaceSchema.parse(w)
await fs.writeFile(snapshotPath, JSON.stringify(w))
await fs.writeFile(
  path.join(root, 'spaces.json'),
  JSON.stringify({
    activeId: w.id,
    spaces: [{ id: w.id, name: w.name, icon: w.icon, path: workspace }],
  }),
)
let app, page
const errors = []
const planner = () => page.locator('.architecture-page:visible'),
  canvas = () => planner().locator('.architecture-diagram'),
  svg = () => canvas().locator('.architecture-diagram-canvas > div > svg'),
  panel = () => page.locator('.architecture-inspector:visible'),
  menu = () => page.getByRole('menu', { name: 'Architecture actions', exact: true }),
  snapshot = async () => JSON.parse(await fs.readFile(snapshotPath, 'utf8')),
  project = async (index = 1) => (await snapshot()).plugins.projectArchitecture.projects[index],
  saved = async () => expect(page.locator('.save-status')).toHaveClass(/\bsaved\b/)
async function launch() {
  app = await electron.launch({
    args: [process.env.SHECO_TEST_MAIN ?? '.'],
    env: { ...process.env, SHECO_DATA_DIR: root },
  })
  page = await app.firstWindow()
  page.setDefaultTimeout(10000)
  page.on('pageerror', (error) => errors.push(error.message))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1500, 1100))
  await expect(planner()).toBeVisible()
  await saved()
}
async function close() {
  await saved()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await app.close()
  app = null
}
async function pick(label, value, scope = planner()) {
  await scope.getByRole('button', { name: label, exact: true }).click()
  await page.getByRole('option', { name: value, exact: true }).click()
}
async function closePanel() {
  if (await panel().count())
    await panel().getByRole('button', { name: 'Close properties', exact: true }).click()
}
async function fit() {
  await closePanel()
  await planner().getByRole('button', { name: 'Fit diagram', exact: true }).click()
  await canvas().scrollIntoViewIfNeeded()
}
async function client(point) {
  return svg().evaluate((node, point) => {
    const transformed = new DOMPoint(point.x, point.y).matrixTransform(node.getScreenCTM())
    return { x: transformed.x, y: transformed.y }
  }, point)
}
const geometry = (value) => architectureDiagramLayout(value, undefined, undefined, false)
async function undo() {
  await closePanel()
  await planner().getByRole('button', { name: 'Undo architecture change', exact: true }).click()
  await saved()
}
async function beginDrag(kind, id, delta) {
  await closePanel()
  const selector =
    kind === 'object'
      ? `[data-architecture-object="${id}"] > rect`
      : `[data-architecture-edit-${kind}="${id}"] > rect`
  const bounds = await planner().locator(selector).boundingBox()
  const a = { x: bounds.x + 28, y: bounds.y + 16 },
    scale = await svg().evaluate((node) => node.getScreenCTM().a)
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move(a.x + delta.x * scale, a.y + delta.y * scale, { steps: 14 })
}
async function finishDrag(cancel = false) {
  if (cancel) await page.keyboard.press('Escape')
  await page.mouse.up()
  await saved()
}
async function objectContext(id) {
  await closePanel()
  await planner()
    .locator(`[data-architecture-object="${id}"] > rect`)
    .click({ button: 'right', position: { x: 35, y: 25 } })
  await expect(menu()).toBeVisible()
}
try {
  await launch()
  // No site exists: the canvas still offers the type submenu and saves a root object.
  const bounds = await canvas().boundingBox()
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, {
    button: 'right',
  })
  await menu().getByRole('menuitem', { name: 'Create object', exact: true }).hover()
  await page
    .getByRole('menu', { name: 'Create object', exact: true })
    .getByRole('menuitem', { name: 'Create server', exact: true })
    .click()
  await expect(panel()).toBeVisible()
  await expect(panel().getByRole('button', { name: 'Site', exact: true })).toContainText('No site')
  await panel()
    .getByRole('textbox', { name: 'Object name', exact: true })
    .fill('Independent server')
  await saved()
  expect((await project(0)).sites).toHaveLength(0)
  expect((await project(0)).objects).toHaveLength(1)
  expect((await project(0)).objects[0].siteId).toBeUndefined()
  const rootBefore = await project(0)
  await pick('Site', 'No site', panel())
  await saved()
  expect(await project(0)).toEqual(rootBefore)
  await page.screenshot({ path: path.join(output, 'without-site-light-en.png') })
  await closePanel()
  await pick('Architecture site', 'No site')
  await expect(planner().locator('[data-architecture-object]')).toHaveCount(1)
  await pick('Architecture project', initial.name)
  await fit()
  const [api, api2, database, website] = initial.objects,
    [a, b] = initial.sites
  // A mouse click has no native orange outline. Keyboard navigation remains visible.
  await planner()
    .locator(`[data-architecture-object="${api.id}"] > rect`)
    .click({ position: { x: 30, y: 30 } })
  expect(await canvas().evaluate((node) => getComputedStyle(node).outlineStyle)).toBe('none')
  expect(
    await planner()
      .locator(`[data-architecture-object="${api.id}"]`)
      .evaluate((node) => getComputedStyle(node).outlineStyle),
  ).toBe('none')
  await canvas().focus()
  await page.keyboard.press('Tab')
  expect(
    await page.evaluate(() => ({
      style: getComputedStyle(document.activeElement).outlineStyle,
      width: getComputedStyle(document.activeElement).outlineWidth,
    })),
  ).toEqual({ style: 'solid', width: '1px' })
  await objectContext(api.id)
  await expect(
    menu().getByRole('menuitem', { name: 'Edit properties', exact: true }).locator('svg'),
  ).toHaveCount(1)
  expect(
    await menu()
      .getByRole('menuitem', { name: 'Duplicate object', exact: true })
      .evaluate((node) => getComputedStyle(node).outlineStyle),
  ).toBe('none')
  await menu().getByRole('menuitem', { name: 'Edit properties', exact: true }).click()
  await expect(panel().locator('summary').filter({ hasText: 'Outgoing connections' })).toHaveCount(
    0,
  )
  await panel().getByRole('textbox', { name: 'Object name', exact: true }).fill('api-primary')
  await saved()
  expect((await project()).links).toEqual(initial.links)
  await objectContext(api.id)
  const beforeCopy = await project()
  await menu().getByRole('menuitem', { name: 'Duplicate object', exact: true }).click()
  await saved()
  const copied = (await project()).objects.at(-1)
  expect(copied.name).toBe('Copy of api-primary')
  expect(copied.id).not.toBe(api.id)
  expect(copied.disks[0].id).not.toBe(api.disks[0].id)
  expect(copied.parameters).toEqual(api.parameters)
  expect((await project()).links).toEqual(initial.links)
  expect(architectureBalances(await project()).find((item) => item.id === 'cpu').used).toBe(20)
  await undo()
  expect(await project()).toEqual(beforeCopy)
  await planner()
    .locator(`[data-architecture-object="${api.id}"] > rect`)
    .click({ position: { x: 30, y: 30 } })
  await page.keyboard.press('ControlOrMeta+d')
  await saved()
  expect((await project()).objects).toHaveLength(5)
  await undo()
  // Header dragging gives a live preview, one save, grid coordinates and stable child offsets.
  await fit()
  const baseline = await project(),
    before = geometry(baseline)
  await beginDrag('site', a.id, { x: -47, y: 49 })
  expect(await project()).toEqual(baseline)
  await expect(planner().locator(`[data-architecture-site="${a.id}"]`)).toHaveAttribute(
    'transform',
    /translate\(-48 48\)/,
  )
  await finishDrag(true)
  expect(await project()).toEqual(baseline)
  await beginDrag('site', a.id, { x: -47, y: 49 })
  await finishDrag()
  let placed = await project(),
    after = geometry(placed)
  expect(placed.sites[0].position).toEqual({ x: -16, y: 144 })
  expect(after.nodes[0].x - before.nodes[0].x).toBe(-48)
  expect(after.nodes[0].y - before.nodes[0].y).toBe(48)
  expect(placed.links).toEqual(baseline.links)
  await undo()
  await fit()
  await beginDrag('site', a.id, { x: b.position.x - a.position.x, y: b.position.y - a.position.y })
  await finishDrag()
  expect((await project()).sites[0].position).toEqual(b.position)
  expect((await project()).sites[1].position).toEqual(a.position)
  await undo()
  await fit()
  // Move on the same canvas to align with another site's left edge.
  await beginDrag('site', a.id, { x: 516, y: 272 })
  await expect(planner().locator('.architecture-alignment-guide')).not.toHaveCount(0)
  await page.screenshot({ path: path.join(output, 'grid-alignment-light-en.png') })
  await finishDrag()
  expect((await project()).sites[0].position).toEqual({ x: 544, y: 368 })
  await undo()
  await fit()
  // Same-site object swap, then detach to the root and attach to a different site.
  const nodes = geometry(await project()).nodes
  await beginDrag('object', api.id, { x: nodes[1].x - nodes[0].x, y: nodes[1].y - nodes[0].y })
  await finishDrag()
  expect((await project()).objects[0].position).toEqual(api2.position)
  expect((await project()).objects[1].position).toEqual(api.position)
  await undo()
  await fit()
  await beginDrag('object', api.id, { x: 368, y: 400 })
  await finishDrag()
  expect((await project()).objects[0].siteId).toBeUndefined()
  expect((await project()).links).toEqual(initial.links)
  await fit()
  let free = geometry(await project()).nodes.find((item) => item.object.id === api.id)
  const destination = geometry(await project()).sites[1]
  await beginDrag('object', api.id, {
    x: destination.x + 32 - free.x,
    y: destination.y + 192 - free.y,
  })
  await finishDrag()
  expect((await project()).objects[0].siteId).toBe(b.id)
  expect((await project()).objects[0].position).toEqual({ x: 32, y: 224 })
  await undo()
  await undo()
  await fit()
  // The free website can also enter a site, preserving all metadata.
  const freeSite = geometry(await project()).nodes.find((item) => item.object.id === website.id)
  await beginDrag('object', website.id, { x: 64 - freeSite.x, y: 448 - freeSite.y })
  await finishDrag()
  expect((await project()).objects[3].siteId).toBe(a.id)
  expect((await project()).objects[3].parameters).toEqual(website.parameters)
  await undo()
  await fit()
  await beginDrag('site', b.id, { x: 64, y: 32 })
  await finishDrag()
  expect((await project()).sites[1].position).toEqual({ x: 608, y: 128 })
  await page.screenshot({ path: path.join(output, 'grid-layout-light-en.png') })
  const retained = await project()
  expect((await snapshot()).pages).toEqual(pages)
  workspaceSchema.parse(await snapshot())
  await close()
  await launch()
  await pick('Architecture project', initial.name)
  expect(await project()).toEqual(retained)
  expect(geometry(await project())).toEqual(geometry(retained))
  expect((await project(0)).objects[0].name).toBe('Independent server')
  await page
    .locator('.sidebar-footer')
    .getByRole('button', { name: 'Settings', exact: true })
    .click()
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
  await settings.getByRole('tab', { name: 'General', exact: true }).click()
  await settings.getByRole('button', { name: 'Dark', exact: true }).click()
  await settings.getByRole('button', { name: 'Русский', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Закрыть', exact: true }).click()
  await saved()
  await planner()
    .locator(`[data-architecture-object="${api.id}"] > rect`)
    .click({ button: 'right', position: { x: 30, y: 30 } })
  await expect(
    page.getByRole('menuitem', { name: 'Дублировать объект', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('menuitem', { name: 'Изменить свойства', exact: true }).locator('svg'),
  ).toHaveCount(1)
  expect(await canvas().evaluate((node) => getComputedStyle(node).outlineStyle)).toBe('none')
  await page.screenshot({ path: path.join(output, 'object-menu-dark-ru.png') })
  await page.keyboard.press('Escape')
  await planner().locator(`[data-architecture-properties-object="${api.id}"]`).click()
  await expect(panel().locator('summary').filter({ hasText: 'Исходящие связи' })).toHaveCount(0)
  await page.screenshot({ path: path.join(output, 'object-properties-dark-ru.png') })
  expect(errors).toEqual([])
  await fs.writeFile(
    path.join(output, 'verification.json'),
    JSON.stringify(
      {
        fixture: root,
        passed: true,
        mouseFocusAndKeyboardFocus: true,
        noSiteCreationAndScope: true,
        duplicateContextAndKeyboard: true,
        independentDisksAndBudgets: true,
        objectFormHasNoConnections: true,
        propertiesActionIcon: true,
        siteLiveDragGridAndEscape: true,
        childOffsetsAndLinksPreserved: true,
        siteAndObjectSwap: true,
        alignmentGuide: true,
        rootDetachAndAttach: true,
        guardedUndoAndRestart: true,
        pagesPreserved: true,
        errors,
      },
      null,
      2,
    ),
  )
  console.log(JSON.stringify({ passed: true, output, fixture: root }))
} catch (error) {
  if (page) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {})
  throw error
} finally {
  if (app) await close().catch(async () => app.close())
}
