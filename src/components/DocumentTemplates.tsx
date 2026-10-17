import { useEffect, useMemo, useRef, useState } from 'react'
import { Copy, FilePlus2, Plus, Pencil, Trash2, ArrowLeft } from 'lucide-react'
import { useI18n } from '../i18n'
import { useApp } from '../state'
import { createPage, plainText, uid, type Page, type DocNode } from '../shared/model'
import {
  documentTemplatesPluginSchema,
  fillTemplate,
  templateLimit,
  type DocumentTemplate,
} from '../shared/documentTemplates'
import { validateEditorDocument } from '../editor/documentSchema'
import { validateReferences } from '../shared/mcp'
import { Modal, PageIcon } from './ui'
import { PopoverPicker } from './PopoverPicker'
import { TemplateEditor } from './TemplateEditor'
import { PluginSettingsHeader } from './PluginSettingsHeader'

export type TemplateEditRequest = { sequence: number; templateId?: string; create?: boolean }

export function DocumentTemplates({
  onCreatePage,
  onEdit,
}: {
  onCreatePage: (id?: string) => void
  onEdit: (id?: string, create?: boolean) => void
}) {
  const { w } = useApp()
  const { t } = useI18n()
  const templates = w!.plugins.documentTemplates.templates
  const [query, setQuery] = useState('')
  const matches = templates.filter((template) =>
    template.name.toLocaleLowerCase().includes(query.toLocaleLowerCase().trim()),
  )
  return (
    <section className="plugin-tool-page templates-page" aria-label={t('Document templates')}>
      <header className="plugin-tool-header">
        <div>
          <h1>
            <FilePlus2 size={24} />
            {t('Document templates')}
          </h1>
          <p className="muted small">{t('Create pages with automatic date and time fields.')}</p>
        </div>
        <button
          className="button primary"
          disabled={templates.length >= templateLimit}
          onClick={() => onEdit(undefined, true)}
        >
          <Plus size={15} />
          {t('Create template')}
        </button>
      </header>
      {templates.length > 0 && (
        <input
          className="template-search"
          type="search"
          aria-label={t('Search templates')}
          placeholder={t('Search templates')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      )}
      {templates.length ? (
        <div className="template-library-cards">
          {matches.map((template) => (
            <article className="template-library-card" key={template.id}>
              <div className="template-card-title">
                <PageIcon icon={template.icon} size={20} />
                <h2>{template.name}</h2>
              </div>
              <p className="template-card-preview">{plainText(template.content).slice(0, 180)}</p>
              <div className="template-card-actions">
                <button className="button" onClick={() => onCreatePage(template.id)}>
                  <FilePlus2 size={15} />
                  {t('Create page')}
                </button>
                <button
                  className="icon-button"
                  title={t('Edit template')}
                  aria-label={t('Edit template') + ': ' + template.name}
                  onClick={() => onEdit(template.id)}
                >
                  <Pencil size={15} />
                </button>
              </div>
            </article>
          ))}
          {!matches.length && <p className="muted small">{t('No matching templates.')}</p>}
        </div>
      ) : (
        <TemplateEmpty onCreate={() => onEdit(undefined, true)} />
      )}
    </section>
  )
}

function TemplateEmpty({ onCreate }: { onCreate: () => void }) {
  const { t } = useI18n()
  return (
    <div className="plugin-empty template-empty">
      <FilePlus2 size={30} />
      <h2>{t('No templates yet.')}</h2>
      <p>{t('Create a template here or save an existing page as a template from its menu.')}</p>
      <button className="button primary" onClick={onCreate}>
        <Plus size={15} />
        {t('Create template')}
      </button>
    </div>
  )
}

export function CreateTemplatePageDialog({
  initialId,
  parentId = null,
  insert,
  onClose,
  onManage,
}: {
  initialId?: string
  parentId?: string | null
  insert?: { page: Page; apply: (content: DocNode) => boolean }
  onClose: () => void
  onManage: (create?: boolean) => void
}) {
  const { w, update, notify } = useApp()
  const { t, language } = useI18n()
  const templates = w!.plugins.documentTemplates.templates
  const destination = w!.pages.find((page) => page.id === parentId && !page.deletedAt)
  const destinationMissing = !!parentId && !destination
  const [selected, setSelected] = useState(initialId ?? templates[0]?.id ?? '')
  const template = templates.find((item) => item.id === selected) ?? templates[0]
  const [title, setTitle] = useState(insert?.page.title ?? template?.name ?? '')
  const [error, setError] = useState('')
  useEffect(() => {
    setTitle(insert?.page.title ?? template?.name ?? '')
    setError('')
  }, [template?.id])
  const preview = useMemo(() => {
    if (!template) return ''
    try {
      const content = fillTemplate(template, {}, { language })
      return (content.content ?? [])
        .map((node) => plainText(node))
        .filter((text) => text.trim())
        .join('\n\n')
    } catch {
      return t('Template preview exceeds its limits.')
    }
  }, [template, language, t])
  function create() {
    if (!template || (!insert && !title.trim()) || destinationMissing) return
    try {
      const now = new Date()
      const content = fillTemplate(template, {}, { language, now })
      validateEditorDocument(content)
      validateReferences(w!, content)
      if (insert) {
        if (insert.apply(content)) onClose()
        else setError(t('The page changed. Reopen the template picker.'))
        return
      }
      let created = false
      update((current) => {
        if (current.id !== w!.id || !current.plugins.documentTemplates.enabled) return current
        if (parentId && !current.pages.some((page) => page.id === parentId && !page.deletedAt)) {
          setError(t('The destination page is no longer available.'))
          return current
        }
        if (current.ui.tabs.length >= 40) {
          notify(t('Close a tab before opening another.'))
          return current
        }
        validateReferences(current, content)
        const currentDatabase = current.pages.some(
          (page) => page.id === parentId && page.kind === 'database',
        )
          ? current.databases.find((database) => database.pageId === parentId)
          : undefined
        const page = {
          ...createPage(current, title.trim(), parentId, 'page', currentDatabase?.id ?? null),
          icon: template.icon,
          description: '',
          content,
        }
        created = true
        return {
          ...current,
          pages: [...current.pages, page],
          ui: {
            ...current.ui,
            tabs: [...current.ui.tabs, page.id],
            activeId: page.id,
            expanded: parentId
              ? [...new Set([...current.ui.expanded, parentId])]
              : current.ui.expanded,
          },
        }
      })
      if (created) onClose()
    } catch (error) {
      setError(
        t(
          error instanceof Error &&
            [
              'Invalid template date format.',
              'Template properties do not match the database. Check their values.',
            ].includes(error.message)
            ? error.message
            : 'Check the template name and document.',
        ),
      )
    }
  }
  return (
    <Modal
      title={t(insert ? 'Insert template' : 'Page from template')}
      onClose={onClose}
      className="template-page-dialog"
    >
      {!template ? (
        <TemplateEmpty onCreate={() => onManage(true)} />
      ) : (
        <form
          className="template-page-form"
          onSubmit={(event) => {
            event.preventDefault()
            create()
          }}
        >
          {destination && (
            <p className="template-page-destination">
              <span>{t('Create inside')}:</span>
              <PageIcon icon={destination.icon} size={14} />
              <strong>{destination.title || t('Untitled')}</strong>
            </p>
          )}
          <div className="template-form-field">
            <span>{t('Template')}</span>
            <PopoverPicker
              label={t('Template')}
              searchPlaceholder={t('Search templates')}
              value={template.id}
              options={templates.map((item) => ({
                value: item.id,
                label: item.name,
                icon: <PageIcon icon={item.icon} />,
              }))}
              onChange={setSelected}
            />
          </div>
          {!insert && (
            <label>
              {t('Page title')}
              <input
                value={title}
                maxLength={500}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
          )}
          {insert && (
            <p className="template-page-destination">
              {t('Insert into')}: <strong>{insert.page.title || t('Untitled')}</strong>
            </p>
          )}
          {!insert && w!.ui.tabs.length >= 40 && (
            <p className="muted small">{t('Close a tab before opening another.')}</p>
          )}
          {(error || destinationMissing) && (
            <p role="alert" className="error-message">
              {destinationMissing ? t('The destination page is no longer available.') : error}
            </p>
          )}
          <details className="template-page-preview">
            <summary>{t('Template preview')}</summary>
            <pre>{preview}</pre>
          </details>
          <div className="template-dialog-actions">
            <button type="button" className="button" onClick={() => onManage()}>
              {t('Manage templates')}
            </button>
            <span />
            <button type="button" className="button" onClick={onClose}>
              {t('Cancel')}
            </button>
            <button
              type="submit"
              className="button primary"
              disabled={
                (!insert && !title.trim()) ||
                destinationMissing ||
                (!insert && w!.ui.tabs.length >= 40)
              }
            >
              <FilePlus2 size={15} />
              {t(insert ? 'Insert template' : 'Create page')}
            </button>
          </div>
        </form>
      )}
    </Modal>
  )
}

export function TemplateConfiguration({
  request,
  onBack,
}: {
  request?: TemplateEditRequest
  onBack: () => void
}) {
  const { w, update, notify } = useApp()
  const { t, language } = useI18n()
  const saved = w!.plugins.documentTemplates.templates
  const [baseline, setBaseline] = useState(JSON.stringify(saved))
  const [draft, setDraft] = useState<DocumentTemplate[]>(() => structuredClone(saved))
  const [selected, setSelected] = useState(saved[0]?.id ?? '')
  const [reset, setReset] = useState(0)
  const [error, setError] = useState('')
  const handledRequest = useRef<number | undefined>(undefined)
  const source = draft.find((template) => template.id === selected) ?? draft[0]
  const conflict = JSON.stringify(saved) !== baseline
  const dirty = JSON.stringify(draft) !== baseline
  useEffect(() => {
    if (!conflict || dirty) return
    setDraft(structuredClone(saved))
    setBaseline(JSON.stringify(saved))
    setSelected((id) => (saved.some((item) => item.id === id) ? id : (saved[0]?.id ?? '')))
    setReset((value) => value + 1)
  }, [saved, conflict, dirty])
  function patch(change: Partial<DocumentTemplate>) {
    if (source)
      setDraft(draft.map((item) => (item.id === source.id ? { ...item, ...change } : item)))
    setError('')
  }
  function add(template?: DocumentTemplate) {
    if (draft.length >= templateLimit) return
    const next: DocumentTemplate = template
      ? { ...structuredClone(template), id: uid(), name: template.name + ' · ' + t('Copy') }
      : {
          id: uid(),
          name: t('New template'),
          description: '',
          icon: 'file',
          content: { type: 'doc', content: [{ type: 'paragraph' }] },
        }
    setDraft([...draft, next])
    setSelected(next.id)
  }
  function reload() {
    setDraft(structuredClone(saved))
    setBaseline(JSON.stringify(saved))
    setSelected(saved[0]?.id ?? '')
    setReset(reset + 1)
    setError('')
  }
  function apply() {
    try {
      if (conflict) return
      const config = documentTemplatesPluginSchema.parse({
        ...w!.plugins.documentTemplates,
        initialized: true,
        templates: draft,
      })
      config.templates.forEach((template) => {
        validateEditorDocument(template.content)
        validateEditorDocument(fillTemplate(template, {}, { language }))
        validateReferences(w!, template.content)
      })
      let applied = false
      update((current) => {
        if (
          current.id !== w!.id ||
          JSON.stringify(current.plugins.documentTemplates.templates) !== baseline
        )
          return current
        applied = true
        return {
          ...current,
          plugins: {
            ...current.plugins,
            documentTemplates: {
              ...current.plugins.documentTemplates,
              initialized: true,
              templates: config.templates,
            },
          },
        }
      })
      if (!applied) {
        setError(t('Templates changed elsewhere. Reload before applying your draft.'))
        return
      }
      setDraft(structuredClone(config.templates))
      setBaseline(JSON.stringify(config.templates))
      notify(t('Templates saved.'))
    } catch {
      setError(t('Check the template name and document.'))
    }
  }
  useEffect(() => {
    if (!request || handledRequest.current === request.sequence) return
    if (request.create) {
      handledRequest.current = request.sequence
      add()
    } else if (request.templateId && draft.some((item) => item.id === request.templateId)) {
      handledRequest.current = request.sequence
      setSelected(request.templateId)
    }
  }, [request, draft])
  return (
    <section className="plugin-tool-page template-configuration" aria-label={t('Template library')}>
      <h1 className="plugin-settings-title">{t('Edit template')}</h1>
      <header className="plugin-card plugin-workspace-heading">
        <PluginSettingsHeader
          icon={FilePlus2}
          title={t('Document templates')}
          description={t('Create pages with automatic date and time fields.')}
        >
          <div className="plugin-tool-actions">
            <button className="button" onClick={onBack}>
              <ArrowLeft size={15} />
              {t('Templates')}
            </button>
            <button className="button primary" disabled={!dirty || conflict} onClick={apply}>
              {t('Save templates')}
            </button>
          </div>
        </PluginSettingsHeader>
      </header>
      {conflict && (
        <div className="template-conflict" role="alert">
          <span>{t('Templates changed elsewhere. Reload before applying your draft.')}</span>
          <button className="button" onClick={reload}>
            {t('Reload saved templates')}
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      <div className="template-workspace template-workspace-focused">
        {source ? (
          <div className="template-edit-panel">
            <div className="template-meta-row">
              <label>
                {t('Template name')}
                <input
                  value={source.name}
                  maxLength={500}
                  onChange={(event) => patch({ name: event.target.value })}
                />
              </label>
              <button
                className="icon-button"
                title={t('Duplicate template')}
                aria-label={t('Duplicate template')}
                disabled={draft.length >= templateLimit}
                onClick={() => add(source)}
              >
                <Copy size={16} />
              </button>
              <button
                className="icon-button"
                title={t('Remove template')}
                aria-label={t('Remove template')}
                onClick={() => {
                  setDraft(draft.filter((item) => item.id !== source.id))
                  setSelected('')
                }}
              >
                <Trash2 size={16} />
              </button>
            </div>
            <TemplateEditor
              key={source.id + ':' + reset}
              content={source.content}
              dateFormat={source.dateFormat}
              timeFormat={source.timeFormat}
              onChange={(content) => patch({ content })}
            />
          </div>
        ) : (
          <TemplateEmpty onCreate={() => add()} />
        )}
      </div>
    </section>
  )
}
