import { _electron as electron, expect } from '@playwright/test'
import { build } from 'esbuild'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sheco-auto-templates-'))
const workspace = path.join(root, 'Knowledge')
const output = path.resolve('test-results/templates')
await fs.mkdir(workspace)
await fs.mkdir(output, { recursive: true })
const bundle = await build({
  stdin: {
    contents:
      "export { seedWorkspace } from './src/shared/seed'; export { createPage, createDatabase } from './src/shared/model'; export { translate } from './src/shared/i18n'; export { documentTemplateSchema } from './src/shared/documentTemplates'; export { validateEditorDocument } from './src/editor/documentSchema'",
    resolveDir: process.cwd(),
  },
  bundle: true,
  // Node fixture validation does not render styles; the compiled app supplies them below.
  loader: { '.css': 'empty' },
  platform: 'node',
  format: 'esm',
  write: false,
})
const seedFile = path.join(root, 'seed.mjs')
await fs.writeFile(seedFile, bundle.outputFiles[0].contents)
const {
  seedWorkspace,
  createPage,
  createDatabase,
  translate,
  documentTemplateSchema,
  validateEditorDocument,
} = await import(pathToFileURL(seedFile).href)
const paragraph = (text) => ({
  type: 'paragraph',
  ...(text ? { content: [{ type: 'text', text }] } : {}),
})
const w = seedWorkspace('Date and time templates', false)
const source = w.pages[0]
source.title = 'Daily note'
source.content = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Daily notes' }] },
    paragraph('Started:  • Finished: {{title}} {{owner}}'),
    {
      type: 'taskList',
      content: [
        { type: 'taskItem', attrs: { checked: true }, content: [paragraph('Retained task')] },
      ],
    },
    {
      type: 'codeBlock',
      attrs: {
        language: 'text',
        title: 'Retained code',
        lineNumbers: false,
        collapsedByDefault: false,
        comments: [{ id: 'date', from: 0, to: 8, text: 'Snapshot date' }],
      },
      content: [{ type: 'text', text: '{{date}} done' }],
    },
    paragraph(''),
  ],
}
const originalSource = structuredClone(source)
const parent = createPage(w, 'Parent', null)
const databasePage = createPage(w, 'Entries', null, 'database')
const database = createDatabase(databasePage.id)
w.pages.push(parent, databasePage)
w.databases.push(database)
const legacy = documentTemplateSchema.parse({
  id: randomUUID(),
  name: 'Legacy template',
  fields: [{ name: 'owner', required: true, defaultValue: 'Old default' }],
  databaseDefaults: {
    databaseId: database.id,
    values: { [database.columns[0].id]: 'In progress' },
  },
  content: { type: 'doc', content: [paragraph('{{title}} {{owner}} {{date}} {{time}}')] },
})
w.plugins.documentTemplates.templates = [legacy]
w.ui.tabs = [source.id]
w.ui.activeId = source.id
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
const errors = []
const tr = (key) => translate(key, language)
const snapshot = async () =>
  JSON.parse(await fs.readFile(path.join(workspace, 'workspace.json'), 'utf8'))
const library = () => page.locator('.template-configuration')
const editor = () => page.getByRole('textbox', { name: tr('Template content'), exact: true })
async function saved() {
  await expect(page.locator('.save-status')).toHaveClass(/\bsaved\b/)
}
async function launch() {
  app = await electron.launch({
    args: [process.env.SHECO_TEST_MAIN ?? '.'],
    env: { ...process.env, SHECO_DATA_DIR: root },
  })
  page = await app.firstWindow()
  page.on('pageerror', (error) => errors.push(error.message))
  await expect(page.locator('.save-status')).toBeVisible({ timeout: 20000 })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 950))
}
async function close() {
  await saved()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await app.close()
  app = undefined
}
async function settings(category = 'Plugins') {
  await page
    .locator('.sidebar-footer')
    .getByRole('button', { name: tr('Settings'), exact: true })
    .click()
  await page.getByRole('tab', { name: tr(category), exact: true }).click()
  return page.getByRole('dialog', { name: tr('Settings'), exact: true })
}
async function enable(value) {
  const dialog = await settings()
  const toggle = dialog.getByRole('switch', { name: tr('Enable document templates'), exact: true })
  if ((await toggle.getAttribute('aria-checked')) !== String(value)) await toggle.click()
  await dialog.getByRole('button', { name: tr('Close'), exact: true }).click()
  await saved()
}
async function tab(title) {
  await page.locator('.tab-open').getByText(title, { exact: true }).click()
}
async function openTemplates() {
  await page
    .locator('.sidebar-footer')
    .getByRole('button', { name: tr('Templates'), exact: true })
    .click()
}
async function picker(scope, label, value) {
  await scope.getByRole('button', { name: tr(label), exact: true }).click()
  await page.getByRole('option', { name: tr(value), exact: true }).click()
}
async function createDialog(parentTitle) {
  if (parentTitle) {
    await page
      .locator('.page-tree .tree-page')
      .getByText(parentTitle, { exact: true })
      .click({ button: 'right' })
  } else {
    await page.getByRole('button', { name: tr('Pages menu'), exact: true }).click()
  }
  await page.getByRole('menuitem', { name: tr('Page from template'), exact: true }).click()
  return page.getByRole('dialog', { name: tr('Page from template'), exact: true })
}
async function create(title, parentTitle) {
  const dialog = await createDialog(parentTitle)
  await picker(dialog, 'Template', 'Daily template')
  await dialog.getByRole('textbox', { name: tr('Page title'), exact: true }).fill(title)
  await expect(dialog.getByRole('textbox')).toHaveCount(1)
  const now = await page.evaluate(() => {
    const d = new Date()
    const pad = (v) => String(v).padStart(2, '0')
    return {
      date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
    }
  })
  await dialog.getByRole('button', { name: tr('Create page'), exact: true }).click()
  await saved()
  const next = (await snapshot()).pages.find((item) => item.title === title)
  expect(JSON.stringify(next.content)).toContain(`Started: ${now.date} ${now.time}`)
  expect(JSON.stringify(next.content)).toContain('{{title}} {{owner}}')
  expect(next.content.content[2]).toEqual(source.content.content[2])
  expect(next.content.content[3].attrs.comments[0]).toMatchObject({ from: 0, to: 10 })
  expect(JSON.stringify(next.content.content.at(-1))).toContain(
    now.date.split('-').reverse().join('.'),
  )
  expect(next.properties).toEqual({})
  validateEditorDocument(next.content)
  return next
}
try {
  await launch()
  await expect(
    page.locator('.sidebar-footer').getByRole('button', { name: 'Templates', exact: true }),
  ).toHaveCount(0)
  await enable(true)
  expect((await snapshot()).plugins.documentTemplates.templates).toEqual([legacy])
  const footerButtons = page.locator('.sidebar-footer > button')
  await expect(footerButtons.nth(0)).toHaveText('Templates')
  await expect(footerButtons.nth(1)).toContainText('Plugins')
  await page.getByRole('button', { name: 'Pages menu', exact: true }).click()
  const rootItems = await page
    .getByRole('menu', { name: 'New page options', exact: true })
    .getByRole('menuitem')
    .allTextContents()
  await page.keyboard.press('Escape')
  await expect(page.locator('.sidebar-new-page')).toHaveCount(0)
  const blank = page.locator('.sidebar-empty-space')
  const blankRect = await blank.boundingBox()
  await blank.click({ button: 'right', position: { x: 15, y: blankRect.height - 15 } })
  await expect(page.getByRole('menu', { name: 'New page options', exact: true })).toBeVisible()
  expect(
    await page
      .getByRole('menu', { name: 'New page options', exact: true })
      .getByRole('menuitem')
      .allTextContents(),
  ).toEqual(rootItems)
  await page.screenshot({ path: path.join(output, 'sidebar-blank-context-light-en.png') })
  await page.keyboard.press('Escape')
  await page
    .locator('.page-tree .tree-page')
    .getByText('Daily note', { exact: true })
    .click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: 'Save as template', exact: true })).toBeVisible()
  await page.screenshot({ path: path.join(output, 'sidebar-capture-light-en.png') })
  await page.getByRole('menuitem', { name: 'Save as template', exact: true }).click()
  await expect(library()).toBeVisible()
  await expect(library().getByRole('textbox', { name: 'Template name', exact: true })).toHaveValue(
    'Daily note',
  )
  await expect(editor()).toContainText('Started:')
  await expect(library().getByText('Field settings', { exact: true })).toHaveCount(0)
  await expect(library().getByRole('textbox', { name: 'Field name', exact: true })).toHaveCount(0)
  await editor().evaluate((el) => {
    let target
    el.editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'paragraph' && node.textContent.startsWith('Started:'))
        target = pos + 1 + 'Started: '.length
    })
    el.editor.commands.setTextSelection(target)
    el.editor.view.focus()
  })
  await library().getByRole('button', { name: 'Current date', exact: true }).click()
  await editor().press('Space')
  await library().getByRole('button', { name: 'Current time', exact: true }).click()
  await expect(editor().locator('.template-date-field')).toHaveCount(2)
  await library()
    .getByRole('textbox', { name: 'Template name', exact: true })
    .fill('Daily template')
  await library().getByRole('button', { name: 'Date format', exact: true }).click()
  await page.getByRole('option', { name: /YYYY-MM-DD$/, exact: false }).click()
  await editor().evaluate((el) => {
    el.editor.commands.setTextSelection(el.editor.state.doc.content.size - 1)
    el.editor.view.focus()
  })
  await library().getByRole('button', { name: 'Current date', exact: true }).click()
  await library().getByRole('button', { name: 'Date format', exact: true }).nth(1).click()
  await page.getByRole('option', { name: /DD\.MM\.YYYY$/, exact: false }).click()
  await library().getByRole('button', { name: 'Undo', exact: true }).click()
  await library().getByRole('button', { name: 'Date format', exact: true }).nth(1).click()
  await expect(page.getByRole('option', { name: /M\/D\/YYYY$/, exact: false })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await page.getByRole('option', { name: /DD\.MM\.YYYY$/, exact: false }).click()
  await expect(library().locator('.template-catalog')).toHaveCount(0)
  await expect(library().getByRole('searchbox')).toHaveCount(0)
  await expect(library().getByRole('textbox', { name: 'Description', exact: true })).toHaveCount(0)
  await library().getByRole('button', { name: 'Save templates', exact: true }).click()
  await saved()
  expect((await snapshot()).pages.find((item) => item.id === source.id)).toEqual(originalSource)
  expect((await snapshot()).plugins.documentTemplates.templates[0]).toEqual(legacy)
  await page.screenshot({ path: path.join(output, 'automatic-editor-light-en.png') })
  await openTemplates()
  await page.screenshot({ path: path.join(output, 'automatic-library-light-en.png') })
  await page
    .locator('.template-library-card')
    .filter({ hasText: 'Daily template' })
    .getByRole('button', { name: 'Create page', exact: true })
    .click()
  let dialog = page.getByRole('dialog', { name: 'Page from template', exact: true })
  await expect(dialog.getByRole('textbox')).toHaveCount(1)
  await dialog.locator('summary').getByText('Template preview', { exact: true }).click()
  await page.screenshot({ path: path.join(output, 'automatic-create-light-en.png') })
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.clock.setFixedTime(new Date(2026, 9, 15, 9, 41))
  const rootPage = await create('Created at 09:41')
  expect(rootPage.parentId).toBeNull()
  await page.clock.setFixedTime(new Date(2026, 9, 16, 14, 25))
  const child = await create('Created tomorrow', 'Parent')
  expect(child.parentId).toBe(parent.id)
  const entry = await create('Created entry', 'Entries')
  expect(entry.databaseId).toBe(database.id)
  await page
    .locator('.page-tree .tree-page')
    .getByText('Parent', { exact: true })
    .click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Save as template', exact: true }).click()
  await expect(library().getByRole('textbox', { name: 'Template name', exact: true })).toHaveValue(
    'Parent',
  )
  await saved()
  expect(
    (await snapshot()).plugins.documentTemplates.templates.find((item) => item.name === 'Parent')
      .content,
  ).toEqual(parent.content)
  const persisted = (await snapshot()).plugins.documentTemplates.templates
  const storedDaily = persisted.find((item) => item.name === 'Daily template').content
  expect(storedDaily.content[1].content.map((node) => node.text ?? '').join('')).toContain(
    '{{date:YYYY-MM-DD}} {{time:HH:mm}}',
  )
  expect(JSON.stringify(storedDaily)).not.toContain('templateDateField')
  await tab('Daily note')
  const pageEditor = page.getByRole('textbox', { name: 'Page content', exact: true })
  await pageEditor.click()
  await page.keyboard.press('ControlOrMeta+Shift+T')
  dialog = page.getByRole('dialog', { name: 'Insert template', exact: true })
  await picker(dialog, 'Template', 'Legacy template')
  await expect(dialog.getByRole('textbox')).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await saved()
  expect((await snapshot()).pages.find((item) => item.id === source.id)).toEqual(originalSource)
  let settingsDialog = await settings('General')
  await settingsDialog.getByRole('button', { name: 'Dark', exact: true }).click()
  await settingsDialog.getByRole('button', { name: 'Русский', exact: true }).click()
  language = 'ru'
  await page
    .getByRole('dialog', { name: tr('Settings'), exact: true })
    .getByRole('button', { name: tr('Close'), exact: true })
    .click()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 850))
  await expect(page.locator('.sidebar-new-page')).toHaveCount(0)
  await openTemplates()
  await page
    .locator('.template-library-card')
    .filter({ hasText: 'Daily template' })
    .getByRole('button', { name: tr('Edit template') + ': Daily template', exact: true })
    .click()
  await expect(
    library().getByRole('button', { name: tr('Current date'), exact: true }),
  ).toBeVisible()
  await expect(
    library().getByRole('button', { name: tr('Current time'), exact: true }),
  ).toBeVisible()
  await library()
    .getByRole('heading', { name: tr('Edit template'), exact: true })
    .scrollIntoViewIfNeeded()
  await page.screenshot({ path: path.join(output, 'automatic-editor-dark-ru.png') })
  await library()
    .getByRole('button', { name: tr('Date format'), exact: true })
    .first()
    .click()
  await expect(page.getByRole('option')).toHaveCount(4)
  await expect(page.getByRole('option').filter({ hasText: tr('Local date format') })).toHaveCount(0)
  await page.keyboard.press('Escape')
  dialog = await createDialog()
  await picker(dialog, 'Template', 'Daily template')
  await page.screenshot({ path: path.join(output, 'automatic-create-dark-ru.png') })
  await dialog.getByRole('button', { name: tr('Cancel'), exact: true }).click()
  await enable(false)
  await expect(
    page.locator('.sidebar-footer').getByRole('button', { name: tr('Templates'), exact: true }),
  ).toHaveCount(0)
  expect((await snapshot()).plugins.documentTemplates.templates).toEqual(persisted)
  await enable(true)
  await close()
  await launch()
  await expect(
    page.locator('.sidebar-footer').getByRole('button', { name: tr('Templates'), exact: true }),
  ).toBeVisible()
  expect((await snapshot()).plugins.documentTemplates.templates).toEqual(persisted)
  expect((await snapshot()).pages.find((item) => item.id === source.id)).toEqual(originalSource)
  expect(errors).toEqual([])
  await fs.writeFile(
    path.join(output, 'verification.json'),
    JSON.stringify(
      {
        passed: true,
        dateTimeOnly: true,
        inlineFormats: true,
        focusedEditor: true,
        sidebarCaptureAndBlankContext: true,
        sidebarTemplates: true,
        captureAndAuthoring: true,
        originalPreserved: true,
        legacyRetained: true,
        rootChildDatabasePages: true,
        creationTimeSnapshots: true,
        codeAnnotations: true,
        disableRestart: true,
        themesLanguagesNarrow: true,
        workspace,
        errors,
      },
      null,
      2,
    ),
  )
  console.log('Automatic template review passed:', output)
} finally {
  if (app) {
    await page?.screenshot({ path: path.join(output, 'last-state.png') }).catch(() => {})
    await app
      .evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
      .catch(() => {})
    await app.close().catch(() => {})
  }
}
