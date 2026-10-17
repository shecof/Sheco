export type PdfFit = 'height' | 'width' | 'custom'
export interface PdfPreviewSession {
  page: number
  fit: PdfFit
  scale: number
  sidebar: boolean
  navigation: 'pages' | 'outline'
}
export const clampPdfScale = (value: number) =>
  Math.min(5, Math.max(0.1, Number.isFinite(value) ? value : 1))
export function fitPdfScale(
  fit: PdfFit,
  area: { width: number; height: number },
  sheet: { width: number; height: number },
  custom: number,
) {
  return fit === 'height'
    ? Math.max(0.01, Math.min(area.height / sheet.height, area.width / sheet.width))
    : fit === 'width'
      ? Math.max(0.01, area.width / sheet.width)
      : clampPdfScale(custom)
}
export function pdfWheelScale(scale: number, delta: number, mode: number) {
  const pixels = delta * (mode === 1 ? 16 : mode === 2 ? 400 : 1)
  return clampPdfScale(scale * Math.exp(-Math.max(-100, Math.min(100, pixels)) * 0.01))
}

export interface PdfEdgeGesture {
  time: number
  started: number
  direction: number
  distance: number
  fast: boolean
  turned: boolean
  arrived: boolean
}
export const pdfWheelGestureGap = 220

// Keep a reading pause at an edge, but carry the distance of a strong flick across pages.
export function pdfEdgeWheel(
  previous: PdfEdgeGesture | null,
  delta: number,
  time: number,
  pageHeight: number,
  arrivedAtEdge = false,
): { gesture: PdfEdgeGesture; pages: number } {
  const direction = Math.sign(delta),
    distance = Math.abs(delta)
  const gesture: PdfEdgeGesture =
    previous &&
    !arrivedAtEdge &&
    previous.direction === direction &&
    (time - previous.time <= pdfWheelGestureGap ||
      (!previous.arrived && !previous.fast && !previous.turned && time - previous.time <= 1000))
      ? { ...previous, time }
      : {
          time,
          started: time,
          direction,
          distance: 0,
          fast: false,
          turned: false,
          arrived: arrivedAtEdge,
        }
  // Reading a zoomed page and turning it are separate gestures. Discard arrival overshoot/momentum.
  if (gesture.arrived) return { gesture, pages: 0 }
  if (gesture.turned && !gesture.fast) return { gesture, pages: 0 }
  gesture.distance += distance
  if (
    !gesture.fast &&
    (distance >= 100 || (time - gesture.started <= 160 && gesture.distance >= 120))
  )
    gesture.fast = true
  if (gesture.fast) {
    let pages = 0
    if (!gesture.turned) {
      pages++
      gesture.turned = true
      gesture.distance = Math.max(0, gesture.distance - 100)
    }
    const travel = Math.max(360, pageHeight * 0.75)
    const extra = Math.floor(gesture.distance / travel)
    gesture.distance -= extra * travel
    return { gesture, pages: direction * (pages + extra) }
  }
  if (time - gesture.started >= 280 && gesture.distance >= 96) {
    gesture.turned = true
    return { gesture, pages: direction }
  }
  return { gesture, pages: 0 }
}
