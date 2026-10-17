import { _electron as electron, expect } from '@playwright/test'
import { build } from 'esbuild'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID as id } from 'node:crypto'
import sharp from 'sharp'

const output = path.resolve('test-results/architecture-pages')
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sheco-architecture-pages-'))
const workspace = path.join(root, 'Knowledge')
await fs.mkdir(workspace)
await fs.mkdir(output, { recursive: true })
await build({
  stdin: {
    contents:
      "export * from './src/shared/projectArchitecture'; export {seedWorkspace} from './src/shared/seed'; export {createPage, workspaceSchema} from './src/shared/model';export {translate} from './src/shared/i18n'",
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: path.join(root, 'model.mjs'),
})
const api = await import(pathToFileURL(path.join(root, 'model.mjs')).href)
const w = api.seedWorkspace('Architecture pages review', false)
w.plugins.projectArchitecture.enabled = true
w.ui.fixedWidth = false
const parent = w.pages[0]
parent.title = 'Architecture guide'
const child = api.createPage(w, 'Store infrastructure', parent.id, 'architecture')
const p = child.architecture
p.presentation = { showTitle: false, showResources: true, showBalances: false }
p.resources.forEach((r) => (r.capacity = 10000))
p.sites = [
  { id: id(), name: 'Moscow', background: 'blue' },
  { id: id(), name: 'Novosibirsk' },
  { id: id(), name: 'Archive', background: 'purple' },
]
p.groups = [{ id: id(), name: 'API servers', siteId: p.sites[0].id, background: 'green' }]
const node = (name, type, site, group) => ({
  id: id(),
  name,
  type,
  siteId: site,
  ...(group && { groupId: group }),
  os: 'Debian',
  resources: { cpu: 4, ram: 8 },
  disks: [{ id: id(), name: 'System', resourceId: 'nvme', capacity: 20 }],
  parameters: [{ name: 'Address', value: '192.0.2.10' }],
})
p.objects = [
  node('store.example', 'website', p.sites[0].id),
  node('api-01', 'server', p.sites[0].id, p.groups[0].id),
  node('api-02', 'server', p.sites[0].id, p.groups[0].id),
  node('orders-db', 'database', p.sites[1].id),
  node('archive-01', 'server', p.sites[2].id),
]
p.links = [
  { id: id(), from: p.objects[1].id, to: p.objects[3].id, label: 'PostgreSQL' },
  { id: id(), from: p.objects[3].id, to: p.objects[4].id, label: 'Backup' },
]
w.pages.push(child)
parent.content = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'Infrastructure plan. Open the preview to edit its architecture subpage.',
        },
      ],
    },
    { type: 'architectureEmbed', attrs: { pageId: child.id, label: child.title } },
    { type: 'paragraph' },
  ],
}
w.ui.tabs = [parent.id, child.id]
w.ui.activeId = parent.id
w.ui.expanded = [parent.id]
api.workspaceSchema.parse(w)
const file = path.join(workspace, 'workspace.json')
await fs.writeFile(file, JSON.stringify(w))
await fs.writeFile(
  path.join(root, 'spaces.json'),
  JSON.stringify({
    activeId: w.id,
    spaces: [{ id: w.id, name: w.name, icon: w.icon, path: workspace }],
  }),
)
let app,
  page,
  language = 'en'
const errors = []
const tr = (key) => api.translate(key, language)
const read = async () => JSON.parse(await fs.readFile(file, 'utf8'))
const saved = async () => {
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
  await expect(page.locator('.save-status')).toHaveClass(/\bsaved\b/)
}
const planner = () => page.locator('.architecture-page:visible')
const inspector = () => page.locator('.architecture-inspector:visible')
const menu = () => page.getByRole('menu', { name: tr('Architecture actions'), exact: true })
const canvas = () => planner().locator('.architecture-diagram')
const currentProject = async (pageId) =>
  (await read()).pages.find((p) => p.id === pageId).architecture
async function launch() {
  app = await electron.launch({
    args: [process.env.SHECO_TEST_MAIN ?? '.'],
    env: { ...process.env, SHECO_DATA_DIR: root },
  })
  page = await app.firstWindow()
  page.setDefaultTimeout(12000)
  page.on('pageerror', (e) => errors.push(e.message))
  await expect(page.locator('.save-status')).toBeVisible({ timeout: 20000 })
  await app.evaluate(({ BrowserWindow, clipboard }, output) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.setSize(1500, 1050)
    globalThis.__architectureDownloads = []
    clipboard.writeText = (text) => {
      globalThis.__architectureCopied = text
    }
    win.webContents.session.on('will-download', (_e, item) => {
      item.setSavePath(output + '/export.' + item.getFilename().split('.').at(-1))
      item.once('done', (_e, state) =>
        globalThis.__architectureDownloads.push({ name: item.getFilename(), state }),
      )
    })
  }, output)
}
async function close() {
  await saved()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await app.close()
  app = null
}
async function pick(scope, label, value) {
  await scope.getByRole('button', { name: tr(label), exact: true }).click()
  await page.getByRole('option', { name: tr(value), exact: true }).click()
}
async function closeProperties() {
  const popup = page.locator('.architecture-properties-popover:visible')
  if (await popup.count())
    if (await popup.locator('.architecture-link-label-editor').count())
      await planner().locator('.architecture-eyebrow').click()
    else await popup.getByRole('button', { name: tr('Close properties'), exact: true }).click()
  await expect(popup).toHaveCount(0)
}
async function properties(objectId, section = 'General') {
  await closeProperties()
  await planner().locator(`[data-architecture-properties-object="${objectId}"]`).click()
  await expect(
    menu().getByRole('menuitem', { name: tr('Group selected objects'), exact: true }),
  ).toHaveCount(0)
  await expect(menu().getByRole('menuitem', { name: tr('New site'), exact: true })).toHaveCount(0)
  await menu()
    .getByRole('menuitem', { name: tr('Edit properties'), exact: true })
    .hover()
  await page
    .getByRole('menu', { name: tr('Edit properties'), exact: true })
    .getByRole('menuitem', { name: tr(section), exact: true })
    .click()
  await expect(inspector()).toBeVisible()
  const box = await page.locator('.architecture-properties-popover:visible').boundingBox()
  expect(box.width).toBeLessThanOrEqual(322)
  expect(box.height).toBeLessThanOrEqual(462)
}
async function field(label, value) {
  await inspector()
    .getByRole('textbox', { name: tr(label), exact: true })
    .fill(value)
  await saved()
}
async function navigate(title) {
  await page.locator('.page-tree').getByRole('button', { name: title, exact: true }).click()
}
async function settings(category = 'General') {
  await page
    .locator('.sidebar-footer')
    .getByRole('button', { name: tr('Settings'), exact: true })
    .click()
  await page.getByRole('tab', { name: tr(category), exact: true }).click()
  return page.getByRole('dialog', { name: tr('Settings'), exact: true })
}
async function pluginToggle() {
  const dialog = await settings('Plugins')
  await dialog.getByRole('button', { name: tr('Tools'), exact: true }).click()
  await dialog.getByRole('switch', { name: tr('Enable project architecture'), exact: true }).click()
  await dialog.getByRole('button', { name: tr('Close'), exact: true }).click()
  await saved()
}
async function diagramPoint(x, y) {
  return canvas()
    .locator('.architecture-diagram-canvas > div > svg')
    .evaluate(
      (svg, point) => {
        const p = new DOMPoint(point.x, point.y).matrixTransform(svg.getScreenCTM())
        return { x: p.x, y: p.y }
      },
      { x, y },
    )
}
try {
  await launch()
  let preview = page.locator('.architecture-embed')
  await expect(preview).toHaveCount(1)
  await expect(preview.locator('.architecture-snapshot > svg')).toBeVisible()
  await expect(
    page.locator('.page-tree').getByRole('button', { name: child.title, exact: true }),
  ).toBeVisible()
  await page.screenshot({ path: path.join(output, '01-page-preview-light.png') })
  // Enabled slash command creates a separate child without leaving the parent.
  await page.locator('.tiptap > p').last().click()
  await page.keyboard.type('/architecture')
  await page.getByRole('option', { name: /Create architecture diagram/ }).click()
  await expect(preview).toHaveCount(2)
  await expect(planner()).toHaveCount(0)
  await saved()
  const created = (await read()).pages.filter((p) => p.kind === 'architecture').at(-1)
  expect(created.parentId).toBe(parent.id)
  expect(created.architecture.objects).toHaveLength(0)
  await expect(
    page
      .locator('.page-tree')
      .getByRole('button', { name: tr('Untitled architecture'), exact: true }),
  ).toBeVisible()
  // One editor, no old project library or extra creation toolbar.
  await preview
    .last()
    .getByRole('button', { name: tr('Open architecture'), exact: true })
    .click()
  await expect(planner()).toBeVisible()
  await expect(planner().getByRole('button', { name: tr('New project'), exact: true })).toHaveCount(
    0,
  )
  await expect(planner().locator('.architecture-project-picker')).toHaveCount(0)
  await expect(planner().locator('.architecture-eyebrow')).toHaveText(tr('Untitled architecture'))
  await expect(planner().locator('h1')).toHaveText(tr('All sites'))
  await expect(planner().locator('.architecture-main-toolbar')).toHaveCount(0)
  const assertFloatingTools = async () =>
    expect(async () => {
      const surface = await canvas().boundingBox()
      const tools = await planner()
        .getByRole('toolbar', { name: tr('Diagram tools') })
        .boundingBox()
      const view = await planner()
        .getByRole('group', { name: tr('Canvas view'), exact: true })
        .boundingBox()
      expect(tools.y - surface.y).toBeGreaterThanOrEqual(16)
      expect(Math.abs(tools.x + tools.width / 2 - surface.x - surface.width / 2)).toBeLessThan(2)
      expect(view.x - surface.x).toBeGreaterThanOrEqual(14)
      expect(surface.y + surface.height - view.y - view.height).toBeGreaterThanOrEqual(14)
      expect(tools.x).toBeGreaterThanOrEqual(surface.x)
      expect(view.y).toBeGreaterThan(tools.y + tools.height)
    }).toPass({ timeout: 5000 })
  await assertFloatingTools()
  // Configure page name/resources through the existing guarded resource form.
  await planner()
    .getByRole('button', { name: tr('Project resources'), exact: true })
    .click()
  const modal = page.locator('.architecture-modal:visible')
  await modal.getByRole('textbox', { name: tr('Project name'), exact: true }).fill('New topology')
  await modal.getByRole('button', { name: tr('Save project'), exact: true }).click()
  await saved()
  // Create a root object via hover submenu and edit its small general section.
  const blank = await canvas().boundingBox()
  await page.mouse.click(blank.x + blank.width / 2, blank.y + 180, { button: 'right' })
  await menu()
    .getByRole('menuitem', { name: tr('Create object'), exact: true })
    .hover()
  await page
    .getByRole('menu', { name: tr('Create object'), exact: true })
    .getByRole('menuitem', { name: tr('Create server'), exact: true })
    .click()
  await field('Object name', 'standalone-01')
  await expect(inspector().getByRole('spinbutton')).toHaveCount(0)
  const os = inspector().getByRole('combobox', { name: tr('Operating system'), exact: true })
  await expect(inspector().getByRole('button', { name: tr('Choose OS'), exact: true })).toHaveCount(
    0,
  )
  await os.click()
  await page.getByRole('option', { name: 'Debian', exact: true }).click()
  await expect(os).toHaveValue('Debian')
  await os.fill('Custom OS 2026')
  await os.press('Enter')
  await saved()
  expect((await currentProject(created.id)).objects[0].os).toBe('Custom OS 2026')
  await os.click()
  await os.fill('Rocky')
  await expect(
    page.getByRole('listbox', { name: tr('Operating system'), exact: true }).getByRole('option'),
  ).toHaveCount(1)
  await os.press('ArrowDown')
  await os.press('Enter')
  await expect(os).toHaveValue('Rocky Linux')
  await os.click()
  await os.fill('Debian')
  await os.press('ArrowDown')
  await os.press('Enter')
  await saved()
  let createdProject = await currentProject(created.id)
  const objectId = createdProject.objects[0].id
  expect(createdProject.objects[0].siteId).toBeUndefined()
  await page.screenshot({ path: path.join(output, '02-general-properties.png') })
  // Three-dot menu gives section choices. Invalid resource text blocks switching.
  await properties(objectId, 'Resources')
  await inspector().getByRole('spinbutton', { name: 'CPU · cores', exact: true }).fill('12')
  await inspector().getByRole('spinbutton', { name: 'RAM · GB', exact: true }).fill('24')
  await pick(inspector(), 'Add disk', 'NVMe')
  await inspector()
    .getByRole('spinbutton', { name: tr('Disk size 1'), exact: true })
    .fill('80')
  await inspector()
    .getByRole('textbox', { name: tr('Disk name 1'), exact: true })
    .fill('System')
  await saved()
  const resourcesAfterTyping = (await currentProject(created.id)).objects[0]
  expect(resourcesAfterTyping.resources).toEqual({ cpu: 12, ram: 24 })
  expect(resourcesAfterTyping.disks[0]).toMatchObject({ capacity: 80, name: 'System' })
  await expect(inspector().getByRole('alert')).toHaveCount(0)
  await page.screenshot({ path: path.join(output, '03-resources-properties.png') })
  await inspector()
    .getByRole('textbox', { name: tr('Object name'), exact: true })
    .fill('')
  await pick(inspector(), 'Property section', 'Custom parameters')
  await expect(inspector().getByRole('spinbutton')).toHaveCount(3)
  await navigate(parent.title)
  await expect(planner()).toBeVisible()
  await expect(
    inspector().getByRole('textbox', { name: tr('Object name'), exact: true }),
  ).toHaveValue('')
  await field('Object name', 'standalone-01')
  await expect(inspector().getByRole('alert')).toHaveCount(0)
  await pick(inspector(), 'Property section', 'Custom parameters')
  await inspector()
    .getByRole('button', { name: tr('Add parameter'), exact: true })
    .click()
  await field('Parameter name 1', 'Address')
  await field('Parameter value 1', '192.0.2.20')
  await expect(inspector().getByRole('spinbutton')).toHaveCount(0)
  await expect(inspector().getByText(tr('Outgoing connections'), { exact: true })).toHaveCount(0)
  await closeProperties()
  createdProject = await currentProject(created.id)
  expect(createdProject.objects[0].resources).toEqual({ cpu: 12, ram: 24 })
  expect(createdProject.objects[0].disks[0].capacity).toBe(80)
  expect(createdProject.objects[0].os).toBe('Debian')
  // Parent live preview and independent second diagram.
  await navigate(parent.title)
  await expect(preview.last()).toContainText('New topology')
  await expect(preview.last().locator('.architecture-snapshot > svg')).toContainText(
    'standalone-01',
  )
  await expect(preview.first().locator('.architecture-snapshot > svg')).not.toContainText(
    'standalone-01',
  )
  await navigate(child.title)
  await expect(planner().locator('[data-architecture-object]')).toHaveCount(5)
  await expect(planner().locator('.architecture-eyebrow')).toHaveText(child.title)
  await pick(planner(), 'Architecture site', p.sites[0].name)
  await expect(planner().locator('h1')).toHaveText(p.sites[0].name)
  await expect(planner().locator('[data-architecture-object]')).toHaveCount(3)
  await pick(planner(), 'Architecture site', 'All sites')
  await planner().locator(`[data-architecture-properties-group="${p.groups[0].id}"]`).click()
  await expect(inspector().getByRole('checkbox')).toHaveCount(0)
  await expect(inspector().getByText(tr('Servers'), { exact: true })).toHaveCount(0)
  await closeProperties()
  for (const objectIndex of [4, 3, 0]) {
    const beforeDrop = await currentProject(child.id)
    const member = planner().locator(
      `[data-architecture-object="${p.objects[objectIndex].id}"] > rect`,
    )
    const group = planner().locator(`[data-architecture-group="${p.groups[0].id}"] > rect`)
    const sourceBox = await member.boundingBox(),
      targetBox = await group.boundingBox()
    await page.mouse.move(sourceBox.x + 60, sourceBox.y + 60)
    await page.mouse.down()
    await page.mouse.move(targetBox.x + 40, targetBox.y + 25, { steps: 20 })
    await expect(planner().locator(`[data-architecture-group="${p.groups[0].id}"]`)).toHaveClass(
      /drop-active/,
    )
    await page.mouse.up()
    await saved()
    const { position, siteId, groupId, ...metadata } = beforeDrop.objects[objectIndex]
    expect(
      (await currentProject(child.id)).objects.find(
        (object) => object.id === p.objects[objectIndex].id,
      ),
    ).toMatchObject({ ...metadata, groupId: p.groups[0].id, siteId: p.sites[0].id })
    expect((await currentProject(child.id)).links).toEqual(beforeDrop.links)
    await planner()
      .getByRole('button', { name: tr('Undo architecture change'), exact: true })
      .click()
    await saved()
    expect(await currentProject(child.id)).toEqual(beforeDrop)
  }
  // A mixed selection groups through the same context command as servers.
  const beforeMixed = await currentProject(child.id)
  for (const [i, objectIndex] of [0, 1].entries())
    await planner()
      .locator(`[data-architecture-object="${p.objects[objectIndex].id}"] > rect`)
      .click({ modifiers: i ? ['Shift'] : [] })
  await planner()
    .locator(`[data-architecture-object="${p.objects[0].id}"] > rect`)
    .click({ button: 'right' })
  await menu()
    .getByRole('menuitem', { name: tr('Group selected objects'), exact: true })
    .click()
  await closeProperties()
  await saved()
  const mixed = await currentProject(child.id),
    mixedGroup = mixed.groups.at(-1)
  expect(
    mixed.objects
      .filter((object) => object.groupId === mixedGroup.id)
      .map((object) => object.type)
      .sort(),
  ).toEqual(['server', 'website'])
  expect(mixed.links).toEqual(beforeMixed.links)
  await planner()
    .getByRole('button', { name: tr('Undo architecture change'), exact: true })
    .click()
  await saved()
  expect(await currentProject(child.id)).toEqual(beforeMixed)
  // Creating inside a group assigns every object type directly to that group.
  for (const [type, command] of [
    ['database', 'Create database'],
    ['website', 'Create website'],
  ]) {
    const beforeCreate = await currentProject(child.id)
    await planner()
      .locator(`[data-architecture-group="${p.groups[0].id}"] > rect`)
      .click({ button: 'right', position: { x: 10, y: 22 } })
    await menu()
      .getByRole('menuitem', { name: tr('Create object'), exact: true })
      .hover()
    await page
      .getByRole('menu', { name: tr('Create object'), exact: true })
      .getByRole('menuitem', { name: tr(command), exact: true })
      .click()
    await saved()
    expect((await currentProject(child.id)).objects.at(-1)).toMatchObject({
      type,
      siteId: p.sites[0].id,
      groupId: p.groups[0].id,
    })
    await closeProperties()
    await planner()
      .getByRole('button', { name: tr('Undo architecture change'), exact: true })
      .click()
    await saved()
    expect(await currentProject(child.id)).toEqual(beforeCreate)
  }
  // Only explicitly selected cards get a blue border; connected cards stay neutral.
  await planner().locator(`[data-architecture-object="${p.objects[1].id}"] > rect`).click()
  await expect(planner().locator('[data-architecture-object].selected')).toHaveCount(1)
  await expect(planner().locator('[data-architecture-object].connection-related')).toHaveCount(0)
  await expect(planner().getByRole('toolbar', { name: tr('Diagram tools') })).not.toContainText(
    /selected|Выделено/,
  )
  const selectedStroke = await planner()
    .locator(`[data-architecture-object="${p.objects[1].id}"] > rect`)
    .evaluate((node) => getComputedStyle(node).stroke)
  expect(
    await planner()
      .locator(`[data-architecture-object="${p.objects[3].id}"] > rect`)
      .evaluate((node) => getComputedStyle(node).stroke),
  ).not.toBe(selectedStroke)
  await canvas().focus()
  await page.keyboard.press('Escape')
  for (let i = 1; i <= 2; i++)
    await planner()
      .locator(`[data-architecture-object="${p.objects[i].id}"] > rect`)
      .click({ modifiers: i === 2 ? ['Shift'] : [] })
  await planner()
    .locator(`[data-architecture-object="${p.objects[1].id}"] > rect`)
    .click({ button: 'right' })
  await expect(
    menu().getByRole('menuitem', { name: tr('Group selected objects'), exact: true }),
  ).toHaveCount(0)
  await expect(menu().getByRole('menuitem', { name: tr('New site'), exact: true })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await canvas().focus()
  await page.keyboard.press('Escape')
  await assertFloatingTools()
  await page.screenshot({ path: path.join(output, '07-editor-tools-light.png') })
  // Context section menu, resources autosave, undo/redo remain page-local.
  await properties(p.objects[0].id, 'Resources')
  await inspector().getByRole('spinbutton', { name: 'CPU · cores', exact: true }).fill('9')
  await saved()
  await closeProperties()
  await planner()
    .getByRole('button', { name: tr('Undo architecture change'), exact: true })
    .click()
  await saved()
  expect((await currentProject(child.id)).objects[0].resources.cpu).toBe(4)
  await planner()
    .getByRole('button', { name: tr('Redo architecture change'), exact: true })
    .click()
  await saved()
  expect((await currentProject(child.id)).objects[0].resources.cpu).toBe(9)
  // Toolbar pointer, wheel and keyboard actions never start a selection or pan gesture.
  const beforeControls = await currentProject(child.id)
  const zoomButton = planner().getByRole('button', { name: tr('Zoom in'), exact: true })
  const beforeZoom = await canvas()
    .locator('.architecture-diagram-canvas > div > svg')
    .evaluate((svg) => svg.getScreenCTM().a)
  await zoomButton.focus()
  await page.keyboard.press('Space')
  await expect
    .poll(() =>
      canvas()
        .locator('.architecture-diagram-canvas > div > svg')
        .evaluate((svg) => svg.getScreenCTM().a),
    )
    .toBeGreaterThan(beforeZoom)
  const beforeWheel = await canvas()
    .locator('.architecture-diagram-canvas > div > svg')
    .getAttribute('viewBox')
  await zoomButton.dispatchEvent('wheel', { deltaY: 100, cancelable: true, bubbles: true })
  expect(
    await canvas().locator('.architecture-diagram-canvas > div > svg').getAttribute('viewBox'),
  ).toBe(beforeWheel)
  expect(await currentProject(child.id)).toEqual(beforeControls)
  // Camera is session-only; zoom and drag change no project data.
  const beforeCamera = await currentProject(child.id)
  await planner()
    .getByRole('button', { name: tr('Zoom in'), exact: true })
    .click()
  await planner()
    .getByRole('button', { name: tr('Pan canvas'), exact: true })
    .click()
  const cb = await canvas().boundingBox()
  await page.mouse.move(cb.x + cb.width / 2, cb.y + 120)
  await page.mouse.down()
  await page.mouse.move(cb.x + cb.width / 2 + 70, cb.y + 160, { steps: 8 })
  await page.mouse.up()
  expect(await currentProject(child.id)).toEqual(beforeCamera)
  await planner()
    .getByRole('button', { name: tr('Fit diagram'), exact: true })
    .click()
  await planner()
    .getByRole('button', { name: tr('Select elements'), exact: true })
    .click()
  // Single clicks select arrows without covering their draggable endpoints with an editor.
  const labelEditor = () => page.locator('.architecture-link-label-editor:visible')
  const label = planner().locator(`[data-architecture-link-label="${p.links[0].id}"]`)
  await label.click()
  await expect(labelEditor()).toHaveCount(0)
  await expect(planner().locator('.architecture-endpoint-handle')).toHaveCount(2)
  await page.screenshot({ path: path.join(output, 'selected-arrow-without-editor.png') })
  for (const [endpoint, targetId] of [
    ['from', p.objects[2].id],
    ['to', p.objects[4].id],
  ]) {
    const beforeReconnect = await currentProject(child.id)
    const handle = await planner()
      .locator(
        `[data-architecture-link="${p.links[0].id}"][data-architecture-endpoint="${endpoint}"] .architecture-endpoint-dot`,
      )
      .boundingBox()
    const target = await planner()
      .locator(`[data-architecture-object="${targetId}"] > rect`)
      .boundingBox()
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
    await page.mouse.down()
    await page.mouse.move(target.x + 35, target.y + 35, { steps: 12 })
    await expect(planner().locator('[data-architecture-object].connection-target')).toHaveAttribute(
      'data-architecture-object',
      targetId,
    )
    await expect(labelEditor()).toHaveCount(0)
    await page.mouse.up()
    await saved()
    expect((await currentProject(child.id)).links).toEqual(
      beforeReconnect.links.map((link) =>
        link.id === p.links[0].id ? { ...link, [endpoint]: targetId } : link,
      ),
    )
    await planner()
      .getByRole('button', { name: tr('Undo architecture change'), exact: true })
      .click()
    await saved()
    expect(await currentProject(child.id)).toEqual(beforeReconnect)
  }
  // Double-clicking a label opens the compact editor; an unlabeled arrow uses its path.
  await label.dblclick()
  await expect(
    labelEditor().getByRole('textbox', { name: tr('Connection label'), exact: true }),
  ).toBeFocused()
  await labelEditor()
    .getByRole('textbox', { name: tr('Connection label'), exact: true })
    .fill('')
  await saved()
  await closeProperties()
  await expect(label).toHaveCount(0)
  const arrow = planner().locator(
    `[data-architecture-link="${p.links[0].id}"]:not([data-architecture-endpoint])`,
  )
  const arrowPoint = await arrow.locator('.architecture-link-hit').evaluate((path) => {
    const id = path.parentElement.getAttribute('data-architecture-link')
    for (let step = 1; step < 20; step++) {
      const local = path.getPointAtLength((path.getTotalLength() * step) / 20)
      const client = new DOMPoint(local.x, local.y).matrixTransform(path.getScreenCTM())
      const hit = document.elementFromPoint(client.x, client.y)
      if (
        hit?.closest('[data-architecture-link]')?.getAttribute('data-architecture-link') === id &&
        !hit.closest('[data-architecture-endpoint]')
      )
        return { x: client.x, y: client.y }
    }
    throw new Error('No visible arrow segment for double-click')
  })
  await page.mouse.click(arrowPoint.x, arrowPoint.y)
  await expect(labelEditor()).toHaveCount(0)
  await expect(planner().locator('.architecture-endpoint-handle')).toHaveCount(2)
  await page.mouse.dblclick(arrowPoint.x, arrowPoint.y)
  await expect(
    labelEditor().getByRole('textbox', { name: tr('Connection label'), exact: true }),
  ).toBeFocused()
  await labelEditor()
    .getByRole('textbox', { name: tr('Connection label'), exact: true })
    .fill('PostgreSQL TLS')
  await saved()
  await closeProperties()
  expect((await currentProject(child.id)).links[0].label).toBe('PostgreSQL TLS')
  // Keyboard activation remains available without requiring a mouse double-click.
  await arrow.focus()
  await page.keyboard.press('Enter')
  await expect(
    labelEditor().getByRole('textbox', { name: tr('Connection label'), exact: true }),
  ).toBeFocused()
  await closeProperties()
  // SVG and raster output still contain the full page, independent of viewport.
  for (const format of ['SVG', 'PNG', 'JPG']) {
    const before = await app.evaluate(() => globalThis.__architectureDownloads.length)
    await pick(planner(), 'Export diagram', format)
    await expect
      .poll(() => app.evaluate(() => globalThis.__architectureDownloads.length))
      .toBe(before + 1)
    const data = await fs.readFile(path.join(output, 'export.' + format.toLowerCase()))
    if (format === 'SVG') expect(data.toString()).toContain('api-01')
    else expect((await sharp(data).metadata()).width).toBeGreaterThan(800)
  }
  await pick(planner(), 'Export diagram', 'Mermaid')
  await page
    .locator('.architecture-modal')
    .getByRole('button', { name: tr('Copy Mermaid'), exact: true })
    .click()
  expect(await app.evaluate(() => globalThis.__architectureCopied)).toContain('api-01')
  await page.keyboard.press('Escape')
  // Printing the dedicated editor creates a full snapshot only for print, not each keystroke.
  await expect(page.locator('.architecture-page-print')).toHaveCount(0)
  await page.emulateMedia({ media: 'print' })
  await expect(page.locator('.architecture-page-print .architecture-snapshot > svg')).toContainText(
    'api-01',
  )
  await expect(planner()).toHaveCount(0)
  await page.emulateMedia({ media: 'screen' })
  await expect(page.locator('.architecture-page-print')).toHaveCount(0)
  const pdf64 = await app.evaluate(async ({ BrowserWindow }) =>
    (
      await BrowserWindow.getAllWindows()[0].webContents.printToPDF({
        printBackground: true,
        pageSize: 'A4',
        preferCSSPageSize: true,
      })
    ).toString('base64'),
  )
  const pdfBytes = Buffer.from(pdf64, 'base64')
  await fs.writeFile(path.join(output, 'architecture-page.pdf'), pdfBytes)
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const pdfTask = getDocument({ data: new Uint8Array(pdfBytes), useSystemFonts: true })
  const pdf = await pdfTask.promise
  let pdfText = ''
  for (let number = 1; number <= pdf.numPages; number++)
    pdfText += (await (await pdf.getPage(number)).getTextContent()).items
      .map((item) => item.str ?? '')
      .join(' ')
  for (const object of p.objects) expect(pdfText).toContain(object.name)
  await pdfTask.destroy()
  await expect(page.locator('.architecture-page-print')).toHaveCount(0)
  // Sidebar duplication retains an independent diagram and correct page title.
  await page.locator('.page-tree').getByRole('button', { name: child.title, exact: true }).hover()
  await page
    .locator('.page-tree')
    .getByRole('button', { name: 'Options for ' + child.title, exact: true })
    .click()
  await page.getByRole('menuitem', { name: tr('Duplicate'), exact: true }).click()
  await saved()
  const duplicate = (await read()).pages.find((p) => p.title === child.title + ' (copy)')
  expect(duplicate.architecture.name).toBe(duplicate.title)
  expect(duplicate.architecture.objects).toEqual((await currentProject(child.id)).objects)
  await navigate(parent.title)
  // Print uses an unbounded full preview; toolbar buttons are hidden.
  await page.emulateMedia({ media: 'print' })
  await expect(
    preview.first().getByRole('button', { name: tr('Open architecture'), exact: true }),
  ).toBeHidden()
  await page.screenshot({ path: path.join(output, '04-page-print.png') })
  await page.emulateMedia({ media: 'screen' })
  // Disabling preserves both the child and its preview, but editing is unavailable.
  const beforeDisable = await currentProject(child.id)
  await pluginToggle()
  await expect(preview.first().locator('.architecture-snapshot > svg')).toBeVisible()
  await preview
    .first()
    .getByRole('button', { name: tr('Open architecture'), exact: true })
    .click()
  await expect(page.locator('.architecture-disabled')).toBeVisible()
  expect(await currentProject(child.id)).toEqual(beforeDisable)
  await pluginToggle()
  await expect(planner()).toBeVisible()
  // English/Russian and dark/narrow popovers stay inside the window.
  let dialog = await settings()
  await dialog.getByRole('button', { name: 'Dark', exact: true }).click()
  await dialog.getByRole('button', { name: 'Русский', exact: true }).click()
  language = 'ru'
  dialog = page.getByRole('dialog', { name: tr('Settings'), exact: true })
  await dialog.getByRole('button', { name: tr('Close'), exact: true }).click()
  await properties(p.objects[1].id, 'General')
  await page.screenshot({ path: path.join(output, '05-dark-russian-properties.png') })
  await closeProperties()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(820, 920))
  await planner()
    .getByRole('button', { name: tr('Fit diagram'), exact: true })
    .click()
  await assertFloatingTools()
  await properties(p.objects[0].id, 'Resources')
  const bounds = await page.locator('.architecture-properties-popover:visible').boundingBox()
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  expect(bounds.x).toBeGreaterThanOrEqual(0)
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width)
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height)
  await page.screenshot({ path: path.join(output, '06-narrow-properties.png') })
  await closeProperties()
  await navigate(parent.title)
  await saved()
  await navigate(child.title)
  for (const objectIndex of [3, 0]) {
    await properties(p.objects[objectIndex].id, 'General')
    if (objectIndex === 3) await pick(inspector(), 'Site', p.sites[0].name)
    await pick(inspector(), 'Group', p.groups[0].name)
    if (objectIndex === 3) {
      await pick(inspector(), 'Object type', 'Website')
      await saved()
      expect(
        (await currentProject(child.id)).objects.find((object) => object.id === p.objects[3].id),
      ).toMatchObject({ type: 'website', groupId: p.groups[0].id })
      await pick(inspector(), 'Object type', 'Database')
    }
    await closeProperties()
    await saved()
  }
  const beforeGroupedRestart = await currentProject(child.id)
  await navigate(parent.title)
  await saved()
  const beforeRestart = await currentProject(created.id)
  await close()
  await launch()
  preview = page.locator('.architecture-embed')
  await expect(preview).toHaveCount(2)
  expect(await currentProject(created.id)).toEqual(beforeRestart)
  expect(await currentProject(child.id)).toEqual(beforeGroupedRestart)
  for (const index of [0, 3])
    expect(
      (await currentProject(child.id)).objects.find((object) => object.id === p.objects[index].id),
    ).toMatchObject({ type: p.objects[index].type, groupId: p.groups[0].id })
  await preview
    .last()
    .getByRole('button', { name: tr('Open architecture'), exact: true })
    .click()
  await expect(planner().locator('.architecture-eyebrow')).toHaveText('New topology')
  await expect(planner().locator('h1')).toHaveText(tr('All sites'))
  await saved()
  expect(errors).toEqual([])
  await fs.writeFile(
    path.join(output, 'result.json'),
    JSON.stringify(
      {
        root,
        checks:
          'Page-owned diagrams, all-type group drag/create/mixed selection/type change/restart, selection-only highlights without counters, compact properties, autosave, Undo/Redo, camera, single-click arrow selection/endpoint drags, double-click label/path editing, keyboard label editing, SVG/Mermaid/PNG/JPG/PDF, disable, themes/languages, narrow containment',
        errors,
      },
      null,
      2,
    ),
  )
  console.log('Architecture page review passed:', root)
} catch (error) {
  console.error(error)
  if (page) {
    await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {})
    // This suite owns the fixture: discard only its invalid form draft before closing normally.
    const reset = page.getByRole('button', { name: tr('Reset draft'), exact: true })
    if (await reset.count()) await reset.click().catch(() => {})
  }
  throw error
} finally {
  if (app) {
    await app
      .evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close())
      .catch(() => {})
    await app.close().catch(() => {})
  }
}
