import { describe, expect, it } from 'vitest'

import { drawingTextLayout, drawingTextWidthUnits, type DrawingElement } from './drawing'
import { squareResizeGeometry } from '../composables/useDrawingCanvas'

const square: DrawingElement = {
  id: 1,
  kind: 'square',
  x: 980,
  y: 80,
  width: 140,
  height: 140,
  strokeWidth: 2,
  dashed: false,
  text: '文本',
}

describe('drawing geometry and labels', () => {
  // A square resize must remain equal-sided and inside the fixed SVG coordinate space.
  it('bounds square resize geometry at every canvas edge', () => {
    const resized = squareResizeGeometry(square, { x: 0, y: 0 }, 'top-left', 760)

    expect(resized.width).toBe(resized.height)
    expect(resized.x).toBeGreaterThanOrEqual(0)
    expect(resized.y).toBeGreaterThanOrEqual(0)
    expect(resized.x + resized.width).toBeLessThanOrEqual(1200)
    expect(resized.y + resized.height).toBeLessThanOrEqual(760)
  })

  // Long labels should be bounded to a few readable lines and expose truncation explicitly.
  it('wraps and truncates long shape labels within the shape width', () => {
    const layout = drawingTextLayout({ ...square, text: '这是一个很长的流程节点标题，用于验证文本边界' })

    expect(layout.lines.length).toBeLessThanOrEqual(3)
    expect(layout.lines.at(-1)).toMatch(/…$/)
    expect(layout.lines.every((line) => drawingTextWidthUnits(line) <= layout.maxWidth / 20 + 0.01)).toBe(true)
  })

  // Lines use a smaller two-line label area so their text does not cover the stroke indefinitely.
  it('limits line labels to two lines', () => {
    const layout = drawingTextLayout({
      ...square,
      kind: 'line',
      width: 180,
      height: 0,
      text: 'a very long line label that must stay bounded',
    })

    expect(layout.lines.length).toBeLessThanOrEqual(2)
    expect(layout.lines.at(-1)).toMatch(/…$/)
  })

  // A top-edge line needs its label below the stroke because no visible space exists above it.
  it('places a top-edge line label below the stroke', () => {
    const layout = drawingTextLayout({
      ...square,
      kind: 'line',
      x: 300,
      y: 0,
      width: 180,
      height: 0,
      text: '顶部线条',
    }, 1200, 760)

    expect(layout.y).toBeGreaterThan(0)
    expect(layout.y - 20).toBeGreaterThanOrEqual(0)
  })

  // A left-edge line shifts its centered label right until the entire text box is visible.
  it('keeps a left-edge line label inside the canvas', () => {
    const layout = drawingTextLayout({
      ...square,
      kind: 'line',
      x: 0,
      y: 300,
      width: 20,
      height: 0,
      text: '左侧',
    }, 1200, 760)

    expect(layout.x - layout.maxWidth / 2).toBeGreaterThanOrEqual(0)
  })

  // A right-edge line shifts its centered label left until the entire text box is visible.
  it('keeps a right-edge line label inside the canvas', () => {
    const layout = drawingTextLayout({
      ...square,
      kind: 'line',
      x: 1180,
      y: 300,
      width: 20,
      height: 0,
      text: '右侧',
    }, 1200, 760)

    expect(layout.x + layout.maxWidth / 2).toBeLessThanOrEqual(1200)
  })
})
