import { useI18n } from '../i18n'
import {
  useState,
  useRef,
  useId,
  useEffect,
  useLayoutEffect,
  useMemo,
  type RefObject,
  type ReactNode,
} from 'react'
import {
  Table2,
  List,
  Columns3,
  LayoutGrid,
  Search,
  Plus,
  SlidersHorizontal,
  ArrowDownUp,
  Filter,
  ChevronDown,
  ArrowUpRight,
  Text,
  Hash,
  CheckSquare,
  CircleDot,
  Calendar,
  Link,
  Mail,
  Tags,
  FileSymlink,
  X,
  ArrowUp,
  ArrowDown,
  Pencil,
  Eye,
  EyeOff,
  Trash2,
  GripVertical,
  Check,
} from 'lucide-react'
import { useApp } from '../state'
import {
  columnValue,
  databaseRows,
  plainText,
  propertyTypes,
  uid,
  type Column,
  type Page,
  type PropertyValue,
  type Database,
  type Workspace,
} from '../shared/model'
import { IconButton, MenuItem, Popover, PageIcon } from './ui'
import { PopoverPicker as DatabasePicker } from './PopoverPicker'

const typeLabels: Record<Column['type'], string> = {
  text: 'Text',
  number: 'Number',
  checkbox: 'Checkbox',
  select: 'Select',
  multiSelect: 'Multi-select',
  date: 'Date',
  url: 'URL',
  email: 'Email',
  status: 'Status',
  relation: 'Relation / Page',
  created: 'Created date',
  modified: 'Modified date',
}
const typeIcons: Record<Column['type'], typeof Text> = {
  text: Text,
  number: Hash,
  checkbox: CheckSquare,
  select: CircleDot,
  multiSelect: Tags,
  date: Calendar,
  url: Link,
  email: Mail,
  status: CircleDot,
  relation: FileSymlink,
  created: Calendar,
  modified: Calendar,
}
export function PropertyIcon({ type }: { type: Column['type'] }) {
  const Icon = typeIcons[type]
  return <Icon size={14} strokeWidth={1.7} />
}
type FilterRuleValue = Database['filters'][number]
type FilterOption = { value: string; label: string; icon?: ReactNode; translated?: boolean }

function filterOptions(w: Workspace, db: Database, columnId: string): FilterOption[] {
  const column = db.columns.find((column) => column.id === columnId)
  if (!column) return []
  if (column.type === 'relation')
    return w.pages
      .filter((page) => !page.deletedAt)
      .map((page) => ({
        value: page.id,
        label: page.title,
        icon: <PageIcon icon={page.icon} />,
      }))
  if (column.type === 'checkbox')
    return [
      { value: 'true', label: 'Checked', translated: true },
      { value: 'false', label: 'Unchecked', translated: true },
    ]
  if (!['select', 'multiSelect', 'status'].includes(column.type)) return []
  const values = w.pages
    .filter((page) => page.databaseId === db.id && !page.deletedAt)
    .flatMap((page) => {
      const value = columnValue(page, column)
      return Array.isArray(value) ? value : value == null || value === '' ? [] : [String(value)]
    })
  return [...new Set([...column.options, ...values])].map((value) => ({ value, label: value }))
}

function FilterValue({
  value,
  options,
  onChange,
  inline = false,
}: {
  value: string
  options: FilterOption[]
  onChange: (value: string) => void
  inline?: boolean
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const listId = useId()
  const selected = options.find((option) => option.value === value)
  const label = (option: FilterOption) =>
    (option.translated ? t(option.label) : option.label) || t('Untitled')
  const choices = options
    .filter(
      (option) => selected || label(option).toLocaleLowerCase().includes(value.toLocaleLowerCase()),
    )
    .slice(0, 50)
  const optionList = (
    <div
      ref={list}
      id={listId}
      role="listbox"
      aria-label={t('Choose filter value')}
      className="filter-value-options"
      onKeyDown={(event) => {
        const buttons = [
          ...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]'),
        ]
        if (!buttons.length) return
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
        const next =
          event.key === 'ArrowDown'
            ? (index + 1) % buttons.length
            : event.key === 'ArrowUp'
              ? (index + buttons.length - 1) % buttons.length
              : event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? buttons.length - 1
                  : -1
        if (next < 0) return
        event.preventDefault()
        buttons[next]?.focus()
      }}
    >
      {choices.map((option, index) => (
        <button
          key={option.value}
          type="button"
          role="option"
          aria-selected={option.value === value}
          autoFocus={!inline && (option.value === value || (!selected && index === 0))}
          onClick={() => {
            onChange(option.value)
            setOpen(false)
            input.current?.focus()
          }}
        >
          {option.icon}
          <span>{label(option)}</span>
          {option.value === value && <Check size={14} />}
        </button>
      ))}
      {!choices.length && <p className="muted small">{t('No matching options.')}</p>}
    </div>
  )
  return (
    <div className={'filter-value ' + (inline ? 'inline-filter-value' : '')}>
      <div ref={anchor} className="filter-value-control">
        <input
          ref={input}
          autoFocus={inline}
          aria-label={t('Filter value')}
          placeholder={t('Value')}
          value={selected ? label(selected) : value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowDown' || !options.length) return
            event.preventDefault()
            if (inline) list.current?.querySelector<HTMLButtonElement>('[role="option"]')?.focus()
            else setOpen(true)
          }}
        />
        {!!options.length && !inline && (
          <button
            type="button"
            aria-label={t('Choose filter value')}
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            onClick={() => setOpen(!open)}
          >
            <ChevronDown size={13} />
          </button>
        )}
      </div>
      {inline && !!options.length && optionList}
      {!inline && open && (
        <Popover anchor={anchor} className="filter-value-popover" onClose={() => setOpen(false)}>
          {optionList}
        </Popover>
      )}
    </div>
  )
}

function FilterRule({
  w,
  db,
  filter,
  onChange,
  onRemove,
  fixed = false,
}: {
  w: Workspace
  db: Database
  filter: FilterRuleValue
  onChange: (filter: FilterRuleValue) => void
  onRemove?: () => void
  fixed?: boolean
}) {
  const { t } = useI18n()
  const options = filterOptions(w, db, filter.column)
  return (
    <div className={'filter-row ' + (fixed ? 'quick-filter-row' : '')}>
      {!fixed && (
        <DatabasePicker
          label={t('Filter property')}
          value={filter.column}
          options={[
            { value: 'title', label: t('Name'), icon: <Text size={14} /> },
            ...db.columns.map((column) => ({
              value: column.id,
              label: column.name,
              icon: <PropertyIcon type={column.type} />,
            })),
          ]}
          onChange={(column) => onChange({ ...filter, column, value: '' })}
        />
      )}
      <DatabasePicker
        label={t('Filter operator')}
        value={filter.operator}
        options={[
          { value: 'contains', label: t('contains') },
          { value: 'equals', label: t('is') },
          { value: 'not', label: t('is not') },
          { value: 'empty', label: t('is empty') },
          { value: 'notEmpty', label: t('is not empty') },
        ]}
        onChange={(operator: FilterRuleValue['operator']) => onChange({ ...filter, operator })}
      />
      {!['empty', 'notEmpty'].includes(filter.operator) && (
        <FilterValue
          value={filter.value}
          options={options}
          inline={fixed}
          onChange={(value) => onChange({ ...filter, value })}
        />
      )}
      {onRemove && (
        <IconButton title={t('Remove filter')} onClick={onRemove}>
          <X size={14} />
        </IconButton>
      )}
    </div>
  )
}

export function tagColor(value: string): string {
  const names: Record<string, string> = {
    Website: 'blue',
    Utility: 'amber',
    'Python utility': 'purple',
    JWT: 'green',
    Web: 'blue',
    Proxy: 'purple',
    HTTP: 'gray',
    Network: 'blue',
    Recon: 'peach',
    DNS: 'purple',
    SQL: 'pink',
    Fuzzing: 'pink',
    REST: 'peach',
    'Not started': 'gray',
    'In progress': 'amber',
    Done: 'green',
  }
  if (names[value]) return names[value]
  let n = 0
  for (const c of value) n += c.charCodeAt(0)
  return ['green', 'blue', 'purple', 'amber', 'pink', 'peach'][n % 6]
}
export function PropertyField({
  page,
  column,
  db,
  mode = 'cell',
}: {
  page: Page
  column: Column
  db: Database
  mode?: 'cell' | 'page'
}) {
  const { t, language } = useI18n()

  const { w, editPage, editDB, openPage, notify } = useApp()
  const [editing, setEditing] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const editorHeight = useRef(20)
  const fitText = () => {
    const input = textarea.current
    if (!input) return
    input.style.height = '0px'
    input.style.height = Math.max(editorHeight.current, input.scrollHeight) + 'px'
  }
  useLayoutEffect(() => {
    if (!editing || !ref.current) return
    const input = ref.current.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      'input,textarea',
    )
    if (column.type !== 'text') {
      input?.focus({ preventScroll: true })
      return
    }
    let width = -1
    const resize = () => {
      const next = ref.current!.clientWidth
      if (next === width) return
      width = next
      fitText()
    }
    resize()
    input?.focus({ preventScroll: true })
    const observer = new ResizeObserver(resize)
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [editing, column.type])
  const value = columnValue(page, column)
  const save = (value: PropertyValue) =>
    editPage(page.id, {
      properties: { ...w!.pages.find((p) => p.id === page.id)!.properties, [column.id]: value },
    })
  const display = () => {
    if (column.type === 'checkbox')
      return (
        <input
          type="checkbox"
          aria-label={column.name + t(' for ') + page.title}
          checked={!!value}
          onChange={(e) => save(e.target.checked)}
        />
      )
    if (column.type === 'select' || column.type === 'status' || column.type === 'multiSelect')
      return (
        <div className="tags">
          {(Array.isArray(value) ? value : value ? [String(value)] : []).map((v) => (
            <span key={v} className={'tag ' + tagColor(v)}>
              {column.type === 'status' && <i />}
              {v}
            </span>
          ))}
        </div>
      )
    if (column.type === 'relation') {
      const target = w!.pages.find((p) => p.id === value && !p.deletedAt)
      return target ? (
        <span
          className="relation"
          onClick={(e) => {
            e.stopPropagation()
            openPage(target.id, true)
          }}
        >
          <PageIcon icon={target.icon} />
          {target.title}
        </span>
      ) : null
    }
    if (column.type === 'created' || column.type === 'modified' || column.type === 'date')
      return value ? (
        <span>
          {new Date(String(value)).toLocaleDateString(language === 'ru' ? 'ru-RU' : 'en-GB', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })}
        </span>
      ) : null
    if (column.type === 'url' || column.type === 'email')
      return value ? (
        <span
          className="property-link"
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey) {
              e.stopPropagation()
              void window.sheco.external(
                column.type === 'email' ? 'mailto:' + value : String(value),
              )
            }
          }}
        >
          {String(value)
            .replace(/^https?:\/\//, '')
            .replace(/\/$/, '')}
        </span>
      ) : null
    return value !== null ? <span className="property-text">{String(value)}</span> : null
  }
  const readOnly = ['created', 'modified'].includes(column.type)
  const isMenu = ['select', 'status', 'multiSelect', 'relation'].includes(column.type)
  return (
    <div
      ref={ref}
      className={
        'property-field ' + mode + (editing ? ' editing' : '') + (readOnly ? ' read-only' : '')
      }
      onMouseDown={(e) => {
        if (editing && !isMenu && e.target === e.currentTarget) {
          e.preventDefault()
          ref.current
            ?.querySelector<HTMLInputElement | HTMLTextAreaElement>('input,textarea')
            ?.focus({ preventScroll: true })
        }
      }}
      onClick={(e) => {
        e.stopPropagation()
        if (column.type === 'checkbox' && e.target === e.currentTarget) save(!value)
        if (!editing && !readOnly && column.type !== 'checkbox') {
          const style = getComputedStyle(e.currentTarget)
          const height = Math.max(
            e.currentTarget.clientHeight,
            mode === 'cell' ? (e.currentTarget.closest('td')?.clientHeight ?? 0) : 0,
          )
          editorHeight.current = Math.max(
            20,
            height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom),
          )
          setEditing(true)
          setQuery('')
        }
      }}
      title={
        readOnly
          ? t('Automatically managed')
          : column.type === 'url'
            ? t('Click to edit · Cmd/Ctrl+click to open')
            : t('Click to edit')
      }
    >
      {editing && column.type === 'text' ? (
        <textarea
          ref={textarea}
          aria-label={column.name + t(' for ') + page.title}
          rows={1}
          defaultValue={String(value ?? '')}
          onInput={fitText}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              event.currentTarget.blur()
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              event.currentTarget.value = String(value ?? '')
              event.currentTarget.blur()
            }
          }}
          onBlur={(event) => {
            if (event.target.value !== String(value ?? '')) save(event.target.value)
            setEditing(false)
          }}
        />
      ) : editing && !isMenu ? (
        <input
          aria-label={column.name + t(' for ') + page.title}
          type={column.type === 'number' ? 'number' : column.type === 'date' ? 'date' : 'text'}
          defaultValue={String(value ?? '')}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              e.currentTarget.blur()
            }
            if (e.key === 'Escape') {
              e.stopPropagation()
              e.currentTarget.value = String(value ?? '')
              e.currentTarget.blur()
            }
          }}
          onBlur={(e) => {
            const raw = e.target.value
            if (column.type === 'number' && raw && !Number.isFinite(Number(raw))) {
              notify(t('Enter a finite number.'))
              setEditing(false)
              return
            }
            if (raw !== String(value ?? ''))
              save(column.type === 'number' ? (raw === '' ? null : Number(raw)) : raw)
            setEditing(false)
          }}
        />
      ) : (
        display()
      )}
      {!editing && value === null && mode === 'page' && (
        <span className="property-empty">{t('Empty')}</span>
      )}
      {editing && isMenu && (
        <Popover anchor={ref} className="property-popover" onClose={() => setEditing(false)}>
          <input
            autoFocus
            aria-label={t('Search ') + column.name}
            placeholder={
              column.type === 'relation' ? t('Find a page…') : t('Find or create an option…')
            }
            value={query}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
          />
          <div className="option-list">
            <MenuItem
              onClick={() => {
                save(null)
                setEditing(false)
              }}
            >
              {t('Clear value')}
            </MenuItem>
            {column.type === 'relation'
              ? w!.pages
                  .filter(
                    (p) =>
                      !p.deletedAt &&
                      p.id !== page.id &&
                      p.title.toLowerCase().includes(query.toLowerCase()),
                  )
                  .slice(0, 50)
                  .map((p) => (
                    <MenuItem
                      key={p.id}
                      icon={<PageIcon icon={p.icon} />}
                      onClick={() => {
                        save(p.id)
                        setEditing(false)
                      }}
                    >
                      {p.title || t('Untitled')}
                    </MenuItem>
                  ))
              : column.options
                  .filter((o) => o.toLowerCase().includes(query.toLowerCase()))
                  .map((o) => (
                    <MenuItem
                      key={o}
                      selected={Array.isArray(value) ? value.includes(o) : value === o}
                      onClick={() => {
                        if (column.type === 'multiSelect') {
                          const selected = Array.isArray(value) ? value : []
                          save(
                            selected.includes(o)
                              ? selected.filter((v) => v !== o)
                              : [...selected, o],
                          )
                        } else {
                          save(o)
                          setEditing(false)
                        }
                      }}
                    >
                      <span className={'tag ' + tagColor(o)}>{o}</span>
                    </MenuItem>
                  ))}
            {column.type !== 'relation' &&
              query.trim() &&
              !column.options.some((o) => o.toLowerCase() === query.trim().toLowerCase()) && (
                <MenuItem
                  icon={<Plus size={14} />}
                  onClick={() => {
                    const option = query.trim().slice(0, 100)
                    editDB(db.id, {
                      columns: db.columns.map((c) =>
                        c.id === column.id ? { ...c, options: [...c.options, option] } : c,
                      ),
                    })
                    save(
                      column.type === 'multiSelect'
                        ? [...(Array.isArray(value) ? value : []), option]
                        : option,
                    )
                    setQuery('')
                    if (column.type !== 'multiSelect') setEditing(false)
                  }}
                >
                  {t('Create “')}
                  {query.trim()}”
                </MenuItem>
              )}
          </div>
        </Popover>
      )}
    </div>
  )
}
export function ColumnPopover({
  db,
  column,
  onClose,
  anchor,
  align = 'start',
}: {
  db: Database
  column?: Column
  onClose: () => void
  anchor: RefObject<HTMLElement | null>
  align?: 'start' | 'end'
}) {
  const { t, language } = useI18n()

  const { editDB } = useApp()
  const [name, setName] = useState(column?.name ?? '')
  const [type, setType] = useState<Column['type']>(column?.type ?? 'text')
  const [options, setOptions] = useState(column?.options.join(', ') ?? '')
  const title = column ? t('Edit property') : t('New property')
  return (
    <Popover anchor={anchor} align={align} className="column-editor-popover" onClose={onClose}>
      <header className="column-editor-header">
        <strong>{title}</strong>
        <IconButton title={t('Close')} onClick={onClose}>
          <X size={16} />
        </IconButton>
      </header>
      <form
        className="column-editor-content"
        role="dialog"
        aria-label={title}
        onSubmit={(e) => {
          e.preventDefault()
          const next: Column = {
            id: column?.id ?? uid(),
            name: name.trim(),
            type,
            width: column?.width ?? 180,
            hidden: column?.hidden ?? false,
            options: options
              .split(',')
              .map((v) => v.trim())
              .filter(Boolean),
          }
          editDB(db.id, {
            columns: column
              ? db.columns.map((c) => (c.id === column.id ? next : c))
              : [...db.columns, next],
          })
          onClose()
        }}
      >
        <label>
          {t('Property name')}
          <input
            autoFocus
            maxLength={100}
            placeholder={t('e.g. Category')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </label>
        <div className="field-label">
          <span>{t('Property type')}</span>
          <DatabasePicker
            label={t('Property type')}
            value={type}
            className="property-type-picker"
            popoverClassName="property-type-popover"
            options={propertyTypes.map((propertyType) => ({
              value: propertyType,
              label: t(typeLabels[propertyType]),
              icon: <PropertyIcon type={propertyType} />,
            }))}
            onChange={setType}
          />
        </div>
        {['select', 'multiSelect', 'status'].includes(type) && (
          <label>
            {t('Options')}
            <small>{t('Separate with commas')}</small>
            <input
              placeholder={t('Not started, In progress, Done')}
              value={options}
              onChange={(e) => setOptions(e.target.value)}
            />
          </label>
        )}
        <div className="modal-actions">
          <button className="button" type="button" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button className="button primary" type="submit" disabled={!name.trim()}>
            {t('Save property')}
          </button>
        </div>
      </form>
    </Popover>
  )
}
function RecordName({ page, children }: { page: Page; children: ReactNode }) {
  const { t, language } = useI18n()

  const { editPage, openPage } = useApp()
  const [editing, setEditing] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  useLayoutEffect(() => {
    if (editing) input.current?.focus({ preventScroll: true })
  }, [editing])
  return (
    <div
      className="record-name"
      title={t('Click to rename · Cmd/Ctrl+click to open')}
      onMouseDown={(e) => {
        if (
          e.button === 0 &&
          editing &&
          !(e.target as Element).closest('button,input,.row-handle')
        ) {
          e.preventDefault()
          input.current?.focus({ preventScroll: true })
        }
      }}
      onClick={(e) => {
        if ((e.target as Element).closest('button,input,.row-handle')) return
        e.stopPropagation()
        if (editing) return
        if (e.metaKey || e.ctrlKey) openPage(page.id, true)
        else setEditing(true)
      }}
    >
      {children}
      <PageIcon icon={page.icon} size={16} />
      {editing ? (
        <input
          ref={input}
          className="record-title-input"
          aria-label={t('Name for ') + page.title}
          defaultValue={page.title}
          maxLength={500}
          onFocus={(e) => e.target.select()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              e.currentTarget.blur()
            }
            if (e.key === 'Escape') {
              e.stopPropagation()
              e.currentTarget.value = page.title
              e.currentTarget.blur()
            }
          }}
          onBlur={(e) => {
            if (e.target.value !== page.title) editPage(page.id, { title: e.target.value })
            setEditing(false)
          }}
        />
      ) : (
        <button
          className="record-title"
          aria-label={t('Rename ') + page.title}
          title={t('Click to rename · Cmd/Ctrl+click to open')}
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey) openPage(page.id, true)
            else setEditing(true)
          }}
        >
          {page.title || t('Untitled')}
        </button>
      )}
      <button
        className="open-record-button"
        aria-label={t('Open ') + page.title}
        title={t('Open ') + page.title}
        onClick={(e) => openPage(page.id, e.metaKey || e.ctrlKey)}
      >
        <ArrowUpRight size={14} />
      </button>
    </div>
  )
}
export function DatabaseView({
  page,
  db,
  embedded = false,
}: {
  page: Page
  db: Database
  embedded?: boolean
}) {
  const { t, language } = useI18n()

  const { w, editDB, newPage, openPage, update, notify } = useApp()
  const [rowDrop, setRowDrop] = useState<{ id: string; edge: 'before' | 'after' } | null>(null)
  const [columnDrop, setColumnDrop] = useState<{ id: string; edge: 'before' | 'after' } | null>(
    null,
  )
  const draggingRow = useRef<string | null>(null)
  const draggingColumn = useRef<string | null>(null)
  const [search, setSearch] = useState('')
  const [showSearch, setShowSearch] = useState(false)
  const [menu, setMenu] = useState<'view' | 'columns' | 'sort' | 'filter' | null>(null)
  const [columnEditor, setColumnEditor] = useState<{
    column: Column | 'new'
    fromMenu: boolean
  } | null>(null)
  const propertyAnchor = useRef<HTMLElement>(null)
  const propertyTrigger = useRef<HTMLElement>(null)
  const viewAnchor = useRef<HTMLDivElement>(null)
  const filterAnchor = useRef<HTMLDivElement>(null)
  const sortAnchor = useRef<HTMLDivElement>(null)
  const columnsAnchor = useRef<HTMLDivElement>(null)
  const [resizing, setResizing] = useState<{ column: string; width: number } | null>(null)
  const resizeCleanup = useRef<(() => void) | null>(null)
  const [quickFilter, setQuickFilter] = useState<FilterRuleValue | null>(null)
  const quickFilterAnchor = useRef<HTMLElement>(null)
  const widthSamples = useRef<HTMLDivElement>(null)
  const [tagWidths, setTagWidths] = useState<Record<string, number>>({})
  const tagColumns = useMemo(
    () =>
      db.columns
        .filter((column) => ['select', 'multiSelect', 'status'].includes(column.type))
        .map((column) => ({
          id: column.id,
          type: column.type,
          values: filterOptions(w!, db, column.id).map((option) => option.value),
        })),
    [db.id, db.columns, w?.pages],
  )
  useLayoutEffect(() => {
    if (db.view !== 'table' || !widthSamples.current) return
    const samples = [...widthSamples.current.querySelectorAll<HTMLElement>('[data-column-id]')]
    const measure = () => {
      const next = Object.fromEntries(
        samples.map((sample) => [
          sample.dataset.columnId!,
          Math.ceil(sample.getBoundingClientRect().width) + 1,
        ]),
      )
      setTagWidths((current) =>
        Object.keys(current).length === samples.length &&
        samples.every(
          (sample) => current[sample.dataset.columnId!] === next[sample.dataset.columnId!],
        )
          ? current
          : next,
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    samples.forEach((sample) => observer.observe(sample))
    return () => observer.disconnect()
  }, [db.view, tagColumns])
  useEffect(() => () => resizeCleanup.current?.(), [db.id, db.view, w?.id])
  const columns = db.columns.filter((c) => !c.hidden)
  const minimumWidth = (id: string) => (id === 'title' ? 180 : Math.max(80, tagWidths[id] ?? 0))
  const maximumWidth = (id: string) => Math.max(1000, minimumWidth(id))
  const columnWidth = (id: string) =>
    Math.max(
      minimumWidth(id),
      resizing?.column === id
        ? resizing.width
        : id === 'title'
          ? db.titleWidth
          : columns.find((column) => column.id === id)!.width,
    )
  const rows = databaseRows(w!, db, search)
  const views = [
    { id: 'table', name: 'Table', icon: Table2 },
    { id: 'list', name: 'List', icon: List },
    { id: 'board', name: 'Board', icon: Columns3 },
    { id: 'gallery', name: 'Gallery', icon: LayoutGrid },
  ] as const
  const ViewIcon = views.find((v) => v.id === db.view)!.icon
  const commitWidth = (columnId: string, width: number) => {
    // Intrinsic tag widths can exceed the stored preference's limit for imported values.
    const storedWidth = Math.min(1000, width)
    update((workspace) =>
      workspace.id !== w!.id
        ? workspace
        : {
            ...workspace,
            databases: workspace.databases.map((database) =>
              database.id !== db.id
                ? database
                : columnId === 'title'
                  ? { ...database, titleWidth: storedWidth }
                  : {
                      ...database,
                      columns: database.columns.map((column) =>
                        column.id === columnId ? { ...column, width: storedWidth } : column,
                      ),
                    },
            ),
          },
    )
  }
  const resizeHandle = (column: string, name: string) => (
    <div
      className="column-resize"
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label={t('Resize column ') + name}
      aria-valuemin={minimumWidth(column)}
      aria-valuemax={maximumWidth(column)}
      aria-valuenow={columnWidth(column)}
      onPointerDown={(event) => resize(event, column)}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 50 : 10
        const width =
          event.key === 'ArrowLeft'
            ? columnWidth(column) - step
            : event.key === 'ArrowRight'
              ? columnWidth(column) + step
              : event.key === 'Home'
                ? minimumWidth(column)
                : event.key === 'End'
                  ? maximumWidth(column)
                  : null
        if (width == null) return
        event.preventDefault()
        event.stopPropagation()
        commitWidth(column, Math.max(minimumWidth(column), Math.min(maximumWidth(column), width)))
      }}
    />
  )
  const resize = (event: React.PointerEvent<HTMLElement>, columnId: string) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    resizeCleanup.current?.()
    const start = event.clientX
    const original = columnWidth(columnId)
    const target = event.currentTarget
    const pointerId = event.pointerId
    const widthAt = (x: number) =>
      Math.round(
        Math.max(minimumWidth(columnId), Math.min(maximumWidth(columnId), original + x - start)),
      )
    target.setPointerCapture(pointerId)
    setResizing({ column: columnId, width: original })
    const move = (e: PointerEvent) => {
      if (e.pointerId === pointerId) setResizing({ column: columnId, width: widthAt(e.clientX) })
    }
    const finish = (width?: number) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('blur', cancel)
      window.removeEventListener('keydown', key, true)
      target.removeEventListener('lostpointercapture', cancel)
      resizeCleanup.current = null
      if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId)
      setResizing(null)
      if (width == null || width === original) return
      commitWidth(columnId, width)
    }
    const up = (event: PointerEvent) => {
      if (event.pointerId === pointerId) finish(widthAt(event.clientX))
    }
    const cancel = () => finish()
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      cancel()
    }
    resizeCleanup.current = cancel
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('blur', cancel)
    window.addEventListener('keydown', key, true)
    target.addEventListener('lostpointercapture', cancel)
  }
  const reorderColumn = (from: string, to: string, edge: 'before' | 'after' = 'before') => {
    if (from === to) return
    const source = db.columns.find((c) => c.id === from)
    if (!source) return
    const next = db.columns.filter((c) => c.id !== from)
    const target = next.findIndex((c) => c.id === to)
    if (target < 0) return
    next.splice(target + (edge === 'after' ? 1 : 0), 0, source)
    editDB(db.id, { columns: next })
  }
  const reorderRow = (from: string, to: string, edge: 'before' | 'after') => {
    if (from === to || db.sort) return
    update((w) => {
      const all = w.pages
        .filter((p) => p.databaseId === db.id && !p.deletedAt)
        .sort((a, b) => a.order - b.order)
      const source = all.find((p) => p.id === from)
      if (!source) return w
      const ordered = all.filter((p) => p.id !== from)
      const target = ordered.findIndex((p) => p.id === to)
      if (target < 0) return w
      ordered.splice(target + (edge === 'after' ? 1 : 0), 0, source)
      const orders = new Map(ordered.map((p, i) => [p.id, i]))
      return {
        ...w,
        pages: w.pages.map((p) => (orders.has(p.id) ? { ...p, order: orders.get(p.id)! } : p)),
      }
    })
  }
  const create = () => newPage(page.id, 'page', db.id, !embedded)
  const viewButton = (type: typeof menu) => {
    setQuickFilter(null)
    setColumnEditor(null)
    setMenu(menu === type ? null : type)
  }
  const openColumnFilter = (event: React.MouseEvent<HTMLButtonElement>, column: string) => {
    quickFilterAnchor.current = event.currentTarget
    setMenu(null)
    setColumnEditor(null)
    setQuickFilter(
      quickFilter?.column === column
        ? null
        : (db.filters.find((filter) => filter.column === column) ?? {
            column,
            operator: filterOptions(w!, db, column).length ? 'equals' : 'contains',
            value: '',
          }),
    )
  }
  const changeQuickFilter = (filter: FilterRuleValue) => {
    setQuickFilter(filter)
    const index = db.filters.findIndex((rule) => rule.column === filter.column)
    const active = filter.value !== '' || ['empty', 'notEmpty'].includes(filter.operator)
    editDB(db.id, {
      filters: !active
        ? db.filters.filter((_, i) => i !== index)
        : index < 0
          ? [...db.filters, filter]
          : db.filters.map((rule, i) => (i === index ? filter : rule)),
    })
  }
  const statusColumn = db.columns.find((c) => c.type === 'status' || c.type === 'select')
  const propertyEditor = columnEditor && (
    <ColumnPopover
      key={columnEditor.column === 'new' ? 'new' : columnEditor.column.id}
      anchor={propertyAnchor}
      align={columnEditor.fromMenu ? 'end' : 'start'}
      db={db}
      column={columnEditor.column === 'new' ? undefined : columnEditor.column}
      onClose={() => {
        setColumnEditor(null)
        if (propertyTrigger.current?.isConnected) propertyTrigger.current.focus()
        else propertyAnchor.current?.querySelector<HTMLElement>('button')?.focus()
      }}
    />
  )
  return (
    <div className={'database-view ' + (resizing ? 'resizing-database' : '')}>
      {db.view === 'table' && (
        <div ref={widthSamples} className="database-width-samples" aria-hidden="true">
          {tagColumns.map((column) => (
            <div key={column.id} data-column-id={column.id} className="database-width-sample">
              {column.values.map((value) => (
                <span key={value} className="tag" data-value={value}>
                  {column.type === 'status' && <i />}
                </span>
              ))}
            </div>
          ))}
        </div>
      )}
      <div className="database-toolbar">
        <div className="view-control" ref={viewAnchor}>
          <button className="view-tab" onClick={() => viewButton('view')}>
            <ViewIcon size={16} />
            {t(views.find((v) => v.id === db.view)!.name)}
            <ChevronDown size={12} />
          </button>
          {menu === 'view' && (
            <Popover anchor={viewAnchor} className="view-popover" onClose={() => setMenu(null)}>
              {views.map((v) => (
                <MenuItem
                  key={v.id}
                  selected={db.view === v.id}
                  icon={<v.icon size={16} />}
                  onClick={() => {
                    editDB(db.id, { view: v.id })
                    setMenu(null)
                  }}
                >
                  {t(v.name)}
                </MenuItem>
              ))}
            </Popover>
          )}
        </div>
        <div className="db-toolbar-right">
          {showSearch && (
            <div className="db-search">
              <Search size={14} />
              <input
                autoFocus
                placeholder={t('Search entries…')}
                aria-label={t('Search database')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <button
                aria-label={t('Clear search')}
                onClick={() => {
                  setSearch('')
                  setShowSearch(false)
                }}
              >
                <X size={13} />
              </button>
            </div>
          )}
          <div className="toolbar-anchor" ref={filterAnchor}>
            <button
              className={'toolbar-button ' + (db.filters.length ? 'is-on' : '')}
              title={t('Filter entries')}
              onClick={() => viewButton('filter')}
            >
              <Filter size={15} />
              <span>
                {t('Filter')}
                {db.filters.length ? ' · ' + db.filters.length : ''}
              </span>
            </button>
            {menu === 'filter' && (
              <Popover
                anchor={filterAnchor}
                align="end"
                className="database-popover filter-popover"
                onClose={() => setMenu(null)}
              >
                <div className="popover-title">{t('Filter entries')}</div>
                <p className="muted small">{t('Show entries matching every rule.')}</p>
                {db.filters.map((filter, index) => (
                  <FilterRule
                    key={index}
                    w={w!}
                    db={db}
                    filter={filter}
                    onChange={(next) =>
                      editDB(db.id, {
                        filters: db.filters.map((rule, i) => (i === index ? next : rule)),
                      })
                    }
                    onRemove={() =>
                      editDB(db.id, { filters: db.filters.filter((_, i) => i !== index) })
                    }
                  />
                ))}
                <MenuItem
                  icon={<Plus size={14} />}
                  onClick={() =>
                    editDB(db.id, {
                      filters: [
                        ...db.filters,
                        { column: 'title', operator: 'contains', value: '' },
                      ],
                    })
                  }
                >
                  {t('Add filter')}
                </MenuItem>
                {db.filters.length > 0 && (
                  <MenuItem onClick={() => editDB(db.id, { filters: [] })}>
                    {t('Clear all filters')}
                  </MenuItem>
                )}
              </Popover>
            )}
          </div>
          <div className="toolbar-anchor" ref={sortAnchor}>
            <button
              className={'toolbar-button ' + (db.sort ? 'is-on' : '')}
              title={t('Sort entries')}
              onClick={() => viewButton('sort')}
            >
              <ArrowDownUp size={15} />
              <span>{t('Sort')}</span>
            </button>
            {menu === 'sort' && (
              <Popover
                anchor={sortAnchor}
                align="end"
                className="database-popover sort-popover"
                onClose={() => setMenu(null)}
              >
                <div className="popover-title">{t('Sort by')}</div>
                <DatabasePicker
                  label={t('Sort property')}
                  value={db.sort?.column ?? ''}
                  options={[
                    { value: '', label: t('Manual order'), icon: <GripVertical size={14} /> },
                    { value: 'title', label: t('Name'), icon: <Text size={14} /> },
                    ...db.columns.map((column) => ({
                      value: column.id,
                      label: column.name,
                      icon: <PropertyIcon type={column.type} />,
                    })),
                  ]}
                  onChange={(column) =>
                    editDB(db.id, {
                      sort: column ? { column, direction: db.sort?.direction ?? 'asc' } : null,
                    })
                  }
                />
                {db.sort && (
                  <DatabasePicker
                    label={t('Sort direction')}
                    value={db.sort.direction}
                    options={[
                      { value: 'asc', label: t('Ascending'), icon: <ArrowUp size={14} /> },
                      { value: 'desc', label: t('Descending'), icon: <ArrowDown size={14} /> },
                    ]}
                    onChange={(direction: 'asc' | 'desc') =>
                      editDB(db.id, {
                        sort: {
                          column: db.sort!.column,
                          direction,
                        },
                      })
                    }
                  />
                )}
              </Popover>
            )}
          </div>
          <IconButton title={t('Search database')} onClick={() => setShowSearch(!showSearch)}>
            <Search size={16} />
          </IconButton>
          <div className="toolbar-anchor" ref={columnsAnchor}>
            <IconButton title={t('Database properties')} onClick={() => viewButton('columns')}>
              <SlidersHorizontal size={16} />
            </IconButton>
            {menu === 'columns' && (
              <Popover
                anchor={columnsAnchor}
                align="end"
                className="database-popover columns-popover"
                onClose={() => {
                  setMenu(null)
                  setColumnEditor(null)
                }}
              >
                <div className="popover-title">{t('Properties')}</div>
                {db.columns.map((c, i) => (
                  <div className="column-setting" key={c.id}>
                    <button
                      title={c.hidden ? t('Show property') : t('Hide property')}
                      onClick={() =>
                        editDB(db.id, {
                          columns: db.columns.map((x) =>
                            x.id === c.id ? { ...x, hidden: !x.hidden } : x,
                          ),
                        })
                      }
                    >
                      {c.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                    <span>
                      <PropertyIcon type={c.type} />
                      {c.name}
                    </span>
                    <button
                      aria-label={t('Edit ') + c.name}
                      onClick={(e) => {
                        propertyAnchor.current = columnsAnchor.current
                        propertyTrigger.current = e.currentTarget
                        setColumnEditor({ column: c, fromMenu: true })
                      }}
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      title={t('Move property left')}
                      disabled={i === 0}
                      onClick={() => reorderColumn(c.id, db.columns[i - 1].id)}
                    >
                      <ArrowUp size={13} />
                    </button>
                  </div>
                ))}
                <div className="menu-separator" />
                <MenuItem
                  icon={<Plus size={15} />}
                  onClick={() => {
                    propertyAnchor.current = columnsAnchor.current
                    propertyTrigger.current = null
                    setColumnEditor({ column: 'new', fromMenu: true })
                  }}
                >
                  {t('Add property')}
                </MenuItem>
                {columnEditor?.fromMenu && propertyEditor}
              </Popover>
            )}
          </div>
          <button className="button primary new-entry" onClick={create}>
            <Plus size={15} />
            {t('New')}
          </button>
        </div>
      </div>
      {quickFilter && (
        <Popover
          key={quickFilter.column}
          anchor={quickFilterAnchor}
          className="quick-filter-popover"
          onClose={() => setQuickFilter(null)}
        >
          <div className="popover-title">
            {t('Filter column ') +
              (quickFilter.column === 'title'
                ? t('Name')
                : (db.columns.find((column) => column.id === quickFilter.column)?.name ?? ''))}
          </div>
          <FilterRule w={w!} db={db} filter={quickFilter} fixed onChange={changeQuickFilter} />
          {db.filters.some((filter) => filter.column === quickFilter.column) && (
            <MenuItem
              icon={<X size={14} />}
              onClick={() => {
                editDB(db.id, {
                  filters: db.filters.filter((filter) => filter.column !== quickFilter.column),
                })
                setQuickFilter({
                  ...quickFilter,
                  operator: filterOptions(w!, db, quickFilter.column).length
                    ? 'equals'
                    : 'contains',
                  value: '',
                })
              }}
            >
              {t('Clear column filters')}
            </MenuItem>
          )}
        </Popover>
      )}
      {db.view === 'table' && (
        <div className="database-scroll">
          <table
            className="database-table"
            style={{
              width:
                columnWidth('title') +
                columns.reduce((sum, column) => sum + columnWidth(column.id), 0) +
                46,
            }}
          >
            <colgroup>
              <col style={{ width: columnWidth('title') }} />
              {columns.map((c) => (
                <col key={c.id} style={{ width: columnWidth(c.id) }} />
              ))}
              <col />
            </colgroup>
            <thead>
              <tr>
                <th>
                  <button
                    className="column-header"
                    aria-label={t('Filter column ') + t('Name')}
                    onClick={(event) => openColumnFilter(event, 'title')}
                  >
                    <span className="title-property-icon">{t('Aa')}</span>
                    <span>{t('Name')}</span>
                    <ChevronDown size={11} />
                  </button>
                  {resizeHandle('title', t('Name'))}
                </th>
                {columns.map((c) => (
                  <th
                    key={c.id}
                    className={columnDrop?.id === c.id ? 'column-drop-' + columnDrop.edge : ''}
                    draggable
                    onDragStart={(e) => {
                      draggingColumn.current = c.id
                      e.dataTransfer.effectAllowed = 'move'
                      e.dataTransfer.setData('application/sheco-column', c.id)
                    }}
                    onDragEnd={() => {
                      draggingColumn.current = null
                      setColumnDrop(null)
                    }}
                    onDragOver={(e) => {
                      if (!e.dataTransfer.types.includes('application/sheco-column')) return
                      e.preventDefault()
                      e.stopPropagation()
                      e.dataTransfer.dropEffect = 'move'
                      const rect = e.currentTarget.getBoundingClientRect()
                      setColumnDrop(
                        draggingColumn.current === c.id
                          ? null
                          : {
                              id: c.id,
                              edge: e.clientX < rect.left + rect.width / 2 ? 'before' : 'after',
                            },
                      )
                    }}
                    onDragLeave={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node)) setColumnDrop(null)
                    }}
                    onDrop={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      const rect = e.currentTarget.getBoundingClientRect()
                      reorderColumn(
                        e.dataTransfer.getData('application/sheco-column'),
                        c.id,
                        e.clientX < rect.left + rect.width / 2 ? 'before' : 'after',
                      )
                      draggingColumn.current = null
                      setColumnDrop(null)
                    }}
                  >
                    <button
                      className="column-header"
                      aria-label={t('Filter column ') + c.name}
                      onClick={(event) => openColumnFilter(event, c.id)}
                    >
                      <PropertyIcon type={c.type} />
                      <span>{c.name}</span>
                      <ChevronDown size={11} />
                    </button>
                    {resizeHandle(c.id, c.name)}
                  </th>
                ))}
                <th>
                  <IconButton
                    title={t('Add property')}
                    onClick={(e) => {
                      propertyAnchor.current = e.currentTarget
                      propertyTrigger.current = e.currentTarget
                      setColumnEditor({ column: 'new', fromMenu: false })
                    }}
                  >
                    <Plus size={15} />
                  </IconButton>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className={rowDrop?.id === row.id ? 'row-drop-' + rowDrop.edge : ''}
                  onDragOver={(e) => {
                    if (!e.dataTransfer.types.includes('application/sheco-row') || db.sort) return
                    e.preventDefault()
                    e.stopPropagation()
                    e.dataTransfer.dropEffect = 'move'
                    const rect = e.currentTarget.getBoundingClientRect()
                    setRowDrop(
                      draggingRow.current === row.id
                        ? null
                        : {
                            id: row.id,
                            edge: e.clientY < rect.top + rect.height / 2 ? 'before' : 'after',
                          },
                    )
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) setRowDrop(null)
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    const rect = e.currentTarget.getBoundingClientRect()
                    reorderRow(
                      e.dataTransfer.getData('application/sheco-row'),
                      row.id,
                      e.clientY < rect.top + rect.height / 2 ? 'before' : 'after',
                    )
                    draggingRow.current = null
                    setRowDrop(null)
                  }}
                >
                  <td>
                    <RecordName page={row}>
                      <span
                        className="row-handle"
                        draggable
                        title={t('Drag to reorder entry')}
                        onDragEnd={() => {
                          draggingRow.current = null
                          setRowDrop(null)
                        }}
                        onDragStart={(e) => {
                          if (db.sort) {
                            e.preventDefault()
                            notify(t('Choose manual order before rearranging entries.'))
                            return
                          }
                          draggingRow.current = row.id
                          e.dataTransfer.effectAllowed = 'move'
                          e.dataTransfer.setData('application/sheco-row', row.id)
                        }}
                      >
                        <GripVertical size={13} />
                      </span>
                    </RecordName>
                  </td>
                  {columns.map((c) => (
                    <td
                      key={c.id}
                      className={columnDrop?.id === c.id ? 'column-drop-' + columnDrop.edge : ''}
                    >
                      <PropertyField page={row} column={c} db={db} />
                    </td>
                  ))}
                  <td />
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && (
            <div className="database-empty">
              <Table2 size={28} />
              <strong>
                {search || db.filters.length
                  ? t('No matching entries')
                  : t('Your database is ready')}
              </strong>
              <p>
                {search || db.filters.length
                  ? t('Try another search or adjust your filters.')
                  : t('Add your first entry. Every row has a page of its own.')}
              </p>
            </div>
          )}
          <button className="add-record" onClick={create}>
            <Plus size={16} />
            {t('New entry')}
          </button>
        </div>
      )}
      {db.view === 'list' && (
        <div className="database-list">
          {rows.map((row) => (
            <div key={row.id}>
              <button onClick={() => openPage(row.id)}>
                <PageIcon icon={row.icon} />
                <strong>{row.title || t('Untitled')}</strong>
                <ArrowUpRight size={14} />
              </button>
              {columns.slice(0, 3).map((c) => (
                <PropertyField key={c.id} page={row} column={c} db={db} />
              ))}
            </div>
          ))}
          <button className="add-record" onClick={create}>
            <Plus size={16} />
            {t('New entry')}
          </button>
        </div>
      )}
      {db.view === 'board' && (
        <div className="database-board">
          {[
            ...new Set(
              [
                ...(statusColumn?.options ?? []),
                ...rows.map((p) =>
                  statusColumn ? String(columnValue(p, statusColumn) ?? '') : '',
                ),
              ].filter(Boolean),
            ),
            'Unassigned',
          ].map((group) => {
            const entries = rows.filter(
              (p) =>
                (statusColumn
                  ? String(columnValue(p, statusColumn) ?? 'Unassigned')
                  : 'Unassigned') === group,
            )
            return (
              <section
                className="board-column"
                key={group}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  const id = e.dataTransfer.getData('application/sheco-card')
                  if (id && statusColumn) {
                    const target = w!.pages.find((p) => p.id === id)
                    if (target)
                      update((w) => ({
                        ...w,
                        pages: w.pages.map((p) =>
                          p.id === id
                            ? {
                                ...p,
                                properties: {
                                  ...p.properties,
                                  [statusColumn.id]: group === 'Unassigned' ? null : group,
                                },
                                updatedAt: new Date().toISOString(),
                              }
                            : p,
                        ),
                      }))
                  }
                }}
              >
                <header>
                  <span className={'tag ' + tagColor(group)}>{group}</span>
                  <span>{entries.length}</span>
                </header>
                {entries.map((row) => (
                  <button
                    className="record-card"
                    draggable
                    key={row.id}
                    onDragStart={(e) => e.dataTransfer.setData('application/sheco-card', row.id)}
                    onClick={() => openPage(row.id)}
                  >
                    <PageIcon icon={row.icon} />
                    <strong>{row.title || t('Untitled')}</strong>
                    <p>{plainText(row.content).slice(0, 100)}</p>
                  </button>
                ))}
                <button
                  className="add-record"
                  onClick={() => {
                    const entry = create()
                    if (statusColumn && group !== 'Unassigned')
                      update((w) => ({
                        ...w,
                        pages: w.pages.map((p) =>
                          p.id === entry.id
                            ? { ...p, properties: { [statusColumn.id]: group } }
                            : p,
                        ),
                      }))
                  }}
                >
                  <Plus size={14} />
                  {t('New entry')}
                </button>
              </section>
            )
          })}
        </div>
      )}
      {db.view === 'gallery' && (
        <div className="database-gallery">
          {rows.map((row) => (
            <button className="gallery-card" key={row.id} onClick={() => openPage(row.id)}>
              <div className="gallery-preview">
                <PageIcon icon={row.icon} size={32} />
                <p>{plainText(row.content).slice(0, 130)}</p>
              </div>
              <strong>
                <PageIcon icon={row.icon} />
                {row.title || t('Untitled')}
              </strong>
              <div className="tags">
                {Object.values(row.properties)
                  .filter((v) => Array.isArray(v))
                  .flat()
                  .slice(0, 3)
                  .map((v) => (
                    <span key={String(v)} className={'tag ' + tagColor(String(v))}>
                      {String(v)}
                    </span>
                  ))}
              </div>
            </button>
          ))}
          <button className="gallery-new" onClick={create}>
            <Plus size={24} />
            <span>{t('New entry')}</span>
          </button>
        </div>
      )}
      <div className="database-footer">
        <span>
          {rows.length} {rows.length === 1 ? t('entry') : t('entries')}
          {!!(search || db.filters.length) && t(' shown')}
          <span className="dot">·</span>
          {columns.length + 1} {t('properties')}
        </span>
      </div>
      {!columnEditor?.fromMenu && propertyEditor}
    </div>
  )
}
