import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'

export function assetRange(value: string | null, size: number) {
  if (!value) return { start: 0, end: size - 1, partial: false }
  const match = /^bytes=(\d*)-(\d*)$/.exec(value)
  if (!match || (!match[1] && !match[2])) return null
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]))
  const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start > end ||
    start >= size
  )
    return null
  return { start, end, partial: true }
}
export async function assetResponse(file: string, mime: string, origin: string, request: Request) {
  const size = (await stat(file)).size
  const range = assetRange(request.headers.get('Range'), size)
  if (!range)
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
  const headers: Record<string, string> = {
    'Content-Type': mime,
    'Content-Length': String(range.end - range.start + 1),
    'Accept-Ranges': 'bytes',
    'Access-Control-Allow-Origin': origin,
    'Content-Security-Policy': "default-src 'none'",
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
  }
  if (range.partial) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${size}`
  const body =
    request.method === 'HEAD'
      ? null
      : (Readable.toWeb(
          createReadStream(file, { start: range.start, end: range.end }),
        ) as ReadableStream<Uint8Array>)
  return new Response(body, { status: range.partial ? 206 : 200, headers })
}
