import { _electron as electron, expect } from '@playwright/test'
import { build } from 'esbuild'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID as id } from 'node:crypto'

const output = path.resolve('test-results/architecture-controls')
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sheco-controls-'))
const workspace = path.join(root, 'Knowledge')
await fs.mkdir(workspace)
await fs.mkdir(output, { recursive: true })
await build({
  stdin: {
    contents:
      "export { seedWorkspace } from './src/shared/seed'; export { createPage, workspaceSchema } from './src/shared/model'; export { defaultDiagramSource } from './src/shared/diagram'; export { translate } from './src/shared/i18n'; export { architectureMermaid } from './src/shared/projectArchitecture'",
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: path.join(root, 'model.mjs'),
})
const api = await import(pathToFileURL(path.join(root, 'model.mjs')).href)
const w = api.seedWorkspace('Canvas controls review', false)
w.plugins.projectArchitecture.enabled = true
w.ui.fixedWidth = false
const parent = w.pages[0]
parent.title = 'Diagram guide'
parent.content = {
  type: 'doc',
  content: [
    { type: 'mermaid', attrs: { source: api.defaultDiagramSource, positions: {} } },
    { type: 'paragraph' },
  ],
}
const child = api.createPage(w, 'Store infrastructure', parent.id, 'architecture')
const project = child.architecture
project.presentation = { showTitle: false, showResources: true, showBalances: true }
project.resources.forEach((pool) => (pool.capacity = 1000))
project.sites = [
  { id: id(), name: 'Moscow', background: 'blue' },
  { id: id(), name: 'Novosibirsk' },
  { id: id(), name: 'Warehouse', background: 'purple' },
]
project.groups = [
  { id: id(), name: 'API cluster', siteId: project.sites[0].id, background: 'green' },
]
project.objects = ['store.example', 'api-01', 'api-02', 'orders-db', 'archive-01'].map(
  (name, index) => ({
    id: id(),
    name,
    type: index === 0 ? 'website' : index === 3 ? 'database' : 'server',
    siteId: project.sites[index < 3 ? 0 : index - 2].id,
    ...(index === 1 || index === 2 ? { groupId: project.groups[0].id } : {}),
    os: 'Debian',
    resources: { cpu: 4, ram: 8 },
    disks: [{ id: id(), resourceId: 'nvme', name: 'System', capacity: 20 }],
    parameters: [],
  }),
)
project.links = [
  [0, 1, 'HTTPS'],
  [0, 2, 'HTTPS'],
  [1, 3, 'PostgreSQL'],
  [2, 3, 'SQL'],
  [0, 4, 'Archive'],
  [3, 4, 'Backup'],
  [4, 2, 'Restore'],
].map(([from, to, label]) => ({
  id: id(),
  from: project.objects[from].id,
  to: project.objects[to].id,
  label,
}))
const exportScene = structuredClone(project)
exportScene.links = Array.from({ length: 12 }, (_, index) => {
  const from = Math.floor(index / 4)
  return {
    id: id(),
    from: project.objects[from].id,
    to: project.objects[(from + 1 + (index % 4)) % 5].id,
    label: 'Style ' + index,
    startArrow: index % 2 ? 'arrow' : 'none',
    endArrow: Math.floor(index / 2) % 2 ? 'arrow' : 'none',
    lineStyle: ['solid', 'dashed', 'dotted'][Math.floor(index / 4)],
  }
})
parent.content.content.splice(1, 0, {
  type: 'mermaid',
  attrs: { source: api.architectureMermaid(exportScene), positions: {} },
})
w.pages.push(child)
w.ui.tabs = [parent.id, child.id]
w.ui.activeId = child.id
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
const current = async () => (await read()).pages.find((item) => item.id === child.id).architecture
const planner = () => page.locator('.architecture-page:visible')
const canvas = () => planner().locator('.architecture-diagram')
async function saved() {
  await expect(page.locator('.save-status')).toHaveClass(/\bsaved\b/)
}
async function undo() {
  await planner()
    .getByRole('button', { name: tr('Undo architecture change'), exact: true })
    .click()
  await saved()
}
async function navigate(title) {
  await page.locator('.page-tree').getByRole('button', { name: title, exact: true }).click()
}
async function launch() {
  app = await electron.launch({
    args: [process.env.SHECO_TEST_MAIN ?? '.'],
    env: { ...process.env, SHECO_DATA_DIR: root },
  })
  page = await app.firstWindow()
  page.setDefaultTimeout(12000)
  page.on('pageerror', (error) => errors.push(error.message))
  await expect(page.locator('.save-status')).toBeVisible()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1500, 1050))
  // A fixture-local clipboard routes actual shortcut key presses into standard clipboard
  // events. No read or write touches the user's operating-system clipboard.
  await page.evaluate(() => {
    let clipboard = ''
    document.addEventListener(
      'keydown',
      (event) => {
        const active = document.activeElement
        if (
          !(event.ctrlKey || event.metaKey) ||
          !(active instanceof Element) ||
          !active.closest('.architecture-diagram') ||
          active.closest('input,textarea,[contenteditable="true"]')
        )
          return
        if (!['c', 'v'].includes(event.key.toLowerCase())) return
        event.preventDefault()
        const data = new DataTransfer()
        const copying = event.key.toLowerCase() === 'c'
        if (!copying) data.setData('text/plain', clipboard)
        active.dispatchEvent(
          new ClipboardEvent(copying ? 'copy' : 'paste', {
            bubbles: true,
            cancelable: true,
            clipboardData: data,
          }),
        )
        if (copying) clipboard = data.getData('text/plain')
      },
      true,
    )
  })
}
async function theme(theme, lang) {
  await page
    .locator('.sidebar-footer')
    .getByRole('button', { name: tr('Settings'), exact: true })
    .click()
  let dialog = page.getByRole('dialog', { name: tr('Settings'), exact: true })
  await dialog.getByRole('button', { name: tr(theme), exact: true }).click()
  await dialog
    .getByRole('button', { name: lang === 'ru' ? 'Русский' : 'English', exact: true })
    .click()
  language = lang
  dialog = page.getByRole('dialog', { name: tr('Settings'), exact: true })
  await dialog.getByRole('button', { name: tr('Close'), exact: true }).click()
}
try {
  await launch()
  await expect(planner()).toBeVisible()
  await expect(canvas().locator('[data-architecture-object] > title')).toHaveCount(0)
  for (const button of await planner()
    .locator('.architecture-diagram-controls .icon-button')
    .all()) {
    const box = await button.boundingBox()
    expect(box.width).toBe(28)
    expect(box.height).toBe(28)
  }
  expect(
    await planner()
      .locator('.architecture-heading')
      .evaluate((node) => getComputedStyle(node).borderBottomWidth),
  ).toBe('0px')
  for (const name of ['Find object', 'Export diagram']) {
    const button = planner().getByRole('button', { name: tr(name), exact: true })
    expect((await button.textContent()).trim()).toBe('')
  }
  await planner()
    .getByRole('button', { name: tr('Display settings'), exact: true })
    .click()
  await expect(page.locator('.architecture-display-settings').getByRole('switch')).toHaveCount(3)
  await planner()
    .getByRole('button', { name: tr('Display settings'), exact: true })
    .click()
  const headerIcons = planner().locator('.architecture-header-icon,.architecture-icon-picker')
  await page.mouse.move(20, 20)
  await expect
    .poll(async () =>
      headerIcons.evaluateAll(
        (buttons) => new Set(buttons.map((button) => getComputedStyle(button).border)).size,
      ),
    )
    .toBe(1)
  const iconStyles = await headerIcons.evaluateAll((buttons) =>
    buttons.map((button) => {
      const style = getComputedStyle(button),
        rect = button.getBoundingClientRect()
      const icon = button.querySelector('svg').getBoundingClientRect()
      return {
        border: style.border,
        radius: style.borderRadius,
        width: rect.width,
        height: rect.height,
        centered:
          Math.abs(rect.x + rect.width / 2 - icon.x - icon.width / 2) < 0.6 &&
          Math.abs(rect.y + rect.height / 2 - icon.y - icon.height / 2) < 0.6,
        clipped:
          icon.x < rect.x ||
          icon.y < rect.y ||
          icon.right > rect.right ||
          icon.bottom > rect.bottom,
      }
    }),
  )
  expect(iconStyles).toHaveLength(3)
  expect(new Set(iconStyles.map((style) => style.border)).size).toBe(1)
  expect(new Set(iconStyles.map((style) => style.radius)).size).toBe(1)
  expect(iconStyles.every((style) => style.centered && !style.clipped)).toBe(true)
  const objectRect = planner().locator(
    `[data-architecture-object="${project.objects[0].id}"] > rect`,
  )
  await objectRect.click({ button: 'right' })
  const actions = page.getByRole('menu', { name: tr('Architecture actions'), exact: true })
  await page.mouse.move(20, 20)
  expect(await actions.locator(':scope > button').allTextContents()).toEqual([
    'Create object',
    'Edit properties',
    'Duplicate object',
    'Delete object',
  ])
  expect(
    await actions
      .getByRole('menuitem', { name: tr('Duplicate object'), exact: true })
      .evaluate((node) => getComputedStyle(node).backgroundColor),
  ).toBe('rgba(0, 0, 0, 0)')
  await actions.getByRole('menuitem', { name: tr('Create object'), exact: true }).hover()
  const creation = page.getByRole('menu', { name: tr('Create object'), exact: true })
  await expect(creation).toBeVisible()
  await expect(creation.getByRole('menuitem', { name: tr('New group'), exact: true })).toBeVisible()
  const createFont = await creation
    .getByRole('menuitem')
    .first()
    .evaluate((node) => getComputedStyle(node).fontSize)
  await actions.getByRole('menuitem', { name: tr('Edit properties'), exact: true }).hover()
  const sections = page.getByRole('menu', { name: tr('Edit properties'), exact: true })
  await expect(sections).toBeVisible()
  await expect(creation).toHaveCount(0)
  expect(
    await sections
      .getByRole('menuitem')
      .first()
      .evaluate((node) => getComputedStyle(node).fontSize),
  ).toBe(createFont)
  await page.screenshot({ path: path.join(output, 'uniform-menu-light-en.png') })
  await planner().locator('.architecture-eyebrow').click()
  // Real mouse selection followed directly by Delete/Backspace must retain canvas focus.
  const label = planner().locator(`[data-architecture-link-label="${project.links[2].id}"]`)
  for (const key of ['Delete', 'Backspace']) {
    await label.click()
    await expect(canvas()).toBeFocused()
    await page.keyboard.press(key)
    await expect.poll(async () => (await current()).links.length).toBe(6)
    await undo()
    await expect.poll(async () => (await current()).links.length).toBe(7)
  }
  await label.click()
  const endHandle = planner().locator(
    '.architecture-endpoint-handle[data-architecture-endpoint="to"]',
  )
  await endHandle.click()
  const canvasBox = await canvas().boundingBox()
  const blank = { x: canvasBox.x + canvasBox.width - 30, y: canvasBox.y + canvasBox.height - 100 }
  await page.mouse.move(blank.x, blank.y)
  await expect(planner().locator('.architecture-connection-draft > path')).toHaveCount(1)
  await page.mouse.click(blank.x, blank.y)
  await page.mouse.move(blank.x - 30, blank.y - 30)
  await expect(planner().locator('.architecture-connection-draft > path')).toHaveCount(0)
  expect((await current()).links).toHaveLength(7)
  // Objects and groups copy from a snapshot, each paste is one undoable change.
  for (const modifier of ['Control', 'Meta']) {
    await planner().locator(`[data-architecture-object="${project.objects[0].id}"] > rect`).click()
    await page.keyboard.press(modifier + '+c')
    await page.keyboard.press(modifier + '+v')
    await expect.poll(async () => (await current()).objects.length).toBe(6)
    const copied = (await current()).objects.at(-1)
    expect(copied.disks[0].id).not.toBe(project.objects[0].disks[0].id)
    expect((await current()).links).toHaveLength(7)
    await undo()
    await expect.poll(async () => (await current()).objects.length).toBe(5)
  }
  await planner().locator(`[data-architecture-edit-group="${project.groups[0].id}"]`).click()
  await page.keyboard.press('Control+c')
  await page.keyboard.press('Control+v')
  await expect.poll(async () => (await current()).groups.length).toBe(2)
  expect((await current()).objects).toHaveLength(7)
  await undo()
  await expect.poll(async () => (await current()).groups.length).toBe(1)
  await label.dblclick()
  const editor = page.locator('.architecture-link-label-editor:visible')
  await editor.getByRole('button', { name: tr('Start arrow'), exact: true }).click()
  await page.getByRole('option', { name: '←', exact: true }).click()
  await expect.poll(async () => (await current()).links[2].startArrow).toBe('arrow')
  await editor.getByRole('button', { name: tr('End arrow'), exact: true }).click()
  await page.getByRole('option', { name: tr('No arrow'), exact: true }).click()
  await expect.poll(async () => (await current()).links[2].endArrow).toBe('none')
  for (const [value, label] of [
    ['dashed', 'Dashed line'],
    ['dotted', 'Dotted line'],
    ['solid', 'Solid line'],
  ]) {
    await editor.getByRole('button', { name: tr('Line style'), exact: true }).click()
    await page.getByRole('option', { name: tr(label), exact: true }).click()
    await expect.poll(async () => (await current()).links[2].lineStyle).toBe(value)
    await expect(editor).toBeVisible()
  }
  await page.screenshot({ path: path.join(output, 'connection-menu-light-en.png') })
  await editor
    .getByRole('textbox', { name: tr('Connection label'), exact: true })
    .fill('PostgreSQL TLS')
  await editor
    .getByRole('textbox', { name: tr('Connection label'), exact: true })
    .press('Backspace')
  await expect.poll(async () => (await current()).links.length).toBe(7)
  await planner().locator('.architecture-eyebrow').click()
  expect(
    await planner()
      .locator(`[data-architecture-link="${project.links[2].id}"] .architecture-link-arrowheads`)
      .getAttribute('marker-start'),
  ).toBe('url(#architecture-arrow)')
  for (const [appearance, lang] of [
    ['Light', 'en'],
    ['Dark', 'en'],
    ['Light', 'ru'],
    ['Dark', 'ru'],
  ]) {
    await theme(appearance, lang)
    await planner()
      .getByRole('button', { name: tr('Fit diagram'), exact: true })
      .click()
    await page.screenshot({
      path: path.join(output, `canvas-${appearance.toLowerCase()}-${lang}.png`),
    })
  }
  await page
    .locator('.sidebar-footer')
    .getByRole('button', { name: /Плагины/ })
    .click()
  await page
    .locator('.plugins-menu')
    .getByRole('button', { name: tr('Project architecture'), exact: true })
    .click()
  const settings = page.getByRole('region', { name: tr('Architecture settings'), exact: true })
  await expect(settings).toBeVisible()
  await settings.getByRole('switch', { name: tr('Show project title'), exact: true }).click()
  await expect
    .poll(async () => (await read()).plugins.projectArchitecture.defaults?.showTitle)
    .toBe(false)
  await page.screenshot({ path: path.join(output, 'global-settings-dark-ru.png') })
  await navigate(parent.title)
  await page.locator('.tiptap > p').last().click()
  await page.keyboard.type('/architecture')
  await page.getByRole('option', { name: /Создать архитектурную схему/ }).click()
  await expect
    .poll(async () => (await read()).pages.filter((item) => item.kind === 'architecture').length)
    .toBe(2)
  expect(
    (await read()).pages.filter((item) => item.kind === 'architecture').at(-1).architecture
      .presentation.showTitle,
  ).toBe(false)
  await navigate(parent.title)
  await expect(page.locator('.diagram-block').nth(1).locator('.diagram-preview')).toHaveAttribute(
    'aria-busy',
    'false',
  )
  await expect(page.locator('.diagram-block').nth(1).locator('.diagram-error')).toHaveCount(0)
  await expect(page.locator('.diagram-block').nth(1).locator('.diagram-svg svg')).toBeVisible()
  await page
    .getByRole('button', { name: tr('Edit diagram'), exact: true })
    .first()
    .click()
  const exportedDashStyles = await page
    .locator('.diagram-block')
    .nth(1)
    .locator('.diagram-svg svg path')
    .evaluateAll((paths) =>
      paths.map((path) => getComputedStyle(path).strokeDasharray.replaceAll(' ', '')),
    )
  expect(exportedDashStyles.some((value) => value === '6px,4px')).toBe(true)
  expect(exportedDashStyles.some((value) => value === '1px,4px')).toBe(true)
  const mermaid = page.getByRole('dialog', { name: tr('Edit diagram'), exact: true })
  await expect(mermaid.locator('.diagram-tools')).toBeVisible()
  expect((await mermaid.locator('.diagram-tools button').first().boundingBox()).width).toBe(28)
  expect((await mermaid.locator('.diagram-zoom button').first().boundingBox()).width).toBe(28)
  await page.screenshot({ path: path.join(output, 'mermaid-dark-ru.png') })
  await page.keyboard.press('Escape')
  await page
    .locator('.sidebar-footer')
    .getByRole('button', { name: tr('Settings'), exact: true })
    .click()
  let dialog = page.getByRole('dialog', { name: tr('Settings'), exact: true })
  await dialog.getByRole('tab', { name: tr('Plugins'), exact: true }).click()
  for (const summary of await dialog.locator('.plugin-commands > summary').all())
    expect(await summary.textContent()).toMatch(/^Команды/)
  await page.screenshot({ path: path.join(output, 'plugin-commands-dark-ru.png') })
  await dialog.getByRole('button', { name: tr('Close'), exact: true }).click()
  await navigate(child.title)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(820, 920))
  await page.screenshot({ path: path.join(output, 'narrow-dark-ru.png') })
  const heading = await planner().locator('.architecture-heading-actions').boundingBox()
  expect(heading.x + heading.width).toBeLessThanOrEqual(await page.evaluate(() => innerWidth))
  await saved()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await app.close()
  app = null
  await launch()
  await expect.poll(async () => (await current()).links[2].startArrow).toBe('arrow')
  expect((await current()).links[2]).toMatchObject({
    startArrow: 'arrow',
    endArrow: 'none',
    lineStyle: 'solid',
  })
  expect((await read()).plugins.projectArchitecture.defaults?.showTitle).toBe(false)
  while (await page.locator('.tab-close:visible').count())
    await page.locator('.tab-close:visible').last().click()
  await expect(page.locator('.empty-workspace')).toBeVisible()
  const logo = page.locator('.empty-illustration')
  expect((await logo.boundingBox()).width).toBeLessThan(90)
  await page.screenshot({ path: path.join(output, 'empty-workspace-dark-ru.png') })
  await theme('Light', 'ru')
  await page.screenshot({ path: path.join(output, 'empty-workspace-light-ru.png') })
  expect(errors).toEqual([])
  await fs.writeFile(
    path.join(output, 'verification.json'),
    JSON.stringify(
      {
        status: 'passed',
        profile: root,
        clipboard: 'Fixture-local shortcut/event simulation; OS clipboard untouched',
        checks: [
          'Delete/Backspace after mouse selection and Undo',
          'Ctrl and Cmd object copy/paste, group copy/paste, independent IDs, resources and one-step Undo',
          'Bidirectional arrows, label editing and restart',
          'Compact architecture and Mermaid controls',
          'Icon header and no divider/tooltip',
          'Architecture plugin menu, persisted defaults',
          'Command headings, four appearance/language combinations and narrow layout',
        ],
        errors,
      },
      null,
      2,
    ),
  )
  console.log('Architecture controls review passed:', output)
} finally {
  if (app) {
    await app
      .evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close())
      .catch(() => {})
    await app.close().catch(() => {})
  }
}
