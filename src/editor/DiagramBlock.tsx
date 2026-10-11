import { useRef, useState } from 'react'
import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { closeHistory } from '@tiptap/pm/history'
import { GitBranch, Minus, Pencil, Plus } from 'lucide-react'
import { useI18n } from '../i18n'
import {
  defaultDiagramSource,
  defaultDiagramScale,
  diagramScaleSchema,
  type DiagramPositions,
} from '../shared/diagram'
import { DiagramPreview } from './DiagramPreview'
import { DiagramEditor } from './DiagramCanvas'

function DiagramView({ node, editor, getPos }: NodeViewProps) {
  const { t } = useI18n()
  const [editing, setEditing] = useState(false)
  const original = useRef('')
  const source = String(node.attrs.source ?? '')
  const positions: DiagramPositions = node.attrs.positions ?? {}
  const scale = diagramScaleSchema.safeParse(node.attrs.scale).data ?? defaultDiagramScale
  const changeScale = (value: number) => {
    const pos = getPos()
    if (editor.isDestroyed || typeof pos !== 'number') return
    const current = editor.state.doc.nodeAt(pos)
    if (current?.type.name !== 'mermaid') return
    const next = Math.round(Math.min(2, Math.max(0.25, value)) * 100) / 100
    if (current.attrs.scale === next) return
    editor.view.dispatch(
      closeHistory(editor.state.tr).setNodeMarkup(pos, undefined, {
        ...current.attrs,
        scale: next,
      }),
    )
    editor.view.dispatch(closeHistory(editor.state.tr))
  }
  return (
    <NodeViewWrapper className="diagram-block" contentEditable={false}>
      <div className="diagram-toolbar">
        <span>
          <GitBranch size={15} />
          Mermaid
        </span>
        <div className="diagram-block-actions">
          <div className="diagram-scale" role="group" aria-label={t('Diagram scale')}>
            <button
              type="button"
              aria-label={t('Zoom out')}
              title={t('Zoom out')}
              disabled={scale <= 0.25}
              onClick={() => changeScale(scale - 0.1)}
            >
              <Minus size={13} />
            </button>
            <button
              type="button"
              className="diagram-scale-value"
              aria-label={t('Reset diagram scale')}
              title={t('Reset diagram scale')}
              onClick={() => changeScale(defaultDiagramScale)}
            >
              {Math.round(scale * 100)}%
            </button>
            <button
              type="button"
              aria-label={t('Zoom in')}
              title={t('Zoom in')}
              disabled={scale >= 2}
              onClick={() => changeScale(scale + 0.1)}
            >
              <Plus size={13} />
            </button>
          </div>
          <button
            type="button"
            className="diagram-edit-button"
            aria-label={t('Edit diagram')}
            title={t('Edit diagram')}
            onClick={() => {
              original.current = JSON.stringify(node.attrs)
              setEditing(true)
            }}
          >
            <Pencil size={14} />
          </button>
        </div>
      </div>
      <DiagramPreview source={source} positions={positions} scale={scale} />
      {editing && (
        <DiagramEditor
          source={source}
          positions={positions}
          onClose={() => setEditing(false)}
          onApply={(source, positions) => {
            const pos = getPos()
            if (editor.isDestroyed || typeof pos !== 'number') return false
            const current = editor.state.doc.nodeAt(pos)
            if (
              current?.type.name !== 'mermaid' ||
              JSON.stringify(current.attrs) !== original.current
            )
              return false
            const tr = closeHistory(editor.state.tr).setNodeMarkup(pos, undefined, {
              ...current.attrs,
              source,
              positions,
            })
            editor.view.dispatch(tr)
            editor.view.dispatch(closeHistory(editor.state.tr))
            setEditing(false)
            return true
          }}
        />
      )}
    </NodeViewWrapper>
  )
}

export const MermaidBlock = Node.create({
  name: 'mermaid',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      scale: {
        default: defaultDiagramScale,
        parseHTML: (element) =>
          diagramScaleSchema.safeParse(Number(element.getAttribute('data-scale'))).data ??
          defaultDiagramScale,
      },
      source: {
        default: defaultDiagramSource,
        parseHTML: (element) => element.getAttribute('data-source') ?? defaultDiagramSource,
      },
      positions: {
        default: {},
        parseHTML: (element) => {
          try {
            return JSON.parse(element.getAttribute('data-positions') ?? '{}')
          } catch {
            return {}
          }
        },
      },
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-type="mermaid"]' }]
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'mermaid',
        'data-source': node.attrs.source,
        'data-positions': JSON.stringify(node.attrs.positions),
        'data-scale': node.attrs.scale,
      }),
      ['pre', {}, node.attrs.source],
    ]
  },
  addNodeView() {
    return ReactNodeViewRenderer(DiagramView)
  },
})
