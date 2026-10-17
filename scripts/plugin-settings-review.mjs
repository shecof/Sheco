import { _electron as electron, expect } from '@playwright/test'
import { build } from 'esbuild'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sheco-plugin-settings-'))
const workspace = path.join(root, 'Knowledge')
const output = path.resolve('test-results/plugin-settings')
await fs.mkdir(workspace)
await fs.mkdir(output, { recursive: true })
const bundled = await build({
  stdin: {
    contents:
      "export { seedWorkspace } from './src/shared/seed'; export { createPage } from './src/shared/model'",
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
})
const modulePath = path.join(root, 'seed.mjs')
await fs.writeFile(modulePath, bundled.outputFiles[0].contents)
const { seedWorkspace, createPage } = await import(pathToFileURL(modulePath).href)
const w = seedWorkspace('Plugin settings preview', false)
for (const key of ['projectArchitecture', 'filePreview', 'jira', 'dataTools'])
  w.plugins[key].enabled = true
w.plugins.projectArchitecture.defaults = {
  showTitle: false,
  showResources: true,
  showBalances: false,
}
const diagram = createPage(w, 'Retained diagram', w.pages[0].id, 'architecture')
w.pages.push(diagram)
const panels = [
  ['preview', 'plugin:file-preview-settings', 'File preview settings', 'Настройка предпросмотра'],
  [
    'architecture',
    'plugin:project-architecture-settings',
    'Architecture settings',
    'Настройки архитектуры',
  ],
  ['data', 'plugin:data-tools-settings', 'Data tools settings', 'Настройки работы с данными'],
  ['jira', 'plugin:jira-settings', 'Jira settings', 'Настройка Jira'],
  ['mcp', 'plugin:mcp-settings', 'MCP settings', 'Настройка MCP'],
]
const architectureTab = panels[1][1]
w.ui.tabs = [w.pages[0].id, diagram.id, ...panels.map((row) => row[1])]
w.ui.activeId = architectureTab
w.ui.accent = 'blue'
await fs.writeFile(path.join(workspace, 'workspace.json'), JSON.stringify(w))
await fs.writeFile(
  path.join(root, 'spaces.json'),
  JSON.stringify({
    activeId: w.id,
    spaces: [{ id: w.id, name: w.name, icon: w.icon, path: workspace }],
  }),
)
let app, page
const errors = [],
  metrics = []
const launch = async () => {
  app = await electron.launch({ args: ['.'], env: { ...process.env, SHECO_DATA_DIR: root } })
  page = await app.firstWindow()
  page.on('pageerror', (error) => errors.push(error.message))
  await saved()
}
const saved = () =>
  expect(page.locator('.save-status')).toHaveClass(/\bsaved\b/, { timeout: 20000 })
const snapshot = () => page.evaluate(async () => (await window.sheco.boot()).active)
const open = async (id) => {
  await page.evaluate(
    (id) => window.dispatchEvent(new CustomEvent('open-page', { detail: { id } })),
    id,
  )
  await saved()
}
const close = async () => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await app.close()
  app = null
}
try {
  await launch()
  const baseline = await snapshot()
  let russian = false
  for (const [theme, ru, width] of [
    ['light', false, 1280],
    ['light', true, 1280],
    ['dark', true, 980],
    ['dark', false, 980],
  ]) {
    await page
      .locator('.sidebar-footer')
      .getByRole('button', { name: russian ? 'Настройки' : 'Settings', exact: true })
      .click()
    await page.getByRole('tab', { name: russian ? 'Общие' : 'General', exact: true }).click()
    await page
      .getByRole('button', {
        name: russian
          ? theme === 'dark'
            ? 'Тёмная'
            : 'Светлая'
          : theme === 'dark'
            ? 'Dark'
            : 'Light',
        exact: true,
      })
      .click()
    await page.getByRole('button', { name: ru ? 'Русский' : 'English', exact: true }).click()
    russian = ru
    await page.getByRole('button', { name: ru ? 'Закрыть' : 'Close', exact: true }).click()
    await app.evaluate(
      ({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 900),
      width,
    )
    for (const [kind, id, en, rs] of panels) {
      await open(id)
      const panel = page.locator('.content-scroll:not([hidden])')
      await expect(panel.locator('h1')).toHaveText(ru ? rs : en)
      const header = panel.locator('.plugin-card-title')
      const spacing = await header.evaluate((element) => {
        const next = element.nextElementSibling
        const content = element.querySelector('.plugin-mark').getBoundingClientRect()
        return {
          padding: getComputedStyle(element).paddingBottom,
          gap: next.getBoundingClientRect().top - content.bottom,
        }
      })
      expect(spacing.padding).toBe('12px')
      expect(spacing.gap).toBeGreaterThanOrEqual(12)
      if (kind === 'architecture') {
        await expect(
          header.getByRole('switch', {
            name: ru ? 'Включить архитектуру проекта' : 'Enable project architecture',
          }),
        ).toBeChecked()
        expect(
          await panel
            .locator('.setting-row')
            .evaluateAll((rows) => rows.map((row) => getComputedStyle(row).paddingTop)),
        ).toEqual(['6px', '6px', '6px'])
      }
      if (kind === 'mcp') {
        const description = header.locator('p')
        await expect(description).toHaveText(
          ru
            ? 'Доступ агентов через MCP, пока Sheco открыто.'
            : 'Local MCP access for agents while Sheco is open.',
        )
        const singleLine = await description.evaluate(
          (element) =>
            element.getBoundingClientRect().height <=
              parseFloat(getComputedStyle(element).lineHeight) + 1 &&
            element.scrollWidth <= element.clientWidth,
        )
        expect(singleLine).toBe(true)
      }
      const contained = await header.evaluate((element) =>
        [...element.querySelectorAll('button')].every(
          (node) => node.getBoundingClientRect().right <= innerWidth,
        ),
      )
      expect(contained).toBe(true)
      await page.screenshot({ path: path.join(output, `${kind}-${theme}-${ru ? 'ru' : 'en'}.png`) })
      metrics.push({ kind, theme, language: ru ? 'ru' : 'en', width, spacing })
    }
  }
  await open(architectureTab)
  await page.getByRole('switch', { name: 'Enable project architecture' }).click()
  await saved()
  let current = await snapshot()
  expect(current.plugins.projectArchitecture.enabled).toBe(false)
  expect(current.plugins.projectArchitecture.defaults).toEqual(
    baseline.plugins.projectArchitecture.defaults,
  )
  expect(current.pages).toEqual(baseline.pages)
  expect(current.ui.activeId).toBe(architectureTab)
  expect(current.ui.tabs).toContain(diagram.id)
  await close()
  await launch()
  await expect(page.getByRole('switch', { name: 'Enable project architecture' })).not.toBeChecked()
  await open(diagram.id)
  await expect(
    page.getByText('Enable project architecture to edit this page.', { exact: true }),
  ).toBeVisible()
  await open(architectureTab)
  const toggle = page.getByRole('switch', { name: 'Enable project architecture' })
  await toggle.focus()
  await page.keyboard.press('Space')
  await expect(toggle).toBeChecked()
  await saved()
  await close()
  await launch()
  await expect(page.getByRole('switch', { name: 'Enable project architecture' })).toBeChecked()
  current = await snapshot()
  expect(current.pages).toEqual(baseline.pages)
  expect(current.plugins).toEqual(baseline.plugins)
  expect(errors).toEqual([])
  await fs.writeFile(
    path.join(output, 'verification.json'),
    JSON.stringify(
      {
        root,
        metrics,
        errors,
        architectureToggle:
          'disable/restart/read-only/re-enable/restart; pages and defaults retained',
      },
      null,
      2,
    ),
  )
  console.log('Plugin settings review passed:', output)
} finally {
  if (app) {
    if (page) await page.screenshot({ path: path.join(output, 'last-state.png') }).catch(() => {})
    await close().catch(() => app?.close())
  }
}
