import { _electron as electron, expect } from '@playwright/test'
import { build } from 'esbuild'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sheco-updates-review-'))
const workspace = path.join(root, 'Knowledge')
const harness = path.join(root, 'app')
const output = path.resolve('test-results/updates')
await Promise.all([fs.mkdir(workspace), fs.mkdir(harness), fs.mkdir(output, { recursive: true })])
const bundled = await build({
  stdin: {
    contents:
      "export { seedWorkspace } from './src/shared/seed'; export { translate } from './src/shared/i18n'",
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
})
const seedFile = path.join(root, 'seed.mjs')
await fs.writeFile(seedFile, bundled.outputFiles[0].contents)
const { seedWorkspace, translate } = await import(pathToFileURL(seedFile).href)
const w = seedWorkspace('Update review', false)
w.pages[0].title = 'Preserved source'
w.pages[0].content = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'Updates must preserve this document.' }],
    },
  ],
}
w.plugins.documentTemplates.enabled = true
const originalPages = structuredClone(w.pages)
await fs.writeFile(path.join(workspace, 'workspace.json'), JSON.stringify(w))
await fs.writeFile(
  path.join(root, 'spaces.json'),
  JSON.stringify({
    activeId: w.id,
    spaces: [{ id: w.id, name: w.name, icon: w.icon, path: workspace }],
  }),
)
const { version } = JSON.parse(await fs.readFile('package.json', 'utf8'))
const stable = version.split(/[-+]/)[0]
const newer = stable.replace(/\d+$/, (patch) => String(Number(patch) + 1))
const release = (tag = 'v' + newer) => ({
  status: 200,
  body: {
    tag_name: tag,
    draft: false,
    prerelease: false,
    html_url: 'https://evil.example/download',
  },
})
const releaseUrl = 'https://github.com/shecof/Sheco/releases/tag/v' + newer
await fs.writeFile(
  path.join(harness, 'package.json'),
  JSON.stringify({ name: 'sheco-update-review', version, main: 'main.cjs' }),
)
// Test-process stubs are registered before the real main process starts; production has no test hooks.
await fs.writeFile(
  path.join(harness, 'main.cjs'),
  `
const { app, session, shell } = require('electron');
globalThis.__updateResponse = JSON.parse(process.env.SHECO_REVIEW_UPDATE);
globalThis.__updateRequests = [];
globalThis.__links = [];
app.whenReady().then(() => {
  shell.openExternal = async url => { globalThis.__links.push(url); };
  session.fromPartition('update-requests').fetch = async (url, init) => {
    globalThis.__updateRequests.push({ url: String(url), credentials: init.credentials, redirect: init.redirect });
    if (process.env.SHECO_REVIEW_HOLD === '1' && !globalThis.__finishUpdate)
      await new Promise(resolve => { globalThis.__finishUpdate = resolve; });
    const { body, status } = globalThis.__updateResponse;
    return new Response(JSON.stringify(body), { status });
  };
});
require(${JSON.stringify(path.resolve(process.env.SHECO_TEST_MAIN ?? 'dist-electron/main.cjs'))});
`,
)

let app,
  page,
  language = 'en'
const errors = []
const tr = (key) => translate(key, language)
const count = () => app.evaluate(() => globalThis.__updateRequests.length)
const state = () => page.evaluate(() => window.sheco.updateState())
async function launch(response = release(), hold = false) {
  app = await electron.launch({
    args: [harness],
    env: {
      ...process.env,
      SHECO_DATA_DIR: root,
      SHECO_REVIEW_UPDATE: JSON.stringify(response),
      SHECO_REVIEW_HOLD: hold ? '1' : '0',
    },
  })
  page = await app.firstWindow()
  page.on('pageerror', (error) => errors.push(error.message))
  await expect(page.locator('.save-status')).toBeVisible({ timeout: 20000 })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 900))
  await expect.poll(async () => (await state()).currentVersion).toBe(version)
}
async function close() {
  await expect(page.locator('.save-status')).toHaveClass(/\bsaved\b/)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await app.close()
  app = null
}
async function settings(category = 'About Sheco') {
  await page
    .locator('.sidebar-footer')
    .getByRole('button', { name: tr('Settings'), exact: true })
    .click()
  await page.getByRole('tab', { name: tr(category), exact: true }).click()
  return page.getByRole('dialog', { name: tr('Settings'), exact: true })
}
const startup = () =>
  page.getByRole('switch', { name: tr('Check for updates at startup'), exact: true })
async function dismiss() {
  await page.getByRole('button', { name: tr('Close'), exact: true }).click()
}
async function unchanged() {
  const stored = JSON.parse(await fs.readFile(path.join(workspace, 'workspace.json'), 'utf8'))
  expect(stored.pages).toEqual(originalPages)
  expect(JSON.stringify(stored)).not.toContain('checkOnStartup')
}
try {
  await launch()
  expect(await count()).toBe(0)
  expect((await state()).result).toBeNull()
  await settings()
  await expect(startup()).toHaveAttribute('aria-checked', 'false')
  expect(await count()).toBe(0)
  await startup().click()
  await expect(startup()).toHaveAttribute('aria-checked', 'true')
  expect(JSON.parse(await fs.readFile(path.join(root, 'updates.json'), 'utf8'))).toEqual({
    checkOnStartup: true,
  })
  expect(await count()).toBe(0)
  await dismiss()
  await close()

  await launch(release(), true)
  await expect.poll(count).toBe(1)
  await settings()
  await expect(startup()).toHaveAttribute('aria-checked', 'true')
  await expect(
    page.getByRole('button', { name: tr('Checking for updates…'), exact: true }),
  ).toBeDisabled()
  const invalid = await page.evaluate(async () => {
    const results = []
    for (const value of [
      { checkOnStartup: 'true' },
      { checkOnStartup: true, url: 'https://evil.example' },
    ]) {
      try {
        await window.sheco.configureUpdates(value)
        results.push(false)
      } catch {
        results.push(true)
      }
    }
    return results
  })
  expect(invalid).toEqual([true, true])
  expect(JSON.parse(await fs.readFile(path.join(root, 'updates.json'), 'utf8'))).toEqual({
    checkOnStartup: true,
  })
  await app.evaluate(() => globalThis.__finishUpdate())
  const notice = page.locator('.sidebar-update-notice')
  await expect(notice).toContainText(tr('New version') + ' ' + newer)
  await expect(page.locator('.update-result.available')).toContainText(newer)
  await page
    .locator('.update-result')
    .getByRole('button', { name: tr('Open release'), exact: true })
    .click()
  await page.getByRole('button', { name: tr('Check for updates'), exact: true }).click()
  await expect(
    page.getByRole('button', { name: tr('Check for updates'), exact: true }),
  ).toBeEnabled()
  expect(await count()).toBe(1)
  await page.screenshot({ path: path.join(output, 'settings-light-en.png') })
  await dismiss()
  const bannerBox = await notice.boundingBox()
  const templatesBox = await page
    .locator('.sidebar-footer')
    .getByRole('button', { name: tr('Templates'), exact: true })
    .boundingBox()
  expect(bannerBox.y + bannerBox.height).toBeLessThanOrEqual(templatesBox.y)
  await notice.getByRole('button', { name: tr('Open release'), exact: true }).click()
  expect(await app.evaluate(() => globalThis.__links)).toEqual([releaseUrl, releaseUrl])
  expect(await app.evaluate(() => globalThis.__updateRequests)).toEqual([
    {
      url: 'https://api.github.com/repos/shecof/Sheco/releases/latest',
      credentials: 'omit',
      redirect: 'error',
    },
  ])
  await page.screenshot({ path: path.join(output, 'sidebar-light-en.png') })

  const general = await settings('General')
  await general.getByRole('button', { name: tr('Dark'), exact: true }).click()
  await general.getByRole('button', { name: 'Русский', exact: true }).click()
  language = 'ru'
  await dismiss()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(850, 720))
  await expect(notice).toContainText('Новая версия')
  await page.screenshot({ path: path.join(output, 'sidebar-dark-ru.png') })
  await settings()
  await expect(startup()).toBeVisible()
  await expect(
    page
      .locator('.update-result.available')
      .getByRole('button', { name: 'Открыть релиз', exact: true }),
  ).toBeVisible()
  await page.screenshot({ path: path.join(output, 'settings-dark-ru.png') })
  await startup().click()
  await expect(startup()).toHaveAttribute('aria-checked', 'false')
  await dismiss()
  await unchanged()
  await close()

  await launch()
  expect(await count()).toBe(0)
  await expect(page.locator('.sidebar-update-notice')).toHaveCount(0)
  await settings()
  await expect(startup()).toHaveAttribute('aria-checked', 'false')
  await startup().click()
  await expect(startup()).toHaveAttribute('aria-checked', 'true')
  await dismiss()
  await close()

  await launch({ status: 503, body: 'offline' })
  await expect.poll(async () => (await state()).result?.status).toBe('error')
  await expect(page.locator('.sidebar-update-notice')).toHaveCount(0)
  await settings()
  await expect(page.locator('.update-result.error')).toContainText(
    tr('Could not check for updates. Try again.'),
  )
  await app.evaluate((_electron, response) => {
    globalThis.__updateResponse = response
  }, release())
  await page.getByRole('button', { name: tr('Check for updates'), exact: true }).click()
  await expect(page.locator('.update-result.available')).toBeVisible()
  expect(await count()).toBe(2)
  await dismiss()
  await expect(page.locator('.sidebar-update-notice')).toBeVisible()
  await close()

  await launch(release('v' + stable))
  await expect
    .poll(async () => (await state()).result?.status)
    .toBe(version === stable ? 'current' : 'available')
  if (version === stable) {
    await expect(page.locator('.sidebar-update-notice')).toHaveCount(0)
    await settings()
    await expect(page.locator('.update-result.current')).toContainText(tr('You are up to date.'))
    await expect(page.locator('.update-result').getByRole('button')).toHaveCount(0)
    await dismiss()
  }
  await unchanged()
  expect(errors).toEqual([])
  await close()
  await fs.writeFile(
    path.join(output, 'verification.json'),
    JSON.stringify(
      {
        platform: process.platform,
        version,
        newerVersion: newer,
        defaultOff: true,
        startupOnce: true,
        preferenceRestart: true,
        sharedStatus: true,
        canonicalReleaseButtons: true,
        invalidSettingsRejected: true,
        errorsRetry: true,
        currentHasNoNotice: true,
        unchangedPages: true,
        screenshots: [
          'settings-light-en.png',
          'sidebar-light-en.png',
          'settings-dark-ru.png',
          'sidebar-dark-ru.png',
        ],
        errors,
      },
      null,
      2,
    ),
  )
  console.log('Update startup/settings/sidebar review passed:', output)
} finally {
  if (app) {
    await app
      .evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close())
      .catch(() => {})
    await app.close().catch(() => {})
  }
}
