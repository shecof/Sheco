import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { _electron as electron, expect } from '@playwright/test'
import { build } from 'esbuild'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sheco-data-recipes-'))
const workspace = path.join(root, 'Knowledge'),
  output = path.resolve('test-results/data-recipes')
await fs.mkdir(workspace)
await fs.mkdir(output, { recursive: true })
const bundled = await build({
  stdin: {
    contents:
      "export { seedWorkspace } from './src/shared/seed'; export { createPage, createDatabase } from './src/shared/model'; export { translate } from './src/shared/i18n'; export { documentTemplatesTab, documentTemplatesSettingsTab, dataToolsTab } from './src/shared/plugins'",
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
})
const seedFile = path.join(root, 'seed.mjs')
await fs.writeFile(seedFile, bundled.outputFiles[0].contents)
const {
  seedWorkspace,
  translate,
  documentTemplatesTab,
  documentTemplatesSettingsTab,
  dataToolsTab,
} = await import(pathToFileURL(seedFile).href)
const w = seedWorkspace('Data recipes review', false)
w.pages[0].title = 'Fixture source'
w.pages[0].content = { type: 'doc', content: [{ type: 'paragraph' }] }
w.plugins.documentTemplates = {
  enabled: true,
  initialized: true,
  catalogRevision: 2,
  templates: [
    {
      id: crypto.randomUUID(),
      name: 'Retained library',
      description: '',
      icon: 'file',
      content: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Preserve this saved template.' }] },
        ],
      },
    },
  ],
}
const retainedTemplates = structuredClone(w.plugins.documentTemplates)
w.plugins.dataTools.enabled = true
w.ui.tabs = [w.pages[0].id, documentTemplatesTab, documentTemplatesSettingsTab, dataToolsTab]
w.ui.activeId = dataToolsTab
await fs.writeFile(path.join(workspace, 'workspace.json'), JSON.stringify(w))
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
let installedVersion, stableVersion, newerVersion
const errors = []
const tr = (key) => translate(key, language)
const snapshot = async () =>
  JSON.parse(await fs.readFile(path.join(workspace, 'workspace.json'), 'utf8'))
async function saved() {
  await expect(page.locator('.save-status')).toHaveClass(/\bsaved\b/)
}
async function launch() {
  app = await electron.launch({
    args: [process.env.SHECO_TEST_MAIN ?? '.'],
    env: { ...process.env, SHECO_DATA_DIR: root },
  })
  page = await app.firstWindow()
  installedVersion = await app.evaluate(({ app }) => app.getVersion())
  stableVersion = installedVersion.split(/[-+]/)[0]
  newerVersion = stableVersion.replace(/\d+$/, (patch) => String(Number(patch) + 1))
  page.on('pageerror', (error) => errors.push(error.message))
  await expect(page.locator('.save-status')).toBeVisible({ timeout: 20000 })
  await app.evaluate(({ BrowserWindow, clipboard, shell }) => {
    BrowserWindow.getAllWindows()[0].setSize(1280, 900)
    globalThis.__copied = ''
    globalThis.__links = []
    clipboard.writeText = (text) => {
      globalThis.__copied = text
    }
    shell.openExternal = async (url) => {
      globalThis.__links.push(url)
    }
  })
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
async function tab(title) {
  await page.locator('.tab-open').getByText(title, { exact: true }).click()
}
async function openTool(title) {
  await page
    .locator('.sidebar-footer')
    .getByRole('button', { name: new RegExp(tr('Plugins')) })
    .click()
  await page
    .locator('.plugins-menu')
    .getByRole('button', { name: tr(title), exact: true })
    .click()
}
async function picker(label, value) {
  await page.getByRole('button', { name: tr(label), exact: true }).click()
  await page.getByRole('option', { name: tr(value), exact: true }).click()
}
async function appearance(theme, nextLanguage) {
  const dialog = await settings('General')
  await dialog.getByRole('button', { name: tr(theme), exact: true }).click()
  await dialog
    .getByRole('button', { name: nextLanguage === 'ru' ? 'Русский' : 'English', exact: true })
    .click()
  language = nextLanguage
  await page.getByRole('button', { name: tr('Close'), exact: true }).click()
  await saved()
}
async function updates(response, status = 200) {
  await app.evaluate(
    ({ session }, { response, status }) => {
      globalThis.__updateRequests ??= []
      session.fromPartition('update-requests').fetch = async (url, init) => {
        globalThis.__updateRequests.push({
          url: String(url),
          credentials: init.credentials,
          redirect: init.redirect,
        })
        return new Response(typeof response === 'string' ? response : JSON.stringify(response), {
          status,
        })
      }
    },
    { response, status },
  )
}
const tools = () => page.locator('.data-tools-page')
async function chooseAction(group, label, add = false, index = 0) {
  await tools()
    .getByRole('button', { name: tr(add ? 'Add action' : 'Change action'), exact: true })
    .nth(index)
    .click()
  const popover = page.locator('.data-action-popover')
  await popover.getByRole('button', { name: tr(group), exact: true }).click()
  await popover.getByRole('option', { name: tr(label), exact: true }).click()
}
async function operation(group, label, input) {
  await chooseAction(group, label)
  await tools()
    .getByRole('textbox', { name: tr('Input'), exact: true })
    .fill(input)
  await tools().locator('.data-run-recipe').click()
}
async function removeStep(index) {
  await tools()
    .locator('.data-recipe-step')
    .nth(index)
    .getByRole('button', { name: tr('Remove action'), exact: true })
    .click()
}
async function startDrag(from, to, after) {
  await page.evaluate(() => {
    window.__recipeDragTrace = []
    if (window.__recipeDragTraceInstalled) return
    window.__recipeDragTraceInstalled = true
    for (const type of ['dragstart', 'dragenter', 'dragover', 'dragleave', 'drop', 'dragend'])
      document.addEventListener(
        type,
        (event) => {
          window.__recipeDragTrace.push({
            type,
            x: event.clientX,
            y: event.clientY,
            target: event.target.tagName,
            card: [...document.querySelectorAll('.data-recipe-step')].indexOf(
              event.target.closest('.data-recipe-step'),
            ),
            types: [...event.dataTransfer.types],
            related: event.relatedTarget?.tagName,
          })
          if (window.__recipeDragTrace.length > 100) window.__recipeDragTrace.shift()
        },
        true,
      )
  })
  const cards = tools().locator('.data-recipe-step')
  const handle = await cards.nth(from).locator('.data-step-drag-handle').boundingBox()
  const target = await cards.nth(to).boundingBox()
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
  await page.mouse.down()
  await page.mouse.move(handle.x + handle.width / 2 + 8, handle.y + handle.height / 2, { steps: 4 })
  await page.mouse.move(
    target.x + target.width * (after ? 0.8 : 0.2),
    target.y + target.height / 2,
    { steps: 12 },
  )
  // A second move over the final descendant gives Chromium a dragover after dragenter.
  await page.mouse.move(
    target.x + target.width * (after ? 0.8 : 0.2) + 1,
    target.y + target.height / 2,
  )
  try {
    await expect(cards.nth(to)).toHaveClass(after ? /drop-after/ : /drop-before/)
  } catch (error) {
    await fs.writeFile(
      path.join(output, 'drag-failure.json'),
      JSON.stringify(
        {
          from,
          to,
          after,
          handle,
          target,
          trace: await page.evaluate(() => window.__recipeDragTrace),
          geometry: await cards.evaluateAll((nodes) =>
            nodes.map((node) => ({
              bounds: node.getBoundingClientRect().toJSON(),
              className: node.className,
            })),
          ),
        },
        null,
        2,
      ),
    )
    throw error
  }
}
async function dragStep(from, to, after) {
  await startDrag(from, to, after)
  await page.mouse.up()
  await expect(tools().locator('.drop-before, .drop-after, .dragging')).toHaveCount(0)
}
async function checkRestoredTemplates() {
  const footer = page.locator('.sidebar-footer')
  await expect(footer.getByRole('button', { name: tr('Templates'), exact: true })).toBeVisible()
  const dialog = await settings()
  await expect(
    dialog.getByRole('switch', { name: tr('Enable document templates'), exact: true }),
  ).toBeChecked()
  await page.getByRole('button', { name: tr('Close'), exact: true }).click()
  await footer.getByRole('button', { name: tr('Templates'), exact: true }).click()
  await expect(page.locator('.templates-page')).toContainText('Retained library')
  await tab(tr('Data tools'))
  await saved()
  expect((await snapshot()).plugins.documentTemplates).toEqual(retainedTemplates)
}

try {
  await launch()
  await expect(tools()).toBeVisible()
  await checkRestoredTemplates()
  await openTool('Data tools')
  await expect(tools().getByRole('textbox', { name: 'Input', exact: true })).toHaveAttribute(
    'placeholder',
    'Paste JSON to format…',
  )
  await expect(tools().getByRole('textbox', { name: 'Result', exact: true })).toHaveAttribute(
    'placeholder',
    'Your result will appear here…',
  )
  await expect(tools().getByRole('button', { name: 'Copy result', exact: true })).toBeDisabled()
  await expect(
    tools().getByRole('button', { name: 'Use result as input', exact: true }),
  ).toBeDisabled()
  await tools().getByRole('button', { name: 'Add action', exact: true }).click()
  for (const [group, count] of [
    ['Formatting', 11],
    ['Encoding', 10],
    ['Hashes', 4],
    ['Text', 20],
  ]) {
    const popover = page.locator('.data-action-popover')
    await popover.getByRole('button', { name: group, exact: true }).click()
    const actions = popover.getByRole('option')
    await expect(actions).toHaveCount(count)
    for (let i = 0; i < count; i++) await expect(actions.nth(i)).toBeVisible()
  }
  const lastAction = page.locator('.data-action-popover').getByRole('option').last()
  await lastAction.scrollIntoViewIfNeeded()
  await expect(lastAction).toBeInViewport()
  const pickerBounds = await page.locator('.data-action-popover').evaluate((popover) => {
    const bounds = popover.getBoundingClientRect()
    return {
      fits:
        bounds.left >= 0 &&
        bounds.right <= innerWidth &&
        bounds.top >= 0 &&
        bounds.bottom <= innerHeight,
    }
  })
  expect(pickerBounds.fits).toBe(true)
  const actionSearch = page
    .locator('.data-action-popover')
    .getByRole('textbox', { name: 'Find an action', exact: true })
  await actionSearch.fill('base64')
  await expect(page.locator('.data-action-popover').getByRole('option')).toHaveCount(4)
  await actionSearch.fill('SHA-256')
  await expect(page.locator('.data-action-popover').getByRole('option')).toHaveCount(1)
  await actionSearch.press('ArrowDown')
  await expect(page.getByRole('option', { name: 'SHA-256', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(tools().getByRole('button', { name: 'Add action', exact: true })).toBeFocused()
  await expect(tools().locator('.data-local-note')).toHaveCount(0)
  const secret = 'session-only-fixture-secret'
  await operation(
    'Formatting',
    'Format JSON',
    '{"id":999999999999999999999,"secret":"' + secret + '"}',
  )
  await expect(tools().getByRole('textbox', { name: 'Result', exact: true })).toHaveValue(
    /999999999999999999999/,
  )
  await tab('Fixture source')
  await tab('Data tools')
  await expect(tools().getByRole('textbox', { name: 'Input', exact: true })).toHaveValue(
    new RegExp(secret),
  )
  expect(JSON.stringify(await snapshot())).not.toContain(secret)
  await tools().getByRole('button', { name: 'Copy result', exact: true }).click()
  expect(await app.evaluate(() => globalThis.__copied)).toContain(secret)
  await tools().getByRole('button', { name: 'Configure', exact: true }).click()
  await picker('Indentation', '4 spaces')
  await picker('CSV delimiter', 'Semicolon')
  await saved()
  expect((await snapshot()).plugins.dataTools).toEqual({
    enabled: true,
    indent: 4,
    csvDelimiter: ';',
  })
  await tab('Data tools')
  await operation('Formatting', 'CSV → JSON', 'name;note\nИван;local')
  await expect(tools().getByText('CSV delimiter: Semicolon', { exact: true })).toBeVisible()
  await expect(tools().getByText('Indentation: 4 spaces', { exact: true })).toBeVisible()
  await expect(tools().getByRole('textbox', { name: 'Result', exact: true })).toHaveValue(
    '[\n    {\n        "name": "Иван",\n        "note": "local"\n    }\n]',
  )
  await operation(
    'Formatting',
    'Format XML',
    '<?xml version="1.0"?><root><item>text</item><empty/></root>',
  )
  await expect(tools().getByRole('textbox', { name: 'Result', exact: true })).toHaveValue(
    '<?xml version="1.0"?>\n<root>\n    <item>text</item>\n    <empty/>\n</root>',
  )
  await operation('Formatting', 'Format XML', '<p>a <b>b</b> c</p>')
  await expect(tools().getByRole('textbox', { name: 'Result', exact: true })).toHaveValue(
    '<p>a <b>b</b> c</p>',
  )
  await operation('Formatting', 'Format XML', '<parsererror>ordinary data</parsererror>')
  await expect(tools().getByRole('textbox', { name: 'Result', exact: true })).toHaveValue(
    '<parsererror>ordinary data</parsererror>',
  )
  await operation(
    'Formatting',
    'Format XML',
    '<!DOCTYPE root SYSTEM "https://example.com/dtd"><root/>',
  )
  await expect(tools().getByRole('alert')).toContainText('DTD')
  await expect(tools().getByRole('button', { name: 'Copy result', exact: true })).toBeDisabled()
  await operation('Formatting', 'Format XML', '<broken>')
  await expect(tools().getByRole('alert')).toContainText('Invalid XML')
  await expect(tools().getByRole('textbox', { name: 'Input', exact: true })).toHaveAttribute(
    'aria-invalid',
    'true',
  )
  await operation(
    'Encoding',
    'Decode HTML entities',
    '&lt;script&gt;literal&lt;/script&gt; <img src="https://example.com/private">',
  )
  await expect(tools().getByRole('textbox', { name: 'Result', exact: true })).toHaveValue(
    '<script>literal</script> <img src="https://example.com/private">',
  )
  await expect(tools().locator('img, script')).toHaveCount(0)
  await operation('Encoding', 'Encode Base64', 'Привет 👋')
  await expect(tools().getByRole('textbox', { name: 'Result', exact: true })).toHaveValue(
    '0J/RgNC40LLQtdGCIPCfkYs=',
  )
  await page.screenshot({ path: path.join(output, 'data-light-en.png') })

  await expect(tools().getByRole('textbox', { name: 'Result', exact: true })).toHaveValue(
    '0J/RgNC40LLQtdGCIPCfkYs=',
  )
  await tools().getByRole('button', { name: 'Use result as input', exact: true }).click()
  await expect(tools().getByRole('textbox', { name: 'Input', exact: true })).toBeFocused()
  await expect(tools().getByRole('textbox', { name: 'Input', exact: true })).toHaveValue(
    '0J/RgNC40LLQtdGCIPCfkYs=',
  )
  await expect(tools().getByRole('textbox', { name: 'Result', exact: true })).toHaveValue('')
  await chooseAction('Encoding', 'Decode Base64')
  await expect(tools().getByRole('textbox', { name: 'Input', exact: true })).toHaveValue(
    '0J/RgNC40LLQtdGCIPCfkYs=',
  )
  await tools().getByRole('textbox', { name: 'Input', exact: true }).press('Control+Enter')
  await expect(tools().getByRole('textbox', { name: 'Result', exact: true })).toHaveValue(
    'Привет 👋',
  )
  await tools().getByRole('button', { name: 'Copy result', exact: true }).click()
  expect(await app.evaluate(() => globalThis.__copied)).toBe('Привет 👋')
  await tools().getByRole('button', { name: 'Clear', exact: true }).click()
  await expect(tools().getByRole('textbox', { name: 'Input', exact: true })).toHaveValue('')
  await expect(tools().getByRole('textbox', { name: 'Result', exact: true })).toHaveValue('')
  await expect(tools().getByRole('textbox', { name: 'Input', exact: true })).toBeFocused()
  await operation('Text', 'Sort lines', '')
  await expect(tools().getByRole('textbox', { name: 'Result', exact: true })).toHaveAttribute(
    'placeholder',
    'The result is empty.',
  )
  await expect(tools().getByRole('button', { name: 'Copy result', exact: true })).toBeEnabled()
  await expect(tools().getByRole('status')).toHaveText('Done')

  await chooseAction('Hashes', 'SHA-256')
  await tools().getByRole('button', { name: 'Clear', exact: true }).click()
  await tools().locator('.data-run-recipe').click()
  await expect(tools().getByRole('textbox', { name: 'Result', exact: true })).toHaveValue(
    createHash('sha256').update('').digest('hex'),
  )
  await tools().getByRole('button', { name: 'Pause action', exact: true }).click()
  await expect(tools().getByRole('textbox', { name: 'Result', exact: true })).toHaveValue('')
  await expect(tools().getByRole('button', { name: 'Copy result', exact: true })).toBeEnabled()
  await tools().getByRole('button', { name: 'Resume action', exact: true }).click()
  await expect(tools().getByRole('textbox', { name: 'Result', exact: true })).toHaveValue(
    createHash('sha256').update('').digest('hex'),
  )
  await chooseAction('Hashes', 'SHA-256')
  await page.evaluate(() => {
    const original = crypto.subtle.digest.bind(crypto.subtle)
    window.__restoreDigest = () => {
      crypto.subtle.digest = original
    }
    crypto.subtle.digest = () =>
      new Promise((resolve) => {
        window.__finishDigest = resolve
      })
  })
  await tools().getByRole('textbox', { name: 'Input', exact: true }).fill('old input')
  await tools().locator('.data-run-recipe').click()
  await expect.poll(() => page.evaluate(() => typeof window.__finishDigest)).toBe('function')
  await tools().getByRole('textbox', { name: 'Input', exact: true }).fill('new input')
  await page.evaluate(() => {
    window.__finishDigest(new Uint8Array([1, 2]).buffer)
    window.__restoreDigest()
  })
  await expect(tools().getByRole('textbox', { name: 'Result', exact: true })).not.toHaveValue(
    '0102',
  )
  await expect(tools().getByRole('textbox', { name: 'Result', exact: true })).toHaveValue(
    createHash('sha256').update('new input').digest('hex'),
  )
  await operation('Hashes', 'SHA-256', 'abc')
  await expect(tools().getByRole('textbox', { name: 'Result', exact: true })).toHaveValue(
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  )

  await operation('Formatting', 'Validate JSON', ' {"n":999999999999999999999,"n":1e1000} ')
  await expect(tools().getByRole('textbox', { name: 'Result', exact: true })).toHaveValue(
    ' {"n":999999999999999999999,"n":1e1000} ',
  )
  await operation(
    'Formatting',
    'JSON array → JSON Lines',
    '[{"id":999999999999999999999},true,{"a":1,"a":2}]',
  )
  await expect(tools().getByRole('textbox', { name: 'Result', exact: true })).toHaveValue(
    '{"id":999999999999999999999}\ntrue\n{"a":1,"a":2}',
  )
  await tools().getByRole('button', { name: 'Use result as input', exact: true }).click()
  await chooseAction('Formatting', 'JSON Lines → JSON array')
  await tools().locator('.data-run-recipe').click()
  await expect(tools().getByRole('textbox', { name: 'Result', exact: true })).toHaveValue(
    /999999999999999999999/,
  )

  await operation('Text', 'Keep matching lines', 'WARN a\nINFO b\nwarn c')
  await expect(tools().getByRole('alert')).toContainText('text to find')
  const parameterCards = tools().locator('.data-recipe-step')
  const parameterResult = tools().getByRole('textbox', { name: 'Result', exact: true })
  await expect(
    parameterCards.nth(0).getByRole('textbox', { name: 'Find text', exact: true }),
  ).toHaveAttribute('aria-invalid', 'true')
  await expect(tools().getByRole('textbox', { name: 'Input', exact: true })).toHaveAttribute(
    'aria-invalid',
    'false',
  )

  await parameterCards.nth(0).getByRole('textbox', { name: 'Find text', exact: true }).fill('WARN')
  await expect(parameterResult).toHaveValue('WARN a')
  await parameterCards.nth(0).getByRole('checkbox', { name: 'Match case', exact: true }).uncheck()
  await expect(parameterResult).toHaveValue('WARN a\nwarn c')
  await chooseAction('Text', 'Replace text', true)
  await parameterCards.nth(1).getByRole('textbox', { name: 'Find text', exact: true }).fill('WARN')
  await parameterCards
    .nth(1)
    .getByRole('textbox', { name: 'Replace with', exact: true })
    .fill('notice')
  await parameterCards.nth(1).getByRole('checkbox', { name: 'Match case', exact: true }).uncheck()
  await chooseAction('Text', 'Join lines', true)
  await parameterCards.nth(2).getByRole('textbox', { name: 'Separator', exact: true }).fill(' | ')
  await expect(parameterResult).toHaveValue('notice a | notice c')
  await chooseAction('Text', 'Replace text', true)
  await parameterCards
    .nth(3)
    .getByRole('textbox', { name: 'Find text', exact: true })
    .fill('notice')
  await parameterCards
    .nth(3)
    .getByRole('textbox', { name: 'Replace with', exact: true })
    .fill('event')
  await expect(parameterResult).toHaveValue('event a | event c')
  await parameterCards.nth(0).getByRole('button', { name: 'Pause action', exact: true }).click()
  await expect(
    parameterCards.nth(0).getByRole('textbox', { name: 'Find text', exact: true }),
  ).toBeDisabled()
  await expect(parameterResult).toHaveValue('event a | INFO b | event c')
  await parameterCards.nth(0).getByRole('button', { name: 'Resume action', exact: true }).click()
  await expect(parameterResult).toHaveValue('event a | event c')
  await dragStep(3, 0, false)
  await expect(
    parameterCards.nth(0).getByRole('textbox', { name: 'Find text', exact: true }),
  ).toHaveValue('notice')
  await expect(parameterResult).toHaveValue('notice a | notice c')
  await dragStep(0, 3, true)
  await expect(parameterResult).toHaveValue('event a | event c')
  expect(JSON.stringify(await snapshot())).not.toContain('notice')
  await page.screenshot({ path: path.join(output, 'parameters-light-en.png') })
  await appearance('Dark', 'ru')
  await page.screenshot({ path: path.join(output, 'parameters-dark-ru.png') })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 700))
  const parameterBounds = await tools().evaluate((section) =>
    [
      ...section.querySelectorAll(
        '.data-step-options input, .data-step-options textarea, .data-step-options button',
      ),
    ].every((node) => {
      const bounds = node.getBoundingClientRect()
      return bounds.left >= 0 && bounds.right <= innerWidth
    }),
  )
  expect(parameterBounds).toBe(true)
  await page.screenshot({ path: path.join(output, 'parameters-narrow-ru.png') })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 900))
  await appearance('Light', 'en')
  while ((await parameterCards.count()) > 1) await removeStep((await parameterCards.count()) - 1)
  await operation('Text', 'Normalize Unicode', 'е\u0308')
  await expect(parameterResult).toHaveValue('ё')
  await parameterCards.nth(0).getByRole('button', { name: 'Unicode form', exact: true }).click()
  await page.getByRole('option', { name: 'NFD', exact: true }).click()
  await expect(parameterResult).toHaveValue('е\u0308')
  await operation('Text', 'Split into lines', 'a::b::c')
  await parameterCards.nth(0).getByRole('textbox', { name: 'Separator', exact: true }).fill('::')
  await expect(parameterResult).toHaveValue('a\nb\nc')
  await chooseAction('Text', 'Join lines', true)
  await parameterCards.nth(1).getByRole('textbox', { name: 'Separator', exact: true }).fill('')
  await expect(parameterResult).toHaveValue('abc')
  await parameterCards.nth(0).getByRole('textbox', { name: 'Separator', exact: true }).fill('')
  await expect(tools().getByRole('alert')).toContainText('separator')
  await parameterCards.nth(0).getByRole('textbox', { name: 'Separator', exact: true }).fill('::')
  await expect(parameterResult).toHaveValue('abc')
  await removeStep(1)
  await operation('Text', 'Add prefix and suffix', 'a\nb')
  await parameterCards.nth(0).getByRole('textbox', { name: 'Prefix', exact: true }).fill('<')
  await parameterCards.nth(0).getByRole('textbox', { name: 'Suffix', exact: true }).fill('>')
  await expect(parameterResult).toHaveValue('<a>\n<b>')
  await chooseAction('Text', 'Uppercase')
  await expect(parameterCards.locator('.data-step-options')).toHaveCount(0)
  await expect(parameterResult).toHaveValue('A\nB')
  await operation('Hashes', 'CRC-32', '123456789')
  await expect(parameterResult).toHaveValue('cbf43926')

  await operation('Text', 'Trim each line', ' a ')
  await chooseAction('Encoding', 'Encode Base64', true)
  await chooseAction('Encoding', 'Encode URL component', true)
  const resultField = tools().getByRole('textbox', { name: 'Result', exact: true })
  const recipeSteps = tools().locator('.data-recipe-step')
  await expect(resultField).toHaveValue('YQ%3D%3D')
  await recipeSteps.nth(1).getByRole('button', { name: 'Pause action', exact: true }).click()
  await expect(recipeSteps.nth(1)).toHaveClass(/paused/)
  await expect(resultField).toHaveValue('a')
  await recipeSteps.nth(1).getByRole('button', { name: 'Resume action', exact: true }).click()
  await expect(resultField).toHaveValue('YQ%3D%3D')
  await dragStep(2, 1, false)
  await expect(recipeSteps.nth(1)).toContainText('Encode URL component')
  await expect(resultField).toHaveValue('YQ==')
  await dragStep(1, 2, true)
  await expect(resultField).toHaveValue('YQ%3D%3D')
  await expect(tools().getByRole('button', { name: 'Action options', exact: true })).toHaveCount(0)
  await expect(recipeSteps.getByRole('button', { name: 'Remove action', exact: true })).toHaveCount(
    3,
  )
  const grip = recipeSteps.nth(2).locator('.data-step-drag-handle')
  await grip.focus()
  await grip.press('ArrowLeft')
  await expect(resultField).toHaveValue('YQ==')
  await recipeSteps.nth(1).locator('.data-step-drag-handle').press('ArrowRight')
  await expect(resultField).toHaveValue('YQ%3D%3D')
  const orderBeforeCancel = await recipeSteps.locator('.data-action-picker').allTextContents()
  await startDrag(2, 0, false)
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await expect(tools().locator('.drop-before, .drop-after, .dragging')).toHaveCount(0)
  expect(await recipeSteps.locator('.data-action-picker').allTextContents()).toEqual(
    orderBeforeCancel,
  )
  await expect(resultField).toHaveValue('YQ%3D%3D')
  const bounds = await tools().evaluate((section) => {
    const recipe = section.querySelector('.data-recipe').getBoundingClientRect()
    const input = section.querySelector('.data-input-panel').getBoundingClientRect()
    const result = section.querySelector('.data-result-panel').getBoundingClientRect()
    const workspace = section.querySelector('.data-workspace').getBoundingClientRect()
    return {
      above: recipe.bottom < input.top && recipe.bottom < result.top,
      sameRow: input.top === result.top,
      equalWidth: Math.abs(input.width - result.width) < 1,
      fieldsShareWidth: (input.width + result.width) / workspace.width > 0.95,
    }
  })
  expect(bounds).toEqual({ above: true, sameRow: true, equalWidth: true, fieldsShareWidth: true })
  await page.screenshot({ path: path.join(output, 'recipe-light-en.png') })
  await chooseAction('Formatting', 'Format JSON', true)
  await expect(tools().getByRole('alert')).toContainText('Step 4: Invalid JSON')
  await expect(recipeSteps.nth(3)).toHaveClass(/has-error/)
  await expect(tools().getByRole('button', { name: 'Copy result', exact: true })).toBeDisabled()
  await recipeSteps.nth(3).getByRole('button', { name: 'Pause action', exact: true }).click()
  await expect(resultField).toHaveValue('YQ%3D%3D')
  await page.screenshot({ path: path.join(output, 'recipe-paused-light-en.png') })
  await tab('Fixture source')
  await tab('Data tools')
  await expect(recipeSteps).toHaveCount(4)
  await expect(recipeSteps.nth(3)).toHaveClass(/paused/)
  for (let i = 0; i < 3; i++)
    await recipeSteps.nth(i).getByRole('button', { name: 'Pause action', exact: true }).click()
  await expect(resultField).toHaveValue(' a ')
  while ((await recipeSteps.count()) > 1) await removeStep((await recipeSteps.count()) - 1)
  await recipeSteps.nth(0).getByRole('button', { name: 'Resume action', exact: true }).click()
  await expect(resultField).toHaveValue('a')

  const filePicker = tools().getByLabel('Choose input file', { exact: true })
  const binary = Buffer.from([0xef, 0xbb, 0xbf, 0, 0xff, 0x80, 13, 10])
  await chooseAction('Hashes', 'SHA-256')
  await filePicker.setInputFiles({
    name: 'exact-bytes.bin',
    mimeType: 'application/octet-stream',
    buffer: binary,
  })
  await expect(tools().locator('.data-file-input')).toContainText('exact-bytes.bin')
  await expect(resultField).toHaveValue(createHash('sha256').update(binary).digest('hex'))
  await expect(tools().getByRole('textbox', { name: 'Input', exact: true })).toHaveAttribute(
    'readonly',
    '',
  )
  await chooseAction('Hashes', 'CRC-32')
  await expect(resultField).toHaveValue(
    gzipSync(binary)
      .readUInt32LE(gzipSync(binary).length - 8)
      .toString(16)
      .padStart(8, '0'),
  )
  await chooseAction('Formatting', 'Format JSON')
  await expect(tools().getByRole('alert')).toContainText('UTF-8 text file')
  const textFile = Buffer.from('\uFEFF{ "name": "Иван", "id": 999999999999999999999 }')
  await filePicker.setInputFiles({
    name: 'example.json',
    mimeType: 'application/json',
    buffer: textFile,
  })
  await expect(resultField).toHaveValue(
    '{\n    "name": "Иван",\n    "id": 999999999999999999999\n}',
  )
  await expect(tools().getByRole('alert')).toHaveCount(0)
  await page.screenshot({ path: path.join(output, 'recipe-file-light-en.png') })
  await tab('Fixture source')
  await tab('Data tools')
  await expect(tools().locator('.data-file-input')).toContainText('example.json')
  expect(JSON.stringify(await snapshot())).not.toContain('example.json')
  await filePicker.setInputFiles({
    name: 'too-large.bin',
    mimeType: 'application/octet-stream',
    buffer: Buffer.alloc(1024 * 1024 + 1),
  })
  await expect(tools().getByRole('alert')).toContainText('1 MB')
  await expect(tools().locator('.data-file-input')).toContainText('example.json')
  await tools().getByRole('button', { name: 'Remove file', exact: true }).click()
  await expect(tools().locator('.data-file-input')).toHaveCount(0)
  await expect(tools().getByRole('textbox', { name: 'Input', exact: true })).toHaveValue(' a ')
  // A late file read cannot restore a cleared input.
  await page.evaluate(() => {
    const original = File.prototype.arrayBuffer
    window.__restoreFileRead = () => {
      File.prototype.arrayBuffer = original
    }
    File.prototype.arrayBuffer = () =>
      new Promise((resolve) => {
        window.__finishFileRead = resolve
      })
  })
  await filePicker.setInputFiles({
    name: 'late.bin',
    mimeType: 'application/octet-stream',
    buffer: binary,
  })
  await expect.poll(() => page.evaluate(() => typeof window.__finishFileRead)).toBe('function')
  await tools().getByRole('button', { name: 'Clear', exact: true }).click()
  await page.evaluate(() => {
    window.__finishFileRead(new Uint8Array([255]).buffer)
    window.__restoreFileRead()
  })
  await expect(tools().locator('.data-file-input')).toHaveCount(0)
  await expect(resultField).toHaveValue('')
  await expect(tools().getByRole('textbox', { name: 'Input', exact: true })).toHaveValue('')

  await operation('Text', 'Trim each line', '  orange  \n apple\n orange\n banana ')
  await chooseAction('Text', 'Remove duplicate lines', true)
  await chooseAction('Text', 'Sort lines', true)
  await chooseAction('Encoding', 'Encode Base64', true)
  await recipeSteps.nth(3).getByRole('button', { name: 'Pause action', exact: true }).click()
  await expect(resultField).toHaveValue('apple\nbanana\norange')
  await page.screenshot({ path: path.join(output, 'data-light-en.png') })
  await appearance('Dark', 'en')
  await page.screenshot({ path: path.join(output, 'data-dark-en.png') })
  await appearance('Light', 'ru')
  await page.screenshot({ path: path.join(output, 'data-light-ru.png') })
  await appearance('Dark', 'ru')
  await page.screenshot({ path: path.join(output, 'recipe-dark-ru.png') })
  await checkRestoredTemplates()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 700))
  const narrow = await tools().evaluate((section) => {
    const recipe = section.querySelector('.data-recipe').getBoundingClientRect()
    const input = section.querySelector('.data-input-panel').getBoundingClientRect()
    const result = section.querySelector('.data-result-panel').getBoundingClientRect()
    return {
      above: recipe.bottom < input.top,
      stacked: result.top >= input.bottom,
      fits: [...section.querySelectorAll('button, textarea')].every((node) => {
        const rect = node.getBoundingClientRect()
        return rect.left >= 0 && rect.right <= innerWidth
      }),
    }
  })
  expect(narrow).toEqual({ above: true, stacked: true, fits: true })
  await dragStep(3, 0, false)
  await expect(recipeSteps.nth(0)).toHaveClass(/paused/)
  await expect(tools().getByRole('textbox', { name: tr('Result'), exact: true })).toHaveValue(
    'apple\nbanana\norange',
  )
  await dragStep(0, 3, true)
  await expect(recipeSteps.nth(3)).toHaveClass(/paused/)
  await page.screenshot({ path: path.join(output, 'data-narrow-ru.png') })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 900))
  await appearance('Light', 'en')
  while ((await recipeSteps.count()) > 1) await removeStep((await recipeSteps.count()) - 1)

  await updates({
    tag_name: 'v' + newerVersion,
    draft: false,
    prerelease: false,
    html_url: 'https://evil.example',
  })
  const about = await settings('About Sheco')
  await expect(
    about.getByText(
      'Compare this version with the latest stable GitHub release. Installation is manual.',
      { exact: true },
    ),
  ).toHaveCount(0)
  await expect(about.getByRole('button', { name: 'View releases', exact: true })).toHaveCount(0)
  await expect(
    about.getByText('Installed version: ' + installedVersion, { exact: true }),
  ).toBeVisible()
  await about.getByRole('button', { name: 'Check for updates', exact: true }).click()
  await expect(about.getByRole('status')).toContainText('A new version is available.')
  await about.getByRole('button', { name: 'Open release', exact: true }).click()
  expect(await app.evaluate(() => globalThis.__links)).toEqual([
    'https://github.com/shecof/Sheco/releases/tag/v' + newerVersion,
  ])
  await about.getByRole('button', { name: 'Check for updates', exact: true }).click()
  expect(await app.evaluate(() => globalThis.__updateRequests.length)).toBe(1)
  await page.screenshot({ path: path.join(output, 'updates-light-en.png') })
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  const toggle = await settings()
  await toggle.getByRole('switch', { name: 'Enable data tools', exact: true }).click()
  await saved()
  await expect(tools()).toHaveCount(0)
  expect((await snapshot()).plugins.documentTemplates).toEqual(retainedTemplates)
  await toggle.getByRole('switch', { name: 'Enable data tools', exact: true }).click()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await openTool('Data tools')
  await expect(tools().getByRole('textbox', { name: 'Input', exact: true })).toHaveValue('')
  await expect(tools().locator('.data-recipe-step')).toHaveCount(1)
  await close()
  await launch()
  await expect(tools().getByRole('textbox', { name: 'Input', exact: true })).toHaveValue('')
  await checkRestoredTemplates()
  expect((await snapshot()).plugins.documentTemplates).toEqual(retainedTemplates)
  expect((await snapshot()).ui.tabs).toContain(documentTemplatesTab)
  expect((await snapshot()).ui.tabs).toContain(documentTemplatesSettingsTab)
  expect(errors).toEqual([])
  await fs.writeFile(
    path.join(output, 'verification.json'),
    JSON.stringify(
      {
        horizontalRecipe: true,
        dataActions: 45,
        stepParameters: true,
        retainedParametersAfterPauseAndDrag: true,
        literalFilteringAndReplacement: true,
        jsonLinesPrecision: true,
        unicodeForms: true,
        crc32Files: true,
        fullWidthFields: true,
        nativeDragReordering: true,
        canceledDrag: true,
        wrappedDragReordering: true,
        keyboardReordering: true,
        visibleRemoval: true,
        pauseResume: true,
        byteExactFiles: true,
        fileReadCancellation: true,
        restoredTemplates: true,
        retainedTemplateLibraryAndTabs: true,
        sessionOnly: true,
        narrowLayout: true,
        themesAndLanguages: true,
        restart: true,
        errors,
      },
      null,
      2,
    ),
  )
  console.log('Data recipes and restored-template review passed:', output)
} finally {
  if (app) {
    await page?.screenshot({ path: path.join(output, 'last-state.png') }).catch(() => {})
    await app
      .evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
      .catch(() => {})
    await app.close().catch(() => {})
  }
}
