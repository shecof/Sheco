import { _electron as electron, expect } from '@playwright/test'
import { build } from 'esbuild'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sheco-plugins-'))
const workspace = path.join(root, 'Knowledge')
const output = path.resolve('test-results/command-tools')
await fs.mkdir(workspace)
await fs.mkdir(output, { recursive: true })
const bundled = await build({
  stdin: {
    contents:
      "export { seedWorkspace } from './src/shared/seed'; export { builtinToolsV1 } from './src/shared/pluginTools'; export { commandBuilderConfigSchema } from './src/shared/plugins'",
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
})
const modulePath = path.join(root, 'seed.mjs')
await fs.writeFile(modulePath, bundled.outputFiles[0].contents)
const { seedWorkspace, builtinToolsV1, commandBuilderConfigSchema } = await import(
  pathToFileURL(modulePath).href
)
const w = seedWorkspace('Plugin review', false)
w.pages[0].content = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Keep this existing note unchanged.' }] },
    { type: 'paragraph' },
  ],
}
const originalPages = JSON.parse(JSON.stringify(w.pages))
const nmapParameterCount = w.plugins.commandBuilder.config.tools[0].parameters.length
w.plugins.commandBuilder.config = commandBuilderConfigSchema.parse({
  ...w.plugins.commandBuilder.config,
  tools: builtinToolsV1,
})
delete w.plugins.commandBuilder.catalogRevision // Exercise an actual old catalog on disk.
const snapshot = path.join(workspace, 'workspace.json')
await fs.writeFile(snapshot, JSON.stringify(w, null, 2))
await fs.writeFile(
  path.join(root, 'spaces.json'),
  JSON.stringify({
    activeId: w.id,
    spaces: [{ id: w.id, name: w.name, icon: w.icon, path: workspace }],
  }),
)
let app, page
const errors = []
async function launch() {
  app = await electron.launch({
    args: [process.env.SHECO_TEST_MAIN ?? '.'],
    env: { ...process.env, SHECO_DATA_DIR: root },
  })
  page = await app.firstWindow()
  page.on('pageerror', (e) => errors.push(e.message))
  await expect(page.locator('.save-status')).toBeVisible({ timeout: 20000 })
  await app.evaluate(({ clipboard }) => {
    clipboard.writeText = (text) => {
      globalThis.pluginCopied = text
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
async function settings() {
  await page
    .locator('.sidebar-footer')
    .getByRole('button', { name: 'Plugins', exact: false })
    .click()
  await page.getByRole('button', { name: 'Manage plugins', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'Plugins', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  )
}
async function catalogAction(name, label = 'Catalog actions') {
  await page.getByRole('button', { name: label, exact: true }).click()
  await page.getByRole('menuitem', { name, exact: true }).click()
}
async function parameterAction(name) {
  await page.getByRole('button', { name: 'Parameter actions', exact: true }).click()
  await page.getByRole('menuitem', { name, exact: true }).click()
}
async function additionalSettings() {
  const details = page.locator('.plugin-inspector-content .plugin-advanced')
  if ((await details.getAttribute('open')) === null) await details.locator('summary').click()
}
async function selectTool(name) {
  await page.locator('.plugin-tool-list').getByText(name, { exact: true }).click()
}
async function selectBuilderTool(name) {
  const picker = page.locator('.command-tool-picker')
  if (await picker.count()) {
    await picker.click()
    await page.getByRole('option', { name, exact: true }).click()
  } else await page.locator('.command-tool-list').getByText(name, { exact: true }).click()
}
async function builderMode(name) {
  await page.locator('.command-mode-switch').getByRole('button', { name, exact: true }).click()
}
async function addCommandParameter(name, label = 'Add parameter') {
  await page.locator('.command-builder').getByRole('button', { name: label, exact: true }).click()
  await page.getByRole('menuitem', { name, exact: true }).click()
}
async function selectParameter(name) {
  await page.locator('.plugin-parameter-list').getByText(name, { exact: true }).click()
}
async function pick(label, name) {
  await page.getByRole('button', { name: label, exact: true }).click()
  await page.getByRole('option', { name, exact: true }).click()
}
async function centeredChain() {
  const geometry = await page.locator('.command-block-chain').evaluate((node) => {
    const fields = node.closest('.command-fields')
    const box = fields.getBoundingClientRect()
    const style = getComputedStyle(fields)
    const left = parseFloat(style.paddingLeft)
    const right = parseFloat(style.paddingRight)
    return {
      center: box.x + fields.clientLeft + left + (fields.clientWidth - left - right) / 2,
      nodes: [...node.children].map((child) => {
        const rect = child.getBoundingClientRect()
        return { center: rect.x + rect.width / 2, y: rect.y, bottom: rect.bottom }
      }),
    }
  })
  for (const [index, node] of geometry.nodes.entries()) {
    expect(Math.abs(node.center - geometry.center)).toBeLessThan(1)
    if (index) expect(node.y - geometry.nodes[index - 1].bottom).toBeGreaterThan(12)
  }
  return geometry
}
async function compactParameter(name, inline = true) {
  const boxes = await page.getByRole('group', { name, exact: true }).evaluate((node) => {
    const card = node.getBoundingClientRect()
    const label = node.querySelector('.command-parameter-label').getBoundingClientRect()
    const value = node.querySelector('.command-parameter-value').getBoundingClientRect()
    return {
      height: card.height,
      label: { x: label.x, right: label.right, y: label.y, bottom: label.bottom },
      value: { x: value.x, y: value.y },
    }
  })
  if (inline) {
    expect(boxes.height).toBeLessThan(85)
    expect(boxes.value.x).toBeGreaterThan(boxes.label.right)
    expect(Math.abs(boxes.value.y - boxes.label.y)).toBeLessThan(12)
  } else {
    expect(boxes.height).toBeLessThan(110)
    expect(boxes.value.y).toBeGreaterThan(boxes.label.bottom)
  }
  return boxes
}
try {
  await launch()
  await page
    .locator('.sidebar-footer')
    .getByRole('button', { name: 'Plugins', exact: false })
    .click()
  await expect(page.getByText('No plugins enabled', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Manage plugins', exact: true }).click()
  await expect(
    page
      .locator('.plugin-card')
      .filter({ has: page.getByRole('switch', { name: 'Enable command builder', exact: true }) })
      .locator('.plugin-commands'),
  ).not.toHaveAttribute('open', '')
  await page
    .locator('.plugin-card')
    .filter({ has: page.getByRole('switch', { name: 'Enable command builder', exact: true }) })
    .locator('summary')
    .click()
  await expect(
    page
      .locator('.plugin-card')
      .filter({ has: page.getByRole('switch', { name: 'Enable command builder', exact: true }) })
      .locator('.plugin-commands'),
  ).toContainText('/commands')
  await expect(
    page
      .locator('.plugin-card')
      .filter({ has: page.getByRole('switch', { name: 'Enable command builder', exact: true }) })
      .locator('.plugin-commands-heading'),
  ).toHaveText('Commands1')
  await page.getByRole('switch', { name: 'Enable command builder' }).click()
  await expect(
    page
      .locator('.plugin-card')
      .filter({ has: page.getByRole('switch', { name: 'Enable command builder', exact: true }) })
      .locator('.plugin-commands-heading'),
  ).toHaveText('Commands1')
  await expect(
    page
      .locator('.plugin-card')
      .filter({ has: page.getByRole('switch', { name: 'Enable command builder', exact: true }) })
      .getByText('Enabled', { exact: true }),
  ).toHaveCount(0)
  await page.screenshot({ path: path.join(output, 'settings-commands-light-en.png') })
  await page
    .locator('.plugin-settings .plugin-card')
    .filter({ has: page.getByRole('switch', { name: 'Enable command builder', exact: true }) })
    .getByRole('button', { name: 'Configure', exact: true })
    .click()
  await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toHaveCount(0)
  await expect(page.locator('.plugin-configuration')).toBeVisible()
  await expect(page.locator('.plugin-configuration select')).toHaveCount(0)
  await expect(page.locator('.tabs .tab')).toHaveCount(2)
  // The catalog and parameter outline are visible without opening choice menus.
  await expect(page.locator('.plugin-tool-list')).toBeVisible()
  await expect(page.locator('.plugin-tool-list button')).toHaveCount(9)
  await expect(page.locator('.plugin-parameter-list button')).toHaveCount(nmapParameterCount)
  await expect(page.getByRole('button', { name: 'Import JSON', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Remove tool', exact: true })).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: 'Apply plugin settings', exact: true }),
  ).toBeDisabled()
  await page.getByRole('textbox', { name: 'Find a tool', exact: true }).fill('curl')
  await expect(page.locator('.plugin-tool-list button')).toHaveCount(1)
  await selectTool('curl')
  await expect(page.getByLabel('Executable', { exact: true })).toHaveValue('curl')
  await page.getByRole('textbox', { name: 'Find a tool', exact: true }).fill('')
  await selectTool('nmap')
  await page.getByRole('textbox', { name: 'Find a parameter', exact: true }).fill('Ports')
  await expect(
    page.locator('.plugin-parameter-list').getByText('Ports', { exact: true }),
  ).toBeVisible()
  await expect(
    page.locator('.plugin-parameter-list').getByText('Most common ports', { exact: true }),
  ).toBeVisible()
  await selectParameter('Ports')
  await expect(page.getByLabel('Flag', { exact: true })).toHaveValue('-p')
  await page.getByRole('textbox', { name: 'Find a parameter', exact: true }).fill('')
  await selectParameter('Scan technique')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(page.getByLabel('Flag', { exact: true })).toHaveValue('-p')
  await page.keyboard.press('Home')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: 'Value type', exact: true })).toHaveText('Choice')
  await saved()
  await page.screenshot({ path: path.join(output, 'configuration-parameters-light-en.png') })
  // Rare catalog actions live in a keyboard-accessible anchored menu.
  await page.getByRole('button', { name: 'Catalog actions', exact: true }).click()
  await expect(page.getByRole('menu', { name: 'Catalog actions', exact: true })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Import JSON', exact: true })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('menuitem', { name: 'Export JSON', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Catalog actions', exact: true })).toBeFocused()
  // Add/delete actions preserve the saved catalog until Apply.
  await page.getByRole('button', { name: 'Add tool', exact: true }).click()
  await expect(page.getByText('No parameters yet', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Add parameter', exact: true }).click()
  await parameterAction('Remove parameter')
  await expect(page.getByText('No parameters yet', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Tool actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Remove tool', exact: true }).click()
  await expect(page.locator('.plugin-tool-list button')).toHaveCount(9)
  await expect(
    page.getByRole('button', { name: 'Apply plugin settings', exact: true }),
  ).toBeDisabled()
  await page.getByRole('button', { name: 'Add tool', exact: true }).click()
  await page.getByLabel('Tool name', { exact: true }).fill('Audit helper')
  await page.getByLabel('Executable', { exact: true }).fill('audittool')
  await additionalSettings()
  await page.getByLabel('Subcommands', { exact: true }).pressSequentially('inspect files')
  await expect(page.getByLabel('Subcommands', { exact: true })).toHaveValue('inspect files')
  // App tab navigation retains unsaved tool fields.
  await page.locator('.tabs .tab-open').first().click()
  await page.locator('.tabs .tab-open').last().click()
  await expect(page.getByLabel('Tool name', { exact: true })).toHaveValue('Audit helper')
  await page.getByRole('button', { name: 'Output templates', exact: true }).click()
  await page.getByRole('button', { name: 'Add output template', exact: true }).click()
  await page.getByRole('textbox', { name: 'Template name', exact: true }).fill('Team format')
  await pick('Template shell', 'Both shells')
  await page.getByRole('textbox', { name: 'Command', exact: true }).fill('formatter')
  await page.getByRole('textbox', { name: 'Arguments · one per line', exact: true }).fill('')
  await page
    .getByRole('textbox', { name: 'Arguments · one per line', exact: true })
    .pressSequentially('a b\n--json')
  await page.getByRole('button', { name: 'Add output step', exact: true }).click()
  await page.getByRole('button', { name: 'Remove output step: 2', exact: true }).click()
  await page.screenshot({ path: path.join(output, 'output-editor-light-en.png') })
  await page.getByRole('button', { name: 'Add parameter', exact: true }).click()
  await page.getByLabel('Parameter label', { exact: true }).fill('Audit target')
  await additionalSettings()
  await pick('Argument position', 'Positional argument')
  await page.locator('.plugin-checks').getByLabel('Required', { exact: true }).check()
  await page.getByRole('button', { name: 'Add parameter', exact: true }).click()
  await page.getByLabel('Parameter label', { exact: true }).fill('Report file')
  await page.getByLabel('Flag', { exact: true }).fill('--output')
  await additionalSettings()
  await page
    .getByRole('textbox', { name: 'Suggestions: value | label, one per line', exact: true })
    .fill('team report.json | Team report')
  await page.getByRole('button', { name: 'Add parameter', exact: true }).click()
  await page.getByLabel('Parameter label', { exact: true }).fill('Audit mode')
  await page.getByLabel('Flag', { exact: true }).fill('--mode')
  await pick('Value type', 'Choice')
  await page
    .getByRole('textbox', { name: 'Choices: value | label, one per line', exact: true })
    .pressSequentially('fast | Fast\nslow | Slow')
  await expect(
    page.getByRole('textbox', { name: 'Choices: value | label, one per line', exact: true }),
  ).toHaveValue('fast | Fast\nslow | Slow')
  await parameterAction('Move parameter up')
  await page.getByRole('button', { name: 'Apply plugin settings', exact: true }).click()
  await saved()
  await page.getByRole('button', { name: 'Tool details', exact: true }).click()
  await additionalSettings()
  await page.getByLabel('Subcommands', { exact: true }).fill('discarded command')
  await page.getByRole('button', { name: 'Discard draft', exact: true }).click()
  await additionalSettings()
  await expect(page.getByLabel('Subcommands', { exact: true })).toHaveValue('inspect files')
  const jsonFile = path.join(root, 'plugin.json')
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file })
  }, jsonFile)
  await catalogAction('Export JSON')
  await expect
    .poll(async () => {
      try {
        return JSON.parse(await fs.readFile(jsonFile, 'utf8')).tools.length
      } catch {
        return 0
      }
    })
    .toBe(10)
  const exported = JSON.parse(await fs.readFile(jsonFile, 'utf8'))
  expect(exported).toMatchObject({ schemaVersion: 1, pluginId: 'command-builder' })
  expect(exported).not.toHaveProperty('enabled')
  expect(exported).not.toHaveProperty('catalogRevision')
  expect(
    JSON.parse(await fs.readFile(snapshot, 'utf8')).plugins.commandBuilder.catalogRevision,
  ).toBe(3)
  expect(exported).not.toHaveProperty('pages')
  expect(exported.tools.at(-1).command).toEqual(['audittool', 'inspect', 'files'])
  await catalogAction('Edit JSON')
  await page.getByRole('textbox', { name: 'Plugin JSON', exact: true }).fill('{bad')
  await page.getByRole('button', { name: 'Apply plugin settings', exact: true }).click()
  await expect(page.locator('.plugin-error')).toBeVisible()
  expect(JSON.parse(await fs.readFile(snapshot, 'utf8')).plugins.commandBuilder.config).toEqual(
    exported,
  )
  await page.getByRole('button', { name: 'Discard draft', exact: true }).click()
  const invalidFile = path.join(root, 'invalid.json')
  await fs.writeFile(invalidFile, JSON.stringify({ ...exported, schemaVersion: 2 }))
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
  }, invalidFile)
  await catalogAction('Import JSON')
  await expect(page.locator('.toast')).toContainText('Invalid plugin JSON')
  expect(JSON.parse(await fs.readFile(snapshot, 'utf8')).plugins.commandBuilder.config).toEqual(
    exported,
  )
  const imported = structuredClone(exported)
  imported.tools.at(-1).name = 'Imported helper'
  imported.tools.at(-1).id = 'constructor'
  imported.tools.at(-1).parameters.find((p) => p.label === 'Audit target').id = 'name'
  await fs.writeFile(jsonFile, JSON.stringify(imported))
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
  }, jsonFile)
  await catalogAction('Import JSON')
  await expect(page.getByRole('textbox', { name: 'Plugin JSON', exact: true })).toContainText(
    'Imported helper',
  )
  expect(JSON.parse(await fs.readFile(snapshot, 'utf8')).plugins.commandBuilder.config).toEqual(
    exported,
  )
  await page.getByRole('button', { name: 'Apply plugin settings', exact: true }).click()
  await saved()
  await page.screenshot({ path: path.join(output, 'configuration-json-light-en.png') })
  // A delayed native import cannot replace a newer draft.
  await app.evaluate(({ dialog }) => {
    dialog.showOpenDialog = () =>
      new Promise((resolve) => {
        globalThis.resolvePluginImport = resolve
      })
  })
  await catalogAction('Import JSON')
  await expect
    .poll(() => app.evaluate(() => typeof globalThis.resolvePluginImport))
    .toBe('function')
  await page.getByRole('textbox', { name: 'Plugin JSON', exact: true }).fill('{newer draft}')
  await app.evaluate(
    (_electron, file) => globalThis.resolvePluginImport({ canceled: false, filePaths: [file] }),
    jsonFile,
  )
  await expect(page.locator('.toast')).toContainText('Settings changed while importing')
  await expect(page.getByRole('textbox', { name: 'Plugin JSON', exact: true })).toHaveValue(
    '{newer draft}',
  )
  expect(JSON.parse(await fs.readFile(snapshot, 'utf8')).plugins.commandBuilder.config).toEqual(
    imported,
  )
  await page.getByRole('button', { name: 'Discard draft', exact: true }).click()
  // A cancelled import or export never mutates the configuration.
  await app.evaluate(({ dialog }) => {
    dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] })
    dialog.showSaveDialog = async () => ({ canceled: true })
  })
  await catalogAction('Import JSON')
  await catalogAction('Export JSON')
  await catalogAction('Open command builder')
  await expect(page.locator('.tabs .tab')).toHaveCount(3)
  await expect(page.locator('.command-scroll .command-builder')).toBeVisible()
  await expect(page.locator('.command-builder select')).toHaveCount(0)
  await expect(page.locator('.command-tools-rail')).toHaveCount(0)
  await expect(page.locator('.command-tool-picker')).toHaveText('nmap')
  await expect(page.locator('.command-builder')).toHaveClass(/command-mode-simple/)
  const chainEnglish = await centeredChain()
  await expect(page.locator('.command-parameter-label small')).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: 'Targets', exact: true })).toHaveAttribute(
    'aria-required',
    'true',
  )
  await page.getByRole('button', { name: 'Parameter help: Targets', exact: true }).click()
  await expect(
    page.getByRole('dialog', { name: 'Parameter help: Targets', exact: true }),
  ).toContainText('One host or network per line')
  const helpSize = await page.locator('.command-help-popover').boundingBox()
  expect(helpSize.width).toBeLessThanOrEqual(240)
  expect(helpSize.height).toBeLessThan(66)
  await page.screenshot({ path: path.join(output, 'builder-help-light-en.png') })
  await page.keyboard.press('Escape')
  await expect(
    page.getByRole('button', { name: 'Parameter help: Targets', exact: true }),
  ).toBeFocused()
  // Tool choices are a shared custom popover, including keyboard navigation and focus return.
  await page.getByRole('button', { name: 'Tool', exact: true }).click()
  await expect(page.getByRole('option')).toHaveCount(10)
  await expect(page.getByRole('option', { name: 'nmap', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(page.getByRole('option', { name: 'nmap', exact: true })).toBeFocused()
  expect(
    await page
      .getByRole('listbox', { name: 'Tool', exact: true })
      .evaluate((node) => node.closest('.popover').parentElement === document.body),
  ).toBe(true)
  await page.screenshot({ path: path.join(output, 'builder-tools-light-en.png') })
  await page.keyboard.press('End')
  await expect(page.getByRole('option', { name: 'Imported helper', exact: true })).toBeFocused()
  await page.keyboard.press('Home')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Tool', exact: true })).toBeFocused()
  // Clicking the name or its chevron opens the same selector; selecting a tool restores focus.
  await page.locator('.command-tool-picker > span').click()
  await page.getByRole('option', { name: 'curl', exact: true }).click()
  await expect(page.locator('.command-tool-picker')).toHaveText('curl')
  await expect(page.locator('.command-tool-picker')).toBeFocused()
  await page.locator('.command-tool-picker > svg').last().click()
  await page.getByRole('option', { name: 'nmap', exact: true }).click()
  await expect(page.locator('.command-tool-picker')).toBeFocused()
  await expect(
    page.locator(
      '.command-parameter-toolbar, .command-group-list, .command-search, .command-result .command-issues, .command-result > p',
    ),
  ).toHaveCount(0)
  await expect(page.locator('.command-fields input[type=checkbox]')).toHaveCount(0)
  await expect(page.locator('.command-fields .command-parameter')).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Reset parameters', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Copy command', exact: true })).toBeDisabled()
  await saved()
  await page.screenshot({ path: path.join(output, 'builder-simple-empty-light-en.png') })
  // Adding a block opens a bounded, portalled menu with keyboard focus return.
  await page.getByRole('button', { name: 'Add parameter', exact: true }).click()
  await expect(page.getByRole('menuitem')).toHaveCount(nmapParameterCount - 1)
  await expect(page.getByRole('menuitem', { name: 'Scan technique', exact: true })).toBeFocused()
  expect(
    await page
      .getByRole('menu', { name: 'Add parameter', exact: true })
      .evaluate((node) => node.closest('.popover').parentElement === document.body),
  ).toBe(true)
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('menuitem', { name: 'Ports', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Add parameter', exact: true })).toBeFocused()
  await page.getByRole('textbox', { name: 'Targets', exact: true }).fill('192.0.2.1')
  const compactTarget = await compactParameter('Targets')
  const targetLine = await page
    .getByRole('textbox', { name: 'Targets', exact: true })
    .evaluate((node) => {
      const style = getComputedStyle(node)
      return {
        height: node.getBoundingClientRect().height,
        extra:
          node.clientHeight -
          parseFloat(style.paddingTop) -
          parseFloat(style.paddingBottom) -
          parseFloat(style.lineHeight),
      }
    })
  expect(targetLine.height).toBe(34)
  expect(Math.abs(targetLine.extra)).toBeLessThan(1)
  // Configure from the builder itself must open/reuse the catalog tab and retain command values.
  await page
    .locator('.command-builder-heading')
    .getByRole('button', { name: 'Configure', exact: true })
    .click()
  await expect(page.locator('.plugin-configuration')).toBeVisible()
  await expect(page.locator('.tabs .tab')).toHaveCount(3)
  await catalogAction('Open command builder')
  await expect(page.getByRole('textbox', { name: 'Targets', exact: true })).toHaveValue('192.0.2.1')
  await pick('Extended output', 'TCP ports · comma-separated')
  await expect(page.locator('.command-result pre')).toHaveText(
    'nmap 192.0.2.1 | grep /tcp | cut -f1 -d/ | paste -s -d, -',
  )
  await page.getByRole('button', { name: 'Copy command', exact: true }).click()
  expect(await app.evaluate(() => globalThis.pluginCopied)).toBe(
    'nmap 192.0.2.1 | grep /tcp | cut -f1 -d/ | paste -s -d, -',
  )
  await builderMode('Advanced')
  await expect(page.locator('.command-result pre')).toContainText('| paste -s -d, -')
  await builderMode('Simple')
  await pick('Shell', 'PowerShell 7')
  await expect(page.getByRole('button', { name: 'Extended output', exact: true })).toHaveCount(0)
  await expect(page.locator('.command-result pre')).toHaveText('& nmap 192.0.2.1')
  await pick('Shell', 'Bash / Zsh')
  await expect(page.locator('.command-result pre')).toContainText('| paste -s -d, -')
  await pick('Extended output', 'Standard output')
  await addCommandParameter('Detect service versions')
  await expect(
    page.getByRole('group', { name: 'Detect service versions', exact: true }),
  ).toBeFocused()
  await addCommandParameter('Default scripts')
  await addCommandParameter('Skip host discovery')
  const toggleGroup = await page.locator('.command-toggle-group').evaluate((node) => ({
    dashed: getComputedStyle(node).borderStyle,
    height: node.getBoundingClientRect().height,
    chips: [...node.querySelectorAll('.command-toggle')].map((chip) => {
      const box = chip.getBoundingClientRect()
      return { x: box.x, right: box.right, y: box.y, height: box.height }
    }),
  }))
  expect(toggleGroup.dashed).toBe('dashed')
  expect(toggleGroup.height).toBeLessThan(120)
  expect(toggleGroup.chips).toHaveLength(3)
  for (const chip of toggleGroup.chips) expect(chip.height).toBeLessThan(45)
  expect(toggleGroup.chips[0].y).toBe(toggleGroup.chips[1].y)
  expect(toggleGroup.chips[0].right).toBeLessThan(toggleGroup.chips[1].x)
  await page.screenshot({ path: path.join(output, 'builder-toggle-group-light-en.png') })
  await page.getByRole('button', { name: 'Remove parameter: Default scripts', exact: true }).click()
  await page
    .getByRole('button', { name: 'Remove parameter: Skip host discovery', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'Remove parameter: Detect service versions', exact: true })
    .click()
  await expect(page.locator('.command-toggle-group')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Add parameter', exact: true })).toBeFocused()
  await addCommandParameter('Detect service versions')
  await addCommandParameter('Ports')
  await expect(page.getByRole('textbox', { name: 'Ports', exact: true })).toBeFocused()
  await expect(page.getByRole('button', { name: 'Copy command', exact: true })).toBeDisabled()
  await page.getByRole('textbox', { name: 'Ports', exact: true }).fill('80,443')
  await compactParameter('Ports')
  await addCommandParameter('Timing template')
  await expect(page.getByRole('button', { name: 'Timing template', exact: true })).toBeFocused()
  const compactChoice = await compactParameter('Timing template')
  await page.getByRole('button', { name: 'Timing template', exact: true }).click()
  await expect(page.getByRole('listbox')).toBeVisible()
  await page.getByRole('option', { name: '3 · Normal', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: 'Timing template', exact: true })).toBeFocused()
  await expect(page.locator('.command-result pre')).toHaveText('nmap -p 80,443 -sV -T3 192.0.2.1')
  await page.getByRole('button', { name: 'Copy command', exact: true }).click()
  expect(await app.evaluate(() => globalThis.pluginCopied)).toBe('nmap -p 80,443 -sV -T3 192.0.2.1')
  await expect(page.locator('.command-fields code')).toHaveCount(0)
  await centeredChain()
  await page.locator('.command-fields').evaluate((node) => {
    node.scrollTop = 0
  })
  await page.screenshot({ path: path.join(output, 'builder-simple-light-en.png') })
  await page.getByRole('button', { name: 'Remove parameter: Ports', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Ports', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Add parameter', exact: true })).toBeFocused()
  await addCommandParameter('Ports')
  await expect(page.getByRole('textbox', { name: 'Ports', exact: true })).toHaveValue('80,443')
  await addCommandParameter('Most common ports')
  await expect(page.getByRole('textbox', { name: 'Ports', exact: true })).toHaveCount(0)
  await page.getByRole('textbox', { name: 'Most common ports', exact: true }).fill('100')
  await addCommandParameter('Comprehensive scan')
  await addCommandParameter('NSE scripts')
  await page
    .getByRole('button', { name: 'Quick choice: NSE scripts', exact: true })
    .press('ArrowDown')
  await expect(page.getByRole('option', { name: 'Default scripts', exact: true })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await expect(
    page.getByRole('option', { name: 'Vulnerability checks · vuln', exact: true }),
  ).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('textbox', { name: 'NSE scripts', exact: true })).toHaveValue('vuln')
  await expect(page.getByRole('textbox', { name: 'NSE scripts', exact: true })).toBeFocused()
  await expect(page.locator('.command-result pre')).toHaveText(
    'nmap --top-ports 100 -sV -A --script vuln -T3 192.0.2.1',
  )
  await page.getByRole('button', { name: 'Extended output', exact: true }).click()
  await expect(page.getByRole('option').nth(1)).toHaveText('NSE · results with hosts and ports')
  await expect(page.getByRole('option', { name: 'NSE · results only', exact: true })).toBeVisible()
  await expect(
    page.getByRole('option', { name: 'NSE · scripts with results', exact: true }),
  ).toBeVisible()
  await page.screenshot({ path: path.join(output, 'nse-output-menu-light-en.png') })
  await page
    .getByRole('option', { name: 'NSE · results with hosts and ports', exact: true })
    .click()
  await expect(page.locator('.command-result pre')).toContainText('--script vuln')
  await expect(page.locator('.command-result pre')).toContainText('| awk ')
  await expect(page.locator('.command-result pre')).toContainText('Host) script results:')
  await pick('Extended output', 'Standard output')
  await page.screenshot({ path: path.join(output, 'nmap-expanded-light-en.png') })
  await page
    .getByRole('textbox', { name: 'NSE scripts', exact: true })
    .fill('(default or safe) and not http-*')
  await expect(page.locator('.command-result pre')).toContainText(
    "--script '(default or safe) and not http-*'",
  )
  await addCommandParameter('Default scripts')
  await expect(page.getByRole('textbox', { name: 'NSE scripts', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Remove parameter: Default scripts', exact: true }).click()
  await page
    .getByRole('button', { name: 'Remove parameter: Comprehensive scan', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'Remove parameter: Most common ports', exact: true })
    .click()
  await addCommandParameter('Ports')
  await expect(page.getByRole('textbox', { name: 'Ports', exact: true })).toHaveValue('80,443')
  await builderMode('Advanced')
  await expect(page.locator('.command-tool-picker')).toHaveCount(0)
  await expect(page.locator('.command-tool-list button')).toHaveCount(10)
  await expect(page.getByRole('checkbox', { name: 'Ports', exact: true })).toBeChecked()
  await expect(page.getByRole('textbox', { name: 'Targets', exact: true })).toHaveValue('192.0.2.1')
  const dockBefore = await page.locator('.command-result').boundingBox()
  await page.locator('.command-fields').evaluate((node) => {
    node.scrollTop = node.scrollHeight
  })
  expect(await page.locator('.command-result').boundingBox()).toEqual(dockBefore)
  expect(
    await page.locator('.command-scroll').evaluate((node) => ({
      horizontal: node.scrollWidth > node.clientWidth,
      vertical: node.scrollHeight > node.clientHeight,
    })),
  ).toEqual({ horizontal: false, vertical: false })
  await page.locator('.command-fields').evaluate((node) => {
    node.scrollTop = 0
  })
  await page.screenshot({ path: path.join(output, 'builder-advanced-light-en.png') })
  // Mixed descriptions, inputs, choices and repeatable fields have equal card heights.
  await builderMode('Simple')
  await selectBuilderTool('ffuf')
  await page
    .getByRole('textbox', { name: 'Target URL', exact: true })
    .fill('https://example.com/FUZZ')
  await page.getByRole('button', { name: 'Quick choice: Wordlist', exact: true }).click()
  await expect(page.getByRole('option')).toHaveCount(4)
  await page.screenshot({ path: path.join(output, 'wordlists-light-en.png') })
  await page.getByRole('option', { name: 'DIRB · common', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Wordlist', exact: true })).toBeFocused()
  await expect(page.getByRole('textbox', { name: 'Wordlist', exact: true })).toHaveValue(
    '/usr/share/wordlists/dirb/common.txt',
  )
  await expect(page.locator('.command-result pre')).toHaveText(
    'ffuf -u https://example.com/FUZZ -w /usr/share/wordlists/dirb/common.txt',
  )
  await compactParameter('Wordlist')
  await page
    .getByRole('textbox', { name: 'Wordlist', exact: true })
    .fill('/my custom/list.txt\n/another/list.txt')
  await expect(page.locator('.command-result pre')).toHaveText(
    "ffuf -u https://example.com/FUZZ -w '/my custom/list.txt' -w /another/list.txt",
  )
  await builderMode('Advanced')
  await selectBuilderTool('hashcat')
  const heights = await page
    .locator('.command-required .command-parameter')
    .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height))
  expect(heights).toHaveLength(4)
  expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(1)
  await page.getByRole('textbox', { name: 'Hash type', exact: true }).fill('invalid')
  await page.getByRole('textbox', { name: 'Hash file', exact: true }).focus()
  await expect(page.getByRole('textbox', { name: 'Hash type', exact: true })).toHaveAttribute(
    'aria-invalid',
    'true',
  )
  await expect(page.getByText('Enter a number', { exact: true })).toBeVisible()
  await page.getByRole('textbox', { name: 'Hash type', exact: true }).fill('0')
  await page.screenshot({ path: path.join(output, 'hashcat-advanced-light-en.png') })
  await builderMode('Simple')
  const blockHeights = await page
    .locator('.command-block-chain .command-parameter')
    .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height))
  expect(blockHeights).toHaveLength(4)
  for (const height of blockHeights) expect(height).toBeLessThan(85)
  await page.getByRole('textbox', { name: 'Hash type', exact: true }).fill('invalid')
  await page.getByRole('textbox', { name: 'Hash file', exact: true }).focus()
  await expect(page.getByText('Enter a number', { exact: true })).toBeVisible()
  await compactParameter('Hash type')
  await page.getByRole('textbox', { name: 'Hash type', exact: true }).fill('0')
  await page.screenshot({ path: path.join(output, 'hashcat-simple-light-en.png') })
  await selectBuilderTool('nmap')
  await page.locator('.tabs .tab-open').first().click()
  await expect(page.locator('.page-title')).toBeVisible()
  await page.locator('.tabs .tab-open').last().click()
  await expect(page.getByRole('textbox', { name: 'Targets', exact: true })).toHaveValue('192.0.2.1')
  // Advanced tool navigation retains search and keyboard selection.
  await builderMode('Advanced')
  await page.getByRole('textbox', { name: 'Find a tool', exact: true }).fill('curl')
  await expect(page.locator('.command-tool-list button')).toHaveCount(1)
  await selectBuilderTool('curl')
  await page.getByRole('textbox', { name: 'Find a tool', exact: true }).fill('')
  await selectBuilderTool('nmap')
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await expect(page.locator('.command-tool-heading h2')).toHaveText('Imported helper')
  await page.keyboard.press('Home')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('textbox', { name: 'Ports', exact: true })).toHaveValue('80,443')
  await builderMode('Simple')
  await expect(page.locator('.command-tools-rail')).toHaveCount(0)
  await expect(page.locator('.command-tool-picker')).toHaveText('nmap')
  await selectBuilderTool('curl')
  await page
    .getByRole('textbox', { name: 'Target URL', exact: true })
    .fill('https://example.com?a=1&b=2')
  await addCommandParameter('Headers')
  await page.getByRole('textbox', { name: 'Headers', exact: true }).fill('X-One: a b\nX-Two: value')
  await pick('Shell', 'PowerShell 7')
  await expect(page.locator('.command-result pre')).toHaveText(
    "& curl.exe -H 'X-One: a b' -H 'X-Two: value' 'https://example.com?a=1&b=2'",
  )
  await selectBuilderTool('nmap')
  await expect(page.getByRole('textbox', { name: 'Targets', exact: true })).toHaveValue('192.0.2.1')
  await selectBuilderTool('curl')
  await expect(page.getByRole('textbox', { name: 'Headers', exact: true })).toHaveValue(
    'X-One: a b\nX-Two: value',
  )
  await selectBuilderTool('hydra')
  await addCommandParameter('Login')
  await page.getByRole('textbox', { name: 'Login', exact: true }).fill('user')
  await addCommandParameter('Login list')
  await expect(page.getByRole('textbox', { name: 'Login', exact: true })).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: 'Login list', exact: true })).toBeFocused()
  await page.getByRole('textbox', { name: 'Login list', exact: true }).fill('/path/users.txt')
  await builderMode('Advanced')
  await expect(page.getByRole('checkbox', { name: 'Login', exact: true })).not.toBeChecked()
  await expect(page.getByRole('checkbox', { name: 'Login list', exact: true })).toBeChecked()
  await builderMode('Simple')
  await selectBuilderTool('Imported helper')
  await page.getByRole('textbox', { name: 'Audit target', exact: true }).fill('192.0.2.8')
  await addCommandParameter('Report file')
  await page.getByRole('button', { name: 'Quick choice: Report file', exact: true }).click()
  await page.getByRole('option', { name: 'Team report', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Report file', exact: true })).toHaveValue(
    'team report.json',
  )
  await page.getByRole('textbox', { name: 'Report file', exact: true }).fill('my report.json')
  await addCommandParameter('Audit mode')
  await pick('Audit mode', 'Fast')
  await expect(page.locator('.command-result pre')).toHaveText(
    "& audittool inspect files --mode fast --output 'my report.json' 192.0.2.8",
  )
  await pick('Extended output', 'Team format')
  await expect(page.locator('.command-result pre')).toContainText("| & formatter 'a b' --json")
  await pick('Extended output', 'Standard output')
  await expect(page.getByRole('button', { name: 'Add parameter', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Remove parameter: Report file', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Add parameter', exact: true })).toBeFocused()
  await addCommandParameter('Report file')
  await expect(page.getByRole('textbox', { name: 'Report file', exact: true })).toHaveValue(
    'my report.json',
  )
  await catalogAction('Reset parameters', 'Command actions')
  await expect(page.getByRole('button', { name: 'Copy command', exact: true })).toBeDisabled()
  await saved()
  expect(JSON.parse(await fs.readFile(snapshot, 'utf8')).pages).toEqual(originalPages)
  await close()
  await launch()
  await expect(page.locator('.command-scroll .command-builder')).toBeVisible()
  expect(JSON.parse(await fs.readFile(snapshot, 'utf8')).plugins.commandBuilder.config).toEqual(
    imported,
  )
  await settings()
  await page.getByRole('switch', { name: 'Enable command builder' }).click()
  await saved()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.locator('.tabs .tab')).toHaveCount(2)
  await expect(page.locator('.plugin-configuration')).toBeVisible()
  await expect(page.locator('.command-scroll')).toHaveCount(0)
  await close()
  await launch()
  await settings()
  await expect(page.getByRole('switch', { name: 'Enable command builder' })).toHaveAttribute(
    'aria-checked',
    'false',
  )
  await page.getByRole('switch', { name: 'Enable command builder' }).click()
  await page
    .locator('.plugin-settings .plugin-card')
    .filter({ has: page.getByRole('switch', { name: 'Enable command builder', exact: true }) })
    .getByRole('button', { name: 'Configure', exact: true })
    .click()
  await expect(page.locator('.tabs .tab')).toHaveCount(2)
  await page.screenshot({ path: path.join(output, 'configuration-tools-light-en.png') })
  await settings()
  await page.getByRole('tab', { name: 'General', exact: true }).click()
  await page.getByRole('button', { name: 'Dark', exact: true }).click()
  await page.getByRole('button', { name: 'Русский', exact: true }).click()
  await page.getByRole('tab', { name: 'Плагины', exact: true }).click()
  await page
    .locator('.plugin-settings .plugin-card')
    .filter({ has: page.getByRole('switch', { name: 'Включить конструктор команд', exact: true }) })
    .getByRole('button', { name: 'Настроить', exact: true })
    .click()
  await expect(page.getByRole('dialog', { name: 'Настройки', exact: true })).toHaveCount(0)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 760))
  await selectTool('nmap')
  await selectParameter('Метод сканирования')
  expect(
    await page.locator('.plugin-configuration-scroll').evaluate((node) => ({
      horizontalOverflow: node.scrollWidth > node.clientWidth,
      verticalOverflow: node.scrollHeight > node.clientHeight,
    })),
  ).toEqual({ horizontalOverflow: false, verticalOverflow: false })
  await page.screenshot({ path: path.join(output, 'configuration-parameters-dark-ru.png') })
  await page.getByRole('button', { name: 'Тип значения', exact: true }).click()
  const bounds = await page.getByRole('listbox').evaluate((node) => {
    const box = node.closest('.popover').getBoundingClientRect()
    return {
      x: box.x,
      y: box.y,
      right: box.right,
      bottom: box.bottom,
      width: innerWidth,
      height: innerHeight,
    }
  })
  expect(bounds.x).toBeGreaterThanOrEqual(0)
  expect(bounds.y).toBeGreaterThanOrEqual(0)
  expect(bounds.right).toBeLessThanOrEqual(bounds.width)
  expect(bounds.bottom).toBeLessThanOrEqual(bounds.height)
  await page.screenshot({ path: path.join(output, 'configuration-picker-dark-ru.png') })
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Тип значения', exact: true })).toBeFocused()
  await catalogAction('Открыть конструктор команд', 'Действия с каталогом')
  await page.getByRole('textbox', { name: 'Цели', exact: true }).fill('192.0.2.1')
  await addCommandParameter('Определять версии служб', 'Добавить параметр')
  await addCommandParameter('Шаблон скорости', 'Добавить параметр')
  await page.getByRole('button', { name: 'Шаблон скорости', exact: true }).click()
  const commandPickerBounds = await page.getByRole('listbox').evaluate((node) => {
    const box = node.closest('.popover').getBoundingClientRect()
    return {
      x: box.x,
      y: box.y,
      right: box.right,
      bottom: box.bottom,
      width: innerWidth,
      height: innerHeight,
    }
  })
  expect(commandPickerBounds.x).toBeGreaterThanOrEqual(0)
  expect(commandPickerBounds.y).toBeGreaterThanOrEqual(0)
  expect(commandPickerBounds.right).toBeLessThanOrEqual(commandPickerBounds.width)
  expect(commandPickerBounds.bottom).toBeLessThanOrEqual(commandPickerBounds.height)
  await page.screenshot({ path: path.join(output, 'builder-picker-dark-ru.png') })
  await page.getByRole('option', { name: '3 · Обычный', exact: true }).click()

  expect(
    await page.locator('.command-scroll').evaluate((node) => ({
      horizontal: node.scrollWidth > node.clientWidth,
      vertical: node.scrollHeight > node.clientHeight,
    })),
  ).toEqual({ horizontal: false, vertical: false })
  await expect(
    page.getByRole('button', { name: 'Копировать команду', exact: true }),
  ).toBeInViewport()
  await page.screenshot({ path: path.join(output, 'builder-dark-ru.png') })
  const chainRussian = await centeredChain()
  await page.getByRole('button', { name: 'Подсказка к параметру: Цели', exact: true }).click()
  const russianHelpSize = await page.locator('.command-help-popover').boundingBox()
  expect(russianHelpSize.width).toBeLessThanOrEqual(240)
  expect(russianHelpSize.height).toBeLessThan(66)
  await page.screenshot({ path: path.join(output, 'builder-help-dark-ru.png') })
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Инструмент', exact: true }).click()
  const toolPickerBounds = await page
    .getByRole('listbox', { name: 'Инструмент', exact: true })
    .evaluate((node) => {
      const box = node.closest('.popover').getBoundingClientRect()
      return {
        x: box.x,
        y: box.y,
        right: box.right,
        bottom: box.bottom,
        width: innerWidth,
        height: innerHeight,
      }
    })
  expect(toolPickerBounds.x).toBeGreaterThanOrEqual(0)
  expect(toolPickerBounds.y).toBeGreaterThanOrEqual(0)
  expect(toolPickerBounds.right).toBeLessThanOrEqual(toolPickerBounds.width)
  expect(toolPickerBounds.bottom).toBeLessThanOrEqual(toolPickerBounds.height)
  await page.screenshot({ path: path.join(output, 'builder-tools-dark-ru.png') })
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Инструмент', exact: true })).toBeFocused()
  // New field and output popovers remain bounded and keyboard-accessible in a narrow dark window.
  async function boundedPopover(locator) {
    const box = await locator.evaluate((node) => {
      const rect = node.closest('.popover').getBoundingClientRect()
      return {
        x: rect.x,
        y: rect.y,
        right: rect.right,
        bottom: rect.bottom,
        width: innerWidth,
        height: innerHeight,
      }
    })
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.right).toBeLessThanOrEqual(box.width)
    expect(box.bottom).toBeLessThanOrEqual(box.height)
  }
  await page.getByRole('button', { name: 'Расширенный вывод', exact: true }).click()
  await boundedPopover(page.getByRole('listbox', { name: 'Расширенный вывод', exact: true }))
  await page.screenshot({ path: path.join(output, 'output-menu-dark-ru.png') })
  await page.getByRole('option', { name: 'TCP-порты через запятую', exact: true }).click()
  await expect(page.locator('.command-result pre')).toContainText('| paste -s -d, -')
  await pick('Расширенный вывод', 'Стандартный вывод')
  await selectBuilderTool('ffuf')
  await page.getByRole('button', { name: 'Быстрый выбор: Словарь', exact: true }).click()
  await boundedPopover(page.getByRole('listbox', { name: 'Быстрый выбор: Словарь', exact: true }))
  await page.keyboard.press('End')
  await expect(page.getByRole('option', { name: 'SecLists · common', exact: true })).toBeFocused()
  await page.screenshot({ path: path.join(output, 'wordlists-dark-ru.png') })
  await page.keyboard.press('Escape')
  await expect(
    page.getByRole('button', { name: 'Быстрый выбор: Словарь', exact: true }),
  ).toBeFocused()
  await page.getByRole('button', { name: 'Подсказка к параметру: Словарь', exact: true }).click()
  const help = page.getByRole('dialog', { name: 'Подсказка к параметру: Словарь', exact: true })
  await boundedPopover(help)
  await expect(help).toContainText('Пути Kali')
  await page.screenshot({ path: path.join(output, 'wordlist-help-dark-ru.png') })
  await page.keyboard.press('Escape')
  await selectBuilderTool('nmap')
  // A wider application sidebar reduces the field area and naturally stacks compact editors.
  await page.locator('.sidebar-resizer').focus()
  await page.keyboard.press('End')
  await expect(page.locator('.sidebar-resizer')).toHaveAttribute('aria-valuenow', '420')
  const narrowChoice = await compactParameter('Шаблон скорости', false)
  await compactParameter('Цели', false)
  await centeredChain()
  expect(
    await page.locator('.command-fields').evaluate((node) => node.scrollWidth > node.clientWidth),
  ).toBe(false)
  await page.screenshot({ path: path.join(output, 'builder-stacked-dark-ru.png') })
  await page.locator('.sidebar-resizer').dblclick()
  await expect(page.locator('.sidebar-resizer')).toHaveAttribute('aria-valuenow', '252')
  await compactParameter('Шаблон скорости')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 600))
  await page
    .getByRole('textbox', { name: 'Цели', exact: true })
    .fill(Array.from({ length: 40 }, (_, i) => `192.0.2.${i + 1}`).join('\n'))
  expect(
    await page
      .locator('.command-result pre')
      .evaluate((node) => node.scrollHeight > node.clientHeight),
  ).toBe(true)
  expect(
    await page.locator('.command-fields').evaluate((node) => node.clientHeight),
  ).toBeGreaterThan(120)
  await expect(
    page.getByRole('button', { name: 'Копировать команду', exact: true }),
  ).toBeInViewport()
  expect(
    await page
      .locator('.command-scroll')
      .evaluate(
        (node) => node.scrollWidth > node.clientWidth || node.scrollHeight > node.clientHeight,
      ),
  ).toBe(false)
  await page.screenshot({ path: path.join(output, 'builder-compact-dark-ru.png') })
  await page.getByRole('button', { name: 'Добавить параметр', exact: true }).click()
  const compactMenuBounds = await page
    .getByRole('menu', { name: 'Добавить параметр', exact: true })
    .evaluate((node) => {
      const box = node.closest('.popover').getBoundingClientRect()
      return {
        x: box.x,
        y: box.y,
        right: box.right,
        bottom: box.bottom,
        width: innerWidth,
        height: innerHeight,
      }
    })
  expect(compactMenuBounds.x).toBeGreaterThanOrEqual(0)
  expect(compactMenuBounds.y).toBeGreaterThanOrEqual(0)
  expect(compactMenuBounds.right).toBeLessThanOrEqual(compactMenuBounds.width)
  expect(compactMenuBounds.bottom).toBeLessThanOrEqual(compactMenuBounds.height)
  await page.screenshot({ path: path.join(output, 'builder-add-compact-dark-ru.png') })
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Добавить параметр', exact: true })).toBeFocused()
  await page.getByRole('textbox', { name: 'Цели', exact: true }).fill('192.0.2.1')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 760))
  await page
    .locator('.sidebar-footer')
    .getByRole('button', { name: 'Плагины', exact: false })
    .click()
  await page.screenshot({ path: path.join(output, 'builder-menu-dark-ru.png') })
  await expect(
    page.locator('.plugins-menu').getByRole('button', { name: 'Конструктор команд', exact: true }),
  ).toBeVisible()
  await page.keyboard.press('Escape')
  // Show the redesigned editor in the user's light Russian presentation too.
  await page
    .locator('.sidebar-footer')
    .getByRole('button', { name: 'Настройки', exact: true })
    .click()
  await page.getByRole('tab', { name: 'Общие', exact: true }).click()
  await page.getByRole('button', { name: 'Светлая', exact: true }).click()
  await page.getByRole('tab', { name: 'Плагины', exact: true }).click()
  await page
    .locator('.plugin-settings .plugin-card')
    .filter({ has: page.getByRole('switch', { name: 'Включить конструктор команд', exact: true }) })
    .getByRole('button', { name: 'Настроить', exact: true })
    .click()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 960))
  await selectTool('nmap')
  await selectParameter('Метод сканирования')
  await saved()
  await page.screenshot({ path: path.join(output, 'configuration-parameters-light-ru.png') })
  await catalogAction('Открыть конструктор команд', 'Действия с каталогом')
  await addCommandParameter('Порты', 'Добавить параметр')
  await page.getByRole('textbox', { name: 'Порты', exact: true }).fill('80,443')

  await expect(page.locator('.command-result pre')).toHaveText('nmap -p 80,443 -sV -T3 192.0.2.1')
  await saved()
  await centeredChain()
  await page.locator('.command-fields').evaluate((node) => {
    node.scrollTop = 0
  })
  await page.screenshot({ path: path.join(output, 'builder-simple-light-ru.png') })
  await addCommandParameter('Скрипты по умолчанию', 'Добавить параметр')
  await addCommandParameter('Пропустить поиск узлов', 'Добавить параметр')
  await expect(page.locator('.command-toggle-group .command-toggle')).toHaveCount(3)
  expect(
    await page
      .locator('.command-toggle-group')
      .evaluate((node) => node.scrollWidth > node.clientWidth),
  ).toBe(false)
  await page.locator('.command-fields').evaluate((node) => {
    node.scrollTop = 0
  })
  await page.screenshot({ path: path.join(output, 'builder-toggle-group-light-ru.png') })
  await page
    .getByRole('button', { name: 'Удалить параметр: Скрипты по умолчанию', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'Удалить параметр: Пропустить поиск узлов', exact: true })
    .click()
  await builderMode('Расширенный')
  await page.screenshot({ path: path.join(output, 'builder-advanced-light-ru.png') })
  await selectBuilderTool('hashcat')
  const localizedHeights = await page
    .locator('.command-required .command-parameter')
    .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height))
  expect(localizedHeights).toHaveLength(4)
  expect(Math.max(...localizedHeights) - Math.min(...localizedHeights)).toBeLessThan(1)
  await page.screenshot({ path: path.join(output, 'hashcat-advanced-light-ru.png') })
  await builderMode('Простой')
  await page.screenshot({ path: path.join(output, 'hashcat-simple-light-ru.png') })
  await page.getByRole('button', { name: 'Быстрый выбор: Словарь или маска', exact: true }).click()
  await expect(
    page.getByRole('option', { name: 'RockYou · после распаковки', exact: true }),
  ).toBeVisible()
  await page.screenshot({ path: path.join(output, 'wordlists-rockyou-light-ru.png') })
  await page.getByRole('option', { name: 'RockYou · после распаковки', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Словарь или маска', exact: true })).toHaveValue(
    '/usr/share/wordlists/rockyou.txt',
  )
  await page
    .getByRole('button', { name: 'Подсказка к параметру: Словарь или маска', exact: true })
    .click()
  await expect(
    page.getByRole('dialog', { name: 'Подсказка к параметру: Словарь или маска', exact: true }),
  ).toContainText('распакуйте rockyou.txt.gz')
  await page.keyboard.press('Escape')
  await selectBuilderTool('nmap')
  // The add menu remains within the viewport at the bottom of the scrolled field area.
  await page.getByRole('button', { name: 'Добавить параметр', exact: true }).click()
  const addBounds = await page
    .getByRole('menu', { name: 'Добавить параметр', exact: true })
    .evaluate((node) => {
      const box = node.closest('.popover').getBoundingClientRect()
      return {
        x: box.x,
        y: box.y,
        right: box.right,
        bottom: box.bottom,
        width: innerWidth,
        height: innerHeight,
      }
    })
  expect(addBounds.x).toBeGreaterThanOrEqual(0)
  expect(addBounds.y).toBeGreaterThanOrEqual(0)
  expect(addBounds.right).toBeLessThanOrEqual(addBounds.width)
  expect(addBounds.bottom).toBeLessThanOrEqual(addBounds.height)
  await page.screenshot({ path: path.join(output, 'builder-add-light-ru.png') })
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Оболочка', exact: true }).click()
  await page.screenshot({ path: path.join(output, 'builder-shell-light-ru.png') })
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Оболочка', exact: true })).toBeFocused()
  await page
    .locator('.sidebar-footer')
    .getByRole('button', { name: 'Настройки', exact: true })
    .click()
  await page.getByRole('tab', { name: 'Общие', exact: true }).click()
  await page.getByRole('button', { name: 'Тёмная', exact: true }).click()
  await page.getByRole('button', { name: 'English', exact: true }).click()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await saved()
  await page.screenshot({ path: path.join(output, 'builder-dark-en.png') })
  await builderMode('Advanced')
  await page.screenshot({ path: path.join(output, 'builder-advanced-dark-en.png') })
  await builderMode('Simple')
  await page
    .locator('.sidebar-footer')
    .getByRole('button', { name: 'Settings', exact: true })
    .click()
  await page.getByRole('tab', { name: 'General', exact: true }).click()
  await page.getByRole('button', { name: 'Light', exact: true }).click()
  await page.getByRole('button', { name: 'Русский', exact: true }).click()
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click()
  await saved()
  const final = JSON.parse(await fs.readFile(snapshot, 'utf8'))
  expect(final.pages).toEqual(originalPages)
  expect(final.plugins.commandBuilder.config).toEqual(imported)
  expect(final.ui.tabs).toContain('plugin:command-builder')
  expect(final.ui.tabs).toContain('plugin:command-builder-settings')
  // The advertised slash shortcut opens the existing plugin tab and leaves note content intact.
  await page.locator('.tabs .tab-open').first().click()
  const tabCount = await page.locator('.tabs .tab').count()
  await page.locator('.document-editor').evaluate((element) => {
    const editor = element.editor
    editor
      .chain()
      .focus()
      .setTextSelection(editor.state.doc.content.size - 1)
      .run()
  })
  await expect(page.locator('.document-editor')).toBeFocused()
  await page.keyboard.type('/commands')
  await expect(page.locator('.command-palette')).toBeVisible()
  await page.getByRole('option', { name: 'Конструктор команд', exact: false }).click()
  await expect(page.locator('.command-builder')).toBeVisible()
  expect(await page.locator('.tabs .tab').count()).toBe(tabCount)
  await page.locator('.tabs .tab-open').first().click()
  expect(
    await page.locator('.document-editor').evaluate((element) => element.editor.getJSON()),
  ).toEqual(originalPages[0].content)
  await page
    .locator('.sidebar-footer')
    .getByRole('button', { name: 'Настройки', exact: true })
    .click()
  await page.getByRole('tab', { name: 'Плагины', exact: true }).click()
  await page.screenshot({ path: path.join(output, 'settings-commands-light-ru.png') })
  await page.getByRole('switch', { name: 'Включить конструктор команд' }).click()
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click()
  await page.locator('.document-editor').evaluate((element) =>
    element.editor
      .chain()
      .focus()
      .setTextSelection(element.editor.state.doc.content.size - 1)
      .run(),
  )
  await expect(page.locator('.document-editor')).toBeFocused()
  await page.keyboard.type('/commands')
  await expect(page.locator('.command-palette')).toBeVisible()
  await expect(page.locator('.command-palette')).not.toContainText('Конструктор команд')
  await page.keyboard.press('Escape')
  await page.locator('.document-editor').evaluate((element) => element.editor.commands.undo())
  expect(
    await page.locator('.document-editor').evaluate((element) => element.editor.getJSON()),
  ).toEqual(originalPages[0].content)
  await saved()
  expect(errors).toEqual([])
  await fs.writeFile(
    path.join(output, 'verification.json'),
    JSON.stringify(
      {
        fixture: root,
        screenshots: [
          'builder-help-light-en.png',
          'output-menu-dark-ru.png',
          'wordlists-dark-ru.png',
          'wordlist-help-dark-ru.png',
          'nmap-expanded-light-en.png',
          'wordlists-light-en.png',
          'wordlists-rockyou-light-ru.png',
          'output-editor-light-en.png',
          'builder-simple-empty-light-en.png',
          'builder-tools-light-en.png',
          'builder-tools-dark-ru.png',
          'builder-toggle-group-light-en.png',
          'builder-toggle-group-light-ru.png',
          'builder-stacked-dark-ru.png',
          'builder-simple-light-en.png',
          'builder-advanced-light-en.png',
          'hashcat-simple-light-en.png',
          'hashcat-advanced-light-en.png',
          'hashcat-simple-light-ru.png',
          'hashcat-advanced-light-ru.png',
          'builder-add-compact-dark-ru.png',
          'builder-advanced-dark-en.png',
          'builder-menu-dark-ru.png',
          'builder-dark-ru.png',
          'builder-dark-en.png',
          'builder-compact-dark-ru.png',
          'builder-simple-light-ru.png',
          'builder-advanced-light-ru.png',
          'builder-add-light-ru.png',
          'builder-picker-dark-ru.png',
          'builder-shell-light-ru.png',
          'configuration-tools-light-en.png',
          'configuration-parameters-light-en.png',
          'configuration-parameters-dark-ru.png',
          'configuration-parameters-light-ru.png',
          'configuration-json-light-en.png',
          'configuration-picker-dark-ru.png',
          'last-state.png',
        ],
        tools: imported.tools.map((t) => t.name),
        persistedEnabled: final.plugins.commandBuilder.enabled,
        pagesUnchanged: true,
        hashcatCardHeights: {
          advancedEnglish: heights,
          simpleEnglish: blockHeights,
          advancedRussian: localizedHeights,
        },
        centeredChain: { english: chainEnglish, russian: chainRussian },
        compactParameters: {
          target: compactTarget,
          choice: compactChoice,
          stackedChoice: narrowChoice,
          toggles: toggleGroup,
        },
        errors,
      },
      null,
      2,
    ),
  )
  console.log('Plugin desktop review passed:', output)
} finally {
  if (app) {
    await page?.screenshot({ path: path.join(output, 'last-state.png') }).catch(() => {})
    await app
      .evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close())
      .catch(() => {})
    await app.close().catch(() => {})
  }
}
