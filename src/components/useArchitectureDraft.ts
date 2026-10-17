import { prepareArchitectureChange } from '../shared/architecturePlacement'
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import { useI18n } from '../i18n'
import { architectureProjectSchema, type ArchitectureProject } from '../shared/projectArchitecture'

export type ArchitectureSave = (
  baseline: ArchitectureProject,
  next: ArchitectureProject,
  historyKey?: string,
) => string | null
export type ArchitectureFlush = MutableRefObject<(() => boolean) | null>

// Keep invalid/stale drafts in the property panel. Valid edits use the existing save
// queue immediately, and navigation flushes synchronously before changing selection.
export function useArchitectureDraft<T>(
  project: ArchitectureProject,
  initial: T,
  build: (project: ArchitectureProject, draft: T) => ArchitectureProject,
  onSave: ArchitectureSave,
  register: ArchitectureFlush,
  invalidMessage: string,
) {
  const { t } = useI18n()
  const [draft, updateDraft] = useState(initial)
  const typing = useRef<{ element: Element | null; time: number; key: string }>({
    element: null,
    time: 0,
    key: '',
  })
  const historyKey = useRef<string | undefined>(undefined)
  const setDraft = (value: T) => {
    const element = document.activeElement
    const text =
      element instanceof HTMLTextAreaElement ||
      (element instanceof HTMLInputElement && !['checkbox', 'radio'].includes(element.type))
    const now = performance.now()
    if (!text) historyKey.current = undefined
    else {
      if (typing.current.element !== element || now - typing.current.time > 1200)
        typing.current = { element, time: now, key: crypto.randomUUID() }
      typing.current.time = now
      historyKey.current = typing.current.key
    }
    updateDraft(value)
  }
  useEffect(() => {
    const boundary = () => {
      typing.current.element = null
    }
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Enter') boundary()
    }
    document.addEventListener('focusout', boundary)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('focusout', boundary)
      document.removeEventListener('keydown', key)
    }
  }, [])
  const [error, setError] = useState('')
  const baseline = useRef(project)
  const saved = useRef(JSON.stringify(initial))
  const current = useRef({ draft, build, onSave })
  current.current = { draft, build, onSave }
  const flush = useCallback(() => {
    const { draft, build, onSave } = current.current
    const fingerprint = JSON.stringify(draft)
    if (fingerprint === saved.current) {
      setError('')
      return true
    }
    const parsed = architectureProjectSchema.safeParse(
      prepareArchitectureChange(baseline.current, build(baseline.current, draft)),
    )
    if (!parsed.success) {
      setError(t(invalidMessage))
      return false
    }
    const error = onSave(baseline.current, parsed.data, historyKey.current)
    if (error) {
      setError(error)
      return false
    }
    baseline.current = parsed.data
    saved.current = fingerprint
    setError('')
    return true
  }, [t, invalidMessage])
  register.current = flush
  const renderedBaseline = baseline.current
  useEffect(() => {
    flush()
  }, [draft])
  useEffect(() => {
    // A local flush earlier in this commit has already advanced the baseline. These
    // props precede that save; wait for its renderer update instead of rolling it back.
    if (baseline.current !== renderedBaseline) return
    if (
      JSON.stringify(project) === JSON.stringify(baseline.current) ||
      JSON.stringify(current.current.draft) !== saved.current
    )
      return
    baseline.current = project
    saved.current = JSON.stringify(initial)
    updateDraft(initial)
  }, [project])
  useEffect(
    () => () => {
      if (register.current === flush) register.current = null
    },
    [register, flush],
  )
  const reset = () => {
    baseline.current = project
    saved.current = JSON.stringify(initial)
    updateDraft(initial)
    setError('')
  }
  return { draft, setDraft, error, flush, reset }
}
