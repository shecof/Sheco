import { useApp } from '../state'
import { useI18n } from '../i18n'
import { PopoverPicker } from './PopoverPicker'
import type { DocumentTemplate } from '../shared/documentTemplates'
import type { PropertyValue } from '../shared/model'

export function TemplateProperties({
  template,
  onChange,
}: {
  template: DocumentTemplate
  onChange: (change: Partial<DocumentTemplate>) => void
}) {
  const { w } = useApp()
  const { t } = useI18n()
  const databases = w!.databases.filter((database) =>
    w!.pages.some((page) => page.id === database.pageId && !page.deletedAt),
  )
  const database = databases.find((item) => item.id === template.databaseDefaults?.databaseId)
  const values = template.databaseDefaults?.values ?? {}
  const options = databases.map((database) => ({
    value: database.id,
    label: w!.pages.find((page) => page.id === database.pageId)!.title || t('Untitled'),
  }))
  if (template.databaseDefaults && !database)
    options.push({ value: template.databaseDefaults.databaseId, label: t('Database unavailable') })
  function set(id: string, value: PropertyValue) {
    if (database)
      onChange({
        databaseDefaults: { databaseId: database.id, values: { ...values, [id]: value } },
      })
  }
  return (
    <details className="template-field-settings template-property-settings">
      <summary>{t('Database properties')}</summary>
      <div className="template-form-field">
        <span>{t('Apply properties in')}</span>
        <PopoverPicker
          label={t('Apply properties in')}
          value={template.databaseDefaults?.databaseId ?? ''}
          options={[{ value: '', label: t('No database properties') }, ...options]}
          onChange={(databaseId) =>
            onChange({ databaseDefaults: databaseId ? { databaseId, values: {} } : undefined })
          }
        />
      </div>
      {database &&
        database.columns
          .filter((column) => !['created', 'modified'].includes(column.type))
          .map((column) => {
            const value = Object.hasOwn(values, column.id) ? values[column.id] : null
            return (
              <div className="template-property-default" key={column.id}>
                <span>{column.name}</span>
                {column.type === 'checkbox' ? (
                  <label className="template-checkbox-value">
                    <input
                      aria-label={column.name}
                      type="checkbox"
                      checked={value === true}
                      onChange={(event) => set(column.id, event.target.checked)}
                    />
                    {t('Checked')}
                  </label>
                ) : column.type === 'select' || column.type === 'status' ? (
                  <PopoverPicker
                    label={column.name}
                    value={typeof value === 'string' ? value : ''}
                    options={[
                      { value: '', label: t('Empty') },
                      ...column.options.map((value) => ({ value, label: value })),
                    ]}
                    onChange={(value) => set(column.id, value)}
                  />
                ) : column.type === 'multiSelect' ? (
                  <div className="template-multi-values">
                    {column.options.map((option) => (
                      <label key={option}>
                        <input
                          type="checkbox"
                          aria-label={column.name + ': ' + option}
                          checked={Array.isArray(value) && value.includes(option)}
                          onChange={(event) =>
                            set(
                              column.id,
                              event.target.checked
                                ? [...(Array.isArray(value) ? value : []), option]
                                : (Array.isArray(value) ? value : []).filter(
                                    (item) => item !== option,
                                  ),
                            )
                          }
                        />
                        {option}
                      </label>
                    ))}
                  </div>
                ) : column.type === 'relation' ? (
                  <PopoverPicker
                    label={column.name}
                    value={typeof value === 'string' ? value : ''}
                    options={[
                      { value: '', label: t('Empty') },
                      ...w!.pages
                        .filter((page) => !page.deletedAt)
                        .map((page) => ({ value: page.id, label: page.title || t('Untitled') })),
                    ]}
                    onChange={(value) => set(column.id, value)}
                  />
                ) : column.type === 'date' ? (
                  <div className="template-date-value">
                    <input
                      type="date"
                      aria-label={column.name}
                      value={
                        typeof value === 'string' && !value.includes('{{') ? value.slice(0, 10) : ''
                      }
                      onChange={(event) => set(column.id, event.target.value)}
                    />
                    <button
                      type="button"
                      className="button"
                      aria-pressed={value === '{{date:YYYY-MM-DD}}'}
                      onClick={() =>
                        set(
                          column.id,
                          value === '{{date:YYYY-MM-DD}}' ? null : '{{date:YYYY-MM-DD}}',
                        )
                      }
                    >
                      {t('Today')}
                    </button>
                  </div>
                ) : (
                  <input
                    aria-label={column.name}
                    type={column.type === 'number' ? 'number' : 'text'}
                    value={typeof value === 'string' || typeof value === 'number' ? value : ''}
                    maxLength={10000}
                    onChange={(event) =>
                      set(
                        column.id,
                        column.type === 'number'
                          ? event.target.value === ''
                            ? null
                            : Number(event.target.value)
                          : event.target.value,
                      )
                    }
                  />
                )}
              </div>
            )
          })}
      <p className="muted small">
        {t(
          'These values apply only to new entries in the selected database. Calculated dates stay automatic.',
        )}
      </p>
    </details>
  )
}
