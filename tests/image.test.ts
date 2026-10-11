import { describe, expect, it } from 'vitest'
import {
  cropAtRatio,
  cropPixels,
  fullCrop,
  moveCrop,
  readCrop,
  resizeCrop,
} from '../src/shared/image'

describe('image crop geometry', () => {
  it('recovers invalid persisted crops and keeps fractional coordinates inside the original', () => {
    expect(readCrop({ x: NaN, y: 0, width: 1, height: 1 })).toEqual(fullCrop)
    expect(readCrop({ x: 0, y: 0, width: -1, height: 1 })).toEqual(fullCrop)
    expect(readCrop({ x: 0.8, y: -1, width: 0.5, height: 3 })).toEqual({
      x: 0.5,
      y: 0,
      width: 0.5,
      height: 1,
    })
  })
  it('moves a crop to the edge without changing its dimensions', () => {
    expect(moveCrop({ x: 0.2, y: 0.3, width: 0.4, height: 0.3 }, 4, -5)).toEqual({
      x: 0.6,
      y: 0,
      width: 0.4,
      height: 0.3,
    })
  })
  it('uses the original pixel ratio for a square crop on a wide image', () => {
    const c = cropAtRatio(fullCrop, 1, 1200, 600)
    expect(c).toEqual({ x: 0.25, y: 0, width: 0.5, height: 1 })
    expect(cropPixels(c, 1200, 600)).toEqual({ x: 300, y: 0, width: 600, height: 600 })
  })
  it('holds the opposite corner and constrains all four resize directions', () => {
    const c = { x: 0.2, y: 0.2, width: 0.6, height: 0.6 }
    for (const corner of ['nw', 'ne', 'sw', 'se'] as const) {
      const r = resizeCrop(c, corner, 5, -5)
      expect(r.x).toBeGreaterThanOrEqual(0)
      expect(r.y).toBeGreaterThanOrEqual(0)
      expect(r.width).toBeGreaterThan(0)
      expect(r.height).toBeGreaterThan(0)
      expect(r.x + r.width).toBeLessThanOrEqual(1)
      expect(r.y + r.height).toBeLessThanOrEqual(1)
      expect(corner.endsWith('e') ? r.x : r.x + r.width).toBeCloseTo(
        corner.endsWith('e') ? c.x : c.x + c.width,
      )
      expect(corner.startsWith('s') ? r.y : r.y + r.height).toBeCloseTo(
        corner.startsWith('s') ? c.y : c.y + c.height,
      )
    }
  })
  it('preserves locked proportions even when the pointer moves outside the image', () => {
    const c = { x: 0.3, y: 0.2, width: 0.4, height: 0.6 }
    for (const corner of ['nw', 'ne', 'sw', 'se'] as const) {
      const r = resizeCrop(c, corner, 9, 3, 2 / 3)
      expect(r.width / r.height).toBeCloseTo(2 / 3)
      expect(r.x + r.width).toBeLessThanOrEqual(1)
      expect(r.y + r.height).toBeLessThanOrEqual(1)
    }
  })
  it('never samples outside a one-pixel image or an original edge', () => {
    expect(cropPixels(fullCrop, 1, 1)).toEqual({ x: 0, y: 0, width: 1, height: 1 })
    expect(cropPixels({ x: 0.99, y: 0.99, width: 0.01, height: 0.01 }, 101, 99)).toEqual({
      x: 100,
      y: 98,
      width: 1,
      height: 1,
    })
  })
})
