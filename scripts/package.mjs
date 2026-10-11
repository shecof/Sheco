import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const targets = {
  mac: ['--mac', 'dmg', 'zip', '--arm64', '--x64'],
  win: ['--win', 'nsis', 'zip'],
  dir: ['--dir'],
}
const [mode, ...args] = process.argv.slice(2)
if (!Object.hasOwn(targets, mode)) throw new Error('Usage: node scripts/package.mjs mac|win|dir')
const platform = mode === 'dir' ? { darwin: 'mac', win32: 'win' }[process.platform] : mode
if (!platform) throw new Error('Packaging is supported on macOS and Windows.')

const require = createRequire(import.meta.url)
const builder = require.resolve('electron-builder/cli.js')
const outputFlags = ['--config.directories.output', '-c.directories.output']
const outputIndex = args.findIndex((arg) =>
  outputFlags.some((flag) => arg === flag || arg.startsWith(flag + '=')),
)
let output
if (outputIndex !== -1) {
  const arg = args[outputIndex]
  output = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : args[outputIndex + 1]
  if (!output || output.startsWith('-'))
    throw new Error('An explicit output directory is required.')
} else if (!args.some((arg) => ['--help', '-h', '--version'].includes(arg))) {
  const now = new Date()
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-')
  await fs.mkdir('release', { recursive: true })
  for (let sequence = 1; ; sequence++) {
    const suffix = sequence === 1 ? '' : '-' + String(sequence).padStart(2, '0')
    const candidate = path.join('release', `${date}-${platform}${suffix}`)
    try {
      await fs.mkdir(candidate)
      output = candidate
      break
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
    }
  }
  args.push('--config.directories.output=' + output)
}

if (output) console.log('Package output:', output)
const child = spawn(process.execPath, [builder, ...targets[mode], ...args, '--publish', 'never'], {
  stdio: 'inherit',
})
child.once('error', (error) => {
  console.error(error)
  process.exitCode = 1
})
child.once('exit', (code) => {
  process.exitCode = code ?? 1
})
process.once('SIGINT', () => child.kill('SIGINT'))
process.once('SIGTERM', () => child.kill('SIGTERM'))
