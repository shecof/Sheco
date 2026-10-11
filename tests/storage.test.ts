import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { WorkspaceStore, atomicWrite } from '../electron/storage'
import { seedWorkspace } from '../src/shared/seed'
const roots: string[] = []
const stores: WorkspaceStore[] = []
async function make() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sheco-storage-'))
  roots.push(root)
  const store = new WorkspaceStore(root)
  stores.push(store)
  await store.initialize(seedWorkspace())
  return store
}
afterEach(async () => {
  for (const s of stores.splice(0)) await s.close()
  for (const r of roots.splice(0)) await fs.rm(r, { recursive: true, force: true })
})
describe('durable local storage', () => {
  it('writes and reopens documents and restored tab state', async () => {
    const s = await make()
    const next = { ...s.state, name: 'Saved workspace' }
    await s.save(next, 0)
    await s.close()
    const reopened = new WorkspaceStore(s.root)
    stores.push(reopened)
    await reopened.open()
    expect(reopened.state.name).toBe('Saved workspace')
    expect(reopened.state.ui.tabs).toEqual(next.ui.tabs)
    expect(reopened.state.revision).toBe(1)
  })
  it('rejects stale saves without overwriting the durable checkpoint', async () => {
    const s = await make()
    const initial = s.state
    await s.save({ ...initial, name: 'First' }, 0)
    await expect(s.save({ ...initial, name: 'Stale' }, 0)).rejects.toThrow('conflict')
    expect(JSON.parse(await fs.readFile(path.join(s.root, 'workspace.json'), 'utf8')).name).toBe(
      'First',
    )
  })
  it('serializes simultaneous writes and rejects the stale one', async () => {
    const s = await make()
    const results = await Promise.allSettled([
      s.save({ ...s.state, name: 'A' }, 0),
      s.save({ ...s.state, name: 'B' }, 0),
    ])
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected'])
    expect(s.state.name).toBe('A')
  })
  it('detects external edits even when their revision is unchanged', async () => {
    const s = await make()
    await fs.writeFile(
      path.join(s.root, 'workspace.json'),
      JSON.stringify({ ...s.state, name: 'External' }),
    )
    await expect(s.save({ ...s.state, name: 'Local' }, 0)).rejects.toThrow('outside Sheco')
    expect(JSON.parse(await fs.readFile(path.join(s.root, 'workspace.json'), 'utf8')).name).toBe(
      'External',
    )
  })
  it('recovers a valid backup and preserves the corrupt file as evidence', async () => {
    const s = await make()
    const original = s.state.name
    await s.save({ ...s.state, name: 'Latest' }, 0)
    await s.close()
    await fs.writeFile(path.join(s.root, 'workspace.json'), '{broken')
    const next = new WorkspaceStore(s.root)
    stores.push(next)
    await next.open()
    expect(next.recovered).toBe(true)
    expect(next.state.name).toBe(original)
    const files = await fs.readdir(path.join(s.root, 'metadata'))
    expect(files.some((f) => f.startsWith('damaged-'))).toBe(true)
  })
  it('preserves an unreadable workspace without a valid backup', async () => {
    const s = await make()
    await s.close()
    await fs.writeFile(path.join(s.root, 'workspace.json'), '{broken')
    const next = new WorkspaceStore(s.root)
    stores.push(next)
    await expect(next.open()).rejects.toThrow('Original files were preserved')
    expect(await fs.readFile(path.join(s.root, 'workspace.json'), 'utf8')).toBe('{broken')
  })
  it('prevents a second writer from opening the workspace', async () => {
    const s = await make()
    const next = new WorkspaceStore(s.root)
    await expect(next.open()).rejects.toThrow('already open')
  })
  it('rejects invalid hierarchy before touching stored data', async () => {
    const s = await make()
    const w = structuredClone(s.state)
    w.pages[0].parentId = w.pages[0].id
    await expect(s.save(w, 0)).rejects.toThrow()
    expect(s.state.revision).toBe(0)
  })
  it('copies attachments under generated names and blocks traversal and symlinks', async () => {
    const s = await make()
    const a = await s.addAttachment('../photo.png', Buffer.from('test'))
    expect(a.name).toBe('photo.png')
    expect(await fs.readFile(await s.attachmentPath(a.file), 'utf8')).toBe('test')
    await expect(s.attachmentPath('../workspace.json')).rejects.toThrow('Invalid')
    const file = crypto.randomUUID() + '.txt'
    await fs.symlink(path.join(s.root, 'workspace.json'), path.join(s.root, 'attachments', file))
    await expect(s.attachmentPath(file)).rejects.toThrow('outside')
  })
  it('atomically replaces a snapshot without temporary residue', async () => {
    const s = await make()
    const file = path.join(s.root, 'test.txt')
    await atomicWrite(file, 'before')
    await atomicWrite(file, 'after')
    expect(await fs.readFile(file, 'utf8')).toBe('after')
    expect((await fs.readdir(s.root)).some((f) => f.endsWith('.tmp'))).toBe(false)
  })
})
