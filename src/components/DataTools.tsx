import { useCallback, useEffect, useId, useRef, useState, type DragEvent } from 'react'
import {
  ArrowDownToLine,
  Braces,
  Check,
  Copy,
  ChevronDown,
  FileText,
  GripVertical,
  Pause,
  Play,
  Plus,
  Upload,
  X,
  Settings2,
  Trash2,
} from 'lucide-react'
import { useI18n } from '../i18n'
import { useApp } from '../state'
import {
  dataOperations,
  dataTextLimit,
  dataRecipeLimit,
  dataParameterLimit,
  dataStepDelimiter,
  DataRecipeError,
  transformDataRecipe,
  type DataRecipeStep,
  type DataStepOptions,
  type DataOperation,
} from '../shared/dataTools'
import { dataToolsSettingsTab } from '../shared/plugins'
import { PopoverPicker } from './PopoverPicker'
import { IconButton, Popover } from './ui'
import { PluginSettingsHeader } from './PluginSettingsHeader'

const operationHelp: Record<DataOperation, { description: string; placeholder: string }> = {
  'json-format': {
    description: 'Add indentation and line breaks to make JSON easier to read.',
    placeholder: 'Paste JSON to format…',
  },
  'json-minify': {
    description: 'Remove extra whitespace from JSON without changing its data.',
    placeholder: 'Paste JSON to minify…',
  },
  'json-validate': {
    description: 'Validate JSON and pass the original text to the next step.',
    placeholder: 'Paste JSON to validate…',
  },
  'json-quote': {
    description: 'Wrap text as a JSON string with escaped quotes and line breaks.',
    placeholder: 'Paste text to quote…',
  },
  'json-unquote': {
    description: 'Restore text from a quoted JSON string.',
    placeholder: 'Paste a JSON string…',
  },
  'json-ndjson': {
    description: 'Put each JSON array item on its own line without rounding numbers.',
    placeholder: 'Paste a JSON array…',
  },
  'ndjson-json': {
    description: 'Combine JSON records into an array, ignoring blank lines.',
    placeholder: 'Paste one JSON value per line…',
  },
  'xml-format': {
    description: 'Add indentation and line breaks to make XML easier to read.',
    placeholder: 'Paste XML to format…',
  },
  'xml-minify': {
    description: 'Compact XML while preserving meaningful text.',
    placeholder: 'Paste XML to minify…',
  },
  'csv-json': {
    description: 'Convert a CSV table with column headers into a JSON array.',
    placeholder: 'Paste CSV with a header row…',
  },
  'json-csv': {
    description: 'Convert a JSON array of flat objects into a CSV table.',
    placeholder: 'Paste a JSON array of objects…',
  },
  'base64-encode': {
    description: 'Convert text or file bytes to Base64.',
    placeholder: 'Paste text to encode…',
  },
  'base64-decode': {
    description: 'Restore UTF-8 text from a Base64 string.',
    placeholder: 'Paste Base64 to decode…',
  },
  'base64url-encode': {
    description: 'Convert text or file bytes to URL-safe Base64.',
    placeholder: 'Paste text to encode…',
  },
  'base64url-decode': {
    description: 'Restore UTF-8 text from a URL-safe Base64 string.',
    placeholder: 'Paste Base64url to decode…',
  },
  'url-encode': {
    description: 'Encode text for use in one part of a URL.',
    placeholder: 'Paste text to encode…',
  },
  'url-decode': {
    description: 'Restore text from an encoded URL component.',
    placeholder: 'Paste an encoded URL component…',
  },
  'hex-encode': {
    description: 'Represent text or file bytes as hexadecimal.',
    placeholder: 'Paste text to encode…',
  },
  'hex-decode': {
    description: 'Restore UTF-8 text from hexadecimal bytes.',
    placeholder: 'Paste hexadecimal bytes to decode…',
  },
  'html-encode': {
    description: 'Escape special characters so HTML can be displayed as text.',
    placeholder: 'Paste text or HTML to escape…',
  },
  'html-decode': {
    description: 'Turn HTML entities into literal text.',
    placeholder: 'Paste text with HTML entities…',
  },
  sha256: {
    description: 'Calculate a SHA-256 fingerprint.',
    placeholder: 'Paste text to hash…',
  },
  sha512: {
    description: 'Calculate a SHA-512 fingerprint.',
    placeholder: 'Paste text to hash…',
  },
  sha1: {
    description: 'Calculate a SHA-1 fingerprint.',
    placeholder: 'Paste text to hash…',
  },
  crc32: {
    description: 'Calculate a CRC-32 checksum of the text or exact file bytes.',
    placeholder: 'Paste text to checksum…',
  },
  'lines-sort': {
    description: 'Sort lines alphabetically.',
    placeholder: 'Paste one item per line…',
  },
  'lines-unique': {
    description: 'Remove repeated lines, keeping their original order.',
    placeholder: 'Paste one item per line…',
  },
  'lines-trim': {
    description: 'Remove spaces from the start and end of each line.',
    placeholder: 'Paste lines to trim…',
  },
  'text-count': {
    description: 'Count characters, words and lines in your text.',
    placeholder: 'Paste text to count…',
  },
  'text-upper': { description: 'Convert text to uppercase.', placeholder: 'Paste text or data…' },
  'text-lower': { description: 'Convert text to lowercase.', placeholder: 'Paste text or data…' },
  'text-trim': {
    description: 'Remove whitespace around the whole text.',
    placeholder: 'Paste text or data…',
  },
  'text-collapse': {
    description: 'Replace runs of whitespace and line breaks with single spaces.',
    placeholder: 'Paste text or data…',
  },
  'text-normalize': {
    description: 'Normalize equivalent Unicode character sequences.',
    placeholder: 'Paste text or data…',
  },
  'lines-empty': {
    description: 'Remove blank and whitespace-only lines.',
    placeholder: 'Paste one item per line…',
  },
  'lines-reverse': {
    description: 'Reverse line order without reversing the text inside each line.',
    placeholder: 'Paste one item per line…',
  },
  'lines-natural': {
    description: 'Sort lines with numbers naturally: item2 before item10.',
    placeholder: 'Paste one item per line…',
  },
  'lines-include': {
    description: 'Keep lines containing the literal search text.',
    placeholder: 'Paste one item per line…',
  },
  'lines-exclude': {
    description: 'Remove lines containing the literal search text.',
    placeholder: 'Paste one item per line…',
  },
  'text-replace': {
    description: 'Replace every literal match; replacement text is used as written.',
    placeholder: 'Paste text or data…',
  },
  'text-split': {
    description: 'Split text at a literal separator into lines.',
    placeholder: 'Paste separated values…',
  },
  'lines-join': {
    description: 'Join lines using your separator.',
    placeholder: 'Paste one item per line…',
  },
  'lines-affix': {
    description: 'Add literal text before and after each line.',
    placeholder: 'Paste one item per line…',
  },
  'lines-lf': { description: 'Convert all line breaks to LF.', placeholder: 'Paste text or data…' },
  'lines-crlf': {
    description: 'Convert all line breaks to CRLF.',
    placeholder: 'Paste text or data…',
  },
}

const categories = ['Formatting', 'Encoding', 'Hashes', 'Text'] as const

function DataActionPicker({
  operation,
  disabled = false,
  onChoose,
}: {
  operation?: DataOperation
  disabled?: boolean
  onChoose: (operation: DataOperation) => void
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState<string>('Formatting')
  const anchor = useRef<HTMLButtonElement>(null)
  const listId = useId()
  const selected = dataOperations.find((item) => item.id === operation)
  const options = dataOperations.filter((item) =>
    query.trim()
      ? t(item.label).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
      : item.group === group,
  )
  function choose(value: DataOperation) {
    onChoose(value)
    setOpen(false)
    anchor.current?.focus()
  }
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className={operation ? 'data-action-picker' : 'data-add-action'}
        disabled={disabled}
        aria-label={t(operation ? 'Change action' : 'Add action')}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => {
          setQuery('')
          setGroup(selected?.group ?? 'Formatting')
          setOpen(!open)
        }}
      >
        {!operation && <Plus size={15} />}
        <span>{t(selected?.label ?? 'Add action')}</span>
        {operation && <ChevronDown size={12} />}
      </button>
      {open && (
        <Popover anchor={anchor} className="data-action-popover" onClose={() => setOpen(false)}>
          <input
            autoFocus
            className="database-picker-search"
            aria-label={t('Find an action')}
            placeholder={t('Find an action…')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && options[0]) {
                event.preventDefault()
                choose(options[0].id)
              } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault()
                const buttons = document
                  .getElementById(listId)
                  ?.querySelectorAll<HTMLButtonElement>('[role="option"]')
                buttons?.[event.key === 'ArrowDown' ? 0 : buttons.length - 1]?.focus()
              }
            }}
          />
          <div className="plugin-category-pills" aria-label={t('Data tool categories')}>
            {categories.map((name) => (
              <button
                key={name}
                aria-pressed={!query && group === name}
                onClick={() => {
                  setGroup(name)
                  setQuery('')
                }}
              >
                {t(name)}
              </button>
            ))}
          </div>
          <div
            id={listId}
            className="data-action-list"
            role="listbox"
            aria-label={t('Choose an action')}
            onKeyDown={(event) => {
              const buttons = [
                ...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]'),
              ]
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
              if (next >= 0) {
                event.preventDefault()
                buttons[next]?.focus()
              }
            }}
          >
            {options.map((item) => (
              <button
                key={item.id}
                role="option"
                aria-selected={operation === item.id}
                title={t(operationHelp[item.id].description)}
                onClick={() => choose(item.id)}
              >
                <span>{t(item.label)}</span>
                {operation === item.id && <Check size={14} />}
              </button>
            ))}
            {!options.length && <p className="picker-empty">{t('No matches.')}</p>}
          </div>
        </Popover>
      )}
    </>
  )
}

type TextParameter = 'find' | 'replacement' | 'delimiter' | 'prefix' | 'suffix'
const actionFields: Partial<
  Record<DataOperation, { key: TextParameter; label: string; placeholder?: string }[]>
> = {
  'lines-include': [{ key: 'find', label: 'Find text', placeholder: 'Text to find…' }],
  'lines-exclude': [{ key: 'find', label: 'Find text', placeholder: 'Text to find…' }],
  'text-replace': [
    { key: 'find', label: 'Find text', placeholder: 'Text to find…' },
    { key: 'replacement', label: 'Replace with', placeholder: 'Leave empty to remove matches' },
  ],
  'text-split': [{ key: 'delimiter', label: 'Separator' }],
  'lines-join': [{ key: 'delimiter', label: 'Separator' }],
  'lines-affix': [
    { key: 'prefix', label: 'Prefix' },
    { key: 'suffix', label: 'Suffix' },
  ],
}
function DataActionOptions({
  step,
  invalidField,
  onChange,
}: {
  step: DataRecipeStep
  invalidField?: keyof DataStepOptions
  onChange: (options: DataStepOptions) => void
}) {
  const { t } = useI18n()
  const id = useId()
  const fields = actionFields[step.operation] ?? []
  const options = step.options ?? {}
  const hasSearch = fields.some((field) => field.key === 'find')
  if (!fields.length && step.operation !== 'text-normalize') return null
  return (
    <fieldset
      className="data-step-options"
      aria-label={t('Action settings')}
      aria-invalid={!!invalidField}
      disabled={step.paused}
    >
      {fields.map((field) => (
        <label key={field.key} htmlFor={id + field.key}>
          <span>{t(field.label)}</span>
          <textarea
            id={id + field.key}
            rows={Math.min(3, (options[field.key] ?? '').split(/\r\n|\r|\n/).length)}
            spellCheck={false}
            maxLength={dataParameterLimit}
            value={
              options[field.key] ??
              (field.key === 'delimiter' ? dataStepDelimiter(step.operation) : '')
            }
            placeholder={field.placeholder ? t(field.placeholder) : undefined}
            aria-invalid={invalidField === field.key}
            onChange={(event) => onChange({ ...options, [field.key]: event.target.value })}
          />
        </label>
      ))}
      {hasSearch && (
        <label className="data-match-case">
          <input
            type="checkbox"
            checked={options.matchCase !== false}
            onChange={(event) => onChange({ ...options, matchCase: event.target.checked })}
          />
          {t('Match case')}
        </label>
      )}
      {step.operation === 'text-normalize' && (
        <label className="data-normalization">
          <span>{t('Unicode form')}</span>
          <PopoverPicker
            label={t('Unicode form')}
            value={options.normalization ?? 'NFC'}
            options={(['NFC', 'NFD', 'NFKC', 'NFKD'] as const).map((value) => ({
              value,
              label: value,
            }))}
            onChange={(normalization) => onChange({ ...options, normalization })}
          />
        </label>
      )}
    </fieldset>
  )
}

type RecipeStep = DataRecipeStep & { id: number }
type FileInput = { name: string; bytes: Uint8Array<ArrayBuffer>; text: string | null }

export function DataTools({ onConfigure }: { onConfigure: (id: string) => void }) {
  const { w, run, notify } = useApp()
  const { t } = useI18n()
  const settings = w!.plugins.dataTools
  const [steps, setSteps] = useState<RecipeStep[]>([
    { id: 0, operation: 'json-format', paused: false },
  ])
  const nextStep = useRef(1)
  const draggedStep = useRef<number | null>(null)
  const [dragging, setDragging] = useState<number | null>(null)
  const [drop, setDrop] = useState<{ id: number; after: boolean } | null>(null)
  const [input, setInput] = useState('')
  const [file, setFile] = useState<FileInput | null>(null)
  const [reading, setReading] = useState(false)
  const [fileError, setFileError] = useState('')
  const [output, setOutput] = useState('')
  const [error, setError] = useState<{
    message: string
    stepIndex?: number
    field?: keyof DataStepOptions
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const [completed, setCompleted] = useState(false)
  const [started, setStarted] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const addRef = useRef<HTMLDivElement>(null)
  const inputId = useId()
  const resultId = useId()
  const errorId = useId()
  const request = useRef(0)
  const fileRequest = useRef(0)
  const controller = useRef<AbortController | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const immediate = useRef(false)
  const invalidate = useCallback(() => {
    request.current++
    controller.current?.abort()
    if (timer.current) clearTimeout(timer.current)
    setOutput('')
    setError(null)
    setBusy(false)
    setCompleted(false)
  }, [])
  const transform = useCallback(async () => {
    if (reading) return
    if (timer.current) clearTimeout(timer.current)
    controller.current?.abort()
    const abort = new AbortController()
    controller.current = abort
    const id = ++request.current
    setBusy(true)
    setError(null)
    setOutput('')
    setCompleted(false)
    try {
      const result = await transformDataRecipe(steps, file?.bytes ?? input, settings, abort.signal)
      if (request.current === id) {
        setOutput(result)
        setCompleted(true)
      }
    } catch (error) {
      if (request.current === id && !abort.signal.aborted)
        setError({
          message: error instanceof Error ? error.message : 'Could not transform data.',
          stepIndex: error instanceof DataRecipeError ? error.stepIndex : undefined,
          field: error instanceof DataRecipeError ? error.field : undefined,
        })
    } finally {
      if (request.current === id) setBusy(false)
    }
  }, [steps, file, input, reading, settings.indent, settings.csvDelimiter])
  // Changes cancel the old run immediately; debounce typing before starting the next recipe.
  useEffect(() => {
    invalidate()
    if (started && !reading) {
      timer.current = setTimeout(() => void transform(), immediate.current ? 0 : 180)
      immediate.current = false
    }
    return () => {
      if (timer.current) clearTimeout(timer.current)
      request.current++
      controller.current?.abort()
    }
  }, [transform, started, invalidate, reading])
  useEffect(
    () => () => {
      fileRequest.current++
    },
    [],
  )

  function changeSteps(value: RecipeStep[]) {
    invalidate()
    setSteps(value)
    if (input || file) setStarted(true)
  }
  function moveStep(id: number, targetId: number, after: boolean) {
    if (id === targetId) return
    const source = steps.find((step) => step.id === id)
    if (!source || !steps.some((step) => step.id === targetId)) return
    const reordered = steps.filter((step) => step.id !== id)
    const index = reordered.findIndex((step) => step.id === targetId) + Number(after)
    reordered.splice(index, 0, source)
    if (reordered.some((step, i) => step.id !== steps[i].id)) changeSteps(reordered)
  }
  function showDrop(event: DragEvent<HTMLLIElement>, id: number) {
    if (
      draggedStep.current === null ||
      draggedStep.current === id ||
      !event.dataTransfer.types.includes('application/sheco-data-step')
    )
      return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    const bounds = event.currentTarget.getBoundingClientRect()
    setDrop({ id, after: event.clientX >= bounds.left + bounds.width / 2 })
  }
  function finishDrag() {
    draggedStep.current = null
    setDragging(null)
    setDrop(null)
  }
  function runRecipe() {
    if (started) void transform()
    else {
      immediate.current = true
      setStarted(true)
    }
  }
  function changeInput(value: string, auto = true) {
    fileRequest.current++
    invalidate()
    setReading(false)
    setFileError('')
    setFile(null)
    setInput(value)
    setStarted(auto)
  }
  async function readFile(selected: File) {
    const id = ++fileRequest.current
    invalidate()
    setFileError('')
    setReading(true)
    try {
      if (selected.size > dataTextLimit) throw new Error('Data is limited to 1 MB.')
      const bytes = new Uint8Array(await selected.arrayBuffer())
      let text: string | null = null
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
        if (text.includes('\0')) text = null
      } catch {
        /* Binary files remain usable by byte operations. */
      }
      if (fileRequest.current !== id) return
      setFile({ name: selected.name, bytes, text })
      setStarted(true)
    } catch (error) {
      if (fileRequest.current === id)
        setFileError(error instanceof Error ? error.message : 'Could not read the file.')
    } finally {
      if (fileRequest.current === id) setReading(false)
    }
  }
  const first = steps.find((step) => !step.paused)
  const placeholder = first ? operationHelp[first.operation].placeholder : 'Paste text or data…'
  const outputBytes = new TextEncoder().encode(output).length
  return (
    <section className="plugin-tool-page data-tools-page" aria-label={t('Data tools')}>
      <header className="plugin-tool-header">
        <h1>
          <Braces size={24} />
          {t('Data tools')}
        </h1>
        <button className="button" onClick={() => onConfigure(dataToolsSettingsTab)}>
          <Settings2 size={15} />
          {t('Configure')}
        </button>
      </header>
      <div className="data-workspace">
        <section className="data-recipe" aria-label={t('Recipe')}>
          <header className="data-recipe-heading">
            <h2>{t('Recipe')}</h2>
            <div className="data-recipe-actions">
              <div ref={addRef}>
                <DataActionPicker
                  disabled={steps.length >= dataRecipeLimit}
                  onChoose={(operation) =>
                    changeSteps([...steps, { id: nextStep.current++, operation, paused: false }])
                  }
                />
              </div>
              <button
                type="button"
                className="button primary data-run-recipe"
                disabled={reading}
                title="⌘ / Ctrl + Enter"
                onClick={runRecipe}
              >
                <Play size={14} />
                {t(busy ? 'Transforming…' : 'Run recipe')}
              </button>
            </div>
          </header>
          <ol className="data-recipe-steps">
            {steps.map((step, index) => {
              const showIndent = ['json-format', 'xml-format', 'csv-json', 'ndjson-json'].includes(
                step.operation,
              )
              const showDelimiter = ['csv-json', 'json-csv'].includes(step.operation)
              return (
                <li
                  key={step.id}
                  className={
                    'data-recipe-step' +
                    (step.paused ? ' paused' : '') +
                    (error?.stepIndex === index ? ' has-error' : '') +
                    (dragging === step.id ? ' dragging' : '') +
                    (drop?.id === step.id ? (drop.after ? ' drop-after' : ' drop-before') : '')
                  }
                  onDragEnterCapture={(event) => showDrop(event, step.id)}
                  onDragOverCapture={(event) => showDrop(event, step.id)}
                  onDragLeave={(event) => {
                    if (
                      event.relatedTarget instanceof Node &&
                      event.currentTarget.contains(event.relatedTarget)
                    )
                      return
                    const bounds = event.currentTarget.getBoundingClientRect()
                    if (
                      event.clientX >= bounds.left &&
                      event.clientX <= bounds.right &&
                      event.clientY >= bounds.top &&
                      event.clientY <= bounds.bottom
                    )
                      return
                    setDrop((current) => (current?.id === step.id ? null : current))
                  }}
                  onDropCapture={(event) => {
                    const id = draggedStep.current
                    if (
                      id === null ||
                      event.dataTransfer.getData('application/sheco-data-step') !== String(id)
                    )
                      return
                    event.preventDefault()
                    event.stopPropagation()
                    const bounds = event.currentTarget.getBoundingClientRect()
                    moveStep(id, step.id, event.clientX >= bounds.left + bounds.width / 2)
                    finishDrag()
                  }}
                >
                  <div className="data-recipe-step-heading">
                    <button
                      type="button"
                      className="data-step-drag-handle"
                      draggable
                      title={t('Drag to reorder')}
                      aria-label={t('Reorder action {number}', { number: index + 1 })}
                      aria-description={t('Drag to reorder, or use arrow keys.')}
                      onDragStart={(event) => {
                        draggedStep.current = step.id
                        event.dataTransfer.effectAllowed = 'move'
                        event.dataTransfer.setData('application/sheco-data-step', String(step.id))
                        const card = event.currentTarget.closest('li')!
                        const bounds = card.getBoundingClientRect()
                        event.dataTransfer.setDragImage(
                          card,
                          event.clientX - bounds.left,
                          event.clientY - bounds.top,
                        )
                        setDragging(step.id)
                      }}
                      onDragEnd={finishDrag}
                      onKeyDown={(event) => {
                        const target =
                          event.key === 'ArrowLeft' || event.key === 'ArrowUp'
                            ? index - 1
                            : event.key === 'ArrowRight' || event.key === 'ArrowDown'
                              ? index + 1
                              : event.key === 'Home'
                                ? 0
                                : event.key === 'End'
                                  ? steps.length - 1
                                  : -1
                        if (
                          ![
                            'ArrowLeft',
                            'ArrowRight',
                            'ArrowUp',
                            'ArrowDown',
                            'Home',
                            'End',
                          ].includes(event.key)
                        )
                          return
                        event.preventDefault()
                        if (target >= 0 && target < steps.length)
                          moveStep(step.id, steps[target].id, target > index)
                      }}
                    >
                      <GripVertical size={14} />
                    </button>
                    <span className="data-step-number">{index + 1}</span>
                    <DataActionPicker
                      operation={step.operation}
                      onChoose={(operation) =>
                        changeSteps(
                          steps.map((item) =>
                            item.id === step.id ? { ...item, operation, options: undefined } : item,
                          ),
                        )
                      }
                    />
                  </div>
                  <DataActionOptions
                    step={step}
                    invalidField={error?.stepIndex === index ? error.field : undefined}
                    onChange={(options) =>
                      changeSteps(
                        steps.map((item) => (item.id === step.id ? { ...item, options } : item)),
                      )
                    }
                  />
                  <div className="data-recipe-step-footer">
                    <div className="data-operation-defaults">
                      {step.paused ? (
                        <span>{t('Paused')}</span>
                      ) : (
                        <>
                          {showIndent && (
                            <span>
                              {t('Indentation')}:{' '}
                              {t(settings.indent === 4 ? '4 spaces' : '2 spaces')}
                            </span>
                          )}
                          {showDelimiter && (
                            <span>
                              {t('CSV delimiter')}:{' '}
                              {t(
                                settings.csvDelimiter === ';'
                                  ? 'Semicolon'
                                  : settings.csvDelimiter === '\t'
                                    ? 'Tab'
                                    : 'Comma',
                              )}
                            </span>
                          )}
                        </>
                      )}
                    </div>
                    <div className="data-step-controls">
                      <IconButton
                        title={step.paused ? 'Resume action' : 'Pause action'}
                        aria-pressed={step.paused}
                        onClick={() =>
                          changeSteps(
                            steps.map((item) =>
                              item.id === step.id ? { ...item, paused: !item.paused } : item,
                            ),
                          )
                        }
                      >
                        {step.paused ? <Play size={13} /> : <Pause size={13} />}
                      </IconButton>
                      <IconButton
                        title="Remove action"
                        onClick={() => {
                          finishDrag()
                          changeSteps(steps.filter((item) => item.id !== step.id))
                          addRef.current?.querySelector('button')?.focus()
                        }}
                      >
                        <Trash2 size={13} />
                      </IconButton>
                    </div>
                  </div>
                </li>
              )
            })}
          </ol>
          {(error || fileError) && (
            <p id={errorId} className="error-message" role="alert">
              {!fileError && error?.stepIndex !== undefined && (
                <strong>{t('Step {number}', { number: error.stepIndex + 1 })}: </strong>
              )}
              {t(fileError || error!.message)}
            </p>
          )}
        </section>
        <div className="data-editors">
          <div className="data-panel data-input-panel">
            <header className="data-panel-heading">
              <label htmlFor={inputId}>{t('Input')}</label>
              <div className="data-panel-actions">
                <button
                  type="button"
                  className="data-text-button"
                  onClick={() => fileRef.current?.click()}
                >
                  <Upload size={14} />
                  {t('File')}
                </button>
                <IconButton
                  title="Clear"
                  disabled={
                    !input && !file && !completed && !error && !fileError && !busy && !reading
                  }
                  onClick={() => {
                    changeInput('', false)
                    inputRef.current?.focus()
                  }}
                >
                  <Trash2 size={14} />
                </IconButton>
              </div>
              <input
                ref={fileRef}
                type="file"
                hidden
                aria-label={t('Choose input file')}
                onChange={(event) => {
                  const selected = event.target.files?.[0]
                  event.target.value = ''
                  if (selected) void readFile(selected)
                }}
              />
            </header>
            {file && (
              <div className="data-file-input">
                <FileText size={15} />
                <span title={file.name}>{file.name}</span>
                <small>
                  {file.bytes.byteLength.toLocaleString()} {t('bytes')}
                </small>
                <IconButton
                  title="Remove file"
                  onClick={() => {
                    changeInput(input)
                    inputRef.current?.focus()
                  }}
                >
                  <X size={13} />
                </IconButton>
              </div>
            )}
            <textarea
              id={inputId}
              ref={inputRef}
              spellCheck={false}
              value={file ? (file.text ?? '') : input}
              readOnly={!!file}
              maxLength={dataTextLimit}
              aria-invalid={!!error && error.stepIndex === 0 && !error.field}
              aria-describedby={error || fileError ? errorId : undefined}
              aria-keyshortcuts="Control+Enter Meta+Enter"
              onChange={(event) => changeInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault()
                  if (!reading) runRecipe()
                }
              }}
              placeholder={t(file && file.text === null ? 'Binary file' : placeholder)}
            />
            <footer className="data-panel-footer">
              <span className="data-limit">{t(reading ? 'Reading file…' : 'Up to 1 MiB')}</span>
              {file && (
                <span className="data-limit">
                  {t(file.text === null ? 'Binary file' : 'UTF-8 text')}
                </span>
              )}
            </footer>
          </div>
          <div className="data-panel data-result-panel">
            <header className="data-panel-heading">
              <label htmlFor={resultId}>{t('Result')}</label>
              <div className="data-panel-actions">
                <IconButton
                  title="Use result as input"
                  disabled={!completed || busy || reading}
                  onClick={() => {
                    changeInput(output, false)
                    inputRef.current?.focus()
                  }}
                >
                  <ArrowDownToLine size={14} />
                </IconButton>
                <IconButton
                  title="Copy result"
                  disabled={!completed || busy || reading}
                  onClick={() =>
                    run(async () => {
                      await window.sheco.copyText(output)
                      notify(t('Result copied.'))
                    })
                  }
                >
                  <Copy size={14} />
                </IconButton>
              </div>
            </header>
            <textarea
              id={resultId}
              spellCheck={false}
              readOnly
              value={output}
              aria-busy={busy}
              placeholder={t(completed ? 'The result is empty.' : 'Your result will appear here…')}
            />
            <footer className="data-panel-footer">
              <span className="data-result-status" role="status">
                {completed && (
                  <>
                    <Check size={13} />
                    {t('Done')}
                  </>
                )}
              </span>
              {completed && (
                <span className="data-limit">
                  {outputBytes.toLocaleString()} {t('bytes')}
                </span>
              )}
            </footer>
          </div>
        </div>
      </div>
    </section>
  )
}
export function DataToolsSettings() {
  const { w, update } = useApp()
  const { t } = useI18n()
  const settings = w!.plugins.dataTools
  return (
    <section className="plugin-settings-page" aria-label={t('Data tools settings')}>
      <h1>{t('Data tools settings')}</h1>
      <div className="plugin-card">
        <PluginSettingsHeader
          icon={Braces}
          title={t('Data tools')}
          description={t('These defaults apply to JSON, XML and CSV operations.')}
        />
        <div className="setting-row">
          <strong>{t('Indentation')}</strong>
          <PopoverPicker
            label={t('Indentation')}
            value={String(settings.indent)}
            options={[
              { value: '2', label: t('2 spaces') },
              { value: '4', label: t('4 spaces') },
            ]}
            onChange={(value) =>
              update((w) => ({
                ...w,
                plugins: {
                  ...w.plugins,
                  dataTools: { ...w.plugins.dataTools, indent: value === '4' ? 4 : 2 },
                },
              }))
            }
          />
        </div>
        <div className="setting-row">
          <strong>{t('CSV delimiter')}</strong>
          <PopoverPicker
            label={t('CSV delimiter')}
            value={settings.csvDelimiter}
            options={[
              { value: ',', label: t('Comma') },
              { value: ';', label: t('Semicolon') },
              { value: '\t', label: t('Tab') },
            ]}
            onChange={(value) =>
              update((w) => ({
                ...w,
                plugins: {
                  ...w.plugins,
                  dataTools: { ...w.plugins.dataTools, csvDelimiter: value as ',' | ';' | '\t' },
                },
              }))
            }
          />
        </div>
      </div>
    </section>
  )
}
