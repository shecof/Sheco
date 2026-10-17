import { _electron as electron, expect } from '@playwright/test'
import { build } from 'esbuild'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID as id } from 'node:crypto'

const output = path.resolve('test-results/architecture-context')
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sheco-architecture-context-'))
const workspace = path.join(root, 'Knowledge')
await fs.mkdir(workspace)
await fs.mkdir(output, { recursive: true })
await build({
  stdin: {
    contents:
      "export * from './src/shared/projectArchitecture'; export { seedWorkspace } from './src/shared/seed'; export { createPage, workspaceSchema } from './src/shared/model'; export { translate } from './src/shared/i18n'",
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: path.join(root, 'model.mjs'),
})
const api = await import(pathToFileURL(path.join(root, 'model.mjs')).href)
const w = api.seedWorkspace('Context menu review', false)
w.plugins.projectArchitecture.enabled = true
w.ui.fixedWidth = false
const child = api.createPage(w, 'Context matrix', undefined, 'architecture')
const p = child.architecture
p.presentation = { showTitle: false, showResources: true, showBalances: false }
p.sites = [
  { id: id(), name: 'Site A', position: { x: 32, y: 32 } },
  { id: id(), name: 'Site B', position: { x: 500, y: 32 } },
]
p.groups = [{ id: id(), name: 'Existing group', siteId: p.sites[0].id, background: 'green' }]
const object = (name, type, siteId, groupId) => ({
  id: id(),
  name,
  type,
  ...(siteId && { siteId }),
  ...(groupId && { groupId }),
  os: 'Ubuntu 22',
  resources: { cpu: 2, ram: 4 },
  disks: [],
  parameters: [],
})
p.objects = [
  ...['server', 'database', 'website'].map((type) => object(`Site ${type}`, type, p.sites[0].id)),
  object('Other site server', 'server', p.sites[1].id),
  object('Grouped server', 'server', p.sites[0].id, p.groups[0].id),
  object('Grouped database', 'database', p.sites[0].id, p.groups[0].id),
  ...['server', 'database', 'website'].map((type) => object(`Root ${type}`, type)),
]
p.links = [{ id: id(), from: p.objects[6].id, to: p.objects[0].id, label: 'Link' }]
w.pages.push(child)
w.ui.tabs = [child.id]
w.ui.activeId = child.id
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
const errors = [],
  results = []
const tr = (key) => api.translate(key, language)
const planner = () => page.locator('.architecture-page:visible')
const canvas = () => planner().locator('.architecture-diagram')
const menu = () => page.getByRole('menu', { name: tr('Architecture actions'), exact: true })
const rect = (index) =>
  planner().locator(`[data-architecture-object="${p.objects[index].id}"] > rect`)
const current = async () =>
  JSON.parse(await fs.readFile(file, 'utf8')).pages.find((page) => page.id === child.id)
    .architecture
const saved = async () => {
  await expect(page.locator('.save-status')).toHaveClass(/\bsaved\b/)
}
async function launch() {
  app = await electron.launch({
    args: [process.env.SHECO_TEST_MAIN ?? '.'],
    env: { ...process.env, SHECO_DATA_DIR: root },
  })
  page = await app.firstWindow()
  page.setDefaultTimeout(12000)
  page.on('pageerror', (error) => errors.push(error.message))
  await expect(planner()).toBeVisible()
}
async function resetSelection() {
  await planner().locator('.architecture-eyebrow').click()
  await canvas().focus()
  await page.keyboard.press('Escape')
}
async function checkMenu(name, labels) {
  await expect(menu()).toBeVisible()
  expect(await menu().locator(':scope > button').allTextContents()).toEqual(labels.map(tr))
  results.push({ name, language, labels })
}
async function creation(hasGroup) {
  await menu()
    .getByRole('menuitem', { name: tr('Create object'), exact: true })
    .hover()
  const submenu = page.getByRole('menu', { name: tr('Create object'), exact: true })
  await expect(submenu).toBeVisible()
  expect(await submenu.getByRole('menuitem').allTextContents()).toEqual(
    ['Create server', 'Create database', 'Create website', ...(hasGroup ? ['New group'] : [])].map(
      tr,
    ),
  )
  await expect(
    submenu.getByRole('menuitem', { name: tr('Group selected objects'), exact: true }),
  ).toHaveCount(0)
}
async function select(indices) {
  await resetSelection()
  for (const [i, index] of indices.entries())
    await rect(index).click({ modifiers: i ? ['Shift'] : [] })
  await rect(indices[0]).click({ button: 'right' })
}
async function closeProperties() {
  await page
    .locator('.architecture-inspector')
    .getByRole('button', { name: tr('Close properties'), exact: true })
    .click()
  await expect(page.locator('.architecture-inspector')).toHaveCount(0)
  await saved()
}
async function undo() {
  await planner()
    .getByRole('button', { name: tr('Undo architecture change'), exact: true })
    .click()
  await saved()
}
try {
  await launch()
  for (const [theme, lang, width] of [
    ['Light', 'en', 1500],
    ['Light', 'ru', 980],
    ['Dark', 'ru', 980],
    ['Dark', 'en', 1500],
  ]) {
    await app.evaluate(
      ({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 1050),
      width,
    )
    await page
      .locator('.sidebar-footer')
      .getByRole('button', { name: tr('Settings'), exact: true })
      .click()
    let settings = page.getByRole('dialog', { name: tr('Settings'), exact: true })
    await settings.getByRole('button', { name: tr(theme), exact: true }).click()
    await settings
      .getByRole('button', { name: lang === 'ru' ? 'Русский' : 'English', exact: true })
      .click()
    language = lang
    settings = page.getByRole('dialog', { name: tr('Settings'), exact: true })
    await settings.getByRole('button', { name: tr('Close'), exact: true }).click()
    for (const index of [0, 1, 2, 4, 5, 6, 7, 8]) {
      await resetSelection()
      await rect(index).click({ button: 'right' })
      await checkMenu(p.objects[index].name, [
        'Create object',
        'Edit properties',
        'Duplicate object',
        'Delete object',
      ])
      await creation(![4, 5].includes(index))
    }
    for (const [kind, entity] of [
      ['site', p.sites[0]],
      ['group', p.groups[0]],
    ]) {
      await resetSelection()
      await planner()
        .locator(`[data-architecture-edit-${kind}="${entity.id}"]`)
        .click({ button: 'right', position: { x: 8, y: 8 } })
      await checkMenu(kind, [
        'Create object',
        'Edit properties',
        kind === 'site' ? 'Delete site' : 'Delete group',
      ])
      await creation(kind === 'site')
    }
    await resetSelection()
    await planner()
      .locator(`[data-architecture-link-label="${p.links[0].id}"]`)
      .click({ button: 'right' })
    await checkMenu('connection', ['Edit properties', 'Delete connection'])
    await resetSelection()
    // The top-left corner lies outside every synthetic frame/card.
    await canvas().click({ button: 'right', position: { x: 3, y: 3 } })
    await checkMenu('blank canvas', ['Create object', 'New site'])
    await creation(true)
    for (const [indices, grouping] of [
      [[0, 1, 2], true],
      [[6, 7, 8], true],
      [[0, 3], false],
      [[0, 6], false],
      [[4, 5], false],
    ]) {
      await select(indices)
      await checkMenu(`selection ${indices.join(',')}`, [
        ...(grouping ? ['Group selected objects'] : []),
        'Duplicate selected objects',
        'Delete selected objects',
      ])
    }
    await resetSelection()
    const boxes = await Promise.all([0, 1].map((index) => rect(index).boundingBox()))
    const start = { x: boxes[0].x - 3, y: boxes[0].y - 3 }
    const end = {
      x: Math.max(...boxes.map((box) => box.x + box.width)) + 3,
      y: Math.max(...boxes.map((box) => box.y + box.height)) + 3,
    }
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(end.x, end.y, { steps: 8 })
    await page.mouse.up()
    await checkMenu('marquee inside site', [
      'Group selected objects',
      'Duplicate selected objects',
      'Delete selected objects',
    ])
    await page.keyboard.press('Escape')
    await canvas().focus()
    await page.keyboard.press('Shift+F10')
    await checkMenu('keyboard selection', [
      'Group selected objects',
      'Duplicate selected objects',
      'Delete selected objects',
    ])
    // Right-clicking a site after a selection switches to that site, not its children.
    await planner()
      .locator(`[data-architecture-edit-site="${p.sites[0].id}"]`)
      .click({ button: 'right', position: { x: 8, y: 8 } })
    await checkMenu('site after multiselection', [
      'Create object',
      'Edit properties',
      'Delete site',
    ])
    await select([6, 7, 8])
    await page.screenshot({
      path: path.join(output, `root-selection-${theme.toLowerCase()}-${lang}.png`),
    })
  }
  await menu()
    .getByRole('menuitem', { name: tr('Group selected objects'), exact: true })
    .click()
  await closeProperties()
  const grouped = await current(),
    group = grouped.groups.at(-1)
  expect(group.siteId).toBeUndefined()
  expect(
    grouped.objects.slice(6).every((object) => object.groupId === group.id && !object.siteId),
  ).toBe(true)
  expect(grouped.links).toEqual(p.links)
  expect(api.architectureBalances(grouped)).toEqual(api.architectureBalances(p))
  await undo()
  expect((await current()).groups).toHaveLength(1)
  await planner()
    .getByRole('button', { name: tr('Redo architecture change'), exact: true })
    .click()
  await saved()
  expect((await current()).groups.at(-1).id).toBe(group.id)
  await resetSelection()
  await planner()
    .locator(`[data-architecture-edit-group="${group.id}"]`)
    .click({ button: 'right', position: { x: 8, y: 8 } })
  await checkMenu('root group', ['Create object', 'Edit properties', 'Delete group'])
  await creation(false)
  await resetSelection()
  await planner().locator(`[data-architecture-properties-group="${group.id}"]`).click()
  const inspector = page.locator('.architecture-inspector')
  const header = inspector.locator(':scope > header'),
    close = inspector.getByRole('button', { name: tr('Close properties'), exact: true })
  await close.hover()
  const headerBox = await header.boundingBox(),
    closeBox = await close.boundingBox()
  expect(headerBox.height).toBe(37)
  expect(headerBox.x + headerBox.width - closeBox.x - closeBox.width).toBe(4)
  expect(closeBox.y - headerBox.y).toBe(4)
  await page.screenshot({ path: path.join(output, 'root-group-properties.png') })
  await closeProperties()
  // Check the No site filter keeps the root group, then restart the complete writer.
  await planner()
    .getByRole('button', { name: tr('Architecture site'), exact: true })
    .click()
  await page.getByRole('option', { name: tr('No site'), exact: true }).click()
  await expect(planner().locator('[data-architecture-site]')).toHaveCount(0)
  await expect(planner().locator(`[data-architecture-group="${group.id}"]`)).toHaveCount(1)
  await expect(planner().locator('[data-architecture-object]')).toHaveCount(3)
  expect(api.architectureMermaid(await current(), api.architectureNoSite)).toContain(group.name)
  expect(api.architectureSvg(await current(), api.architectureNoSite)).toContain(group.name)
  await saved()
  await app.close()
  app = null
  await launch()
  expect((await current()).groups.at(-1).id).toBe(group.id)
  await expect(planner().locator(`[data-architecture-group="${group.id}"]`)).toHaveCount(1)
  for (const type of ['server', 'database', 'website']) {
    await resetSelection()
    await planner()
      .locator(`[data-architecture-edit-group="${group.id}"]`)
      .click({ button: 'right', position: { x: 8, y: 8 } })
    await menu()
      .getByRole('menuitem', { name: tr('Create object'), exact: true })
      .hover()
    await page
      .getByRole('menu', { name: tr('Create object'), exact: true })
      .getByRole('menuitem', {
        name: tr(
          type === 'server'
            ? 'Create server'
            : type === 'database'
              ? 'Create database'
              : 'Create website',
        ),
        exact: true,
      })
      .click()
    await closeProperties()
    const created = (await current()).objects.at(-1)
    expect(created).toMatchObject({ type, groupId: group.id })
    expect(created.siteId).toBeUndefined()
  }
  await resetSelection()
  await planner().locator(`[data-architecture-edit-group="${group.id}"]`).click()
  await canvas().focus()
  await page.keyboard.press('Shift+F10')
  await checkMenu('keyboard root group', ['Create object', 'Edit properties', 'Delete group'])
  await resetSelection()
  await planner()
    .locator(`[data-architecture-edit-group="${group.id}"]`)
    .click({ button: 'right', position: { x: 8, y: 8 } })
  await menu()
    .getByRole('menuitem', { name: tr('Delete group'), exact: true })
    .click()
  await saved()
  expect(
    (await current()).objects.slice(6).every((object) => !object.groupId && !object.siteId),
  ).toBe(true)
  expect((await current()).links).toEqual(p.links)
  expect(errors).toEqual([])
  await fs.writeFile(
    path.join(output, 'verification.json'),
    JSON.stringify(
      {
        results,
        header: { height: 37, top: 4, right: 4 },
        rootGrouping:
          'save, undo/redo, scope, SVG/Mermaid, restart, delete retaining members passed',
        errors,
      },
      null,
      2,
    ),
  )
  console.log(
    `Passed ${results.length} menu cases, root grouping/save/restart/export and close-button alignment`,
  )
} finally {
  await app?.close()
}
