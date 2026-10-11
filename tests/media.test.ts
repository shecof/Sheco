import { describe, it, expect } from 'vitest'
import { markdown } from '../src/shared/export'
import { plainText } from '../src/shared/model'
import { translate } from '../src/shared/i18n'
import { getSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { AttachmentNode } from '../src/editor/extensions'
import { validateEditorDocument } from '../src/editor/documentSchema'
import { attachmentViews, mediaBlocks } from '../src/shared/media'
describe('media documents', () => {
  it('opens older attachments as wide cards and retains every view without changing file identity or export links', () => {
    const metadata = {
      id: 'attachment-id',
      file: 'report.pdf',
      name: 'A [report].pdf',
      bytes: 1234,
      mime: 'application/pdf',
      createdAt: '2026-10-08T00:00:00.000Z',
    }
    const legacy = mediaBlocks([metadata], 'workspace', 'attachments')[0]
    const schema = getSchema([StarterKit, AttachmentNode])
    expect(schema.nodeFromJSON(legacy).attrs.display).toBe('card')
    validateEditorDocument({ type: 'doc', content: [schema.nodeFromJSON(legacy).toJSON()] })
    for (const display of attachmentViews) {
      const block = {
        type: 'attachment',
        attrs: {
          id: metadata.id,
          file: metadata.file,
          name: metadata.name,
          bytes: metadata.bytes,
          display,
        },
      }
      validateEditorDocument({ type: 'doc', content: [block] })
      expect(schema.nodeFromJSON(block).toJSON()).toEqual(block)
      expect(markdown(block)).toBe('[A \\[report\\].pdf](attachments/report.pdf)\n\n')
      expect(plainText(block)).toContain(metadata.name)
    }
    for (const display of ['unknown', '', false, 7, {}, null])
      expect(() =>
        validateEditorDocument({
          type: 'doc',
          content: [{ type: 'attachment', attrs: { display } }],
        }),
      ).toThrow('Invalid attachment view')
  })
  it('exports every slider image and its caption, escaping Markdown while preserving searchable captions', () => {
    const node = {
      type: 'imageGallery',
      attrs: {
        images: [
          { src: 'sheco-asset://workspace/first.png', alt: 'First', caption: 'A [caption]' },
          {
            src: 'sheco-asset://workspace/second.png',
            alt: 'Second',
            caption: 'Another *caption*',
          },
        ],
      },
    }
    expect(markdown(node)).toBe(
      '![First](attachments/first.png)\n\nA \\[caption\\]\n\n![Second](attachments/second.png)\n\nAnother \\*caption\\*\n\n',
    )
    expect(plainText(node)).toContain('Another *caption*')
  })
  it('exports a named, numbered code block without injecting gutter numbers into code', () => {
    const node = {
      type: 'codeBlock',
      attrs: { title: 'Example.ts', language: 'typescript', lineNumbers: true },
      content: [{ type: 'text', text: 'a\nb' }],
    }
    expect(markdown(node)).toBe('Example.ts\n\n```typescript\na\nb\n```\n\n')
    expect(plainText(node)).toContain('Example.ts a\nb')
  })
  it('translates interface text and safely preserves unknown text and placeholders', () => {
    expect(translate('Settings', 'ru')).toBe('Настройки')
    expect(translate('Settings', 'en')).toBe('Settings')
    expect(translate('My custom page', 'ru')).toBe('My custom page')
    expect(translate('Open {name}', 'ru', { name: 'User notes' })).toBe('Open User notes')
  })
})
