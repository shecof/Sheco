export type CropRect = { x: number; y: number; width: number; height: number }
export type CropCorner = 'nw' | 'ne' | 'sw' | 'se'
export const fullCrop: CropRect = { x: 0, y: 0, width: 1, height: 1 }
export const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value))

// Fractions refer to the untouched original, so repeated crops never compound rounding.
export function readCrop(value: unknown): CropRect {
  if (!value || typeof value !== 'object') return { ...fullCrop }
  const c = value as CropRect
  if (![c.x, c.y, c.width, c.height].every(Number.isFinite) || c.width <= 0 || c.height <= 0)
    return { ...fullCrop }
  const width = clamp(c.width, 0.001, 1),
    height = clamp(c.height, 0.001, 1)
  return { x: clamp(c.x, 0, 1 - width), y: clamp(c.y, 0, 1 - height), width, height }
}
export function moveCrop(c: CropRect, dx: number, dy: number): CropRect {
  return { ...c, x: clamp(c.x + dx, 0, 1 - c.width), y: clamp(c.y + dy, 0, 1 - c.height) }
}
export function cropAtRatio(
  c: CropRect,
  ratio: number,
  imageWidth: number,
  imageHeight: number,
): CropRect {
  const unitRatio = (ratio * imageHeight) / imageWidth
  const width = Math.min(1, unitRatio),
    height = width / unitRatio
  return {
    x: clamp(c.x + c.width / 2 - width / 2, 0, 1 - width),
    y: clamp(c.y + c.height / 2 - height / 2, 0, 1 - height),
    width,
    height,
  }
}
export function resizeCrop(
  c: CropRect,
  corner: CropCorner,
  dx: number,
  dy: number,
  unitRatio: number | null = null,
): CropRect {
  const east = corner.endsWith('e'),
    south = corner.startsWith('s')
  const ax = east ? c.x : c.x + c.width,
    ay = south ? c.y : c.y + c.height
  const maxWidth = east ? 1 - ax : ax,
    maxHeight = south ? 1 - ay : ay
  let width = clamp(c.width + dx * (east ? 1 : -1), Math.min(0.02, maxWidth), maxWidth)
  let height = clamp(c.height + dy * (south ? 1 : -1), Math.min(0.02, maxHeight), maxHeight)
  if (unitRatio && Number.isFinite(unitRatio) && unitRatio > 0) {
    if (Math.abs(dx) >= Math.abs(dy) * unitRatio) height = width / unitRatio
    else width = height * unitRatio
    const scale = Math.min(1, maxWidth / width, maxHeight / height)
    width *= scale
    height *= scale
  }
  return { x: east ? ax : ax - width, y: south ? ay : ay - height, width, height }
}
export function cropPixels(c: CropRect, width: number, height: number) {
  const crop = readCrop(c)
  const x = clamp(Math.round(crop.x * width), 0, width - 1)
  const y = clamp(Math.round(crop.y * height), 0, height - 1)
  const right = clamp(Math.round((crop.x + crop.width) * width), x + 1, width)
  const bottom = clamp(Math.round((crop.y + crop.height) * height), y + 1, height)
  return { x, y, width: right - x, height: bottom - y }
}
export function imageWidth(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? clamp(value, 1, 10000)
    : null
}
