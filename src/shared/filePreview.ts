import { z } from 'zod'
import type { Attachment } from './model'

export const filePreviewPrefix = 'plugin:file-preview:'
export const filePreviewTabSchema = z.string().refine((id) => filePreviewId(id) !== null)
export const textPreviewLimit = 4 * 1024 * 1024
export const pdfPreviewLimit = 64 * 1024 * 1024
export const previewRequestSchema = z
  .object({
    workspaceId: z.string().uuid(),
    attachmentId: z.string().uuid(),
  })
  .strict()
export function filePreviewTab(id: string) {
  return filePreviewPrefix + z.string().uuid().parse(id)
}
export function filePreviewId(tab: string): string | null {
  if (!tab.startsWith(filePreviewPrefix)) return null
  const result = z.string().uuid().safeParse(tab.slice(filePreviewPrefix.length))
  return result.success ? result.data : null
}
const previewMimes: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  pdf: 'application/pdf',
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
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  ogv: 'video/ogg',
  mov: 'video/quicktime',
}
// The generated file extension must agree with registered MIME. Legacy videos used octet-stream.
export function attachmentPreviewMime(a: Pick<Attachment, 'file' | 'mime'>) {
  const expected = previewMimes[a.file.split('.').at(-1) ?? '']
  return expected &&
    (a.mime === expected ||
      ((expected.startsWith('video/') ||
        expected.startsWith('text/') ||
        expected === 'application/json' ||
        expected === 'application/xml') &&
        a.mime === 'application/octet-stream'))
    ? expected
    : null
}
export function attachmentPreviewKind(a: Pick<Attachment, 'file' | 'mime'>) {
  const mime = attachmentPreviewMime(a)
  return mime === 'application/pdf'
    ? 'pdf'
    : mime?.startsWith('video/')
      ? 'video'
      : mime &&
          (mime.startsWith('text/') || mime === 'application/json' || mime === 'application/xml')
        ? 'text'
        : null
}
export function decodePreviewText(bytes: Uint8Array) {
  if (bytes.byteLength > textPreviewLimit) throw new Error('Text preview exceeds 4 MB.')
  const encoding =
    bytes[0] === 0xff && bytes[1] === 0xfe
      ? 'utf-16le'
      : bytes[0] === 0xfe && bytes[1] === 0xff
        ? 'utf-16be'
        : 'utf-8'
  const text = new TextDecoder(encoding, { fatal: true }).decode(bytes)
  if (text.includes('\0')) throw new Error('Binary files cannot be previewed as text.')
  return text
}
