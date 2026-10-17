import { _electron as electron, expect } from '@playwright/test'
import { build } from 'esbuild'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { pathToFileURL } from 'node:url'

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sheco-jira-inline-'))
const workspace = path.join(root, 'Knowledge'),
  output = path.resolve('test-results/jira-inline')
await fs.mkdir(workspace)
await fs.mkdir(output, { recursive: true })
let status = 'In progress',
  delayed
const requests = []
const server = http.createServer((request, response) => {
  const key = request.url?.match(/\/issue\/(PROJECT-\d+)/)?.[1]
  requests.push({
    key,
    authenticated: request.headers.authorization === 'Bearer synthetic-inline-token',
  })
  const reply = () => {
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(
      JSON.stringify({
        key,
        fields: {
          summary: 'Prepare the desktop release',
          status: {
            name: status,
            statusCategory: { key: status === 'Done' ? 'done' : 'indeterminate' },
          },
          duedate: '2026-10-20',
        },
      }),
    )
  }
  if (delayed) delayed = { reply }
  else reply()
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const baseUrl = `http://127.0.0.1:${server.address().port}`
const bundle = await build({
  stdin: {
    contents: "export { seedWorkspace } from './src/shared/seed'",
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
})
const modulePath = path.join(root, 'seed.mjs')
await fs.writeFile(modulePath, bundle.outputFiles[0].contents)
const { seedWorkspace } = await import(pathToFileURL(modulePath).href)
const w = seedWorkspace('Inline Jira review', false)
w.plugins.jira = {
  ...w.plugins.jira,
  enabled: true,
  connections: [{ id: crypto.randomUUID(), name: '', baseUrl, authType: 'pat' }],
}
w.pages[0].title = 'Jira tasks in context'
const text = (text, marks) => ({ type: 'text', text, ...(marks ? { marks } : {}) })
const p = (...content) => ({ type: 'paragraph', content })
const issue = (key, display = 'minimal') => ({
  type: 'jiraIssue',
  attrs: {
    baseUrl,
    issueKey: key,
    display,
    summary: 'Prepare the desktop release',
    status: key === 'PROJECT-2' ? 'Done' : 'In progress',
    statusCategory: key === 'PROJECT-2' ? 'done' : 'indeterminate',
    dueDate: '2026-10-20',
    fetchedAt: '',
  },
})
const inlineIssue = (key, status = 'In progress', statusCategory = 'indeterminate') => {
  const snapshot = issue(key)
  return {
    ...snapshot,
    type: 'jiraIssueInline',
    attrs: { ...snapshot.attrs, status, statusCategory },
  }
}
w.pages[0].content = {
  type: 'doc',
  content: [
    p(text('A task inside a sentence: ')),
    issue('PROJECT-1'),
    p(text('This separate paragraph stays separate.')),
    {
      type: 'orderedList',
      attrs: { start: 3 },
      content: [
        {
          type: 'listItem',
          content: [
            p(text('Review ', [{ type: 'bold' }])),
            issue('PROJECT-2'),
            p(text('Another paragraph in the same item.')),
          ],
        },
        {
          type: 'listItem',
          content: [p(text('Release checklist')), issue('PROJECT-3', 'detailed')],
        },
      ],
    },
    p(
      text('Ordinary text '),
      inlineIssue('PROJECT-9', 'Done', 'done'),
      text(' with another task '),
      inlineIssue('PROJECT-10', 'To do', 'new'),
      text(' and a reference in the middle '),
      inlineIssue('PROJECT-11', 'To do', 'new'),
      text(' of this paragraph '),
      inlineIssue('PROJECT-12'),
      text(' followed by '),
      inlineIssue('PROJECT-13', 'To do', 'new'),
      text(' more text.'),
    ),
    p(text('Insert a reference here: end.')),
  ],
}
await fs.writeFile(path.join(workspace, 'workspace.json'), JSON.stringify(w))
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
  page.on('pageerror', (error) => errors.push(error.message))
  await expect(page.locator('.document-editor')).toBeVisible({ timeout: 20000 })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 900))
}
const badge = (key) =>
  page.locator('.jira-block').filter({ has: page.getByRole('button', { name: key, exact: true }) })
async function doc() {
  return page.locator('.document-editor').evaluate((element) => element.editor.getJSON())
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
async function view(key, label) {
  await badge(key).hover()
  await badge(key)
    .getByRole('button', { name: /Jira block view|Вид блока Jira/ })
    .click()
  await page.locator('.popover').getByRole('button', { name: label, exact: true }).click()
}
async function appearance(theme, language, ru = false) {
  await page
    .locator('.sidebar-footer')
    .getByRole('button', { name: ru ? 'Настройки' : 'Settings', exact: true })
    .click()
  await page.getByRole('tab', { name: ru ? 'Общие' : 'General', exact: true }).click()
  await page.getByRole('button', { name: theme, exact: true }).click()
  await page.getByRole('button', { name: language, exact: true }).click()
  await page
    .getByRole('button', { name: language === 'Русский' ? 'Закрыть' : 'Close', exact: true })
    .click()
  await saved()
}
async function compactReferences() {
  const sizes = await page.locator('.jira-inline').evaluateAll((nodes) =>
    nodes.map((node) => {
      const box = node.getBoundingClientRect(),
        statusNode = node.querySelector('.jira-status'),
        status = statusNode.getBoundingClientRect(),
        wrapper = node.closest('.node-jiraIssueInline').getBoundingClientRect(),
        style = getComputedStyle(node),
        statusStyle = getComputedStyle(statusNode)
      return {
        top: status.top - box.top - parseFloat(style.borderTopWidth),
        bottom: box.bottom - status.bottom - parseFloat(style.borderBottomWidth),
        right: box.right - status.right - parseFloat(style.borderRightWidth),
        before: box.left - wrapper.left,
        after: wrapper.right - box.right,
        height: box.height,
        borders: [style, statusStyle].flatMap((style) =>
          ['Top', 'Right', 'Bottom', 'Left'].map((side) => parseFloat(style[`border${side}Width`])),
        ),
        statusBackground: statusStyle.backgroundColor,
        background: style.backgroundColor,
      }
    }),
  )
  expect(sizes.length).toBeGreaterThan(0)
  for (const {
    top,
    bottom,
    right,
    before,
    after,
    height,
    borders,
    statusBackground,
    background,
  } of sizes) {
    expect(right).toBeGreaterThanOrEqual(5.5)
    expect(right).toBeLessThanOrEqual(6.5)
    expect(top).toBeGreaterThanOrEqual(2.5)
    expect(top).toBeLessThanOrEqual(3.5)
    expect(Math.abs(top - bottom)).toBeLessThanOrEqual(0.5)
    expect(before).toBeGreaterThanOrEqual(1.5)
    expect(after).toBeLessThanOrEqual(2.5)
    expect(Math.abs(before - after)).toBeLessThanOrEqual(0.5)
    expect(height).toBeLessThanOrEqual(23)
    expect(borders.every((width) => width === 0)).toBe(true)
    expect(statusBackground).toBe('rgba(0, 0, 0, 0)')
    expect(background).not.toBe('rgba(0, 0, 0, 0)')
  }
  const rows = await page
    .locator('.document-editor p')
    .filter({ hasText: 'Ordinary text' })
    .locator('.jira-inline')
    .evaluateAll((nodes) => {
      const rows = []
      for (const node of nodes) {
        const { top, bottom } = node.getBoundingClientRect()
        if (!rows.some((row) => Math.abs(row.top - top) < 1)) rows.push({ top, bottom })
      }
      return rows
    })
  expect(rows.length).toBeGreaterThan(1)
  for (let i = 1; i < rows.length; i++)
    expect(rows[i].top - rows[i - 1].bottom).toBeGreaterThanOrEqual(4)
}
try {
  await launch()
  await expect(badge('PROJECT-1')).toHaveClass(/jira-inline/)
  await expect(badge('PROJECT-2')).toHaveClass(/jira-inline/)
  await compactReferences()
  // Inline atoms at the end of a paragraph/list leave a real gap before the native caret.
  for (const key of ['PROJECT-1', 'PROJECT-2']) {
    const gap = await page.locator('.document-editor').evaluate((element, key) => {
      const editor = element.editor
      let pos
      editor.state.doc.descendants((node, at) => {
        if (node.attrs.issueKey === key) pos = at + node.nodeSize
      })
      editor.chain().focus().setTextSelection(pos).run()
      const view = editor.view.nodeDOM(pos - 1),
        badge = view.querySelector('.jira-inline')
      return editor.view.coordsAtPos(pos).left - badge.getBoundingClientRect().right
    }, key)
    expect(gap).toBeGreaterThanOrEqual(1.5)
  }
  await page.mouse.move(10, 10)
  await expect(badge('PROJECT-1').locator('.jira-actions')).toHaveCSS('pointer-events', 'none')
  await badge('PROJECT-1').hover()
  await expect(badge('PROJECT-1').locator('.jira-actions')).toHaveCSS('pointer-events', 'auto')
  expect(requests.length).toBe(0)
  await page.evaluate(
    ({ workspaceId, baseUrl }) =>
      window.sheco.configureJira({
        workspaceId,
        baseUrl,
        credentials: { type: 'pat', pat: 'synthetic-inline-token' },
      }),
    { workspaceId: w.id, baseUrl },
  )
  const migrated = await doc()
  expect(migrated.content[0].content.at(-1).type).toBe('jiraIssueInline')
  expect(migrated.content[1].content[0].text).toBe('This separate paragraph stays separate.')
  expect(migrated.content[2].attrs.start).toBe(3)
  await view('PROJECT-2', 'Detailed')
  await expect(badge('PROJECT-2')).toHaveClass(/detailed/)
  await view('PROJECT-2', 'Minimal')
  expect(await doc()).toEqual(migrated)
  await page.locator('.document-editor').evaluate((element) => element.editor.commands.undo())
  await expect(badge('PROJECT-2')).toHaveClass(/detailed/)
  await page.locator('.document-editor').evaluate((element) => element.editor.commands.redo())
  expect(await doc()).toEqual(migrated)
  await page.locator('.document-editor').evaluate((element) => {
    const editor = element.editor
    let pos
    editor.state.doc.descendants((node, at) => {
      if (node.isText && node.text.startsWith('Insert a reference here:'))
        pos = at + node.text.indexOf('end.')
    })
    editor.chain().focus().setTextSelection(pos).run()
  })
  await expect(page.locator('.document-editor')).toBeFocused()
  await page.keyboard.type('/jira-inline')
  await page
    .locator('.command-palette')
    .getByRole('option')
    .filter({ has: page.getByText('Jira issue in text', { exact: true }) })
    .click()
  await expect(page.locator('.jira-inline .jira-insert')).toBeVisible()
  await expect(page.locator('.jira-insert-popover')).toHaveCount(0)
  await page.getByRole('textbox', { name: 'Jira issue key or URL', exact: true }).fill('PROJECT-4')
  await page.getByRole('button', { name: 'Add issue', exact: true }).click()
  await expect(badge('PROJECT-4')).toHaveClass(/jira-inline/)
  await expect(page.locator('.document-editor')).toBeFocused()
  await expect(badge('PROJECT-4').locator('.jira-status')).toHaveText('In progress')
  const added = await doc()
  expect(added.content.at(-1).content.map((node) => node.type)).toEqual([
    'text',
    'jiraIssueInline',
    'text',
  ])
  expect(added.content.at(-1).content.at(-1).text).toBe('end.')
  await view('PROJECT-4', 'Detailed')
  await view('PROJECT-4', 'Minimal')
  expect(await doc()).toEqual(added)
  // Replace a selected issue in-place, keep surrounding text, and undo the snapshot change.
  await badge('PROJECT-4').hover()
  await badge('PROJECT-4').getByRole('button', { name: 'Change Jira issue', exact: true }).click()
  await page.locator('.jira-editing').getByRole('textbox').fill('PROJECT-8')
  await page.locator('.jira-editing').getByRole('textbox').press('Enter')
  await expect(badge('PROJECT-8')).toBeVisible()
  await expect(page.locator('.document-editor')).toBeFocused()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z')
  await expect(badge('PROJECT-4')).toBeVisible()
  expect(await doc()).toEqual(added)

  await page.locator('.document-editor').evaluate((element) => {
    const editor = element.editor
    let pos
    editor.state.doc.descendants((node, at) => {
      if (node.attrs.issueKey === 'PROJECT-4') pos = at + node.nodeSize
    })
    editor.chain().focus().setTextSelection(pos).run()
  })
  await expect(page.locator('.document-editor')).toBeFocused()
  await page.keyboard.type(' after ')
  expect((await doc()).content.at(-1).content.at(-1).text).toBe(' after end.')
  const beforeHTML = await doc()
  const html = await page
    .locator('.document-editor')
    .evaluate((element) => element.editor.getHTML())
  await page
    .locator('.document-editor')
    .evaluate((element, html) => element.editor.commands.setContent(html), html)
  expect(await doc()).toEqual(beforeHTML)
  // Use native editor clipboard handlers without touching the system clipboard.
  const clipboard = await page.locator('.document-editor').evaluate((element) => {
    const editor = element.editor
    let pos
    editor.state.doc.descendants((node, at) => {
      if (node.attrs.issueKey === 'PROJECT-4') pos = at
    })
    editor.commands.setNodeSelection(pos)
    const transfer = new DataTransfer()
    editor.view.dom.dispatchEvent(
      new ClipboardEvent('copy', { clipboardData: transfer, bubbles: true, cancelable: true }),
    )
    return { html: transfer.getData('text/html'), text: transfer.getData('text/plain') }
  })
  expect(clipboard.html).toContain('data-type="jira-issue-inline"')
  expect(clipboard.text).toContain('PROJECT-4')
  expect(clipboard.text).toContain('In progress')
  await page.locator('.document-editor').evaluate((element, clipboard) => {
    const editor = element.editor
    editor.commands.insertContentAt(editor.state.doc.content.size, {
      type: 'paragraph',
      content: [{ type: 'text', text: 'Copied: ' }],
    })
    editor
      .chain()
      .focus()
      .setTextSelection(editor.state.doc.content.size - 1)
      .run()
    const transfer = new DataTransfer()
    transfer.setData('text/html', clipboard.html)
    transfer.setData('text/plain', clipboard.text)
    editor.view.dom.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }),
    )
  }, clipboard)
  expect((await doc()).content.at(-1).content.map((node) => node.type)).toEqual([
    'text',
    'jiraIssueInline',
  ])
  await page.locator('.document-editor').evaluate((element) => {
    const editor = element.editor
    let pos, paragraph
    editor.state.doc.descendants((node, at) => {
      if (node.type.name === 'paragraph' && node.textContent.startsWith('Copied:'))
        paragraph = { from: at, to: at + node.nodeSize }
      if (node.attrs.issueKey === 'PROJECT-4') pos = at
    })
    editor.commands.setNodeSelection(pos)
    const transfer = new DataTransfer()
    editor.view.dom.dispatchEvent(
      new ClipboardEvent('cut', { clipboardData: transfer, bubbles: true, cancelable: true }),
    )
    if (editor.state.doc.nodeAt(paragraph.from)?.textContent !== 'Copied: ')
      throw new Error('Cut did not remove the pasted mention')
    editor.commands.deleteRange({ from: paragraph.from, to: paragraph.to - 1 })
  })
  expect(await doc()).toEqual(beforeHTML)
  delayed = {}
  await badge('PROJECT-1').hover()
  await badge('PROJECT-1').getByRole('button', { name: 'Refresh Jira issue', exact: true }).click()
  await expect.poll(() => !!delayed.reply).toBe(true)
  await page.locator('.document-editor').evaluate((element) => {
    const editor = element.editor
    let pos
    editor.state.doc.descendants((node, at) => {
      if (node.attrs.issueKey === 'PROJECT-1') pos = at
    })
    editor.commands.deleteRange({ from: pos, to: pos + 1 })
    editor.commands.insertContentAt(editor.state.doc.content.size, {
      type: 'paragraph',
      content: [{ type: 'text', text: 'Typing while loading.' }],
    })
  })
  const removed = await doc()
  delayed.reply()
  delayed = undefined
  await page.waitForTimeout(200)
  expect(await doc()).toEqual(removed)
  await page
    .locator('.document-editor')
    .evaluate((element, doc) => element.editor.commands.setContent(doc), beforeHTML)
  status = 'Done'
  await badge('PROJECT-1').hover()
  await badge('PROJECT-1').getByRole('button', { name: 'Refresh Jira issue', exact: true }).click()
  await expect(badge('PROJECT-1').locator('.jira-status')).toHaveText('Done')
  await page.locator('.document-editor').evaluate((element) => element.editor.commands.undo())
  expect(await doc()).toEqual(beforeHTML)
  await page.locator('.document-editor').evaluate((element) => element.editor.commands.redo())
  await expect(badge('PROJECT-1').locator('.jira-status')).toHaveText('Done')
  const finalDoc = await doc(),
    count = requests.length
  await close()
  await launch()
  expect(await doc()).toEqual(finalDoc)
  expect(requests.length).toBe(count)
  await page.screenshot({ path: path.join(output, 'inline-light-en.png') })
  await compactReferences()
  await appearance('Dark', 'English')
  await compactReferences()
  await page.screenshot({ path: path.join(output, 'inline-dark-en.png') })
  await appearance('Dark', 'Русский')
  await compactReferences()
  await page.screenshot({ path: path.join(output, 'inline-dark-ru.png') })
  await appearance('Светлая', 'Русский', true)
  await compactReferences()
  await page.screenshot({ path: path.join(output, 'inline-light-ru.png') })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(800, 700))
  for (const step of [-4, -2, 0, 2, 4]) {
    await page
      .locator('.document-editor')
      .evaluate((element, step) => element.style.setProperty('--reading-step', `${step}px`), step)
    await compactReferences()
  }
  await page
    .locator('.document-editor')
    .evaluate((element) => element.style.removeProperty('--reading-step'))
  const bounds = await page.locator('.jira-block').evaluateAll((nodes) =>
    nodes.map((node) => ({
      width: node.scrollWidth <= node.clientWidth,
      right: node.getBoundingClientRect().right <= innerWidth,
    })),
  )
  expect(bounds.every((item) => item.width && item.right)).toBe(true)
  await page.screenshot({ path: path.join(output, 'inline-narrow-ru.png') })
  await page.emulateMedia({ media: 'print' })
  await expect(page.locator('.jira-actions').first()).toBeHidden()
  await expect(badge('PROJECT-1').locator('.jira-status')).toBeVisible()
  await page.emulateMedia({ media: null })
  await app.evaluate(
    ({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath })
    },
    path.join(output, 'inline.pdf'),
  )
  await page.evaluate((id) => window.sheco.exportPage(id, 'pdf'), w.pages[0].id)
  expect((await fs.stat(path.join(output, 'inline.pdf'))).size).toBeGreaterThan(1000)
  expect(requests.every((request) => request.authenticated)).toBe(true)
  expect(errors).toEqual([])
  await fs.writeFile(
    path.join(output, 'verification.json'),
    JSON.stringify(
      {
        migrated: true,
        inlineInsertion: true,
        listRoundTrip: true,
        undoRedo: true,
        htmlRoundTrip: true,
        inlineClipboard: true,
        staleReplyIgnored: true,
        offlineRestart: true,
        balancedInlineSpacing: true,
        singleMentionSurface: true,
        wrappedLineClearance: true,
        requests,
        errors,
      },
      null,
      2,
    ),
  )
  console.log('Inline Jira desktop review passed:', output)
} finally {
  if (app) {
    await page?.screenshot({ path: path.join(output, 'last-state.png') }).catch(() => {})
    await app
      .evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close())
      .catch(() => {})
    await app.close().catch(() => {})
  }
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
}
