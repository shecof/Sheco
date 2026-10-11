import { _electron as electron, expect } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sheco-review-'))
const output = path.resolve('test-results/review')
await fs.mkdir(output, { recursive: true })
let app
let page
const errors = []
const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
async function launch() {
  app = await electron.launch({ args: ['.'], env: { ...process.env, SHECO_DATA_DIR: root } })
  page = await app.firstWindow()
  page.on('pageerror', (e) => errors.push(e.message))
  await expect(page.getByLabel('Page title')).toBeVisible({ timeout: 20000 })
}
async function saved() {
  await expect(page.locator('.save-status')).toHaveClass(/\bsaved\b/)
}
async function floatingPopover(locator) {
  await expect(locator).toBeVisible()
  expect(await locator.evaluate((el) => el.parentElement === document.body)).toBe(true)
  expect(await locator.evaluate((el) => getComputedStyle(el).position)).toBe('fixed')
  const box = await locator.boundingBox()
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  expect(box.x).toBeGreaterThanOrEqual(8)
  expect(box.y).toBeGreaterThanOrEqual(8)
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width - 7)
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height - 7)
}
async function menu(action) {
  await app.evaluate(
    ({ BrowserWindow }, action) =>
      BrowserWindow.getAllWindows()[0].webContents.send('menu', action),
    action,
  )
}
async function slash(command) {
  await page.locator('.document-editor > p').last().click()
  await page.keyboard.type('/' + command)
  await page.keyboard.press('Enter')
}
async function dragStart(source, target, axis, fraction) {
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer())
  await source.dispatchEvent('dragstart', { dataTransfer })
  const rect = await target.boundingBox()
  const coords = {
    clientX: rect.x + rect.width * (axis === 'x' ? fraction : 0.5),
    clientY: rect.y + rect.height * (axis === 'y' ? fraction : 0.5),
  }
  await target.dispatchEvent('dragover', { dataTransfer, ...coords })
  return { dataTransfer, coords }
}
async function dragFinish(source, target, transfer) {
  await target.dispatchEvent('drop', { dataTransfer: transfer.dataTransfer, ...transfer.coords })
  await source.dispatchEvent('dragend', { dataTransfer: transfer.dataTransfer })
  await transfer.dataTransfer.dispose()
}
try {
  await launch()
  expect(
    await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--green').trim(),
    ),
  ).toBe('#252525')
  console.log('Review: launched')
  // Name editing must not navigate, and opening remains a distinct action.
  await page.getByRole('button', { name: 'Rename Nmap', exact: true }).click()
  expect(
    await page
      .getByLabel('Name for Nmap', { exact: true })
      .evaluate((el) => getComputedStyle(el).borderTopWidth),
  ).toBe('0px')
  expect(
    await page
      .locator('.database-table td:has(.record-title-input)')
      .evaluate((el) => getComputedStyle(el).boxShadow),
  ).not.toBe('none')
  await page.screenshot({ path: path.join(output, 'record-name-edit.png') })
  await page.getByLabel('Name for Nmap', { exact: true }).fill('Nmap revised')
  await page.getByLabel('Name for Nmap', { exact: true }).press('Enter')
  await expect(page.getByLabel('Page title')).toHaveValue('Tools')
  await page.getByRole('button', { name: 'Open Nmap revised', exact: true }).click()
  await expect(page.getByLabel('Page title')).toHaveValue('Nmap revised')
  await page.locator('.favorite-pages').getByRole('button', { name: 'Tools', exact: true }).click()
  console.log('Review: names')
  // Property editing is anchored, and its nested type menu stays within the same popup family.
  await page.getByRole('button', { name: 'Database properties', exact: true }).click()
  await page
    .locator('.columns-popover')
    .getByRole('button', { name: 'Edit Category', exact: true })
    .click()
  await expect(page.getByRole('dialog', { name: 'Edit property', exact: true })).toBeVisible()
  await expect(page.locator('.modal-overlay')).toHaveCount(0)
  await page.getByRole('button', { name: 'Property type', exact: true }).click()
  await expect(page.getByRole('listbox', { name: 'Property type', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.property-type-popover')).toHaveCount(0)
  await expect(page.getByRole('dialog', { name: 'Edit property', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Property type', exact: true }).click()
  await page.getByRole('option', { name: 'Number', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Property type', exact: true })).toContainText(
    'Number',
  )
  await expect(page.getByRole('dialog', { name: 'Edit property', exact: true })).toBeVisible()
  await page.screenshot({ path: path.join(output, 'property-editor.png') })
  await page.getByLabel('Page title').click()
  await expect(page.locator('.column-editor-popover')).toHaveCount(0)
  await expect(page.locator('.column-header').filter({ hasText: 'Category' })).toBeVisible()
  // Highlight and commit both ends of a row drop.
  const sourceRow = page.locator('.database-table tbody tr').filter({ hasText: 'Nmap revised' })
  const source = sourceRow.locator('.row-handle')
  const target = page.locator('.database-table tbody tr').filter({ hasText: 'jwt.io' })
  const before = await dragStart(source, target, 'y', 0.15)
  await expect(target).toHaveClass('row-drop-before')
  await page.screenshot({ path: path.join(output, 'row-drop.png') })
  await dragFinish(source, target, before)
  await expect(page.locator('.record-title').first()).toHaveText('Nmap revised')
  const after = await dragStart(source, target, 'y', 0.85)
  await expect(target).toHaveClass('row-drop-after')
  await dragFinish(source, target, after)
  await expect(page.locator('.record-title').nth(1)).toHaveText('Nmap revised')
  console.log('Review: rows')
  // Column drop marker extends through the visible cells.
  const columnSource = page.locator('.database-table th').filter({ hasText: 'Category' })
  const columnTarget = page.locator('.database-table th').filter({ hasText: 'Description' })
  const columnBefore = await dragStart(columnSource, columnTarget, 'x', 0.1)
  await expect(columnTarget).toHaveClass('column-drop-before')
  await expect(page.locator('tbody .column-drop-before')).toHaveCount(10)
  await page.screenshot({ path: path.join(output, 'column-drop.png') })
  await dragFinish(columnSource, columnTarget, columnBefore)
  await expect(page.locator('.database-table th').nth(1)).toContainText('Category')
  const columnAfter = await dragStart(columnSource, columnTarget, 'x', 0.9)
  await expect(columnTarget).toHaveClass('column-drop-after')
  await dragFinish(columnSource, columnTarget, columnAfter)
  await expect(page.locator('.database-table th').nth(2)).toContainText('Category')
  await page.locator('.space-switcher > button').click()
  const avatar = await page.locator('.mini-avatar').boundingBox()
  expect(avatar.width).toBe(avatar.height)
  await page.screenshot({ path: path.join(output, 'workspace.png') })
  await page.keyboard.press('Escape')
  console.log('Review: columns and workspace')
  await menu('newPage')
  await expect(page.getByLabel('Page title')).toHaveValue('Untitled')
  await page.getByLabel('Page title').fill('Design review')
  await page.getByTitle('Change page icon').click()
  expect(
    (await page.locator('.icon-picker-content .search-input').boundingBox()).height,
  ).toBeGreaterThanOrEqual(38)
  expect(
    await page.getByLabel('Search icons').evaluate((el) => el.scrollHeight <= el.clientHeight),
  ).toBe(true)
  await page.screenshot({ path: path.join(output, 'icon-search.png') })
  expect(await page.locator('.icon-picker-grid button').count()).toBeGreaterThan(200)
  await page.getByLabel('Search icons').fill('flying saucer')
  await page.getByRole('button', { name: 'flying saucer UFO', exact: true }).click()
  await expect(page.getByTitle('Change page icon')).toContainText('🛸')
  await expect(page.locator('.page-eyebrow')).toHaveCount(0)
  await expect(page.locator('.editor-bottom, .backlinks-section')).toHaveCount(0)
  console.log('Review: page and icons')
  // Callout styles and icons use a searchable app dialog and persist attributes.
  await slash('callout')
  await page.getByRole('button', { name: 'Customize callout', exact: true }).click()
  for (const color of ['yellow', 'red', 'green', 'gray']) {
    await page.getByRole('button', { name: color + ' background', exact: true }).click()
    await expect(page.locator('.callout-block')).toHaveClass(new RegExp('callout-' + color))
  }
  await page.getByRole('button', { name: 'yellow background', exact: true }).click()
  await page.getByLabel('Search icons').fill('pin')
  await page.getByRole('button', { name: 'pin', exact: true }).click()
  await expect(page.locator('.callout-emoji')).toContainText('📌')
  await page.locator('.callout-content p').click()
  await page.keyboard.type('Keep the details close. Your knowledge stays on this device.')
  console.log('Review: callout')
  await slash('code')
  await page.getByRole('button', { name: 'Code language', exact: true }).click()
  await expect(page.locator('.code-header select')).toHaveCount(0)
  await page.getByLabel('Search languages').fill('typescript')
  await page.getByRole('option', { name: 'typescript', exact: true }).click()
  await expect(page.locator('.code-language')).toHaveText('typescript')
  await page.locator('.code-block code').click()
  await page.keyboard.type('const knowledge = { local: true, yours: true };')
  console.log('Review: code')
  await slash('toggle')
  await page.locator('.document-editor summary').click()
  await page.keyboard.type('A few things worth keeping')
  await expect(page.locator("[data-type='details']")).not.toHaveClass(/is-open/)
  await page.locator("[data-type='details'] > button").click()
  await expect(page.locator("[data-type='details']")).toHaveClass(/is-open/)
  await page.locator("[data-type='details'] > button").click()
  console.log('Review: toggle')
  // Separate plus controls insert real blocks above and below the hovered block.
  await page.locator('.callout-block').hover()
  await page.getByLabel('Block options', { exact: true }).hover()
  await expect(page.getByLabel('Insert block above', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Insert block below', { exact: true })).toBeVisible()
  await page.getByLabel('Insert block above', { exact: true }).click()
  await expect(page.locator('.command-palette')).toHaveCount(0)
  expect(
    await page.evaluate(() => {
      const node = window.getSelection()?.anchorNode
      return (node?.nodeType === 1 ? node : node?.parentElement)?.closest('p')?.textContent
    }),
  ).toBe('')
  await page.keyboard.type('/h2')
  await expect(page.locator('.command-palette')).toBeVisible()
  await page.keyboard.press('Enter')
  await page.keyboard.type('Make room for the useful things')
  await page.locator('.callout-block').hover()
  await page.getByLabel('Block options', { exact: true }).hover()
  await page.getByLabel('Insert block below', { exact: true }).click()
  await expect(page.locator('.command-palette')).toHaveCount(0)
  expect(
    await page.evaluate(() => {
      const node = window.getSelection()?.anchorNode
      return (node?.nodeType === 1 ? node : node?.parentElement)?.closest('p')?.textContent
    }),
  ).toBe('')
  await page.keyboard.type('Write a note, connect an idea, or collect a little more context.')
  console.log('Review: block inserts')
  // Inline database stays on the note and its rows remain complete pages.
  await slash('database')
  await expect(page.getByLabel('Page title')).toHaveValue('Design review')
  await expect(page.locator('.database-embed .database-table')).toBeVisible()
  await page.getByLabel('Database name').fill('Reading list')
  await page.locator('.database-embed').getByRole('button', { name: 'New', exact: true }).click()
  await expect(page.getByLabel('Page title')).toHaveValue('Design review')
  await page.getByRole('button', { name: 'Rename Untitled', exact: true }).click()
  await page.getByLabel('Name for Untitled', { exact: true }).fill('A field guide to better notes')
  await page.getByLabel('Name for Untitled', { exact: true }).press('Enter')
  await page.locator('.database-embed .property-field').click()
  const propertyMenu = page.locator('.property-popover')
  await floatingPopover(propertyMenu)
  // A visible button must also be reachable through the actual painted surface.
  const done = propertyMenu.getByRole('button', { name: 'Done', exact: true })
  expect(
    await done.evaluate((el) => {
      const box = el.getBoundingClientRect()
      return el.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2))
    }),
  ).toBe(true)
  await page.screenshot({ path: path.join(output, 'inline-property-popover.png') })
  await page.keyboard.press('Escape')
  await expect(propertyMenu).toHaveCount(0)
  // Exercise horizontal scrolling in a narrow inline table without changing its schema.
  const databaseScroll = page.locator('.database-embed .database-scroll')
  await databaseScroll.evaluate((el) => {
    el.style.maxWidth = '360px'
  })
  const statusField = page.locator('.database-embed .property-field')
  await statusField.click({ position: { x: 20, y: 20 } })
  await floatingPopover(propertyMenu)
  const beforeScroll = await propertyMenu.boundingBox()
  const delta = await databaseScroll.evaluate((el) => {
    const before = el.scrollLeft
    el.scrollLeft += 30
    return el.scrollLeft - before
  })
  expect(delta).toBeGreaterThan(0)
  await expect
    .poll(async () => (await propertyMenu.boundingBox()).x)
    .toBeCloseTo(beforeScroll.x - delta, 0)
  await page.getByRole('button', { name: 'In progress', exact: true }).click()
  await expect(page.locator('.property-popover')).toHaveCount(0)
  await databaseScroll.evaluate((el) => {
    el.style.maxWidth = ''
    el.scrollLeft = 0
  })
  const inline = page.locator('.database-embed')
  for (const [button, popup] of [
    ['Table', '.view-popover'],
    ['Filter', '.filter-popover'],
    ['Sort', '.database-popover'],
    ['Database properties', '.columns-popover'],
  ]) {
    await inline.getByRole('button', { name: button, exact: true }).click()
    await floatingPopover(page.locator(popup))
    await page.keyboard.press('Escape')
    await expect(page.locator(popup)).toHaveCount(0)
  }
  console.log('Review: unclipped inline status/toolbar popovers and horizontal scroll tracking')
  await page.locator('.page-title').click()
  await saved()
  // Block action coordinates stay in the viewport, including on a scrolled note.
  const block = page.locator('.callout-block')
  await block.scrollIntoViewIfNeeded()
  await block.evaluate((el) => {
    const scroll = el.closest('.content-scroll')
    scroll.scrollTop += el.getBoundingClientRect().top - 240
  })
  expect(await page.locator('.content-scroll').evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
  await block.hover()
  const grip = page.getByLabel('Block options', { exact: true })
  const gripBox = await grip.boundingBox()
  const clickX = gripBox.x + gripBox.width / 2
  const clickY = gripBox.y + gripBox.height / 2
  await grip.click()
  const blockMenu = page.locator('.block-menu')
  await expect(blockMenu).toBeVisible()
  const menuBox = await blockMenu.boundingBox()
  expect(Math.abs(menuBox.x - clickX - 8)).toBeLessThanOrEqual(1)
  expect(Math.abs(menuBox.y - clickY)).toBeLessThanOrEqual(1)
  expect(await blockMenu.evaluate((el) => getComputedStyle(el).position)).toBe('fixed')
  await page.screenshot({ path: path.join(output, 'block-menu.png') })
  await blockMenu.getByRole('button', { name: 'Turn into…', exact: true }).click()
  const expandedMenu = await blockMenu.boundingBox()
  const viewportHeight = await page.evaluate(() => window.innerHeight)
  expect(expandedMenu.y).toBeGreaterThanOrEqual(8)
  expect(expandedMenu.y + expandedMenu.height).toBeLessThanOrEqual(viewportHeight - 7)
  await page.keyboard.press('Escape')
  await expect(blockMenu).toHaveCount(0)
  await block.hover()
  await grip.focus()
  const keyboardGripBox = await grip.boundingBox()
  await grip.press('Enter')
  await expect(blockMenu).toBeVisible()
  expect((await blockMenu.boundingBox()).x).toBeCloseTo(
    keyboardGripBox.x + keyboardGripBox.width + 8,
    0,
  )
  await page.locator('.click-away').click({ position: { x: 2, y: 2 } })
  await expect(blockMenu).toHaveCount(0)
  await page.locator('.document-editor > p').last().hover()
  await grip.click()
  await expect(blockMenu).toBeVisible()
  const edgeMenu = await blockMenu.boundingBox()
  expect(edgeMenu.y).toBeGreaterThanOrEqual(8)
  expect(edgeMenu.y + edgeMenu.height).toBeLessThanOrEqual(viewportHeight - 7)
  await blockMenu.getByRole('button', { name: 'Turn into…', exact: true }).click()
  const expandedEdgeMenu = await blockMenu.boundingBox()
  expect(expandedEdgeMenu.y).toBeGreaterThanOrEqual(8)
  expect(expandedEdgeMenu.y + expandedEdgeMenu.height).toBeLessThanOrEqual(viewportHeight - 7)
  await page.keyboard.press('Escape')
  console.log('Review: block menu anchor, scrolled note, viewport edges, keyboard and dismissal')
  await page.screenshot({ path: path.join(output, 'note.png') })
  await page.locator('.tab-bar').screenshot({ path: path.join(output, 'tabs.png') })
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByTitle('Dark', { exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.keyboard.press('Escape')
  await page
    .locator('.database-embed .database-view')
    .screenshot({ path: path.join(output, 'dark-database.png') })
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByTitle('Light', { exact: true }).click()
  await page.keyboard.press('Escape')
  await page
    .getByRole('button', { name: 'Open A field guide to better notes', exact: true })
    .click({ modifiers: [mod] })
  await expect(page.getByLabel('Page title')).toHaveValue('A field guide to better notes')
  await page.locator('.document-editor').click()
  await page.keyboard.type('An inline record is also a complete document.')
  await saved()
  await page.locator('.tab').filter({ hasText: 'Design review' }).locator('.tab-open').click()
  await saved()
  await app.close()
  await launch()
  await expect(page.getByLabel('Database name')).toHaveValue('Reading list')
  await expect(page.locator('.record-title')).toHaveText('A field guide to better notes')
  await expect(page.locator('.callout-block')).toHaveClass(/callout-yellow/)
  await expect(page.locator('.callout-emoji')).toContainText('📌')
  await expect(page.locator('.code-language')).toHaveText('typescript')
  expect(errors).toEqual([])
  console.log(
    'Passed: neutral theme, full-cell record name editing, anchored property editing with nested type selection/Escape/outside dismissal, row/column drop markers, square workspace icons, emoji search height, callout colors/icons, code language dialog, toggle controls, before/after insertion, inline database and restart persistence.',
  )
} catch (error) {
  if (page)
    await page
      .screenshot({ path: path.join(output, 'failure.png'), fullPage: true })
      .catch(() => {})
  throw error
} finally {
  if (app) await app.close().catch(() => {})
  await fs.rm(root, { recursive: true, force: true })
}
