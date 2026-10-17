import { useEffect, useState } from 'react'
import { ArrowUpRight, WrapText } from 'lucide-react'
import { useI18n } from '../i18n'
import { useApp } from '../state'
import { attachmentPreviewKind } from '../shared/filePreview'
import type { Attachment } from '../shared/model'
import type { PdfPreviewSession } from '../shared/pdfPreview'
import { PdfPreview } from './PdfPreview'

export function FilePreview({
  attachment,
  session,
  onSession,
}: {
  attachment: Attachment
  session?: PdfPreviewSession
  onSession: (session: PdfPreviewSession) => void
}) {
  const { t } = useI18n(),
    { w, run } = useApp()
  const kind = attachmentPreviewKind(attachment),
    workspaceId = w!.id
  const [text, setText] = useState<string | null>(null),
    [error, setError] = useState(false),
    [wrap, setWrap] = useState(true)
  useEffect(() => {
    if (kind !== 'text') return
    let alive = true
    void window.sheco
      .readPreviewText({ workspaceId, attachmentId: attachment.id })
      .then((value) => {
        if (alive) setText(value)
      })
      .catch(() => {
        if (alive) setError(true)
      })
    return () => {
      alive = false
    }
  }, [workspaceId, attachment.id, kind])
  if (kind === 'pdf')
    return <PdfPreview attachment={attachment} session={session} onSession={onSession} />
  return (
    <section className="file-preview" aria-label={t('File preview')}>
      <div className="file-preview-toolbar">
        <strong title={attachment.name}>{attachment.name}</strong>
        {kind === 'text' && (
          <button className="button" aria-pressed={wrap} onClick={() => setWrap(!wrap)}>
            <WrapText size={15} />
            {t('Wrap lines')}
          </button>
        )}
        <button
          className="button preview-external"
          aria-label={t('Open externally')}
          title={t('Open externally')}
          onClick={() => run(() => window.sheco.openAttachment(attachment.id))}
        >
          <ArrowUpRight size={15} />
          {t('Open')}
        </button>
      </div>
      <div className="file-preview-stage">
        {kind === 'text' && text === null && !error && <p role="status">{t('Loading…')}</p>}
        {error && (
          <p role="alert">{t('Could not preview this file. Open it in an external app.')}</p>
        )}
        {kind === 'text' && text !== null && (
          <pre className={'file-preview-text' + (wrap ? ' wrap' : '')}>{text}</pre>
        )}
        {kind === 'video' && (
          <video
            src={`sheco-asset://${workspaceId}/${attachment.file}`}
            controls
            preload="metadata"
            onError={() => setError(true)}
          />
        )}
      </div>
    </section>
  )
}
