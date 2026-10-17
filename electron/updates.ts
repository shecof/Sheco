import { z } from 'zod'
import fs from 'node:fs/promises'
import path from 'node:path'
import { atomicWrite } from './storage'
import {
  latestReleaseApi,
  compareVersions,
  parseVersion,
  type UpdateResult,
  type AppUpdateState,
  type UpdateSettings,
} from '../src/shared/appUpdates'

const releaseSchema = z.object({
  tag_name: z.string().min(1).max(100),
  draft: z.literal(false),
  prerelease: z.literal(false),
})
export function createUpdateChecker(
  currentVersion: string,
  request: typeof fetch = fetch,
  now = () => Date.now(),
) {
  let cached: UpdateResult | undefined,
    checked = 0,
    pending: Promise<UpdateResult> | undefined
  async function check(): Promise<UpdateResult> {
    const result: UpdateResult = {
      currentVersion,
      latestVersion: null,
      releaseUrl: null,
      status: 'error',
      checkedAt: new Date(now()).toISOString(),
    }
    try {
      const response = await request(latestReleaseApi, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': `Sheco/${currentVersion}` },
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
        credentials: 'omit',
      })
      if (!response.ok) {
        await response.body?.cancel()
        return {
          ...result,
          status: response.status === 404 ? 'unavailable' : 'error',
          error:
            response.status === 404
              ? 'no-release'
              : [403, 429].includes(response.status)
                ? 'rate-limit'
                : 'network',
        }
      }
      const reader = response.body?.getReader()
      if (!reader) return { ...result, error: 'invalid-release' }
      const chunks: Uint8Array[] = []
      let size = 0
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        size += value.length
        if (size > 1024 * 1024) {
          await reader.cancel()
          return { ...result, error: 'invalid-release' }
        }
        chunks.push(value)
      }
      const bytes = new Uint8Array(size)
      let offset = 0
      for (const chunk of chunks) {
        bytes.set(chunk, offset)
        offset += chunk.length
      }
      let data: unknown
      try {
        data = JSON.parse(new TextDecoder().decode(bytes))
      } catch {
        return { ...result, error: 'invalid-release' }
      }
      const release = releaseSchema.safeParse(data)
      if (!release.success) return { ...result, error: 'invalid-release' }
      const version = parseVersion(release.data.tag_name)
      const comparison = compareVersions(release.data.tag_name, currentVersion)
      if (!version || version.pre.length || comparison === null)
        return { ...result, error: 'invalid-release' }
      return {
        ...result,
        status: comparison > 0 ? 'available' : 'current',
        latestVersion: release.data.tag_name.replace(/^v/, ''),
        releaseUrl:
          'https://github.com/shecof/Sheco/releases/tag/' +
          encodeURIComponent(release.data.tag_name),
      }
    } catch {
      return { ...result, error: 'network' }
    }
  }
  return () => {
    if (
      cached &&
      ['current', 'available'].includes(cached.status) &&
      now() - checked < 5 * 60 * 1000
    )
      return Promise.resolve({ ...cached })
    if (pending) return pending
    pending = check()
      .then((result) => {
        cached = result
        checked = now()
        return { ...result }
      })
      .finally(() => {
        pending = undefined
      })
    return pending
  }
}

const updateSettingsSchema = z.object({ checkOnStartup: z.boolean() }).strict()

/** Device preference and session result, independent of any workspace or settings dialog. */
export class AppUpdateService {
  private state: AppUpdateState
  private initialized?: Promise<void>
  private started = false
  private pending?: Promise<UpdateResult>
  private saves: Promise<void> = Promise.resolve()
  private readonly file: string
  private readonly checker: ReturnType<typeof createUpdateChecker>

  constructor(
    profile: string,
    currentVersion: string,
    request: typeof fetch = fetch,
    private readonly changed: (state: AppUpdateState) => void = () => {},
    now = () => Date.now(),
  ) {
    this.file = path.join(profile, 'updates.json')
    this.checker = createUpdateChecker(currentVersion, request, now)
    this.state = {
      currentVersion,
      settings: { checkOnStartup: false },
      checking: false,
      result: null,
      availableRelease: null,
      revision: 0,
    }
  }
  snapshot(): AppUpdateState {
    return structuredClone(this.state)
  }
  private publish() {
    this.state.revision++
    this.changed(this.snapshot())
  }
  initialize(): Promise<void> {
    this.initialized ??= (async () => {
      try {
        const handle = await fs.open(this.file, 'r')
        try {
          const stat = await handle.stat()
          if (!stat.isFile() || stat.size > 4096) return
          const bytes = Buffer.alloc(4097)
          const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0)
          if (bytesRead > 4096) return
          const parsed = updateSettingsSchema.safeParse(
            JSON.parse(bytes.subarray(0, bytesRead).toString('utf8')),
          )
          if (parsed.success) this.state.settings = parsed.data
        } finally {
          await handle.close()
        }
      } catch {
        // A missing or damaged preference stays disabled; reading never replaces the file.
      }
      this.publish()
    })()
    return this.initialized
  }
  async start(): Promise<void> {
    await this.initialize()
    if (this.started) return
    this.started = true
    if (this.state.settings.checkOnStartup) void this.check()
  }
  async configure(input: unknown): Promise<AppUpdateState> {
    const settings: UpdateSettings = updateSettingsSchema.parse(input)
    await this.initialize()
    const save = this.saves.then(async () => {
      await atomicWrite(this.file, JSON.stringify(settings, null, 2) + '\n')
      this.state.settings = settings
      this.publish()
    })
    this.saves = save.catch(() => {})
    await save
    return this.snapshot()
  }
  async flush(): Promise<void> {
    await this.initialize()
    await this.saves
  }
  async check(): Promise<UpdateResult> {
    await this.initialize()
    if (this.pending) return this.pending
    this.state.checking = true
    this.publish()
    this.pending = this.checker()
      .then((result) => {
        this.state.result = result
        if (result.status === 'available' && result.latestVersion && result.releaseUrl)
          this.state.availableRelease = { version: result.latestVersion, url: result.releaseUrl }
        else if (result.status !== 'error') this.state.availableRelease = null
        return result
      })
      .finally(() => {
        this.state.checking = false
        this.pending = undefined
        this.publish()
      })
    return this.pending
  }
}
