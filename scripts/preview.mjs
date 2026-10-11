import { build } from 'esbuild'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import electron from 'electron'

const root = path.resolve('test-results/design-preview')
const workspace = path.join(root, 'Knowledge')
await fs.mkdir(workspace, { recursive: true })
try {
  await fs.access(path.join(root, 'spaces.json'))
} catch {
  const moduleDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sheco-preview-seed-'))
  const bundled = await build({
    stdin: {
      contents:
        "export { seedWorkspace } from './src/shared/seed'; export { createPage, createDatabase, uid } from './src/shared/model'",
      resolveDir: process.cwd(),
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
  })
  const modulePath = path.join(moduleDir, 'seed.mjs')
  await fs.writeFile(modulePath, bundled.outputFiles[0].contents)
  const { seedWorkspace, createPage, createDatabase, uid } = await import(
    pathToFileURL(modulePath).href
  )
  const w = seedWorkspace('Design preview')
  const text = (value) => ({ type: 'text', text: value })
  const p = (value) => ({ type: 'paragraph', content: value ? [text(value)] : [] })
  const note = createPage(w, 'A quieter space.')
  note.icon = '🛸'
  note.description = 'Notes, connected ideas, and collections. All yours.'
  w.pages.push(note)
  const collection = createPage(w, 'Reading list', note.id, 'database')
  w.pages.push(collection)
  const db = createDatabase(collection.id)
  db.columns.push({
    id: uid(),
    name: 'Notes',
    type: 'text',
    width: 280,
    hidden: false,
    options: [],
  })
  w.databases.push(db)
  for (const [name, status, description] of [
    ['The craft of useful notes', 'In progress', 'Connect ideas, keep the context.'],
    ['A field guide to curiosity', 'Not started', 'Good questions lead to good discoveries.'],
    ['Designing for focus', 'Done', 'Less noise. More room to think.'],
  ]) {
    const row = createPage(w, name, collection.id, 'page', db.id)
    row.properties = { [db.columns[0].id]: status, [db.columns[1].id]: description }
    row.content = {
      type: 'doc',
      content: [p('Every record is also a complete document. Add your own notes here.'), p('')],
    }
    w.pages.push(row)
  }
  note.content = {
    type: 'doc',
    content: [
      p(
        'Make room for the useful things. Capture a thought, give it a home, and come back to it whenever you need.',
      ),
      {
        type: 'callout',
        attrs: { emoji: '💡', color: 'gray' },
        content: [p('A thought worth keeping: the best tools make room for your ideas.')],
      },
      {
        type: 'callout',
        attrs: { emoji: '📌', color: 'yellow' },
        content: [p('Choose an icon and a background. Keep important details in view.')],
      },
      {
        type: 'details',
        attrs: { open: false },
        content: [
          { type: 'detailsSummary', content: [text('A little more context')] },
          {
            type: 'detailsContent',
            content: [
              p(
                'Some things can wait until you need them. Expand this section to find the details.',
              ),
            ],
          },
        ],
      },
      {
        type: 'codeBlock',
        attrs: { language: 'typescript' },
        content: [text('const knowledge = { local: true, yours: true };')],
      },
      { type: 'databaseEmbed', attrs: { pageId: collection.id, label: collection.title } },
      p(''),
    ],
  }
  const tools = w.pages.find((page) => page.title === 'Tools')
  w.ui = {
    ...w.ui,
    tabs: [note.id, tools.id],
    activeId: note.id,
    expanded: [...w.ui.expanded, note.id],
    favorites: [note.id, tools.id],
    theme: 'light',
  }
  await fs.writeFile(path.join(workspace, 'workspace.json'), JSON.stringify(w, null, 2))
  await fs.writeFile(
    path.join(root, 'spaces.json'),
    JSON.stringify(
      { activeId: w.id, spaces: [{ id: w.id, name: w.name, icon: w.icon, path: workspace }] },
      null,
      2,
    ),
  )
  await fs.rm(moduleDir, { recursive: true, force: true })
}
const child = spawn(electron, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, SHECO_DATA_DIR: root },
})
console.log('Sheco design preview uses its own local workspace:', workspace)
child.on('exit', (code) => process.exit(code ?? 0))
process.on('SIGINT', () => child.kill())
process.on('SIGTERM', () => child.kill())
