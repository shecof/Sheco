import fs from 'node:fs/promises'
import path from 'node:path'
const visited = new Set()
const notices = []
async function locate(name, from) {
  let base = from
  for (;;) {
    const dir = path.join(base, 'node_modules', name)
    if (
      await fs.stat(path.join(dir, 'package.json')).then(
        () => true,
        () => false,
      )
    )
      return dir
    const parent = path.dirname(base)
    if (parent === base) return null
    base = parent
  }
}
async function visit(name, from) {
  const directory = await locate(name, from)
  if (!directory || visited.has(directory)) return
  visited.add(directory)
  const manifest = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'))
  const files = (await fs.readdir(directory)).filter((file) =>
    /^(license|licence|copying|notice)(\.|$)/i.test(file),
  )
  let content = ''
  for (const file of files) {
    if ((await fs.stat(path.join(directory, file))).isFile())
      content += '\n' + file + '\n' + (await fs.readFile(path.join(directory, file), 'utf8'))
  }
  if (manifest.name === 'pdfjs-dist') {
    for (const folder of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
      for (const file of await fs.readdir(path.join(directory, folder))) {
        if (/^LICENSE/.test(file))
          content +=
            '\n' +
            folder +
            '/' +
            file +
            '\n' +
            (await fs.readFile(path.join(directory, folder, file), 'utf8'))
      }
    }
  }
  notices.push(
    `${manifest.name} ${manifest.version}\nLicense: ${typeof manifest.license === 'string' ? manifest.license : JSON.stringify(manifest.license ?? 'See package source')}\n${content || 'License text is provided in the package source.'}`,
  )
  for (const dependency of Object.keys(manifest.dependencies ?? {}))
    await visit(dependency, directory)
}
const root = path.resolve('.')
const manifest = JSON.parse(await fs.readFile('package.json', 'utf8'))
for (const name of Object.keys(manifest.dependencies)) await visit(name, root)
await fs.mkdir('build', { recursive: true })
const own = await fs.readFile('LICENSE', 'utf8')
await fs.writeFile(
  'build/THIRD_PARTY_NOTICES.txt',
  `Sheco — third-party notices\n\n${own}\n\nElectron and Chromium notices are also included with their runtime.\n\n${notices.sort().join('\n\n' + '='.repeat(78) + '\n\n')}\n`,
)
console.log(`Included license notices for ${notices.length} production dependency packages.`)
