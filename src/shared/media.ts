import type { Attachment, DocNode } from './model'

export const attachmentViews = ['card', 'compact', 'tile', 'link'] as const

export const isImageAttachment = (file: Attachment) =>
  /^image\/(png|jpeg|gif|webp|avif)$/.test(file.mime)
export function mediaBlocks(
  items: Attachment[],
  workspaceId: string,
  mode: 'separate' | 'slider' | 'attachments',
): DocNode[] {
  const image = (a: Attachment): DocNode => ({
    type: 'image',
    attrs: { src: `sheco-asset://${workspaceId}/${a.file}`, alt: a.name },
  })
  if (mode === 'attachments') return items.map((a) => ({ type: 'attachment', attrs: { ...a } }))
  // Place a slider at the first image's position while preserving the order of other files.
  const images = items.filter(isImageAttachment)
  let addedSlider = false
  return items.flatMap((a) => {
    if (!isImageAttachment(a)) return [{ type: 'attachment', attrs: { ...a } }]
    if (mode !== 'slider' || images.length < 2) return [image(a)]
    if (addedSlider) return []
    addedSlider = true
    return [{ type: 'imageGallery', attrs: { images: images.map((a) => image(a).attrs) } }]
  })
}
