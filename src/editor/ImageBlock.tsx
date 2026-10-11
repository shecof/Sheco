import { useI18n } from '../i18n'
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
  type KeyboardEvent,
} from 'react'
import Image from '@tiptap/extension-image'
import { Node, mergeAttributes } from '@tiptap/core'
import { closeHistory } from '@tiptap/pm/history'
import { NodeSelection } from '@tiptap/pm/state'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import {
  Crop,
  Expand,
  RotateCcw,
  ImageOff,
  MessageSquare,
  ChevronLeft,
  ChevronRight,
  UnfoldVertical,
} from 'lucide-react'
import { useApp } from '../state'
import { imageWidth, clamp, type CropRect } from '../shared/image'
import { ImageCropDialog } from './ImageCropDialog'
import { selectedBlocks, selectBlocks } from './BlockSelection'

type ImageAttrs = Record<string, unknown>
function ImageView({
  node,
  editor,
  getPos,
  updateAttributes,
  selected,
  slide,
}: NodeViewProps & { slide?: number }) {
  const { t, language } = useI18n()

  const readAttrs = (n: typeof node): ImageAttrs =>
    slide === undefined
      ? n.attrs
      : {
          ...n.attrs.images[slide],
          width: n.attrs.width ?? n.attrs.images[0]?.width ?? null,
        }
  const attrs = readAttrs(node)
  const updateImage = (change: ImageAttrs) => {
    if (slide === undefined) updateAttributes(change)
    else
      updateAttributes({
        ...('width' in change ? { width: change.width } : {}),
        images: current.current.attrs.images.map((image: ImageAttrs, index: number) => ({
          ...image,
          ...(index === slide ? change : {}),
          ...('width' in change ? { width: change.width, height: null } : {}),
        })),
      })
  }
  const [captionOpen, setCaptionOpen] = useState(false)
  const [caption, setCaption] = useState(String(attrs.caption ?? ''))
  useLayoutEffect(() => setCaption(String(attrs.caption ?? '')), [attrs.caption])
  const { w, addAttachments } = useApp()
  const [cropping, setCropping] = useState(false)
  const [liveWidth, setLiveWidth] = useState<number | null>(null)
  const [available, setAvailable] = useState(10000)
  const [rendered, setRendered] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const [reload, setReload] = useState(0)
  const wrapper = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLDivElement>(null)
  const captionInput = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    if (captionInput.current) {
      captionInput.current.style.height = 'auto'
      captionInput.current.style.height = captionInput.current.scrollHeight + 'px'
    }
  }, [attrs.caption, captionOpen])
  const alive = useRef(true)
  const current = useRef(node)
  current.current = node
  const dragging = useRef<{
    pointer: number
    x: number
    width: number
    side: 'left' | 'right'
  } | null>(null)
  const width = liveWidth ?? imageWidth(attrs.width)
  const source = String(attrs.src ?? '')
  const original =
    typeof attrs.originalSrc === 'string' && attrs.originalSrc.startsWith(`sheco-asset://${w!.id}/`)
      ? attrs.originalSrc
      : source
  const hasCrop = original !== source
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  useEffect(() => {
    setLoaded(false)
    setFailed(false)
  }, [source, reload])
  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === wrapper.current)
          setAvailable(Math.max(1, Math.floor(entry.contentRect.width)))
        if (entry.target === frame.current) setRendered(Math.round(entry.contentRect.width))
      }
    })
    if (wrapper.current) observer.observe(wrapper.current)
    if (frame.current) observer.observe(frame.current)
    return () => observer.disconnect()
  }, [])
  const minimum = Math.min(48, available)
  function select(add = false) {
    const pos = getPos()
    if (typeof pos !== 'number' || editor.isDestroyed) return
    if (add) {
      const current = editor.state.selection
      const positions = selectedBlocks(editor.state).length
        ? selectedBlocks(editor.state)
        : current instanceof NodeSelection &&
            ['image', 'imageGallery'].includes(current.node.type.name)
          ? [current.from]
          : []
      selectBlocks(
        editor.view,
        positions.includes(pos) ? positions.filter((p) => p !== pos) : [...positions, pos],
      )
      editor.view.focus()
    } else {
      selectBlocks(editor.view, [])
      editor.commands.setNodeSelection(pos)
    }
  }
  function changeImage(attrs: Record<string, unknown>, focus = true) {
    if (editor.isDestroyed || typeof getPos() !== 'number') return
    // A drag, crop, or reset is one undoable action, separate from inserting the image.
    editor.view.dispatch(closeHistory(editor.state.tr))
    updateImage(attrs)
    editor.view.dispatch(closeHistory(editor.state.tr))
    if (focus) editor.view.focus()
  }
  function commit(value: number, focus = true) {
    changeImage({ width: Math.round(clamp(value, minimum, available)), height: null }, focus)
  }
  function begin(e: PointerEvent<HTMLButtonElement>, side: 'left' | 'right') {
    if (e.button !== 0 || !loaded) return
    e.preventDefault()
    e.stopPropagation()
    select()
    e.currentTarget.setPointerCapture(e.pointerId)
    const initial = frame.current!.getBoundingClientRect().width
    dragging.current = { pointer: e.pointerId, x: e.clientX, width: initial, side }
    setLiveWidth(initial)
  }
  function resize(e: PointerEvent<HTMLButtonElement>) {
    const d = dragging.current
    if (!d || d.pointer !== e.pointerId) return
    setLiveWidth(
      clamp(d.width + (e.clientX - d.x) * (d.side === 'right' ? 2 : -2), minimum, available),
    )
  }
  function end(e: PointerEvent<HTMLButtonElement>, canceled = false) {
    const d = dragging.current
    if (!d || d.pointer !== e.pointerId) return
    if (!canceled) commit(d.width + (e.clientX - d.x) * (d.side === 'right' ? 2 : -2))
    dragging.current = null
    setLiveWidth(null)
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId)
  }
  function key(e: KeyboardEvent<HTMLButtonElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
    e.preventDefault()
    e.stopPropagation()
    select()
    const pos = getPos()
    const storedWidth =
      typeof pos === 'number' && editor.state.doc.nodeAt(pos)
        ? imageWidth(readAttrs(editor.state.doc.nodeAt(pos)!).width)
        : null
    const currentWidth = Math.min(
      available,
      storedWidth ?? frame.current?.getBoundingClientRect().width ?? rendered,
    )
    commit(
      e.key === 'Home'
        ? minimum
        : e.key === 'End'
          ? available
          : currentWidth + (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 10 : 1),
      false,
    )
  }
  function historyKey(e: KeyboardEvent<HTMLElement>) {
    if (cropping || e.target instanceof HTMLTextAreaElement || !(e.metaKey || e.ctrlKey)) return
    const key = e.key.toLowerCase()
    if (!['z', 'y', 'я'].includes(key)) return
    e.preventDefault()
    e.stopPropagation()
    if (key === 'y' || e.shiftKey) editor.commands.redo()
    else editor.commands.undo()
    editor.view.focus()
  }
  async function applyCrop(crop: CropRect, bytes: ArrayBuffer) {
    const before = source
    const name =
      String(attrs.alt || 'image')
        .replace(/\.[^.]+$/, '')
        .slice(0, 440) + '-crop.png'
    const attachment = await window.sheco.attachBytes(name, bytes)
    if (
      !alive.current ||
      editor.isDestroyed ||
      readAttrs(current.current).src !== before ||
      typeof getPos() !== 'number'
    )
      return
    addAttachments([attachment])
    changeImage({
      src: `sheco-asset://${w!.id}/${attachment.file}`,
      originalSrc: original,
      crop,
      height: null,
    })
    setCropping(false)
  }
  return (
    <NodeViewWrapper
      className={
        'image-block' + (selected ? ' is-selected' : '') + (dragging.current ? ' is-resizing' : '')
      }
      contentEditable={false}
      onKeyDownCapture={historyKey}
    >
      <div ref={wrapper} className="image-block-inner">
        <div
          ref={frame}
          className="image-frame"
          style={{ width: width ? width + 'px' : 'fit-content' }}
          onClick={(e) => {
            e.stopPropagation()
            select(e.shiftKey || e.metaKey || e.ctrlKey)
          }}
        >
          <img
            key={reload}
            src={source}
            alt={String(attrs.alt ?? '')}
            title={typeof attrs.title === 'string' ? attrs.title : undefined}
            draggable={true}
            data-drag-handle=""
            style={{ width: width ? '100%' : undefined }}
            onLoad={() => {
              setLoaded(true)
              setFailed(false)
            }}
            onError={() => {
              setLoaded(false)
              setFailed(true)
            }}
          />
          {failed && (
            <div className="image-failed">
              <ImageOff size={24} />
              <span>{t('Image unavailable')}</span>
              <button type="button" onClick={() => setReload(reload + 1)}>
                {t('Try again')}
              </button>
            </div>
          )}
          <div className="image-toolbar" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => {
                setCaptionOpen(true)
                requestAnimationFrame(() => captionInput.current?.focus())
              }}
            >
              <MessageSquare size={14} />
              {t('Caption')}
            </button>
            <span className="image-size">{rendered ? `${rendered} px` : ''}</span>
            <button type="button" disabled={!loaded} onClick={() => setCropping(true)}>
              <Crop size={14} />
              {t('Crop')}
            </button>
            <button
              type="button"
              disabled={!loaded}
              onClick={() => commit(available)}
              title={t('Fit image to page')}
            >
              <Expand size={14} />
              {t('Full width')}
            </button>
            {hasCrop && (
              <button
                type="button"
                onClick={() =>
                  changeImage({ src: original, originalSrc: null, crop: null, height: null })
                }
              >
                <RotateCcw size={14} />
                {t('Reset crop')}
              </button>
            )}
          </div>
          {['left', 'right'].map((side) => (
            <button
              key={side}
              type="button"
              className={'image-resize-handle ' + side}
              role="slider"
              aria-label={t('Resize image from ') + side}
              aria-valuemin={minimum}
              aria-valuemax={available}
              aria-valuenow={rendered}
              aria-valuetext={rendered + ' pixels wide'}
              aria-orientation="horizontal"
              disabled={!loaded}
              onPointerDown={(e) => begin(e, side as 'left' | 'right')}
              onPointerMove={resize}
              onPointerUp={(e) => end(e)}
              onPointerCancel={(e) => end(e, true)}
              onLostPointerCapture={() => {
                dragging.current = null
                setLiveWidth(null)
              }}
              onKeyDown={key}
            />
          ))}
        </div>
      </div>
      {(captionOpen || !!attrs.caption) && (
        <div className="image-caption" style={{ maxWidth: rendered ? rendered + 'px' : undefined }}>
          <textarea
            ref={captionInput}
            aria-label={t('Image caption')}
            placeholder={t('Add a caption…')}
            rows={1}
            value={caption}
            onChange={(e) => {
              // React must see the new value in this input event, before the node-view update.
              setCaption(e.target.value)
              updateImage({ caption: e.target.value })
            }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return
              e.preventDefault()
              e.stopPropagation()
              e.currentTarget.blur()
              select()
              editor.view.focus()
            }}
            onInput={(e) => {
              e.currentTarget.style.height = 'auto'
              e.currentTarget.style.height = e.currentTarget.scrollHeight + 'px'
            }}
            onBlur={() => {
              if (!attrs.caption) setCaptionOpen(false)
            }}
          />
          <p className="image-caption-print">{String(attrs.caption ?? '')}</p>
        </div>
      )}
      {cropping && (
        <ImageCropDialog
          src={original}
          initialCrop={hasCrop ? attrs.crop : null}
          onApply={applyCrop}
          onClose={() => setCropping(false)}
        />
      )}
    </NodeViewWrapper>
  )
}

export const EditableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      originalSrc: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-original-src'),
        renderHTML: (attrs) =>
          attrs.originalSrc ? { 'data-original-src': attrs.originalSrc } : {},
      },
      crop: {
        default: null,
        parseHTML: (element) => parseJSON(element.getAttribute('data-crop'), null),
        renderHTML: (attrs) => (attrs.crop ? { 'data-crop': JSON.stringify(attrs.crop) } : {}),
      },
      caption: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-caption') ?? '',
        renderHTML: (attrs) => ({ 'data-caption': attrs.caption }),
      },
    }
  },
  addNodeView() {
    return ReactNodeViewRenderer(ImageView)
  },
}).configure({ allowBase64: false })

function GalleryView(props: NodeViewProps) {
  const { t, language } = useI18n()

  const [active, setActive] = useState(0)
  const images: ImageAttrs[] = props.node.attrs.images
  const index = Math.min(active, Math.max(0, images.length - 1))
  if (!images.length)
    return <NodeViewWrapper contentEditable={false}>{t('Image unavailable')}</NodeViewWrapper>
  return (
    <NodeViewWrapper className="image-gallery" contentEditable={false}>
      <div className="gallery-controls">
        <button
          aria-label={t('Previous image')}
          disabled={index === 0}
          onClick={() => setActive(index - 1)}
        >
          <ChevronLeft size={17} />
        </button>
        <span aria-live="polite">
          {index + 1} / {images.length}
        </span>
        <button
          aria-label={t('Next image')}
          disabled={index === images.length - 1}
          onClick={() => setActive(index + 1)}
        >
          <ChevronRight size={17} />
        </button>
        <button
          className="gallery-split"
          onClick={() => {
            const pos = props.getPos()
            if (typeof pos === 'number')
              props.editor
                .chain()
                .focus()
                .insertContentAt(
                  { from: pos, to: pos + props.node.nodeSize },
                  images.map((attrs) => ({
                    type: 'image',
                    attrs: { ...attrs, width: props.node.attrs.width ?? images[0]?.width ?? null },
                  })),
                )
                .run()
          }}
        >
          <UnfoldVertical size={14} />
          {t('Separate images')}
        </button>
      </div>
      <div className="gallery-active">
        <ImageView key={index} {...props} slide={index} />
      </div>
      <div className="gallery-print">
        {images.map((image, i) => (
          <figure key={i}>
            <img
              src={String(image.src ?? '')}
              alt={String(image.alt ?? '')}
              style={{ width: imageWidth(props.node.attrs.width ?? images[0]?.width) ?? undefined }}
            />
            <figcaption>{String(image.caption ?? '')}</figcaption>
          </figure>
        ))}
      </div>
    </NodeViewWrapper>
  )
}
export const ImageGallery = Node.create({
  name: 'imageGallery',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      images: {
        default: [],
        parseHTML: (element) => parseJSON(element.getAttribute('data-images'), []),
        renderHTML: (attrs) => ({ 'data-images': JSON.stringify(attrs.images) }),
      },
      width: {
        default: null,
        parseHTML: (element) => Number(element.getAttribute('data-width')) || null,
        renderHTML: (attrs) => (attrs.width ? { 'data-width': attrs.width } : {}),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-type="image-gallery"]' }]
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'image-gallery' }),
      ...node.attrs.images.map((attrs: ImageAttrs) => [
        'figure',
        {},
        ['img', { src: attrs.src, alt: attrs.alt ?? '', width: node.attrs.width ?? attrs.width }],
        ['figcaption', {}, String(attrs.caption ?? '')],
      ]),
    ]
  },
  addNodeView() {
    return ReactNodeViewRenderer(GalleryView)
  },
})

function parseJSON(value: string | null, fallback: unknown) {
  try {
    return value ? JSON.parse(value) : fallback
  } catch {
    return fallback
  }
}
