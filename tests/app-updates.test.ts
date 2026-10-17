import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { compareVersions, parseVersion, latestReleaseApi } from '../src/shared/appUpdates'
import { AppUpdateService, createUpdateChecker } from '../electron/updates'
import type { AppUpdateState } from '../src/shared/appUpdates'

const release = (tag = 'v1.0.1') =>
  new Response(
    JSON.stringify({
      tag_name: tag,
      draft: false,
      prerelease: false,
      html_url: 'https://evil.example/download',
    }),
  )
describe('GitHub update checks', () => {
  it('compares semantic versions numerically including prereleases and build metadata', () => {
    expect(compareVersions('v1.10.0', '1.9.99')).toBe(1)
    expect(compareVersions('1.0.0', '1.0.0-beta.2')).toBe(1)
    expect(compareVersions('1.0.0-beta.10', '1.0.0-beta.2')).toBe(1)
    expect(compareVersions('1.0.0+new', '1.0.0+old')).toBe(0)
    expect(compareVersions('1.0.0-beta', '1.0.0')).toBe(-1)
    expect(compareVersions('1.0', '1.0.0')).toBeNull()
    for (const value of ['v01.0.0', '1.0.0-01', '1.0.0-a..b', '1.0.0+..', 'https://evil.example'])
      expect(parseVersion(value)).toBeNull()
  })
  it('uses a fixed endpoint, no credentials, no redirects and a canonical release link', async () => {
    const request = vi.fn(async (..._args: Parameters<typeof fetch>) => release())
    const result = await createUpdateChecker('1.0.0', request)()
    expect(result).toMatchObject({
      status: 'available',
      currentVersion: '1.0.0',
      latestVersion: '1.0.1',
      releaseUrl: 'https://github.com/shecof/Sheco/releases/tag/v1.0.1',
    })
    expect(request.mock.calls[0][0]).toBe(latestReleaseApi)
    expect(request.mock.calls[0][1]).toMatchObject({ redirect: 'error', credentials: 'omit' })
  })
  it('reports equal and newer installed versions as current', async () => {
    expect((await createUpdateChecker('1.0.0', async () => release('v1.0.0'))()).status).toBe(
      'current',
    )
    expect((await createUpdateChecker('1.1.0', async () => release('v1.0.0'))()).status).toBe(
      'current',
    )
    expect(
      (await createUpdateChecker('1.0.0-beta.1', async () => release('v1.0.0'))()).status,
    ).toBe('available')
  })
  it('deduplicates concurrent checks and caches successful results for five minutes', async () => {
    let time = 10000
    const request = vi.fn(async () => release())
    const check = createUpdateChecker('1.0.0', request, () => time)
    await Promise.all([check(), check(), check()])
    expect(request).toHaveBeenCalledTimes(1)
    await check()
    expect(request).toHaveBeenCalledTimes(1)
    time += 5 * 60 * 1000
    await check()
    expect(request).toHaveBeenCalledTimes(2)
  })
  it('handles absent releases, rate limiting and network failures, allowing retries', async () => {
    expect(
      await createUpdateChecker('1.0.0', async () => new Response('', { status: 404 }))(),
    ).toMatchObject({ status: 'unavailable', error: 'no-release' })
    expect(
      await createUpdateChecker('1.0.0', async () => new Response('', { status: 429 }))(),
    ).toMatchObject({ status: 'error', error: 'rate-limit' })
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(release())
    const check = createUpdateChecker('1.0.0', request)
    expect(await check()).toMatchObject({ status: 'error', error: 'network' })
    expect((await check()).status).toBe('available')
  })
  it('rejects prereleases, invalid tags, malformed JSON and oversized bodies', async () => {
    for (const response of [
      release('v1.0.1-beta.1'),
      release('../evil'),
      new Response('<html>'),
      new Response('x'.repeat(1024 * 1024 + 1)),
      new Response(JSON.stringify({ tag_name: 'v1.0.1', draft: true, prerelease: false })),
    ])
      expect(await createUpdateChecker('1.0.0', async () => response)()).toMatchObject({
        status: 'error',
        error: 'invalid-release',
        latestVersion: null,
        releaseUrl: null,
      })
  })
})

describe('device startup preference and shared update state', () => {
  const profiles: string[] = []
  async function profile() {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'sheco-update-unit-'))
    profiles.push(folder)
    return folder
  }
  afterEach(async () => {
    await Promise.all(profiles.splice(0).map((folder) => fs.rm(folder, { recursive: true })))
  })
  it('defaults off, preserves missing preferences, and enabling takes effect on next launch', async () => {
    const folder = await profile()
    const request = vi.fn(async () => release())
    const first = new AppUpdateService(folder, '1.0.0', request)
    await first.start()
    await expect(fs.stat(path.join(folder, 'updates.json'))).rejects.toThrow()
    expect(request).not.toHaveBeenCalled()
    await first.configure({ checkOnStartup: true })
    await first.start()
    expect(request).not.toHaveBeenCalled()
    const next = new AppUpdateService(folder, '1.0.0', request)
    await Promise.all([next.start(), next.start(), next.start()])
    await next.check()
    expect(request).toHaveBeenCalledTimes(1)
    expect(next.snapshot()).toMatchObject({
      settings: { checkOnStartup: true },
      checking: false,
      result: { status: 'available' },
      availableRelease: {
        version: '1.0.1',
        url: 'https://github.com/shecof/Sheco/releases/tag/v1.0.1',
      },
    })
    await next.configure({ checkOnStartup: false })
    await next.flush()
    await new AppUpdateService(folder, '1.0.0', request).start()
    expect(request).toHaveBeenCalledTimes(1)
  })
  it('rejects malformed preferences without enabling checks or replacing their contents', async () => {
    const folder = await profile()
    const file = path.join(folder, 'updates.json')
    const request = vi.fn(async () => release())
    for (const contents of [
      '{broken',
      JSON.stringify({ checkOnStartup: 'true' }),
      JSON.stringify({ checkOnStartup: true, url: 'https://evil.example' }),
      JSON.stringify({ checkOnStartup: true }) + ' '.repeat(4096),
    ]) {
      await fs.writeFile(file, contents)
      const service = new AppUpdateService(folder, '1.0.0', request)
      await service.start()
      expect(service.snapshot().settings.checkOnStartup).toBe(false)
      expect(await fs.readFile(file, 'utf8')).toBe(contents)
      await expect(
        service.configure({ checkOnStartup: true, url: 'https://evil.example' }),
      ).rejects.toThrow()
      await expect(service.configure({ checkOnStartup: 'true' })).rejects.toThrow()
      expect(await fs.readFile(file, 'utf8')).toBe(contents)
    }
    expect(request).not.toHaveBeenCalled()
  })
  it('serializes rapid preference changes and publishes only durable settings', async () => {
    const folder = await profile()
    const states: AppUpdateState[] = []
    const service = new AppUpdateService(
      folder,
      '1.0.0',
      async () => release(),
      (state) => states.push(state),
    )
    await Promise.all([
      service.configure({ checkOnStartup: true }),
      service.configure({ checkOnStartup: false }),
      service.configure({ checkOnStartup: true }),
    ])
    await service.flush()
    expect(states.map((state) => state.settings.checkOnStartup)).toEqual([false, true, false, true])
    expect(JSON.parse(await fs.readFile(path.join(folder, 'updates.json'), 'utf8'))).toEqual({
      checkOnStartup: true,
    })
    const invalidFolder = path.join(folder, 'not-a-folder')
    await fs.writeFile(invalidFolder, 'retained')
    const failed = new AppUpdateService(invalidFolder, '1.0.0')
    await expect(failed.configure({ checkOnStartup: true })).rejects.toThrow()
    expect(failed.snapshot().settings.checkOnStartup).toBe(false)
    expect(await fs.readFile(invalidFolder, 'utf8')).toBe('retained')
  })
  it('shares in-flight manual/startup checks, keeps known releases through errors, and clears current results', async () => {
    const folder = await profile()
    let time = 10000
    let finish!: (response: Response) => void
    const request = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve
        }),
    )
    const states: AppUpdateState[] = []
    const service = new AppUpdateService(
      folder,
      '1.0.0',
      request,
      (state) => states.push(state),
      () => time,
    )
    await service.configure({ checkOnStartup: true })
    await service.start()
    const pending = service.check()
    expect(service.snapshot().checking).toBe(true)
    finish(release())
    await pending
    expect(request).toHaveBeenCalledTimes(1)
    time += 5 * 60 * 1000
    const retry = service.check()
    await Promise.resolve()
    finish(new Response('', { status: 503 }))
    await retry
    expect(service.snapshot()).toMatchObject({
      result: { status: 'error' },
      availableRelease: { version: '1.0.1' },
    })
    const current = service.check()
    await Promise.resolve()
    finish(release('v1.0.0'))
    await current
    expect(service.snapshot().availableRelease).toBeNull()
    const clone = service.snapshot()
    clone.settings.checkOnStartup = false
    expect(service.snapshot().settings.checkOnStartup).toBe(true)
    expect(states.every((state, i) => !i || state.revision > states[i - 1].revision)).toBe(true)
    expect(service.snapshot().checking).toBe(false)
  })
})
