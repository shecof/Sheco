import { _electron as electron, expect } from '@playwright/test'
import { build } from 'esbuild'
import sharp from 'sharp'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sheco-architecture-canvas-'))
const workspace = path.join(root, 'Knowledge'),
  output = path.resolve('test-results/project-architecture')
await fs.mkdir(workspace)
await fs.mkdir(output, { recursive: true })
const bundle = await build({
  stdin: {
    contents:
      "export { seedWorkspace } from './src/shared/seed'; export { translate } from './src/shared/i18n'; export { workspaceSchema } from './src/shared/model'; export { projectArchitectureTab, projectArchitectureSettingsTab } from './src/shared/plugins'; export { createArchitectureProject, architectureDiagramLayout } from './src/shared/projectArchitecture'",
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
})
const seedFile = path.join(root, 'seed.mjs')
await fs.writeFile(seedFile, bundle.outputFiles[0].contents)
const {
  seedWorkspace,
  translate,
  workspaceSchema,
  projectArchitectureTab,
  projectArchitectureSettingsTab,
  createArchitectureProject,
  architectureDiagramLayout,
} = await import(pathToFileURL(seedFile).href)
const w = seedWorkspace('Architecture canvas review', false)
w.pages[0].title = 'Retained note'
w.pages[0].content = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'This note must survive all architecture changes.' }],
    },
  ],
}
const originalPages = structuredClone(w.pages)
delete w.plugins.projectArchitecture
w.ui.tabs.push(projectArchitectureSettingsTab)
w.ui.activeId = projectArchitectureSettingsTab
const snapshotPath = path.join(workspace, 'workspace.json')
await fs.writeFile(snapshotPath, JSON.stringify(w))
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
const errors = [],
  tr = (key) => translate(key, language)
const planner = () => page.locator('.architecture-page:visible')
const panel = () => page.locator('.architecture-inspector:visible')
const labelEditor = () => page.locator('.architecture-link-label-editor:visible')
const modal = () => page.locator('.architecture-modal:visible')
const menu = () => page.getByRole('menu', { name: tr('Architecture actions') })
const snapshot = async () => JSON.parse(await fs.readFile(snapshotPath, 'utf8'))
const project = async () => (await snapshot()).plugins.projectArchitecture.projects[0]
async function saved() {
  await expect(page.locator('.save-status')).toHaveClass(/\bsaved\b/)
}
async function launch() {
  app = await electron.launch({
    args: [process.env.SHECO_TEST_MAIN ?? '.'],
    env: { ...process.env, SHECO_DATA_DIR: root },
  })
  page = await app.firstWindow()
  page.setDefaultTimeout(10000)
  page.on('pageerror', (error) => errors.push(error.message))
  await expect(page.locator('.save-status')).toBeVisible({ timeout: 20000 })
  await app.evaluate(({ BrowserWindow, clipboard }, output) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.setSize(1500, 1100)
    globalThis.__architectureCopied = ''
    globalThis.__architectureDownloads = []
    globalThis.__architectureDownload = false
    clipboard.writeText = (text) => {
      globalThis.__architectureCopied = text
    }
    win.webContents.session.on('will-download', (_event, item) => {
      item.setSavePath(output + '/architecture-export.' + item.getFilename().split('.').at(-1))
      item.once('done', (_event, state) => {
        globalThis.__architectureDownload = state
        globalThis.__architectureDownloads.push(item.getFilename())
      })
    })
  }, output)
}
async function close() {
  await saved()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await app.close()
  app = null
}
async function settings(category = 'Plugins') {
  await page
    .locator('.sidebar-footer')
    .getByRole('button', { name: tr('Settings'), exact: true })
    .click()
  await page.getByRole('tab', { name: tr(category), exact: true }).click()
  return page.getByRole('dialog', { name: tr('Settings'), exact: true })
}
async function pluginCard() {
  const dialog = await settings()
  await dialog.getByRole('button', { name: tr('Tools'), exact: true }).click()
  return dialog
    .locator('.plugin-card')
    .filter({ has: page.getByText(tr('Project architecture'), { exact: true }) })
}
async function pick(scope, label, value) {
  await scope.getByRole('button', { name: label, exact: true }).click()
  await page.getByRole('option', { name: value, exact: true }).click()
}
async function field(label, value) {
  await (label === 'Connection label' ? labelEditor() : panel())
    .getByRole('textbox', { name: tr(label), exact: true })
    .fill(value)
  await saved()
}
async function closePanel() {
  const popup = page.locator('.architecture-properties-popover:visible')
  if (await popup.count())
    await popup.getByRole('button', { name: tr('Close properties'), exact: true }).click()
  await expect(popup).toHaveCount(0)
}
async function openProperties(kind, id) {
  await closePanel()
  await planner().locator(`[data-architecture-properties-${kind}="${id}"]`).scrollIntoViewIfNeeded()
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
  const before = await camera()
  await planner().locator(`[data-architecture-properties-${kind}="${id}"]`).click()
  await expect(panel()).toBeVisible()
  const bounds = await page.locator('.architecture-properties-popover:visible').boundingBox()
  expect(bounds.width).toBeLessThanOrEqual(362)
  expect(bounds.x).toBeGreaterThanOrEqual(0)
  const size = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(size.width)
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(size.height)
  expect(await camera()).toEqual(before)
}
async function openLabel(id) {
  await closePanel()
  const point = await planner()
    .locator(`[data-architecture-link="${id}"] .architecture-link-hit`)
    .evaluate((path) => {
      const local = path.getPointAtLength(path.getTotalLength() * 0.5)
      const client = new DOMPoint(local.x, local.y).matrixTransform(path.getScreenCTM())
      return { x: client.x, y: client.y }
    })
  await page.mouse.click(point.x, point.y)
  await expect(
    labelEditor().getByRole('textbox', { name: tr('Connection label'), exact: true }),
  ).toBeFocused()
  expect(
    (await page.locator('.architecture-properties-popover.is-link-label').boundingBox()).height,
  ).toBeLessThan(65)
  await expect(page.getByRole('button', { name: tr('Connection from'), exact: true })).toHaveCount(
    0,
  )
  await expect(page.getByRole('button', { name: tr('Connection to'), exact: true })).toHaveCount(0)
}
async function reattach(id, endpoint, targetId, cancel = false, valid = true) {
  await openLabel(id)
  await closePanel()
  const handle = await planner()
    .locator(
      `[data-architecture-link="${id}"][data-architecture-endpoint="${endpoint}"] .architecture-endpoint-dot`,
    )
    .boundingBox()
  const target = await planner()
    .locator(`[data-architecture-object="${targetId}"] > rect`)
    .boundingBox()
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
  await page.mouse.down()
  await page.mouse.move(target.x + 35, target.y + 35, { steps: 12 })
  if (valid)
    await expect(planner().locator('[data-architecture-object].connection-target')).toHaveAttribute(
      'data-architecture-object',
      targetId,
    )
  else
    await expect(planner().locator('[data-architecture-object].connection-target')).toHaveCount(0)
  if (cancel) await page.keyboard.press('Escape')
  await page.mouse.up()
  await saved()
}
const canvas = () => planner().locator('.architecture-diagram')
const camera = () =>
  canvas()
    .locator('.architecture-diagram-canvas > div > svg')
    .evaluate((svg) => {
      const box = svg.viewBox.baseVal
      return {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        zoom: svg.getScreenCTM().a,
      }
    })
async function fitCanvas() {
  await canvas().scrollIntoViewIfNeeded()
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
  await planner()
    .getByRole('button', { name: tr('Fit diagram'), exact: true })
    .click()
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
}
async function ensureNodesVisible(ids) {
  const viewport = await canvas().boundingBox()
  const boxes = await Promise.all(
    ids.map((id) => planner().locator(`[data-architecture-object="${id}"] > rect`).boundingBox()),
  )
  if (
    boxes.some(
      (box) =>
        box.x < viewport.x ||
        box.y < viewport.y ||
        box.x + box.width > viewport.x + viewport.width ||
        box.y + box.height > viewport.y + viewport.height,
    )
  )
    await fitCanvas()
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
}
async function panAt(point, delta, button = 'left', cancel = false) {
  await page.mouse.move(point.x, point.y)
  await page.mouse.down({ button })
  await page.mouse.move(point.x + delta.x, point.y + delta.y, { steps: 12 })
  if (cancel) await page.keyboard.press('Escape')
  await page.mouse.up({ button })
}
async function expand(title) {
  const details = panel()
    .locator('details')
    .filter({ has: page.locator('summary').getByText(tr(title), { exact: true }) })
  if ((await details.getAttribute('open')) === null) await details.locator('summary').click()
}
async function display(key, checked) {
  await planner()
    .getByRole('button', { name: tr('Display settings'), exact: true })
    .click()
  await page
    .locator('.architecture-display-settings')
    .getByRole('checkbox', { name: tr(key), exact: true })
    .setChecked(checked)
  await page.keyboard.press('Escape')
  await saved()
}
async function contextSite(siteId, groupId) {
  await closePanel()
  await fitCanvas()
  const target = planner().locator(
    `[data-architecture-${groupId ? 'group' : 'site'}="${groupId ?? siteId}"] > rect`,
  )
  await target.scrollIntoViewIfNeeded()
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
  const point = await target.evaluate((rect) => {
    const box = rect.getBBox()
    const point = new DOMPoint(box.x + 6, box.y + box.height - 6).matrixTransform(
      rect.getScreenCTM(),
    )
    return { x: point.x, y: point.y }
  })
  await page.mouse.click(point.x, point.y, { button: 'right' })
  await expect(menu()).toBeVisible()
}
async function createSite(name, color = 'Default background') {
  await closePanel()
  const canvas = await planner().locator('.architecture-diagram').boundingBox()
  await page.mouse.click(canvas.x + 10, canvas.y + 10, { button: 'right' })
  await menu()
    .getByRole('menuitem', { name: tr('New site'), exact: true })
    .click()
  await expect(modal()).toHaveCount(0)
  await field('Site name', name)
  await pick(panel(), tr('Background'), tr(color))
  await saved()
  return (await project()).sites.find((site) => site.name === name)
}
async function createObject(name, type, site, cpu, ram, pool, capacity, groupId) {
  await contextSite(site.id, groupId)
  await menu()
    .getByRole('menuitem', { name: tr('Create object'), exact: true })
    .hover()
  await page
    .getByRole('menu', { name: tr('Create object'), exact: true })
    .getByRole('menuitem', {
      name: tr(
        { server: 'Create server', database: 'Create database', website: 'Create website' }[type],
      ),
      exact: true,
    })
    .click()
  await expect(modal()).toHaveCount(0)
  await field('Object name', name)
  for (const [resource, value] of [
    ['CPU', cpu],
    ['RAM', ram],
  ])
    await panel()
      .getByRole('spinbutton', {
        name: `${resource} · ${tr(resource === 'CPU' ? 'cores' : 'GB')}`,
        exact: true,
      })
      .fill(String(value))
  if (pool) {
    await pick(panel(), tr('Add disk'), pool)
    await panel()
      .getByRole('spinbutton', {
        name: translate('Disk size {number}', language, { number: 1 }),
        exact: true,
      })
      .fill(String(capacity))
  }
  await expand('Operating system')
  await pick(panel(), tr('Choose OS'), 'Debian')
  await saved()
  return (await project()).objects.find((object) => object.name === name)
}
async function marquee(ids, cancel = false) {
  await closePanel()
  await planner().locator('.architecture-diagram').scrollIntoViewIfNeeded()
  await ensureNodesVisible(ids)
  const boxes = await Promise.all(
    ids.map((id) => planner().locator(`[data-architecture-object="${id}"] > rect`).boundingBox()),
  )
  // Keep the gesture inside the visible gap, including at fitted-out camera scales.
  const padding = Math.min(3, (await camera()).zoom * 6)
  const left = Math.min(...boxes.map((box) => box.x)) - padding,
    top = Math.min(...boxes.map((box) => box.y)) - padding
  const right = Math.max(...boxes.map((box) => box.x + box.width)) + padding,
    bottom = Math.max(...boxes.map((box) => box.y + box.height)) + padding
  await page.mouse.move(left, top)
  await page.mouse.down()
  await page.mouse.move(right, bottom, { steps: 14 })
  if (cancel) await page.keyboard.press('Escape')
  await page.mouse.up()
  if (!cancel) {
    await expect(planner().locator('[data-architecture-object].selected')).toHaveCount(ids.length)
    await expect(menu()).toBeVisible()
  }
}
async function drag(ids, destinationSite, destinationGroup, cancel = false) {
  await fitCanvas()
  const source = await planner()
    .locator(`[data-architecture-object="${ids[0]}"] > rect`)
    .boundingBox()
  const target = await planner()
    .locator(
      `[data-architecture-${destinationGroup ? 'group' : 'site'}="${destinationGroup ?? destinationSite}"] > rect`,
    )
    .evaluate((rect, grouped) => {
      const box = rect.getBBox()
      const point = new DOMPoint(
        box.x + box.width / 2,
        box.y + (grouped ? 24 : 44),
      ).matrixTransform(rect.getScreenCTM())
      return { x: point.x, y: point.y }
    }, !!destinationGroup)
  await page.mouse.move(source.x + source.width * 0.2, source.y + source.height * 0.25)
  await page.mouse.down()
  await page.mouse.move(target.x, target.y, { steps: 14 })
  if (cancel) await page.keyboard.press('Escape')
  await page.mouse.up()
  await saved()
  await expect(modal()).toHaveCount(0)
}
async function connect(from, to, label) {
  await closePanel()
  await ensureNodesVisible([from.id, to.id])
  const port = await planner()
    .locator(`[data-architecture-connect="${from.id}"] .architecture-port-dot`)
    .boundingBox()
  const target = await planner()
    .locator(`[data-architecture-object="${to.id}"] > rect`)
    .boundingBox()
  await page.mouse.move(port.x + port.width / 2, port.y + port.height / 2)
  await page.mouse.down()
  await page.mouse.move(target.x + target.width * 0.2, target.y + target.height * 0.3, {
    steps: 12,
  })
  await expect(planner().locator('[data-architecture-object].connection-target')).toHaveAttribute(
    'data-architecture-object',
    to.id,
  )
  await expect(planner().locator('[data-architecture-object].connecting')).toHaveAttribute(
    'data-architecture-object',
    from.id,
  )
  await expect(planner().locator('[data-architecture-object].connection-related')).toHaveCount(0)
  if (label === 'Backup')
    await page.screenshot({ path: path.join(output, 'connection-target-light-en.png') })
  await page.mouse.up()
  await saved()
  await expect(modal()).toHaveCount(0)
  await expect(page.locator('.architecture-properties-popover:visible')).toHaveCount(0)
  const link = (await project()).links.find((link) => link.from === from.id && link.to === to.id)
  expect(link.label).toBe('')
  await openLabel(link.id)
  await field('Connection label', label)
  if (label === 'Backup')
    await page.screenshot({ path: path.join(output, 'connection-label-light-en.png') })
  return (await project()).links.find((item) => item.id === link.id)
}
async function undo() {
  await closePanel()
  await planner()
    .getByRole('button', { name: tr('Undo architecture change'), exact: true })
    .click()
  await saved()
}
async function exportFormat(format) {
  await closePanel()
  await app.evaluate(() => {
    globalThis.__architectureDownload = false
  })
  await pick(planner(), tr('Export diagram'), format)
  if (format === 'Mermaid') {
    await expect(modal()).toBeVisible()
    await modal()
      .getByRole('button', { name: tr('Download Mermaid'), exact: true })
      .click()
  }
  await expect.poll(() => app.evaluate(() => globalThis.__architectureDownload)).toBe('completed')
}
async function appearance(theme, nextLanguage) {
  const dialog = await settings('General')
  await dialog.getByRole('button', { name: tr(theme), exact: true }).click()
  await dialog
    .getByRole('button', { name: nextLanguage === 'ru' ? 'Русский' : 'English', exact: true })
    .click()
  language = nextLanguage
  await page
    .getByRole('dialog', { name: tr('Settings'), exact: true })
    .getByRole('button', { name: tr('Close'), exact: true })
    .click()
  await saved()
}
try {
  await launch()
  await saved()
  await expect(page.locator('.architecture-configuration')).toHaveCount(0)
  expect((await snapshot()).ui.tabs).toContain(projectArchitectureSettingsTab)
  let card = await pluginCard()
  await expect(card.getByRole('button', { name: tr('Configure'), exact: true })).toHaveCount(0)
  await card.getByRole('switch').click()
  await card.getByRole('button', { name: tr('Open architecture'), exact: true }).click()
  await expect(planner()).toBeVisible()
  await planner()
    .getByRole('button', { name: tr('New project'), exact: true })
    .first()
    .click()
  await modal()
    .getByRole('textbox', { name: tr('Project name'), exact: true })
    .fill('Commerce platform')
  for (const [resource, capacity] of [
    ['CPU', 400],
    ['RAM', 200],
    ['NVMe', 2000],
    ['SSD', 1000],
    ['HDD', 1000],
  ])
    await modal()
      .getByRole('spinbutton', { name: `Capacity ${resource}`, exact: true })
      .fill(String(capacity))
  await modal()
    .getByRole('button', { name: tr('Create project'), exact: true })
    .click()
  await saved()
  await expect(planner().locator('h1')).toContainText('Commerce platform')
  expect(
    await planner()
      .locator('h1 .database-picker > span')
      .evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
  ).toBe(true)
  expect(
    await planner()
      .locator('h2 .database-picker > span')
      .evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
  ).toBe(true)
  await expect(planner().locator('.architecture-sites')).toHaveCount(0)
  await expect(planner().getByRole('button', { name: 'Mermaid', exact: true })).toHaveCount(0)
  await expect(planner().getByRole('button', { name: tr('New object'), exact: true })).toHaveCount(
    0,
  )
  await expect(
    planner().getByRole('button', { name: tr('New server group'), exact: true }),
  ).toHaveCount(0)
  const moscow = await createSite('Москва 1', 'Blue'),
    novosibirsk = await createSite('Новосибирск 1'),
    warehouse = await createSite('Новосибирск Склад 1', 'Purple')
  await expect(planner().getByRole('button', { name: tr('New site'), exact: true })).toHaveCount(0)
  await contextSite(warehouse.id)
  const createTrigger = menu().getByRole('menuitem', { name: tr('Create object'), exact: true })
  await createTrigger.focus()
  await createTrigger.press('ArrowRight')
  const childMenu = page.getByRole('menu', { name: tr('Create object'), exact: true })
  await expect(childMenu).toBeVisible()
  await expect(childMenu.getByRole('menuitem').first()).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(childMenu.getByRole('menuitem').nth(1)).toBeFocused()
  await page.keyboard.press('ArrowLeft')
  await expect(childMenu).toHaveCount(0)
  await expect(createTrigger).toBeFocused()
  await createTrigger.hover()
  await expect(childMenu).toBeVisible()
  const childBox = await childMenu.boundingBox(),
    windowSize =
      page.viewportSize() ??
      (await page.evaluate(() => ({ width: innerWidth, height: innerHeight })))
  expect(childBox.x).toBeGreaterThanOrEqual(0)
  expect(childBox.x + childBox.width).toBeLessThanOrEqual(windowSize.width)
  await page.screenshot({ path: path.join(output, 'create-submenu-light-en.png') })
  await page.mouse.move(childBox.x + 30, childBox.y + childBox.height - 15, { steps: 12 })
  await expect(childMenu).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(childMenu).toHaveCount(0)
  await expect(menu()).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(menu()).toHaveCount(0)
  const api = await createObject('api-01', 'server', moscow, 32, 32, 'NVMe', 120)
  await pick(panel(), tr('Add disk'), 'NVMe')
  await panel()
    .getByRole('textbox', {
      name: translate('Disk name {number}', language, { number: 2 }),
      exact: true,
    })
    .fill('Data')
  await panel()
    .getByRole('spinbutton', {
      name: translate('Disk size {number}', language, { number: 2 }),
      exact: true,
    })
    .fill('80')
  await pick(panel(), tr('Choose OS'), 'Debian')
  await panel()
    .getByRole('button', { name: tr('Choose OS'), exact: true })
    .click()
  const osBounds = await page.locator('.architecture-os-options').boundingBox()
  expect(osBounds.width).toBeLessThanOrEqual(220)
  await page.keyboard.press('Escape')
  await saved()
  await expect(planner().locator('select,datalist')).toHaveCount(0)
  expect((await project()).objects.find((object) => object.id === api.id).disks).toHaveLength(2)
  await page.screenshot({ path: path.join(output, 'compact-form-light-en.png') })
  const api2 = await createObject('api-02', 'server', moscow, 16, 16, 'SSD', 100)
  const website = await createObject('store.example', 'website', moscow, 4, 8, 'NVMe', 20)
  const database = await createObject('orders-db', 'database', novosibirsk, 24, 64, 'NVMe', 700)
  const archive = await createObject('archive-01', 'server', warehouse, 8, 16, 'HDD', 600)
  await closePanel()
  await expect(planner().locator('.architecture-balance').first()).toContainText('316')
  // Invalid local fields stay in the panel and block navigation until explicitly reset.
  await planner()
    .locator(`[data-architecture-object="${api.id}"] > rect`)
    .click({ position: { x: 40, y: 40 } })
  await expect(panel()).toHaveCount(0)
  await planner()
    .locator(`[data-architecture-object="${api.id}"] > rect`)
    .click({ button: 'right', position: { x: 40, y: 40 } })
  await menu()
    .getByRole('menuitem', { name: tr('Edit properties'), exact: true })
    .click()
  await expect(panel()).toBeVisible()
  await panel()
    .getByRole('textbox', { name: tr('Object name'), exact: true })
    .fill('')
  await expect(panel().getByRole('alert')).toBeVisible()
  await pick(planner(), tr('Architecture site'), warehouse.name)
  await expect(panel().getByRole('textbox', { name: tr('Object name'), exact: true })).toHaveValue(
    '',
  )
  expect((await project()).objects.find((object) => object.id === api.id).name).toBe(api.name)
  await panel()
    .getByRole('button', { name: tr('Reset draft'), exact: true })
    .click()
  await closePanel()
  // Keep a draft across an independent resource save; a stale panel must not overwrite it.
  await openProperties('object', api.id)
  await planner()
    .getByRole('button', { name: tr('Project resources'), exact: true })
    .click()
  await planner()
    .locator(`[data-architecture-properties-object="${api.id}"]`)
    .evaluate((node) => {
      const rect = node.getBoundingClientRect()
      node.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
        }),
      )
    })
  await panel()
    .getByRole('textbox', { name: tr('Object name'), exact: true })
    .evaluate((input) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  await expect(panel().locator('[role="alert"]')).toBeVisible()
  await modal().getByRole('spinbutton', { name: 'Capacity CPU', exact: true }).fill('450')
  await modal()
    .getByRole('button', { name: tr('Save project'), exact: true })
    .click()
  await field('Object name', 'Retained stale draft')
  await expect(panel().getByRole('alert')).toHaveText(
    tr('The project changed. Reopen the form before saving.'),
  )
  await expect(panel().getByRole('textbox', { name: tr('Object name'), exact: true })).toHaveValue(
    'Retained stale draft',
  )
  expect((await project()).objects.find((object) => object.id === api.id).name).toBe(api.name)
  expect((await project()).resources[0].capacity).toBe(450)
  await panel()
    .getByRole('button', { name: tr('Reset draft'), exact: true })
    .click()
  await closePanel()
  await planner()
    .getByRole('button', { name: tr('Project resources'), exact: true })
    .click()
  await modal().getByRole('spinbutton', { name: 'Capacity CPU', exact: true }).fill('400')
  await modal()
    .getByRole('button', { name: tr('Save project'), exact: true })
    .click()
  await saved()
  await marquee([api.id, api2.id], true)
  await expect(menu()).toHaveCount(0)
  await marquee([api.id, api2.id])
  await page.screenshot({ path: path.join(output, 'selection-context-light-en.png') })
  await menu()
    .getByRole('menuitem', { name: tr('Group selected servers'), exact: true })
    .click()
  await expect(modal()).toHaveCount(0)
  await field('Group name', 'API cluster')
  await pick(panel(), tr('Background'), tr('Green'))
  await saved()
  const apiGroup = (await project()).groups.find((group) => group.name === 'API cluster')
  expect(apiGroup.siteId).toBe(moscow.id)
  expect((await project()).objects.filter((object) => object.groupId === apiGroup.id)).toHaveLength(
    2,
  )
  await expect(
    planner().locator(
      '[data-architecture-add-server],[data-architecture-add],[data-architecture-add-group]',
    ),
  ).toHaveCount(0)
  await page.screenshot({ path: path.join(output, 'group-form-light-en.png') })
  await contextSite(warehouse.id)
  await menu()
    .getByRole('menuitem', { name: tr('New server group'), exact: true })
    .click()
  await field('Group name', 'Archive cluster')
  await pick(panel(), tr('Background'), tr('Orange'))
  await saved()
  const archiveGroup = (await project()).groups.find((group) => group.name === 'Archive cluster')
  expect(archiveGroup.siteId).toBe(warehouse.id)
  await closePanel()
  await drag([archive.id], warehouse.id, archiveGroup.id)
  expect((await project()).objects.find((object) => object.id === archive.id).groupId).toBe(
    archiveGroup.id,
  )
  // A group context creates a server directly inside that group; deletion and undo are atomic.
  const beforeGroupCreate = await project()
  const temporary = await createObject(
    'context-created',
    'server',
    warehouse,
    0,
    0,
    null,
    0,
    archiveGroup.id,
  )
  expect((await project()).objects.find((object) => object.id === temporary.id).groupId).toBe(
    archiveGroup.id,
  )
  await closePanel()
  await fitCanvas()
  await planner()
    .locator(`[data-architecture-object="${temporary.id}"] > rect`)
    .click({ button: 'right', position: { x: 40, y: 40 } })
  await menu()
    .getByRole('menuitem', { name: tr('Delete selected objects'), exact: true })
    .click()
  await saved()
  expect((await project()).objects).toHaveLength(5)
  // Retain one group after deleting its shell, and restore it with Undo.
  await closePanel()
  await planner()
    .locator(`[data-architecture-edit-group="${apiGroup.id}"] > rect`)
    .click({ button: 'right' })
  await menu()
    .getByRole('menuitem', { name: tr('Delete server group'), exact: true })
    .click()
  await saved()
  expect(
    (await project()).objects
      .filter((object) => [api.id, api2.id].includes(object.id))
      .every((object) => !object.groupId),
  ).toBe(true)
  await undo()
  expect((await project()).objects.filter((object) => object.groupId === apiGroup.id)).toHaveLength(
    2,
  )
  await marquee([api.id, api2.id])
  await page.keyboard.press('Escape')
  await planner()
    .locator(`[data-architecture-object="${api.id}"] > rect`)
    .click({ position: { x: 50, y: 40 } })
  await planner()
    .locator(`[data-architecture-object="${website.id}"] > rect`)
    .click({ modifiers: ['Shift'], position: { x: 50, y: 40 } })
  await expect(planner().locator('[data-architecture-object].selected')).toHaveCount(2)
  await planner()
    .locator(`[data-architecture-object="${website.id}"] > rect`)
    .click({ button: 'right', position: { x: 50, y: 40 } })
  await expect(
    menu().getByRole('menuitem', { name: tr('Group selected servers'), exact: true }),
  ).toBeDisabled()
  await page.keyboard.press('Escape')
  await marquee([api.id, api2.id])
  await page.keyboard.press('Escape')
  const dragBaseline = await project()
  await drag([api.id, api2.id], warehouse.id, undefined, true)
  expect((await project()).objects).toEqual(dragBaseline.objects)
  await drag([api.id, api2.id], warehouse.id)
  expect(
    (await project()).objects
      .filter((object) => [api.id, api2.id].includes(object.id))
      .every((object) => object.siteId === warehouse.id && !object.groupId),
  ).toBe(true)
  await drag([api.id, api2.id], moscow.id, apiGroup.id)
  expect((await project()).objects.filter((object) => object.groupId === apiGroup.id)).toHaveLength(
    2,
  )
  await marquee([api.id, api2.id])
  await menu()
    .getByRole('menuitem', { name: tr('Delete selected objects'), exact: true })
    .click()
  await saved()
  expect((await project()).objects).toHaveLength(3)
  await undo()
  expect((await project()).objects).toHaveLength(5)
  const links = []
  for (const [from, to, label] of [
    [website, api, 'HTTPS'],
    [website, api2, 'HTTPS'],
    [api, database, 'PostgreSQL'],
    [api2, database, 'PostgreSQL'],
    [database, archive, 'Backup'],
    [website, archive, 'HTTPS archive'],
  ])
    links.push(await connect(from, to, label))
  await closePanel()
  await expect(planner().locator('.architecture-diagram')).toContainText('HTTPS archive')
  await expect(planner().locator('[data-architecture-connect] path')).toHaveCount(0)
  expect(
    Number(await planner().locator('.architecture-port-dot').first().getAttribute('r')),
  ).toBeLessThanOrEqual(4)
  const beforeConnections = await project()
  // Navigation changes only the session camera. Hand/Space/middle-button overrides node moves.
  await canvas().scrollIntoViewIfNeeded()
  await fitCanvas()
  const initialView = await camera()
  const nodeBox = await planner()
    .locator(`[data-architecture-object="${api.id}"] > rect`)
    .boundingBox()
  const panPoint = { x: nodeBox.x + 35, y: nodeBox.y + 30 }
  await planner()
    .getByRole('button', { name: tr('Pan canvas'), exact: true })
    .click()
  await panAt(panPoint, { x: 70, y: -35 })
  let nextView = await camera()
  expect(nextView.x).toBeCloseTo(initialView.x - 70 / initialView.zoom, 2)
  expect(nextView.y).toBeCloseTo(initialView.y + 35 / initialView.zoom, 2)
  await expect(panel()).toHaveCount(0)
  await expect(planner().locator('.architecture-marquee')).toHaveCount(0)
  await expect(planner().locator('.architecture-drag-ghost')).toHaveCount(0)
  await panAt(panPoint, { x: -60, y: 20 }, 'left', true)
  expect(await camera()).toEqual(nextView)
  await fitCanvas()
  await planner()
    .getByRole('button', { name: tr('Select elements'), exact: true })
    .click()
  await canvas().focus()
  await page.keyboard.down('Space')
  await panAt(panPoint, { x: -55, y: 25 })
  await page.keyboard.up('Space')
  expect((await camera()).x).toBeCloseTo(initialView.x + 55 / initialView.zoom, 2)
  await expect(canvas()).not.toHaveClass(/tool-hand/)
  await fitCanvas()
  await panAt(panPoint, { x: 35, y: 25 }, 'middle')
  expect((await camera()).x).toBeCloseTo(initialView.x - 35 / initialView.zoom, 2)
  await fitCanvas()
  const canvasBox = await canvas().boundingBox()
  const cursor = {
    x: Math.round(canvasBox.x + canvasBox.width * 0.6),
    y: Math.round(canvasBox.y + canvasBox.height * 0.45),
  }
  const worldAt = () =>
    canvas()
      .locator('.architecture-diagram-canvas > div > svg')
      .evaluate((svg, cursor) => {
        const point = new DOMPoint(cursor.x, cursor.y).matrixTransform(svg.getScreenCTM().inverse())
        return { x: point.x, y: point.y }
      }, cursor)
  await page.mouse.move(cursor.x, cursor.y)
  const beforeWheel = await camera()
  const outerScroll = await page
    .locator('.plugin-tool-scroll:visible')
    .evaluate((node) => node.scrollTop)
  await page.mouse.wheel(60, 90)
  await expect.poll(async () => (await camera()).y).not.toBe(beforeWheel.y)
  nextView = await camera()
  expect(nextView.x).toBeCloseTo(beforeWheel.x + 60 / beforeWheel.zoom, 2)
  expect(nextView.y).toBeCloseTo(beforeWheel.y + 90 / beforeWheel.zoom, 2)
  expect(await page.locator('.plugin-tool-scroll:visible').evaluate((node) => node.scrollTop)).toBe(
    outerScroll,
  )
  const anchored = await worldAt()
  await page.keyboard.down('Control')
  await page.mouse.wheel(0, -80)
  await page.keyboard.up('Control')
  await expect.poll(async () => (await camera()).zoom).toBeGreaterThan(nextView.zoom)
  expect((await worldAt()).x).toBeCloseTo(anchored.x, 2)
  expect((await worldAt()).y).toBeCloseTo(anchored.y, 2)
  expect(await page.evaluate(() => visualViewport.scale)).toBe(1)
  expect(await project()).toEqual(beforeConnections)
  await fitCanvas()
  expect(await camera()).toEqual(initialView)
  // A modest camera transform keeps both nodes visible while exercising world-space selection.
  await planner()
    .getByRole('button', { name: tr('Zoom in'), exact: true })
    .click()
  await panAt(panPoint, { x: 18, y: -12 }, 'middle')
  await marquee([api.id, api2.id])
  await page.keyboard.press('Escape')
  const extra = await connect(api, archive, 'Temporary HTTPS')
  const endpointBaseline = await project()
  await reattach(extra.id, 'to', website.id, true)
  expect(await project()).toEqual(endpointBaseline)
  await reattach(extra.id, 'to', database.id, false, false)
  expect(await project()).toEqual(endpointBaseline)
  await reattach(extra.id, 'to', website.id)
  await reattach(extra.id, 'from', website.id, false, false)
  expect((await project()).links.find((link) => link.id === extra.id)).toMatchObject({
    from: api.id,
    to: website.id,
    label: 'Temporary HTTPS',
  })
  await reattach(extra.id, 'from', archive.id)
  const beforeBlankDrop = await project()
  await openLabel(extra.id)
  await page.keyboard.press('Escape')
  await expect(canvas()).toBeFocused()
  await openLabel(extra.id)
  await closePanel()
  const endpointBox = await planner()
    .locator(
      `[data-architecture-link="${extra.id}"][data-architecture-endpoint="to"] .architecture-endpoint-dot`,
    )
    .boundingBox()
  const emptyCanvas = await canvas().boundingBox()
  await panAt(
    { x: endpointBox.x + endpointBox.width / 2, y: endpointBox.y + endpointBox.height / 2 },
    {
      x: emptyCanvas.x + 3 - endpointBox.x - endpointBox.width / 2,
      y: emptyCanvas.y + 3 - endpointBox.y - endpointBox.height / 2,
    },
  )
  expect(await project()).toEqual(beforeBlankDrop)
  // Click-to-connect remains available, with the same target feedback and no automatic form.
  await planner().locator(`[data-architecture-connect="${archive.id}"]`).click()
  const clickTarget = await planner()
    .locator(`[data-architecture-object="${api2.id}"] > rect`)
    .boundingBox()
  await page.mouse.move(clickTarget.x + 35, clickTarget.y + 35)
  await expect(planner().locator('[data-architecture-object].connection-target')).toHaveAttribute(
    'data-architecture-object',
    api2.id,
  )
  await page.mouse.click(clickTarget.x + 35, clickTarget.y + 35)
  await saved()
  await expect(page.locator('.architecture-properties-popover:visible')).toHaveCount(0)
  expect((await project()).links).toHaveLength(8)
  await canvas().focus()
  await page.keyboard.press('Delete')
  await saved()
  expect(await project()).toEqual(beforeBlankDrop)
  await openLabel(extra.id)
  await field('Connection label', 'Restore HTTPS')
  expect((await project()).links.find((link) => link.id === extra.id)).toMatchObject({
    from: archive.id,
    to: website.id,
  })
  await labelEditor()
    .getByRole('button', { name: tr('Delete connection'), exact: true })
    .click()
  await saved()
  expect((await project()).links).toHaveLength(6)
  await closePanel()
  await fitCanvas()
  await undo()
  expect((await project()).links).toHaveLength(7)
  await planner().locator(`[data-architecture-link-label="${extra.id}"] text`).click()
  await planner()
    .locator(`[data-architecture-link="${extra.id}"]:not([data-architecture-endpoint])`)
    .focus()
  await page.keyboard.press('Delete')
  await saved()
  expect((await project()).links).toHaveLength(6)
  await display('Show project title', false)
  await display('Show object resources', false)
  await display('Show resource balance', false)
  await expect(planner().locator('[data-architecture-title]')).toHaveCount(0)
  await expect(planner().locator('.architecture-balances')).toHaveCount(0)
  expect((await project()).presentation).toEqual({
    showTitle: false,
    showResources: false,
    showBalances: false,
  })
  await page.screenshot({ path: path.join(output, 'diagram-resources-hidden-en.png') })
  await pick(planner(), tr('Architecture site'), moscow.name)
  await expect(planner().locator('[data-architecture-object]')).toHaveCount(3)
  await expect(planner().locator('.architecture-diagram')).not.toContainText(database.name)
  await pick(planner(), tr('Architecture site'), tr('All sites'))
  await display('Show project title', true)
  await display('Show object resources', true)
  await display('Show resource balance', true)
  await exportFormat('Mermaid')
  await modal()
    .getByRole('button', { name: tr('Copy Mermaid'), exact: true })
    .click()
  const mermaidSource = await app.evaluate(() => globalThis.__architectureCopied)
  expect(mermaidSource).toContain('API cluster')
  expect(mermaidSource).toContain('NVMe: 120 GB')
  await modal()
    .getByRole('button', { name: tr('Close'), exact: true })
    .click()
  const entry = await page.evaluate(() =>
    new URL(document.querySelector('script[type="module"][src]').src).pathname.split('/').pop(),
  )
  const modules = (await fs.readdir(path.resolve('dist/assets'))).filter((file) =>
    /^mermaid\.core-.*\.js$/.test(file),
  )
  const sources = await Promise.all(
    modules.map((file) => fs.readFile(path.resolve('dist/assets', file), 'utf8')),
  )
  const mermaidModule = modules[sources.findIndex((source) => source.includes(entry))]
  expect(mermaidModule).toBeTruthy()
  expect(
    await page.evaluate(
      async ({ source, moduleName }) => {
        const { default: mermaid } = await import(
          new URL('./assets/' + moduleName, location.href).href
        )
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' })
        return !!(await mermaid.parse(source))
      },
      { source: mermaidSource, moduleName: mermaidModule },
    ),
  ).toBe(true)
  await exportFormat('SVG')
  const svg = await fs.readFile(path.join(output, 'architecture-export.svg'), 'utf8')
  expect(svg).toContain('fill="#f4f8f2"')
  expect(svg).not.toContain('var(--')
  expect(
    await page.evaluate(
      (source) =>
        !new DOMParser().parseFromString(source, 'image/svg+xml').querySelector('parsererror'),
      svg,
    ),
  ).toBe(true)
  for (const format of ['PNG', 'JPG']) {
    await exportFormat(format)
    const bytes = await fs.readFile(
      path.join(output, 'architecture-export.' + format.toLowerCase()),
    )
    expect((await sharp(bytes).metadata()).format).toBe(format === 'PNG' ? 'png' : 'jpeg')
    expect((await sharp(bytes).stats()).channels[0].stdev).toBeGreaterThan(5)
  }
  const downloads = await app.evaluate(() => globalThis.__architectureDownloads.length)
  await page.evaluate(() => {
    const original = window.Image
    window.__restoreArchitectureImage = () => {
      window.Image = original
    }
    window.Image = class {
      set src(_value) {}
    }
  })
  await pick(planner(), tr('Export diagram'), 'PNG')
  await expect(
    planner().getByRole('button', { name: tr('Export diagram'), exact: true }),
  ).toContainText(tr('Exporting…'))
  await display('Show project title', false)
  await expect(
    planner().getByRole('button', { name: tr('Export diagram'), exact: true }),
  ).toContainText(tr('Export'))
  await page.evaluate(() => window.__restoreArchitectureImage())
  expect(await app.evaluate(() => globalThis.__architectureDownloads.length)).toBe(downloads)
  await display('Show project title', true)
  if (await page.getByRole('button', { name: tr('Dismiss notification'), exact: true }).count())
    await page.getByRole('button', { name: tr('Dismiss notification'), exact: true }).click()
  await page.screenshot({ path: path.join(output, 'diagram-light-en.png') })
  await expect(planner().getByRole('button', { name: tr('Objects'), exact: true })).toHaveCount(0)
  await expect(
    planner().locator('.architecture-view-switch,.architecture-object-list'),
  ).toHaveCount(0)
  await appearance('Dark', 'en')
  await page.screenshot({ path: path.join(output, 'diagram-dark-en.png') })
  await appearance('Light', 'ru')
  await page.screenshot({ path: path.join(output, 'diagram-light-ru.png') })
  await appearance('Dark', 'ru')
  await page.screenshot({ path: path.join(output, 'diagram-dark-ru.png') })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(880, 800))
  await openProperties('object', api.id)
  expect(await panel().evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true)
  await panel().evaluate((node) => {
    node.scrollTop = node.scrollHeight
  })
  await expect(panel().locator('header')).toBeInViewport({ ratio: 1 })
  await expect(
    panel().getByRole('button', { name: tr('Close properties'), exact: true }),
  ).toBeInViewport({ ratio: 1 })
  await page.screenshot({ path: path.join(output, 'narrow-dark-ru.png') })
  expect(await planner().evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
  await closePanel()
  await saved()
  const retained = await project()
  expect((await snapshot()).pages).toEqual(originalPages)
  await close()
  await launch()
  await expect(planner()).toBeVisible()
  await saved()
  expect(await project()).toEqual(retained)
  card = await pluginCard()
  await card.getByRole('switch').click()
  await page
    .getByRole('dialog', { name: tr('Settings'), exact: true })
    .getByRole('button', { name: tr('Close'), exact: true })
    .click()
  await saved()
  expect((await snapshot()).ui.tabs).not.toContain(projectArchitectureTab)
  expect(await project()).toEqual(retained)
  card = await pluginCard()
  await card.getByRole('switch').click()
  await card.getByRole('button', { name: tr('Open architecture'), exact: true }).click()
  await saved()
  expect((await snapshot()).ui.tabs.filter((id) => id === projectArchitectureTab)).toHaveLength(1)
  workspaceSchema.parse(await snapshot())
  expect((await snapshot()).pages).toEqual(originalPages)
  expect(errors).toEqual([])
  // The maximum-size synthetic project starts in a fresh app owner, never the user's preview.
  await close()
  const large = createArchitectureProject('Large canvas')
  large.presentation = { showTitle: true, showResources: false, showBalances: false }
  large.sites = Array.from({ length: 100 }, (_, index) => ({
    id: randomUUID(),
    name: `Site ${index + 1}`,
    background: index % 2 ? 'blue' : 'green',
  }))
  large.objects = large.sites.flatMap((site, index) =>
    Array.from({ length: 5 }, (_, ordinal) => ({
      id: randomUUID(),
      siteId: site.id,
      name: `server-${index + 1}-${ordinal + 1}`,
      type: 'server',
      os: 'Debian',
      resources: {},
      parameters: [],
    })),
  )
  const largeSnapshot = await snapshot()
  largeSnapshot.plugins.projectArchitecture.projects.push(large)
  const tall = structuredClone(large)
  tall.id = randomUUID()
  tall.name = 'Tall canvas'
  tall.sites = [tall.sites[0]]
  tall.objects.forEach((object) => {
    object.siteId = tall.sites[0].id
  })
  largeSnapshot.plugins.projectArchitecture.projects.push(tall)
  workspaceSchema.parse(largeSnapshot)
  await fs.writeFile(snapshotPath, JSON.stringify(largeSnapshot))
  await launch()
  await appearance('Light', 'en')
  await pick(planner(), tr('Architecture project'), large.name)
  await canvas().scrollIntoViewIfNeeded()
  await expect(planner().locator('[data-architecture-object]')).toHaveCount(500)
  expect((await camera()).zoom).toBeLessThan(0.03)
  await page.screenshot({ path: path.join(output, 'large-canvas-fit-en.png') })
  // Zoom to a readable detail at the far end via wheel; no giant scroll surface is allocated.
  const largeLayout = architectureDiagramLayout(large)
  const lastNode = largeLayout.nodes.at(-1)
  await canvas().evaluate((node) => {
    const bounds = node.getBoundingClientRect()
    for (let index = 0; index < 8; index++)
      node.dispatchEvent(
        new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          deltaY: -500,
          clientX: bounds.left + bounds.width / 2,
          clientY: bounds.top + bounds.height / 2,
        }),
      )
  })
  await expect.poll(async () => (await camera()).zoom).toBeCloseTo(2.5, 3)
  const readable = await camera()
  await canvas().evaluate(
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
      x: (lastNode.x + lastNode.width / 2 - readable.x - readable.width / 2) * readable.zoom,
      y: (lastNode.y + lastNode.height / 2 - readable.y - readable.height / 2) * readable.zoom,
    },
  )
  await expect(
    planner().locator(`[data-architecture-object="${lastNode.object.id}"]`),
  ).toBeInViewport()
  expect(await canvas().evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
  await page.screenshot({ path: path.join(output, 'large-canvas-detail-en.png') })
  await planner()
    .getByRole('button', { name: tr('Pan canvas'), exact: true })
    .click()
  await openProperties('object', lastNode.object.id)
  await expect(panel().getByRole('textbox', { name: tr('Object name'), exact: true })).toHaveValue(
    lastNode.object.name,
  )
  await panel()
    .getByRole('textbox', { name: tr('Object name'), exact: true })
    .fill('')
  const draftCamera = await camera()
  const draftCanvas = await canvas().boundingBox()
  await panAt({ x: draftCanvas.x + 40, y: draftCanvas.y + 40 }, { x: 25, y: 15 }, 'middle')
  expect((await camera()).x).not.toBe(draftCamera.x)
  await expect(panel().getByRole('textbox', { name: tr('Object name'), exact: true })).toHaveValue(
    '',
  )
  await panel()
    .getByRole('button', { name: tr('Reset draft'), exact: true })
    .click()
  const zoomBeforePanel = (await camera()).zoom
  await closePanel()
  expect((await camera()).zoom).toBeCloseTo(zoomBeforePanel, 4)
  expect((await snapshot()).plugins.projectArchitecture.projects[1]).toEqual(large)
  expect((await snapshot()).pages).toEqual(originalPages)
  await canvas().evaluate((node) => {
    for (let index = 0; index < 10; index++)
      node.dispatchEvent(
        new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          deltaY: 500,
        }),
      )
  })
  await expect.poll(async () => (await camera()).zoom).toBeCloseTo(0.001, 5)
  await pick(planner(), tr('Architecture project'), tall.name)
  await fitCanvas()
  const tallGeometry = architectureDiagramLayout(tall)
  const tallViewport = await canvas().evaluate((node) => ({
    width: node.clientWidth,
    height: node.clientHeight,
  }))
  expect((await camera()).zoom).toBeCloseTo(
    Math.min(tallViewport.width / tallGeometry.width, tallViewport.height / tallGeometry.height, 1),
    5,
  )
  await expect(
    planner().locator(`[data-architecture-object="${tall.objects.at(-1).id}"]`),
  ).toBeInViewport({ ratio: 1 })
  await expect(
    planner().locator(`[data-architecture-object="${tall.objects[0].id}"]`),
  ).toBeInViewport({ ratio: 1 })
  expect((await snapshot()).plugins.projectArchitecture.projects[2]).toEqual(tall)
  await pick(planner(), tr('Architecture project'), retained.name)
  await fitCanvas()
  expect(await project()).toEqual(retained)
  expect(errors).toEqual([])
  await fs.writeFile(
    path.join(output, 'verification.json'),
    JSON.stringify(
      {
        retiredSettingsCompatibility: true,
        singleDesigner: true,
        titlePickersAndNoSiteRail: true,
        contextCreationWithoutModal: true,
        inlineAutosaveAndInvalidDraftRetention: true,
        stalePropertiesPreserveNewerProject: true,
        multipleDisks: true,
        compactOsPicker: true,
        hoverCreationSubmenuAndKeyboard: true,
        diagramOnly: true,
        compactContextAndThreeDotProperties: true,
        blankConnectionsAndInlineLabel: true,
        dragBothEndpointsAndInvalidDropGuards: true,
        connectionTargetHighlight: true,
        clickToConnectAndBlankEndpointDrop: true,
        propertyPopoverScrollAndStickyHeader: true,
        siteCreationOnlyInContext: true,
        sharedBudget: true,
        marqueeGroupingAndBulkDeletion: true,
        modifierSelectionAndMixedGroupGuard: true,
        bulkMoveAndEscape: true,
        freeCanvasPanHandSpaceMiddleAndEscape: true,
        wheelPanAndCursorAnchoredZoom: true,
        cameraDoesNotChangeProjectOrOuterScroll: true,
        selectionAndConnectionsUnderCameraTransform: true,
        fitAndZoomLimits: true,
        maximum100Sites500ObjectsCanvas: true,
        maximumTall500ObjectsFitsBothAxes: true,
        panPreservesInvalidInlineDraft: true,
        groupDeletionPreservesServers: true,
        undo: true,
        dotConnectionsAndInlineEditing: true,
        persistedPresentation: true,
        mutedGroupColors: true,
        mermaidExportViewer: true,
        actualSvgMermaidPngJpg: true,
        mermaidParserAndSvgXml: true,
        staleRasterCancellation: true,
        restartAndDisablePreservation: true,
        themesAndLanguages: true,
        narrowLayout: true,
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
  if (app)
    await close().catch(async () => {
      await app.close()
    })
}
