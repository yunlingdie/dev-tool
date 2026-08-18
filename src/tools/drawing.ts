export const DRAWING_TOOL_MIME = 'application/x-dev-tool-drawing-tool'

export const DRAWING_TOOL_IDS = [
  'square',
  'rectangle',
  'polygon',
  'line',
  'dashed-line',
  'thick-line',
  'thick-dashed-line',
] as const

export type DrawingToolId = typeof DRAWING_TOOL_IDS[number]

/** Checks untrusted drag data before it is used to create a canvas element. */
export function isDrawingToolId(value: string): value is DrawingToolId {
  return (DRAWING_TOOL_IDS as readonly string[]).includes(value)
}

export type DrawingElementKind = 'square' | 'rectangle' | 'polygon' | 'line'

export interface DrawingElement {
  id: number
  kind: DrawingElementKind
  x: number
  y: number
  width: number
  height: number
  strokeWidth: number
  dashed: boolean
  text: string
}

export interface DrawingTextLayout {
  x: number
  y: number
  lineHeight: number
  maxWidth: number
  lines: string[]
}

const DRAWING_TEXT_FONT_SIZE = 20
const DRAWING_TEXT_LINE_HEIGHT = 24
const DRAWING_TEXT_LINE_GAP = 14
const DEFAULT_DRAWING_CANVAS_WIDTH = 1200

/** Estimates one character's width relative to the drawing label font size. */
function characterWidthUnits(character: string): number {
  // Spaces need less width and should not force premature wrapping.
  if (character === ' ') {
    return 0.35
  }

  // A full font-size unit safely covers wide Latin, CJK, symbol, and emoji glyphs.
  return 1
}

/** Estimates the rendered width of a drawing label in font-size units. */
export function drawingTextWidthUnits(value: string): number {
  return Array.from(value).reduce((width, character) => width + characterWidthUnits(character), 0)
}

/** Wraps a label into a bounded number of lines and marks hidden text with an ellipsis. */
function wrapDrawingText(value: string, maxWidth: number, maxLines: number): string[] {
  const maxUnits = Math.max(1, maxWidth / DRAWING_TEXT_FONT_SIZE)
  const wrappedLines: string[] = []
  let currentLine = ''
  let currentUnits = 0

  for (const character of Array.from(value)) {
    const characterUnits = characterWidthUnits(character)

    // A full line is committed before the next character exceeds its visible width.
    if (currentLine && currentUnits + characterUnits > maxUnits) {
      wrappedLines.push(currentLine.trimEnd())
      currentLine = ''
      currentUnits = 0
    }

    // Leading spaces on a wrapped line do not contribute useful visible content.
    if (!currentLine && character === ' ') {
      continue
    }

    currentLine += character
    currentUnits += characterUnits
  }

  // The final partial line, or an empty source label, still needs one renderable line.
  if (currentLine || wrappedLines.length === 0) {
    wrappedLines.push(currentLine)
  }

  // Labels that already fit retain every character without an ellipsis.
  if (wrappedLines.length <= maxLines) {
    return wrappedLines
  }

  const visibleLines = wrappedLines.slice(0, maxLines)
  let finalLine = visibleLines[maxLines - 1]

  // Characters are removed until the ellipsis itself also fits the available width.
  while (finalLine && drawingTextWidthUnits(`${finalLine}…`) > maxUnits) {
    finalLine = Array.from(finalLine).slice(0, -1).join('')
  }

  visibleLines[maxLines - 1] = `${finalLine.trimEnd()}…`
  return visibleLines
}

/** Produces the bounded multi-line label layout shared by the canvas and SVG export. */
export function drawingTextLayout(
  element: DrawingElement,
  canvasWidth = DEFAULT_DRAWING_CANVAS_WIDTH,
  canvasHeight = Number.POSITIVE_INFINITY,
): DrawingTextLayout {
  // Line labels use a compact box above their midpoint so they do not cover the stroke.
  if (element.kind === 'line') {
    const maxWidth = Math.min(canvasWidth, 200, Math.max(80, Math.hypot(element.width, element.height) * 0.75))
    const lines = wrapDrawingText(element.text, maxWidth, 2)
    const midpointX = element.x + element.width / 2
    const midpointY = element.y + element.height / 2
    const halfTextWidth = maxWidth / 2
    const x = Math.min(canvasWidth - halfTextWidth, Math.max(halfTextWidth, midpointX))
    const aboveY = midpointY - DRAWING_TEXT_LINE_GAP - (lines.length - 1) * DRAWING_TEXT_LINE_HEIGHT
    let y = aboveY

    // A label without enough room above the line is placed below it to remain visible.
    if (aboveY - DRAWING_TEXT_FONT_SIZE < 0) {
      y = midpointY + DRAWING_TEXT_LINE_GAP + DRAWING_TEXT_FONT_SIZE
    }

    const maximumFirstBaseline = canvasHeight - (lines.length - 1) * DRAWING_TEXT_LINE_HEIGHT
    y = Math.min(maximumFirstBaseline, Math.max(DRAWING_TEXT_FONT_SIZE, y))

    return {
      x,
      y,
      lineHeight: DRAWING_TEXT_LINE_HEIGHT,
      maxWidth,
      lines,
    }
  }

  const maxWidth = Math.max(24, element.width - 24)
  const availableLines = Math.floor((element.height - 20) / DRAWING_TEXT_LINE_HEIGHT)
  const maxLines = Math.max(1, Math.min(3, availableLines))
  const lines = wrapDrawingText(element.text, maxWidth, maxLines)
  return {
    x: element.x + element.width / 2,
    y: element.y + element.height / 2 + 7 - (lines.length - 1) * DRAWING_TEXT_LINE_HEIGHT / 2,
    lineHeight: DRAWING_TEXT_LINE_HEIGHT,
    maxWidth,
    lines,
  }
}
