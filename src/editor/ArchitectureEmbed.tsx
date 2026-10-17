import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { ArrowUpRight, Network } from 'lucide-react'
import { useApp } from '../state'
import { useI18n } from '../i18n'
import { ArchitectureSnapshot } from '../components/ArchitectureSnapshot'

function ArchitectureEmbedView({ node }: NodeViewProps) {
  const { w, openPage } = useApp()
  const { t } = useI18n()
  const page = w?.pages.find(
    (page) => page.id === node.attrs.pageId && page.kind === 'architecture' && !page.deletedAt,
  )
  return (
    <NodeViewWrapper className="diagram-block architecture-embed" contentEditable={false}>
      <div className="diagram-toolbar">
        <span>
          <Network size={15} />
          {page?.title || String(node.attrs.label || t('Project architecture'))}
        </span>
        {page && (
          <button
            type="button"
            className="diagram-edit-button"
            aria-label={t('Open architecture')}
            title={t('Open architecture')}
            onClick={() => openPage(page.id, true)}
          >
            <ArrowUpRight size={15} />
          </button>
        )}
      </div>
      {page?.architecture ? (
        <div className="architecture-embed-preview" onDoubleClick={() => openPage(page.id, true)}>
          <ArchitectureSnapshot project={page.architecture} />
        </div>
      ) : (
        <p className="architecture-missing">{t('Architecture page is unavailable')}</p>
      )}
    </NodeViewWrapper>
  )
}
export const ArchitectureEmbed = Node.create({
  name: 'architectureEmbed',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      pageId: { default: '', parseHTML: (element) => element.getAttribute('data-page-id') ?? '' },
      label: {
        default: 'Project architecture',
        parseHTML: (element) => element.getAttribute('data-label') ?? 'Project architecture',
      },
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-type="architecture-embed"]' }]
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'architecture-embed',
        'data-page-id': node.attrs.pageId,
        'data-label': node.attrs.label,
      }),
      node.attrs.label,
    ]
  },
  addNodeView() {
    return ReactNodeViewRenderer(ArchitectureEmbedView)
  },
})
