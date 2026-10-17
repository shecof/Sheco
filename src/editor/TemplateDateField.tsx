import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { CalendarDays, Clock } from 'lucide-react'
import { closeHistory } from '@tiptap/pm/history'
import { useI18n } from '../i18n'
import { PopoverPicker } from '../components/PopoverPicker'
import {
  formatTemplateDate,
  templateDateNode,
  templateDateToken,
  validTemplateDateFormat,
} from '../shared/documentTemplates'

function DateFieldView({ node, editor, getPos }: NodeViewProps) {
  const { t, language } = useI18n()
  const kind = node.attrs.kind === 'time' ? 'time' : 'date'
  const format = String(node.attrs.format)
  const pickerFormat =
    format === 'locale' ? (language === 'ru' ? 'DD.MM.YYYY' : 'M/D/YYYY') : format
  const Icon = kind === 'date' ? CalendarDays : Clock
  const formats =
    kind === 'date'
      ? ['DD.MM.YYYY', 'YYYY-MM-DD', 'D MMMM YYYY', 'ddd, D MMM']
      : ['HH:mm', 'HH:mm:ss', 'hh:mm A']
  if (!formats.includes(pickerFormat)) formats.push(pickerFormat)
  const now = new Date()
  const sample = (value: string) => {
    try {
      return formatTemplateDate(now, value, language)
    } catch {
      return t('Invalid template date format.')
    }
  }
  return (
    <NodeViewWrapper
      as="span"
      className="template-date-field"
      contentEditable={false}
      data-kind={kind}
    >
      <PopoverPicker
        label={t(kind === 'date' ? 'Date format' : 'Time format')}
        value={pickerFormat}
        selectedLabel={`${t(kind === 'date' ? 'Date' : 'Time')} · ${sample(format)}`}
        options={formats.map((value) => ({
          value,
          label: `${sample(value)} · ${value}`,
          icon: <Icon size={13} />,
        }))}
        className="template-date-chip"
        popoverClassName="template-date-formats"
        onChange={(value) => {
          const pos = getPos()
          if (typeof pos !== 'number' || editor.isDestroyed) return
          const current = editor.state.doc.nodeAt(pos)
          if (current?.type.name !== templateDateNode) return
          editor.view.dispatch(
            closeHistory(editor.state.tr).setNodeMarkup(pos, undefined, {
              ...current.attrs,
              format: value,
            }),
          )
          editor.view.dispatch(closeHistory(editor.state.tr))
        }}
      />
    </NodeViewWrapper>
  )
}

export const TemplateDateField = Node.create({
  name: templateDateNode,
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes: () => ({ kind: { default: 'date' }, format: { default: 'locale' } }),
  parseHTML: () => [
    {
      tag: 'span[data-template-date-field]',
      getAttrs: (element) => {
        const kind = element.getAttribute('data-template-date-field')
        const format = element.getAttribute('data-format') ?? ''
        return kind && ['date', 'time'].includes(kind) && validTemplateDateFormat(format)
          ? { kind, format }
          : false
      },
    },
  ],
  renderHTML: ({ node, HTMLAttributes }) => [
    'span',
    mergeAttributes(HTMLAttributes, {
      'data-template-date-field': node.attrs.kind,
      'data-format': node.attrs.format,
    }),
    templateDateToken(node.attrs.kind, node.attrs.format),
  ],
  renderText: ({ node }) => templateDateToken(node.attrs.kind, node.attrs.format),
  addNodeView: () => ReactNodeViewRenderer(DateFieldView),
})
