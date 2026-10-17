import { useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import { Mathematics } from '@tiptap/extension-mathematics'
import Placeholder from '@tiptap/extension-placeholder'
import {
  Bold,
  Italic,
  Heading2,
  List,
  ListOrdered,
  CheckSquare,
  Quote,
  Code,
  Undo2,
  Redo2,
  CalendarDays,
  Clock,
} from 'lucide-react'
import { documentExtensions } from '../editor/documentSchema'
import { DatabaseEmbed } from '../editor/extensions'
import type { DocNode } from '../shared/model'
import { useI18n } from '../i18n'
import { TemplateDateField } from '../editor/TemplateDateField'
import {
  templateEditorContent,
  templateStoredContent,
  templateDateNode,
} from '../shared/documentTemplates'

export function TemplateEditor({
  content,
  dateFormat = 'locale',
  timeFormat = 'HH:mm',
  onChange,
}: {
  content: DocNode
  dateFormat?: string
  timeFormat?: string
  onChange: (content: DocNode) => void
}) {
  const { t } = useI18n()
  const callback = useRef(onChange)
  callback.current = onChange
  const [, refresh] = useState(0)
  const editor = useEditor({
    extensions: [
      ...documentExtensions().map((extension) =>
        extension.name === DatabaseEmbed.name
          ? DatabaseEmbed.extend({
              // A library draft retains the reference without editing the live database.
              addNodeView: () => null,
            })
          : extension,
      ),
      Mathematics.configure({ katexOptions: { trust: false, throwOnError: false } }),
      TemplateDateField,
      Placeholder.configure({ placeholder: t('Write the content for future pages…') }),
    ],
    content: templateEditorContent({
      content,
      dateFormat,
      timeFormat,
    }),
    editorProps: {
      attributes: {
        class: 'document-editor template-editor',
        'aria-label': t('Template content'),
        spellcheck: 'true',
      },
    },
    onUpdate: ({ editor }) => callback.current(templateStoredContent(editor.getJSON() as DocNode)),
    onTransaction: () => refresh((n) => n + 1),
  })
  if (!editor) return null
  const actions = [
    {
      label: 'Bold',
      icon: Bold,
      active: editor.isActive('bold'),
      action: () => editor.chain().focus().toggleBold().run(),
    },
    {
      label: 'Italic',
      icon: Italic,
      active: editor.isActive('italic'),
      action: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      label: 'Heading',
      icon: Heading2,
      active: editor.isActive('heading', { level: 2 }),
      action: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      label: 'Bulleted list',
      icon: List,
      active: editor.isActive('bulletList'),
      action: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      label: 'Numbered list',
      icon: ListOrdered,
      active: editor.isActive('orderedList'),
      action: () => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      label: 'Task list',
      icon: CheckSquare,
      active: editor.isActive('taskList'),
      action: () => editor.chain().focus().toggleTaskList().run(),
    },
    {
      label: 'Quote',
      icon: Quote,
      active: editor.isActive('blockquote'),
      action: () => editor.chain().focus().toggleBlockquote().run(),
    },
    {
      label: 'Code',
      icon: Code,
      active: editor.isActive('codeBlock'),
      action: () => editor.chain().focus().toggleCodeBlock().run(),
    },
    { label: 'Undo', icon: Undo2, action: () => editor.chain().focus().undo().run() },
    { label: 'Redo', icon: Redo2, action: () => editor.chain().focus().redo().run() },
  ]
  return (
    <div className="template-editor-frame">
      <div className="template-editor-toolbar" role="toolbar" aria-label={t('Text formatting')}>
        {actions.map(({ label, icon: Icon, active, action }) => (
          <button
            key={label}
            type="button"
            className="icon-button"
            title={t(label)}
            aria-label={t(label)}
            aria-pressed={active}
            onClick={action}
          >
            <Icon size={15} />
          </button>
        ))}
        <span className="template-toolbar-separator" aria-hidden="true" />
        {(
          [
            { name: 'date', label: 'Current date', icon: CalendarDays },
            { name: 'time', label: 'Current time', icon: Clock },
          ] as const
        ).map(({ name, label, icon: Icon }) => (
          <button
            key={name}
            type="button"
            className="button template-auto-field"
            aria-label={t(label)}
            title={`{{${name}}}`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              const format = name === 'date' ? dateFormat : timeFormat
              editor
                .chain()
                .focus()
                .insertContent(
                  editor.isActive('codeBlock')
                    ? `{{${name}:${format}}}`
                    : { type: templateDateNode, attrs: { kind: name, format } },
                )
                .run()
            }}
          >
            <Icon size={15} />
            {t(name === 'date' ? 'Date' : 'Time')}
          </button>
        ))}
      </div>
      <EditorContent editor={editor} />
    </div>
  )
}
