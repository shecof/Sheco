import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createHash, randomUUID } from 'node:crypto'
import { workspaceSchema, type Workspace, type Attachment } from '../src/shared/model'

export const MAX_SNAPSHOT_BYTES = 64 * 1024 * 1024
const digest = (data: string) => createHash('sha256').update(data).digest('hex')
export async function atomicWrite(file: string, data: string | Uint8Array): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`)
  const handle = await fs.open(temp, 'wx', 0o600)
  try {
    await handle.writeFile(data)
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await fs.rename(temp, file)
  } catch (error) {
    await fs.rm(temp, { force: true })
    throw error
  }
  // Directory fsync is supported on POSIX; Windows rejects directory handles.
  if (process.platform !== 'win32') {
    const directory = await fs.open(path.dirname(file), 'r')
    try {
      await directory.sync()
    } finally {
      await directory.close()
    }
  }
}
export function validateWorkspace(data: unknown): Workspace {
  const w = workspaceSchema.parse(data)
  if (Buffer.byteLength(JSON.stringify(w, null, 2), 'utf8') > MAX_SNAPSHOT_BYTES)
    throw new Error(
      'This workspace exceeds the 64 MB document limit. Split it into smaller spaces.',
    )
  return w
}
export class WorkspaceStore {
  state!: Workspace
  recovered = false
  private fingerprint = ''
  private lockToken = randomUUID()
  private locked = false
  private queue: Promise<unknown> = Promise.resolve()
  constructor(readonly root: string) {}
  private get file() {
    return path.join(this.root, 'workspace.json')
  }
  async acquire(): Promise<void> {
    await fs.mkdir(path.join(this.root, 'metadata'), { recursive: true })
    const file = path.join(this.root, 'metadata', 'writer.lock')
    try {
      await fs.writeFile(
        file,
        JSON.stringify({ pid: process.pid, host: os.hostname(), token: this.lockToken }),
        { flag: 'wx', mode: 0o600 },
      )
      this.locked = true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      let lock: { pid: number; host: string; token: string }
      try {
        lock = JSON.parse(await fs.readFile(file, 'utf8'))
      } catch {
        throw new Error(
          'The workspace has an unreadable lock. Close other copies of Sheco before removing metadata/writer.lock.',
        )
      }
      let alive = true
      if (lock.host === os.hostname() && Number.isSafeInteger(lock.pid) && lock.pid > 0)
        try {
          process.kill(lock.pid, 0)
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code === 'ESRCH') alive = false
        }
      if (alive)
        throw new Error(
          'This workspace is already open by another process or device. Close it there first. Shared folders must be used on one device at a time.',
        )
      await fs.rm(file)
      await this.acquire()
    }
  }
  async initialize(w: Workspace): Promise<void> {
    const exists = await fs.stat(this.file).then(
      () => true,
      () => false,
    )
    if (exists)
      throw new Error('This folder already contains a workspace. Use Open workspace instead.')
    await fs.mkdir(path.join(this.root, 'attachments'), { recursive: true })
    await this.acquire()
    this.state = validateWorkspace(w)
    const data = JSON.stringify(this.state, null, 2)
    await atomicWrite(this.file, data)
    this.fingerprint = digest(data)
  }
  async open(): Promise<Workspace> {
    await this.acquire()
    try {
      const data = await this.readSnapshot(this.file)
      this.state = validateWorkspace(JSON.parse(data))
      this.fingerprint = digest(data)
    } catch (error) {
      const backupDir = path.join(this.root, 'metadata', 'backups')
      const files = (await fs.readdir(backupDir).catch(() => []))
        .filter((f) => f.endsWith('.json'))
        .sort()
        .reverse()
      let restored = false
      for (const name of files)
        try {
          const data = await this.readSnapshot(path.join(backupDir, name))
          const state = validateWorkspace(JSON.parse(data))
          await fs
            .copyFile(this.file, path.join(this.root, 'metadata', `damaged-${Date.now()}.json`))
            .catch(() => {})
          await atomicWrite(this.file, data)
          this.state = state
          this.fingerprint = digest(data)
          this.recovered = true
          restored = true
          break
        } catch {
          /* Try the next complete checkpoint. */
        }
      if (!restored) {
        await this.close()
        throw new Error(
          `Cannot open this workspace. No valid backup was found. Original files were preserved. ${error instanceof Error ? error.message : ''}`,
        )
      }
    }
    return this.state
  }
  private async readSnapshot(file: string): Promise<string> {
    const stat = await fs.stat(file)
    if (stat.size > MAX_SNAPSHOT_BYTES) throw new Error('Workspace file is too large.')
    return fs.readFile(file, 'utf8')
  }
  save(
    input: Workspace,
    expectedRevision: number,
  ): Promise<{ revision: number; updatedAt: string }> {
    const operation = this.queue.then(async () => {
      if (!this.locked) throw new Error('Workspace is closed.')
      const w = validateWorkspace(input)
      if (w.id !== this.state.id) throw new Error('Workspace identity cannot be changed.')
      if (expectedRevision !== this.state.revision)
        throw new Error(
          'Save conflict: this workspace changed. Your unsaved edits are kept in this window. Export them before reopening.',
        )
      const disk = await this.readSnapshot(this.file)
      if (digest(disk) !== this.fingerprint)
        throw new Error(
          'Save conflict: the workspace was modified outside Sheco. Your edits are kept in this window; choose Export unsaved recovery file in Settings.',
        )
      // Keep the previous durable checkpoint before replacing the current one.
      const backupDir = path.join(this.root, 'metadata', 'backups')
      await fs.mkdir(backupDir, { recursive: true })
      const stamp = `${Date.now()}-${String(this.state.revision).padStart(10, '0')}.json`
      await atomicWrite(path.join(backupDir, stamp), disk)
      const updatedAt = new Date().toISOString()
      const next = { ...w, revision: this.state.revision + 1, updatedAt }
      const data = JSON.stringify(next, null, 2)
      if (Buffer.byteLength(data, 'utf8') > MAX_SNAPSHOT_BYTES)
        throw new Error(
          'This workspace exceeds the 64 MB document limit. Your previous snapshot is preserved.',
        )
      await atomicWrite(this.file, data)
      this.state = next
      this.fingerprint = digest(data)
      const files = (await fs.readdir(backupDir))
        .filter((f) => f.endsWith('.json'))
        .sort()
        .reverse()
      await Promise.all(files.slice(30).map((f) => fs.rm(path.join(backupDir, f)).catch(() => {})))
      return { revision: next.revision, updatedAt }
    })
    this.queue = operation.catch(() => {})
    return operation
  }
  async addAttachment(name: string, bytes: Uint8Array): Promise<Attachment> {
    if (!bytes.length || bytes.length > 200 * 1024 * 1024)
      throw new Error('Attachments must be between 1 byte and 200 MB.')
    const ext =
      path
        .extname(name)
        .slice(1)
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .slice(0, 12) || 'bin'
    const mime: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      avif: 'image/avif',
      pdf: 'application/pdf',
      mp4: 'video/mp4',
      m4v: 'video/mp4',
      webm: 'video/webm',
      ogv: 'video/ogg',
      mov: 'video/quicktime',
      txt: 'text/plain',
      md: 'text/markdown',
      csv: 'text/csv',
      json: 'application/json',
      log: 'text/plain',
      yaml: 'text/yaml',
      yml: 'text/yaml',
      toml: 'text/plain',
      ini: 'text/plain',
      xml: 'application/xml',
    }
    const a: Attachment = {
      id: randomUUID(),
      file: `${randomUUID()}.${ext}`,
      name: path.basename(name).slice(0, 500),
      mime: mime[ext] ?? 'application/octet-stream',
      bytes: bytes.length,
      createdAt: new Date().toISOString(),
    }
    await atomicWrite(path.join(this.root, 'attachments', a.file), bytes)
    // The renderer includes the returned metadata in its next serialized save.
    return a
  }
  async attachmentPath(file: string): Promise<string> {
    if (!/^[0-9a-f-]{36}\.[a-z0-9]{1,12}$/.test(file)) throw new Error('Invalid attachment name.')
    const base = await fs.realpath(path.join(this.root, 'attachments'))
    const target = await fs.realpath(path.join(base, file))
    if (path.dirname(target) !== base) throw new Error('Attachment path is outside the workspace.')
    return target
  }
  async close(): Promise<void> {
    await this.queue
    if (!this.locked) return
    const file = path.join(this.root, 'metadata', 'writer.lock')
    const token = await fs.readFile(file, 'utf8').then(
      (s) => JSON.parse(s).token,
      () => null,
    )
    if (token === this.lockToken) await fs.rm(file, { force: true })
    this.locked = false
  }
}
