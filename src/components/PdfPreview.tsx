import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  PanelLeft,
  ChevronDown,
  Files,
  ListTree,
} from 'lucide-react'
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'
import { useI18n } from '../i18n'
import { useApp } from '../state'
import { MenuItem, Popover } from './ui'
import type { Attachment } from '../shared/model'
import {
  clampPdfScale,
  fitPdfScale,
  pdfWheelScale,
  pdfEdgeWheel,
  pdfWheelGestureGap,
  type PdfEdgeGesture,
  type PdfFit,
  type PdfPreviewSession,
} from '../shared/pdfPreview'

type OutlineItem = NonNullable<Awaited<ReturnType<PDFDocumentProxy['getOutline']>>>[number]
type Outline = Pick<OutlineItem, 'title' | 'dest'> & { items: Outline[] }
function boundedOutline(items: OutlineItem[]) {
  let remaining = 2000
  function walk(items: OutlineItem[], depth: number): Outline[] {
    const result: Outline[] = []
    if (depth > 8) return result
    for (const item of items) {
      if (remaining <= 0) break
      remaining--
      result.push({
        title: item.title.slice(0, 1000),
        dest: item.dest,
        items: walk(item.items, depth + 1),
      })
    }
    return result
  }
  return walk(items, 0)
}
function Thumbnail({ pdf, page }: { pdf: PDFDocumentProxy; page: number }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    let alive = true,
      render: RenderTask | undefined
    void (async () => {
      try {
        const sheet = await pdf.getPage(page)
        if (!alive || !canvas.current) return
        const base = sheet.getViewport({ scale: 1 })
        const view = sheet.getViewport({ scale: Math.min(140 / base.width, 126 / base.height) })
        canvas.current.width = Math.ceil(view.width * 1.5)
        canvas.current.height = Math.ceil(view.height * 1.5)
        canvas.current.style.width = view.width + 'px'
        canvas.current.style.height = view.height + 'px'
        render = sheet.render({
          canvas: canvas.current,
          viewport: view,
          transform: [1.5, 0, 0, 1.5, 0, 0],
        })
        await render.promise
      } catch {
        /* Main page handles unsupported documents; a thumbnail may stay blank. */
      }
    })()
    return () => {
      alive = false
      render?.cancel()
    }
  }, [pdf, page])
  return <canvas ref={canvas} aria-hidden="true" />
}
function PageThumbnails({
  pdf,
  page,
  onPage,
}: {
  pdf: PDFDocumentProxy
  page: number
  onPage: (page: number) => void
}) {
  const { t } = useI18n()
  const scroller = useRef<HTMLDivElement>(null)
  const [top, setTop] = useState(0),
    [height, setHeight] = useState(600)
  const row = 166
  useEffect(() => {
    const element = scroller.current!
    const observer = new ResizeObserver(() => setHeight(element.clientHeight))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    const element = scroller.current!
    const y = (page - 1) * row
    if (y < element.scrollTop || y + row > element.scrollTop + element.clientHeight) {
      element.scrollTop = y
      setTop(y)
    }
  }, [page])
  const first = Math.max(0, Math.floor(top / row) - 2)
  const last = Math.min(pdf.numPages, first + Math.ceil(height / row) + 5)
  return (
    <div
      ref={scroller}
      className="pdf-thumbnails"
      onScroll={(e) => setTop(e.currentTarget.scrollTop)}
    >
      <div style={{ height: pdf.numPages * row, position: 'relative' }}>
        {Array.from({ length: last - first }, (_, i) => i + first + 1).map((number) => (
          <button
            key={number}
            className="pdf-thumbnail"
            style={{ top: (number - 1) * row, height: row - 8 }}
            aria-label={t('Page {page}', { page: number })}
            aria-current={number === page ? 'page' : undefined}
            onClick={() => onPage(number)}
          >
            <Thumbnail pdf={pdf} page={number} />
            <span>{number}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
function OutlineRows({ items, onSelect }: { items: Outline[]; onSelect: (item: Outline) => void }) {
  return (
    <ul>
      {items.map((item, i) => (
        <li key={i}>
          <button disabled={!item.dest} onClick={() => onSelect(item)} title={item.title}>
            {item.title}
          </button>
          {!!item.items.length && <OutlineRows items={item.items} onSelect={onSelect} />}
        </li>
      ))}
    </ul>
  )
}
export function PdfPreview({
  attachment,
  session,
  onSession,
}: {
  attachment: Attachment
  session?: PdfPreviewSession
  onSession: (session: PdfPreviewSession) => void
}) {
  const { t } = useI18n(),
    { w, run } = useApp()
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [sheet, setSheet] = useState<PDFPageProxy | null>(null)
  const [page, setPage] = useState(session?.page ?? 1),
    [pageDraft, setPageDraft] = useState(String(session?.page ?? 1))
  const [fit, setFit] = useState<PdfFit>(session?.fit ?? w!.plugins.filePreview.pdfFit)
  const [scale, setScale] = useState(session?.scale ?? 1),
    [shownScale, setShownScale] = useState(1)
  const [sidebar, setSidebar] = useState(session?.sidebar ?? w!.plugins.filePreview.pdfNavigation)
  const [navigation, setNavigation] = useState<'pages' | 'outline'>(session?.navigation ?? 'pages')
  const [outline, setOutline] = useState<Outline[]>([])
  const [area, setArea] = useState({ width: 600, height: 600 })
  const [error, setError] = useState(false),
    [loading, setLoading] = useState(true),
    [zoomMenu, setZoomMenu] = useState(false)
  const alive = useRef(true),
    stage = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    zoomAnchor = useRef<HTMLButtonElement>(null)
  const resolvedScale = useRef(1),
    pinchScale = useRef(1)
  const displayedPage = useRef(0),
    renderedPage = useRef(0),
    pageLanding = useRef<'start' | 'end'>('start')
  const wheelGesture = useRef<PdfEdgeGesture | null>(null),
    navigationPage = useRef(page)
  const pointerAnchor = useRef<{
    x: number
    y: number
    fractionX: number
    fractionY: number
  } | null>(null)
  const workspaceId = w!.id
  useEffect(() => {
    onSession({ page, fit, scale, sidebar, navigation })
  }, [page, fit, scale, sidebar, navigation, onSession])
  useEffect(() => {
    const element = stage.current!
    const observer = new ResizeObserver(([entry]) =>
      setArea({
        width: Math.max(1, entry.contentRect.width),
        height: Math.max(1, entry.contentRect.height),
      }),
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    alive.current = true
    let task: import('pdfjs-dist').PDFDocumentLoadingTask | undefined
    void (async () => {
      try {
        const pdfjs = await import('pdfjs-dist')
        if (!alive.current) return
        pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
        const bytes = await window.sheco.readPreviewPdf({
          workspaceId,
          attachmentId: attachment.id,
        })
        if (!alive.current) return
        task = pdfjs.getDocument({
          data: new Uint8Array(bytes),
          useSystemFonts: true,
          cMapUrl: new URL('pdfjs/cmaps/', location.href).href,
          standardFontDataUrl: new URL('pdfjs/standard_fonts/', location.href).href,
          wasmUrl: new URL('pdfjs/wasm/', location.href).href,
          iccUrl: new URL('pdfjs/iccs/', location.href).href,
        })
        const doc = await task.promise
        if (!alive.current) return
        setPdf(doc)
        navigationPage.current = Math.min(doc.numPages, navigationPage.current)
        setPage(navigationPage.current)
        setLoading(false)
        const entries = await doc.getOutline().catch(() => null)
        if (alive.current) setOutline(boundedOutline(entries ?? []))
      } catch {
        if (alive.current) {
          setError(true)
          setLoading(false)
        }
      }
    })()
    return () => {
      alive.current = false
      void task?.destroy().catch(() => {})
    }
  }, [workspaceId, attachment.id])
  useEffect(() => {
    setPageDraft(String(page))
  }, [page])
  useEffect(() => {
    if (!pdf) return
    let live = true
    void pdf.getPage(page).then(
      (value) => {
        if (live) setSheet(value)
      },
      () => {
        if (live) setError(true)
      },
    )
    return () => {
      live = false
    }
  }, [pdf, page])
  useLayoutEffect(() => {
    const element = canvas.current,
      scroller = stage.current
    if (!sheet || sheet.pageNumber !== page || !element || !scroller) return
    const base = sheet.getViewport({ scale: 4 / 3 })
    const value = fitPdfScale(fit, area, base, scale)
    resolvedScale.current = value
    pinchScale.current = value
    setShownScale(value)
    const viewport = sheet.getViewport({ scale: (value * 4) / 3 })
    // Resize the existing bitmap visually without clearing it while a sharper copy renders.
    element.style.width = viewport.width + 'px'
    element.style.height = viewport.height + 'px'
    const anchor = pointerAnchor.current
    pointerAnchor.current = null
    if (displayedPage.current !== page) {
      displayedPage.current = page
      scroller.scrollLeft = 0
      scroller.scrollTop = pageLanding.current === 'end' ? scroller.scrollHeight : 0
    } else if (anchor) {
      const next = element.getBoundingClientRect()
      scroller.scrollLeft += next.left + anchor.fractionX * viewport.width - anchor.x
      scroller.scrollTop += next.top + anchor.fractionY * viewport.height - anchor.y
    }
    let live = true,
      render: RenderTask | undefined
    const timer = window.setTimeout(
      () => {
        void (async () => {
          const buffer = document.createElement('canvas')
          try {
            const ratio = Math.min(
              devicePixelRatio || 1,
              2,
              Math.sqrt(20_000_000 / (viewport.width * viewport.height)),
            )
            buffer.width = Math.ceil(viewport.width * ratio)
            buffer.height = Math.ceil(viewport.height * ratio)
            render = sheet.render({
              canvas: buffer,
              viewport,
              transform: [ratio, 0, 0, ratio, 0, 0],
            })
            await render.promise
            if (!live) return
            // Clear and copy in one synchronous operation, so no empty frame can be painted.
            element.width = buffer.width
            element.height = buffer.height
            element.getContext('2d')!.drawImage(buffer, 0, 0)
            renderedPage.current = page
          } catch (e) {
            if (live && !(e instanceof Error && e.name === 'RenderingCancelledException'))
              setError(true)
          } finally {
            buffer.width = buffer.height = 0
          }
        })()
      },
      renderedPage.current === page ? 120 : 0,
    )
    return () => {
      live = false
      window.clearTimeout(timer)
      render?.cancel()
    }
  }, [sheet, page, fit, scale, area])
  useEffect(() => {
    const element = stage.current!
    const wheel = (event: WheelEvent) => {
      if (!pdf || error) return
      if (!event.ctrlKey) {
        if (event.shiftKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
        event.preventDefault()
        const now = performance.now(),
          unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1,
          delta = event.deltaY * unit,
          gesture = wheelGesture.current
        let remainder = delta
        const continuing =
          gesture &&
          now - gesture.time <= pdfWheelGestureGap &&
          gesture.direction === Math.sign(delta)
        const inFlight = continuing && gesture.turned
        const pageHeight = Math.max(
          element.clientHeight,
          canvas.current?.getBoundingClientRect().height ?? 0,
        )
        // Once a turn starts, its remaining input belongs to that gesture even during rasterization.
        if (!inFlight && displayedPage.current === navigationPage.current) {
          const top = element.scrollTop
          element.scrollTop += delta
          element.scrollLeft += event.deltaX * unit
          const moved = element.scrollTop - top
          remainder -= moved
          const reachedEdge =
            delta > 0
              ? element.scrollTop + element.clientHeight >= element.scrollHeight - 2
              : element.scrollTop <= 2
          if (moved !== 0 && reachedEdge && element.scrollHeight > element.clientHeight + 2) {
            wheelGesture.current = pdfEdgeWheel(null, delta, now, pageHeight, true).gesture
            return
          }
          if (Math.abs(remainder) < 1) {
            wheelGesture.current = null
            return
          }
        }
        const result = pdfEdgeWheel(wheelGesture.current, remainder, now, pageHeight)
        wheelGesture.current = result.gesture
        const next = Math.max(1, Math.min(pdf.numPages, navigationPage.current + result.pages))
        if (next !== navigationPage.current) {
          navigationPage.current = next
          pageLanding.current = result.pages < 0 ? 'end' : 'start'
          pointerAnchor.current = null
          setPage(next)
        }
        return
      }
      event.preventDefault()
      event.stopPropagation()
      wheelGesture.current = null
      const box = canvas.current?.getBoundingClientRect()
      if (box?.width && box.height)
        pointerAnchor.current = {
          x: event.clientX,
          y: event.clientY,
          fractionX: (event.clientX - box.left) / box.width,
          fractionY: (event.clientY - box.top) / box.height,
        }
      const next = pdfWheelScale(pinchScale.current, event.deltaY, event.deltaMode)
      pinchScale.current = next
      setScale(next)
      setFit('custom')
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  }, [pdf, error])
  const go = (number: number) => {
    if (pdf) {
      pageLanding.current = 'start'
      pointerAnchor.current = null
      wheelGesture.current = null
      setError(false)
      navigationPage.current = Math.max(1, Math.min(pdf.numPages, number))
      setPage(navigationPage.current)
    }
  }
  const zoom = (factor: number) => {
    wheelGesture.current = null
    setScale(clampPdfScale(resolvedScale.current * factor))
    setFit('custom')
  }
  const chooseFit = (next: PdfFit) => {
    wheelGesture.current = null
    setFit(next)
    setZoomMenu(false)
    pointerAnchor.current = null
    if (stage.current) {
      stage.current.scrollTop = 0
      stage.current.scrollLeft = 0
    }
  }
  const commitPage = () => {
    if (/^\d+$/.test(pageDraft)) go(Number(pageDraft))
    else setPageDraft(String(page))
  }
  async function selectOutline(item: Outline) {
    if (!pdf || !item.dest) return
    try {
      const dest = typeof item.dest === 'string' ? await pdf.getDestination(item.dest) : item.dest
      if (!dest) return
      const index = typeof dest[0] === 'number' ? dest[0] : await pdf.getPageIndex(dest[0])
      if (alive.current) go(index + 1)
    } catch {
      /* Malformed or external outline entries do not navigate away from the document. */
    }
  }
  return (
    <section
      className="file-preview pdf-preview"
      aria-label={t('PDF preview')}
      onKeyDown={(event) => {
        if ((event.target as HTMLElement).closest('input,textarea,[role="tab"]')) return
        const next =
          event.key === 'ArrowRight' || event.key === 'PageDown'
            ? 1
            : event.key === 'ArrowLeft' || event.key === 'PageUp'
              ? -1
              : 0
        if (next) {
          event.preventDefault()
          go(page + next)
        } else if (
          event.target === stage.current &&
          (event.key === '+' || event.key === '=' || event.key === '-')
        ) {
          event.preventDefault()
          zoom(event.key === '-' ? 1 / 1.2 : 1.2)
        }
      }}
    >
      <div className="file-preview-toolbar pdf-toolbar">
        <button
          className="icon-button"
          title={t('PDF navigation')}
          aria-label={t('PDF navigation')}
          aria-expanded={sidebar}
          onClick={() => setSidebar(!sidebar)}
        >
          <PanelLeft size={17} />
        </button>
        <strong title={attachment.name}>{attachment.name}</strong>
        {pdf && (
          <>
            <div className="preview-page-controls" aria-label={t('Page navigation')}>
              <button
                className="icon-button"
                title={t('Previous page')}
                aria-label={t('Previous page')}
                disabled={page <= 1}
                onClick={() => go(page - 1)}
              >
                <ChevronLeft size={17} />
              </button>
              <input
                aria-label={t('Page number')}
                inputMode="numeric"
                maxLength={8}
                style={{ width: `${Math.max(2, String(pdf.numPages).length)}ch` }}
                value={pageDraft}
                onChange={(e) => setPageDraft(e.target.value)}
                onBlur={commitPage}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    commitPage()
                    stage.current?.focus({ preventScroll: true })
                  } else if (e.key === 'Escape') {
                    setPageDraft(String(page))
                    stage.current?.focus({ preventScroll: true })
                  }
                }}
              />
              <span>/ {pdf.numPages}</span>
              <button
                className="icon-button"
                title={t('Next page')}
                aria-label={t('Next page')}
                disabled={page >= pdf.numPages}
                onClick={() => go(page + 1)}
              >
                <ChevronRight size={17} />
              </button>
            </div>
          </>
        )}
        <button
          className="button preview-external"
          aria-label={t('Open externally')}
          title={t('Open externally')}
          onClick={() => run(() => window.sheco.openAttachment(attachment.id))}
        >
          <ArrowUpRight size={15} />
          <span>{t('Open')}</span>
        </button>
      </div>
      <div className="pdf-body">
        {sidebar && pdf && (
          <aside className="pdf-navigation-sidebar" aria-label={t('PDF navigation')}>
            <div className="pdf-navigation-tabs" role="tablist" aria-label={t('PDF navigation')}>
              {(['pages', 'outline'] as const).map((mode) => (
                <button
                  role="tab"
                  aria-selected={navigation === mode}
                  aria-label={t(mode === 'pages' ? 'Pages' : 'PDF outline')}
                  title={t(mode === 'pages' ? 'Pages' : 'PDF outline')}
                  key={mode}
                  onClick={() => setNavigation(mode)}
                >
                  {mode === 'pages' ? <Files size={18} /> : <ListTree size={18} />}
                </button>
              ))}
            </div>
            {navigation === 'pages' ? (
              <PageThumbnails pdf={pdf} page={page} onPage={go} />
            ) : (
              <div className="pdf-outline">
                {outline.length ? (
                  <OutlineRows items={outline} onSelect={(item) => void selectOutline(item)} />
                ) : (
                  <p className="muted small">{t('This PDF has no outline.')}</p>
                )}
              </div>
            )}
          </aside>
        )}
        <div className="pdf-viewport">
          <div
            ref={stage}
            className="file-preview-stage pdf-stage"
            tabIndex={0}
            aria-label={t('PDF document')}
          >
            {loading && <p role="status">{t('Loading…')}</p>}
            {error && (
              <p role="alert">{t('Could not preview this file. Open it in an external app.')}</p>
            )}
            {!error && <canvas ref={canvas} aria-label={t('PDF page {page}', { page })} />}
          </div>
          {pdf && !error && (
            <>
              <div className="preview-zoom-controls" role="toolbar" aria-label={t('PDF scale')}>
                <button
                  className="icon-button"
                  title={t('Zoom out')}
                  aria-label={t('Zoom out')}
                  disabled={shownScale <= 0.1}
                  onClick={() => zoom(1 / 1.2)}
                >
                  <ZoomOut size={17} />
                </button>
                <button
                  ref={zoomAnchor}
                  className="preview-zoom-menu"
                  aria-label={t('PDF scale')}
                  aria-expanded={zoomMenu}
                  onClick={() => setZoomMenu(!zoomMenu)}
                >
                  {Math.round(shownScale * 100)}%<ChevronDown size={12} />
                </button>
                <button
                  className="icon-button"
                  title={t('Zoom in')}
                  aria-label={t('Zoom in')}
                  disabled={shownScale >= 5}
                  onClick={() => zoom(1.2)}
                >
                  <ZoomIn size={17} />
                </button>
              </div>
              {zoomMenu && (
                <Popover anchor={zoomAnchor} align="end" onClose={() => setZoomMenu(false)}>
                  <MenuItem selected={fit === 'height'} onClick={() => chooseFit('height')}>
                    {t('Fit height')}
                  </MenuItem>
                  <MenuItem selected={fit === 'width'} onClick={() => chooseFit('width')}>
                    {t('Fit width')}
                  </MenuItem>
                  {[1, 2, 4].map((value) => (
                    <MenuItem
                      key={value}
                      selected={fit === 'custom' && scale === value}
                      onClick={() => {
                        setScale(value)
                        chooseFit('custom')
                      }}
                    >
                      {value * 100}%
                    </MenuItem>
                  ))}
                </Popover>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  )
}
