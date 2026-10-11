import sharp from 'sharp'
import fs from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
await sharp('build/icon.svg').png().toFile('build/icon.png')
const sizes = [16, 32, 48, 64, 128, 256]
const entries = await Promise.all(
  sizes.map((size) => sharp('build/icon.svg').resize(size, size).png().toBuffer()),
)
const header = Buffer.alloc(6 + 16 * entries.length)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(entries.length, 4)
let offset = header.length
for (let i = 0; i < entries.length; i++) {
  const pos = 6 + 16 * i
  header[pos] = sizes[i] === 256 ? 0 : sizes[i]
  header[pos + 1] = header[pos]
  header.writeUInt16LE(1, pos + 4)
  header.writeUInt16LE(32, pos + 6)
  header.writeUInt32LE(entries[i].length, pos + 8)
  header.writeUInt32LE(offset, pos + 12)
  offset += entries[i].length
}
await fs.writeFile('build/icon.ico', Buffer.concat([header, ...entries]))
if (process.platform === 'darwin') {
  await fs.mkdir('build/icon.iconset', { recursive: true })
  for (const size of [16, 32, 128, 256, 512])
    for (const factor of [1, 2])
      await sharp('build/icon.svg')
        .resize(size * factor, size * factor)
        .png()
        .toFile(`build/icon.iconset/icon_${size}x${size}${factor === 2 ? '@2x' : ''}.png`)
  execFileSync('iconutil', ['-c', 'icns', 'build/icon.iconset', '-o', 'build/icon.icns'])
  await fs.rm('build/icon.iconset', { recursive: true })
}
