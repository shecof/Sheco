import { jiraSettingsTab, mcpSettingsTab, filePreviewSettingsTab } from '../src/shared/plugins'
import { fitPdfScale, pdfWheelScale, pdfEdgeWheel } from '../src/shared/pdfPreview'
import { describe, expect, it } from 'vitest'
import {
  attachmentPreviewKind,
  attachmentPreviewMime,
  filePreviewTab,
  filePreviewId,
  previewRequestSchema,
  decodePreviewText,
  textPreviewLimit,
} from '../src/shared/filePreview'
import { seedWorkspace } from '../src/shared/seed'
import { workspaceSchema, uid } from '../src/shared/model'
import { assetRange, assetResponse } from '../electron/assetResponse'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

describe('attachment previews', () => {
  it('defaults off, accepts only registered supported tabs and preserves other plugins', () => {
    const w = seedWorkspace()
    expect(w.plugins.filePreview.enabled).toBe(false)
    const a = {
      id: uid(),
      file: uid() + '.pdf',
      name: 'Report.pdf',
      mime: 'application/pdf',
      bytes: 12,
      createdAt: new Date().toISOString(),
    }
    w.attachments.push(a)
    const tab = filePreviewTab(a.id)
    w.ui.tabs.push(tab)
    w.ui.activeId = tab
    expect(workspaceSchema.safeParse(w).success).toBe(false)
    w.plugins.filePreview.enabled = true
    expect(workspaceSchema.parse(w).ui.activeId).toBe(tab)
    w.attachments[0].file = uid() + '.html'
    expect(workspaceSchema.safeParse(w).success).toBe(false)
    w.attachments = []
    expect(workspaceSchema.safeParse(w).success).toBe(false)
    expect(filePreviewId('plugin:file-preview:../../secrets')).toBeNull()
    expect(() =>
      previewRequestSchema.parse({ workspaceId: w.id, attachmentId: a.id, path: '/tmp/secret' }),
    ).toThrow()
  })
  it('rejects executable/image mismatches and supports legacy video metadata', () => {
    for (const [file, mime] of [
      ['x.svg', 'image/svg+xml'],
      ['x.html', 'application/pdf'],
      ['x.jpg', 'image/png'],
      ['x.pdf', 'text/html'],
    ])
      expect(attachmentPreviewKind({ file, mime })).toBeNull()
    expect(attachmentPreviewKind({ file: 'x.pdf', mime: 'application/pdf' })).toBe('pdf')
    expect(attachmentPreviewKind({ file: 'x.png', mime: 'image/png' })).toBeNull()
    expect(attachmentPreviewMime({ file: 'x.mp4', mime: 'application/octet-stream' })).toBe(
      'video/mp4',
    )
    expect(attachmentPreviewKind({ file: 'x.mov', mime: 'video/quicktime' })).toBe('video')
  })
  it('bounds media byte ranges, streams partial bytes, and retains MIME security headers', async () => {
    expect(assetRange('bytes=0-4', 10)).toEqual({ start: 0, end: 4, partial: true })
    expect(assetRange('bytes=-3', 10)).toEqual({ start: 7, end: 9, partial: true })
    expect(assetRange('bytes=4-', 10)).toEqual({ start: 4, end: 9, partial: true })
    for (const value of [
      'bytes=10-',
      'bytes=8-4',
      'bytes=-0',
      'bytes=0-1,4-6',
      'bytes=99999999999999999-',
    ])
      expect(assetRange(value, 10)).toBeNull()
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sheco-preview-range-'))
    try {
      const file = path.join(dir, 'data.webm')
      await fs.writeFile(file, '0123456789')
      const response = await assetResponse(
        file,
        'video/webm',
        'sheco://app',
        new Request('https://test.invalid', { headers: { Range: 'bytes=2-5' } }),
      )
      expect(response.status).toBe(206)
      expect(await response.text()).toBe('2345')
      expect(response.headers.get('Content-Range')).toBe('bytes 2-5/10')
      expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
      expect(response.headers.get('Content-Security-Policy')).toBe("default-src 'none'")
      const head = await assetResponse(
        file,
        'video/webm',
        'sheco://app',
        new Request('https://test.invalid', { method: 'HEAD' }),
      )
      expect(await head.text()).toBe('')
      expect(head.headers.get('Content-Length')).toBe('10')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})

// Compatibility and capability changes preserve snapshots while retiring image-only preview tabs.
it('retires legacy image tabs without changing pages/files, retains plugin settings tabs while disabled', () => {
  const w = seedWorkspace()
  const image = {
    id: uid(),
    file: uid() + '.png',
    name: 'Picture.png',
    mime: 'image/png',
    bytes: 12,
    createdAt: new Date().toISOString(),
  }
  w.attachments.push(image)
  w.plugins.filePreview.enabled = true
  const legacy = filePreviewTab(image.id)
  w.ui.tabs.push(legacy)
  w.ui.activeId = legacy
  const old = structuredClone(w)
  const next = workspaceSchema.parse(w)
  expect(next.ui.tabs).not.toContain(legacy)
  expect(next.ui.activeId).toBe(old.ui.tabs.at(-2))
  expect(next.pages).toEqual(old.pages)
  expect(next.attachments).toEqual(old.attachments)
  expect(w).toEqual(old)
  expect(workspaceSchema.parse(next)).toEqual(next)
  w.ui.tabs = old.ui.tabs
  w.ui.activeId = legacy
  w.ui.tabs.push(legacy)
  expect(workspaceSchema.safeParse(w).success).toBe(false)
  const fresh = seedWorkspace()
  fresh.ui.tabs.push(jiraSettingsTab, mcpSettingsTab, filePreviewSettingsTab)
  fresh.ui.activeId = mcpSettingsTab
  expect(workspaceSchema.parse(fresh).ui.activeId).toBe(mcpSettingsTab)
  expect(fresh.plugins.filePreview.pdfFit).toBe('height')
})
it('decodes escaped plain text and UTF-16, rejects binary/oversized data', () => {
  const bytes = new TextEncoder().encode('<script>window.hacked=true</script>\nТекст')
  expect(decodePreviewText(bytes)).toContain('<script>')
  expect(decodePreviewText(new Uint8Array([255, 254, 65, 0, 66, 0]))).toBe('AB')
  expect(decodePreviewText(new Uint8Array([254, 255, 0, 65, 0, 66]))).toBe('AB')
  expect(() => decodePreviewText(new Uint8Array([0, 1, 2]))).toThrow()
  expect(() => decodePreviewText(new Uint8Array([255, 255]))).toThrow()
  expect(() => decodePreviewText(new Uint8Array(textPreviewLimit + 1))).toThrow()
  expect(attachmentPreviewKind({ file: 'x.md', mime: 'text/markdown' })).toBe('text')
  expect(attachmentPreviewKind({ file: 'x.json', mime: 'application/octet-stream' })).toBe('text')
})
it('fits a PDF within height and width and makes bounded pinch scale changes', () => {
  expect(fitPdfScale('height', { width: 900, height: 600 }, { width: 600, height: 800 }, 1)).toBe(
    0.75,
  )
  expect(fitPdfScale('height', { width: 300, height: 600 }, { width: 600, height: 800 }, 1)).toBe(
    0.5,
  )
  expect(fitPdfScale('width', { width: 900, height: 600 }, { width: 600, height: 800 }, 1)).toBe(
    1.5,
  )
  expect(pdfWheelScale(1, -10, 0)).toBeGreaterThan(1)
  expect(pdfWheelScale(1, 10, 0)).toBeLessThan(1)
  expect(pdfWheelScale(5, -1000, 0)).toBe(5)
  expect(pdfWheelScale(0.1, 1000, 0)).toBe(0.1)
})

it('holds a slow edge scroll before turning and ignores its remaining momentum', () => {
  let result = pdfEdgeWheel(null, 20, 0, 800)
  expect(result.pages).toBe(0)
  for (const time of [70, 140, 210]) {
    result = pdfEdgeWheel(result.gesture, 20, time, 800)
    expect(result.pages).toBe(0)
  }
  result = pdfEdgeWheel(result.gesture, 20, 280, 800)
  expect(result.pages).toBe(1)
  expect(pdfEdgeWheel(result.gesture, 80, 300, 800).pages).toBe(0)
  expect(pdfEdgeWheel(result.gesture, 120, 600, 800).pages).toBe(1)
  result = pdfEdgeWheel(null, 20, 0, 800)
  for (const time of [250, 500, 750]) {
    result = pdfEdgeWheel(result.gesture, 20, time, 800)
    expect(result.pages).toBe(0)
  }
  expect(pdfEdgeWheel(result.gesture, 20, 1000, 800).pages).toBe(1)
})

it('carries a strong flick across several pages without repeating the first-turn threshold', () => {
  expect(pdfEdgeWheel(null, 1500, 0, 800).pages).toBe(3)
  expect(pdfEdgeWheel(null, -1500, 0, 800).pages).toBe(-3)
  let result = pdfEdgeWheel(null, 60, 0, 800)
  expect(result.pages).toBe(0)
  result = pdfEdgeWheel(result.gesture, 60, 16, 800)
  expect(result.pages).toBe(1)
  let turns = result.pages
  for (let i = 2; i < 25; i++) {
    result = pdfEdgeWheel(result.gesture, 60, i * 16, 800)
    turns += result.pages
  }
  expect(turns).toBe(3)
})

it('does not let a weak flick tail turn another page and resets on reversal or a pause', () => {
  let result = pdfEdgeWheel(null, 120, 0, 800)
  expect(result.pages).toBe(1)
  for (const [index, delta] of [45, 30, 20, 10, 5, 2].entries()) {
    result = pdfEdgeWheel(result.gesture, delta, (index + 1) * 16, 800)
    expect(result.pages).toBe(0)
  }
  result = pdfEdgeWheel(result.gesture, -20, 120, 800)
  expect(result.pages).toBe(0)
  expect(result.gesture.direction).toBe(-1)
  result = pdfEdgeWheel(result.gesture, -20, 1300, 800)
  expect(result.pages).toBe(0)
  expect(result.gesture.distance).toBe(20)
  expect(pdfEdgeWheel(null, 1500, 0, 2400).pages).toBe(1)
})

it('holds a magnified page on arrival at either edge, discarding a strong overshoot and its tail', () => {
  for (const direction of [1, -1]) {
    let result = pdfEdgeWheel(null, direction * 10000, 0, 2400, true)
    expect(result.pages).toBe(0)
    expect(result.gesture.distance).toBe(0)
    for (let i = 1; i <= 30; i++) {
      result = pdfEdgeWheel(result.gesture, direction * 160, i * 16, 2400)
      expect(result.pages).toBe(0)
    }
    expect(pdfEdgeWheel(result.gesture, direction * 120, 750, 2400).pages).toBe(direction)
  }
})

it('rearms normal navigation after an arrival pause or a change of direction', () => {
  const arrival = pdfEdgeWheel(null, 60, 0, 2400, true).gesture
  const reverse = pdfEdgeWheel(arrival, -20, 50, 2400)
  expect(reverse.gesture.arrived).toBe(false)
  expect(reverse.pages).toBe(0)
  let result = pdfEdgeWheel(arrival, 20, 300, 2400)
  expect(result.gesture.arrived).toBe(false)
  expect(result.pages).toBe(0)
  for (const time of [380, 460, 540]) {
    result = pdfEdgeWheel(result.gesture, 20, time, 2400)
    expect(result.pages).toBe(0)
  }
  expect(pdfEdgeWheel(result.gesture, 20, 620, 2400).pages).toBe(1)
  expect(pdfEdgeWheel(arrival, 1500, 300, 800).pages).toBe(3)
})
