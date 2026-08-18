import { nextTick, onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

import {
  DRAWING_TOOL_MIME,
  drawingTextLayout as calculateDrawingTextLayout,
  isDrawingToolId,
  type DrawingElement,
  type DrawingToolId,
} from '../tools/drawing'

export const CANVAS_WIDTH = 1200
const DEFAULT_CANVAS_HEIGHT = 760
const MIN_DRAWN_LINE_SIZE = 8
const MIN_SHAPE_SIZE = 48
const DEFAULT_SHAPE_SIZES: Record<'square' | 'rectangle' | 'polygon', { width: number, height: number }> = {
  square: { width: 140, height: 140 },
  rectangle: { width: 190, height: 120 },
  polygon: { width: 180, height: 120 },
}
const DEFAULT_LINE_WIDTH = 180

export const connectorSides = ['top', 'right', 'bottom', 'left'] as const
export type ConnectorSide = typeof connectorSides[number]
export const shapeResizeHandles = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const
export type ShapeResizeHandle = typeof shapeResizeHandles[number]
export type ResizeHandle = ShapeResizeHandle | 'start' | 'end'

interface DrawingCanvasOptions {
  active: Readonly<Ref<boolean>>
  textDefault: Readonly<Ref<string>>
}

interface DrawingInteraction {
  mode: 'draw' | 'move' | 'resize'
  pointerId: number
  startX: number
  startY: number
  originalElements?: DrawingElement[]
  elementId?: number
  resizeHandle?: ResizeHandle
}

interface CanvasPoint {
  x: number
  y: number
}

/** Calculates an equal-sided resize that keeps every square edge inside the canvas. */
export function squareResizeGeometry(
  source: DrawingElement,
  point: CanvasPoint,
  handle: ShapeResizeHandle,
  canvasHeight: number,
): Pick<DrawingElement, 'x' | 'y' | 'width' | 'height'> {
  let anchorX = source.x
  let anchorY = source.y
  let horizontalDirection = 1
  let verticalDirection = 1

  // Left handles anchor resizing on the original right edge.
  if (handle === 'top-left' || handle === 'bottom-left') {
    anchorX = source.x + source.width
    horizontalDirection = -1
  }

  // Top handles anchor resizing on the original bottom edge.
  if (handle === 'top-left' || handle === 'top-right') {
    anchorY = source.y + source.height
    verticalDirection = -1
  }

  let maximumHorizontalSize = CANVAS_WIDTH - anchorX
  let maximumVerticalSize = canvasHeight - anchorY

  // A leftward resize cannot extend farther than the left canvas edge.
  if (horizontalDirection < 0) {
    maximumHorizontalSize = anchorX
  }

  // An upward resize cannot extend farther than the top canvas edge.
  if (verticalDirection < 0) {
    maximumVerticalSize = anchorY
  }

  const horizontalDistance = Math.max(0, (point.x - anchorX) * horizontalDirection)
  const verticalDistance = Math.max(0, (point.y - anchorY) * verticalDirection)
  const requestedSize = Math.max(MIN_SHAPE_SIZE, Math.max(horizontalDistance, verticalDistance))
  const maximumSize = Math.max(1, Math.min(maximumHorizontalSize, maximumVerticalSize))
  const minimumSize = Math.min(MIN_SHAPE_SIZE, maximumSize)
  const size = Math.max(minimumSize, Math.min(maximumSize, requestedSize))
  let x = anchorX
  let y = anchorY

  // Left handles move the stored horizontal origin away from the fixed anchor.
  if (horizontalDirection < 0) {
    x = anchorX - size
  }

  // Top handles move the stored vertical origin away from the fixed anchor.
  if (verticalDirection < 0) {
    y = anchorY - size
  }

  return { x, y, width: size, height: size }
}

/** Owns the drawing canvas state, gestures, history, keyboard commands, and SVG export. */
export function useDrawingCanvas(options: DrawingCanvasOptions) {
  const canvas = ref<SVGSVGElement | null>(null)
  const canvasHeight = ref(DEFAULT_CANVAS_HEIGHT)
  const connectorHandleRadius = ref(12)
  const textInput = ref<HTMLInputElement | null>(null)
  const elements = ref<DrawingElement[]>([])
  const undoStack = ref<DrawingElement[][]>([])
  const redoStack = ref<DrawingElement[][]>([])
  const selectedElementId = ref<number | null>(null)
  const draftElement = ref<DrawingElement | null>(null)
  const textEditor = ref<{ x: number, y: number, value: string, elementId: number } | null>(null)
  let nextElementId = 1
  let canvasResizeObserver: ResizeObserver | null = null
  let interaction: DrawingInteraction | null = null
  let lastElementPress: { elementId: number, pressedAt: number } | null = null

  /** Creates a detached snapshot so undo history cannot be mutated by later gestures. */
  function cloneElements(source: DrawingElement[]): DrawingElement[] {
    return source.map((element) => ({ ...element }))
  }

  /** Stores one completed mutation and invalidates redo states from the abandoned branch. */
  function recordMutation(previousElements: DrawingElement[]): void {
    undoStack.value.push(cloneElements(previousElements))
    redoStack.value = []
  }

  /** Restricts one numeric coordinate to a visible canvas range. */
  function clamp(value: number, minimum: number, maximum: number): number {
    return Math.max(minimum, Math.min(maximum, value))
  }

  /** Converts a pointer or drop position into the fixed SVG coordinate system. */
  function canvasPoint(event: PointerEvent | DragEvent): CanvasPoint {
    const bounds = canvas.value?.getBoundingClientRect()

    // A missing or collapsed SVG can only occur during unmount, so the neutral point is sufficient.
    if (!bounds || bounds.width === 0 || bounds.height === 0) {
      return { x: 0, y: 0 }
    }

    return {
      x: clamp((event.clientX - bounds.left) * CANVAS_WIDTH / bounds.width, 0, CANVAS_WIDTH),
      y: clamp((event.clientY - bounds.top) * canvasHeight.value / bounds.height, 0, canvasHeight.value),
    }
  }

  /** Matches the SVG coordinate ratio to its responsive box so shapes never stretch across viewports. */
  function syncCanvasAspectRatio(): void {
    const bounds = canvas.value?.getBoundingClientRect()

    // A scene hidden with v-show has no measurable box and keeps its last useful coordinate space.
    if (!bounds || bounds.width === 0 || bounds.height === 0) {
      return
    }

    canvasHeight.value = CANVAS_WIDTH * bounds.height / bounds.width
    connectorHandleRadius.value = 10 * CANVAS_WIDTH / bounds.width
  }

  /** Resolves common kind and stroke presentation for one palette tool. */
  function toolAppearance(tool: DrawingToolId): Pick<DrawingElement, 'kind' | 'strokeWidth' | 'dashed'> {
    let kind: DrawingElement['kind'] = 'square'
    let strokeWidth = 2
    let dashed = false

    // Rectangles retain free width and height while using the shared box renderer.
    if (tool === 'rectangle') {
      kind = 'rectangle'
    }

    // Polygons use their own SVG point geometry while sharing rectangular bounds.
    if (tool === 'polygon') {
      kind = 'polygon'
    }

    // Every line style shares endpoint geometry and differs only in presentation.
    if (tool.includes('line')) {
      kind = 'line'
    }

    // Thick variants remain visually distinct at every canvas scale.
    if (tool.includes('thick')) {
      strokeWidth = 7
    }

    // Dashed variants use the same geometry so resizing remains consistent.
    if (tool.includes('dashed')) {
      dashed = true
    }

    return { kind, strokeWidth, dashed }
  }

  /** Creates one element with the current localized default text. */
  function createElement(tool: DrawingToolId, x: number, y: number, width: number, height: number): DrawingElement {
    const appearance = toolAppearance(tool)
    const element: DrawingElement = {
      id: nextElementId,
      ...appearance,
      x,
      y,
      width,
      height,
      text: options.textDefault.value,
    }
    nextElementId += 1
    return element
  }

  /** Builds a centered element with a practical default size for palette drops. */
  function createDroppedElement(tool: DrawingToolId, point: CanvasPoint): DrawingElement {
    const appearance = toolAppearance(tool)

    // Lines are dropped horizontally and can then be redirected from either endpoint.
    if (appearance.kind === 'line') {
      const x = clamp(point.x - DEFAULT_LINE_WIDTH / 2, 0, CANVAS_WIDTH - DEFAULT_LINE_WIDTH)
      return createElement(tool, x, point.y, DEFAULT_LINE_WIDTH, 0)
    }

    const size = DEFAULT_SHAPE_SIZES[appearance.kind]
    const x = clamp(point.x - size.width / 2, 0, CANVAS_WIDTH - size.width)
    const y = clamp(point.y - size.height / 2, 0, Math.max(0, canvasHeight.value - size.height))
    return createElement(tool, x, y, size.width, size.height)
  }

  /** Commits one default-sized palette element as an undoable canvas mutation. */
  function commitPlacedElement(tool: DrawingToolId, point: CanvasPoint): void {
    const previousElements = cloneElements(elements.value)
    const element = createDroppedElement(tool, point)
    elements.value.push(element)
    selectedElementId.value = element.id
    recordMutation(previousElements)
  }

  /** Places a palette element at the canvas center for touch and keyboard activation. */
  function placeTool(tool: DrawingToolId): void {
    commitPlacedElement(tool, {
      x: CANVAS_WIDTH / 2,
      y: canvasHeight.value / 2,
    })
  }

  /** Accepts a trusted palette drag and commits one default-sized object at the drop point. */
  function dropTool(event: DragEvent): void {
    event.preventDefault()
    const tool = event.dataTransfer?.getData(DRAWING_TOOL_MIME) ?? ''

    // Arbitrary drag payloads must never create malformed drawing elements.
    if (!isDrawingToolId(tool)) {
      return
    }

    commitPlacedElement(tool, canvasPoint(event))
  }

  /** Clears the current selection when the user presses empty canvas space. */
  function startCanvasInteraction(): void {
    selectedElementId.value = null
  }

  /** Selects an object, opens its editor on the second press, or begins a move gesture. */
  async function startElementMove(event: PointerEvent, elementId: number): Promise<void> {
    const point = canvasPoint(event)
    const previousPress = lastElementPress
    const pressedAt = performance.now()
    selectedElementId.value = elementId
    lastElementPress = { elementId, pressedAt }

    // Pointer capture suppresses native double-click delivery, so two quick presses open editing directly.
    if (previousPress?.elementId === elementId && pressedAt - previousPress.pressedAt <= 400) {
      lastElementPress = null
      interaction = null
      const target = elements.value.find((element) => element.id === elementId)

      // A stale id can only occur when deletion races with the second pointer press.
      if (target) {
        await editText(target)
      }
      return
    }

    interaction = {
      mode: 'move',
      pointerId: event.pointerId,
      startX: point.x,
      startY: point.y,
      originalElements: cloneElements(elements.value),
      elementId,
    }
    canvas.value?.setPointerCapture(event.pointerId)
  }

  /** Returns the visible coordinate for one shape corner or line endpoint handle. */
  function resizeHandlePoint(element: DrawingElement, handle: ResizeHandle): CanvasPoint {
    // A line's first endpoint is stored directly as its origin.
    if (handle === 'start') {
      return { x: element.x, y: element.y }
    }

    // A line's second endpoint is encoded as signed width and height from its origin.
    if (handle === 'end') {
      return { x: element.x + element.width, y: element.y + element.height }
    }

    // Top-left is the shape's stored origin.
    if (handle === 'top-left') {
      return { x: element.x, y: element.y }
    }

    // Top-right combines the right edge with the stored top edge.
    if (handle === 'top-right') {
      return { x: element.x + element.width, y: element.y }
    }

    // Bottom-right combines both far edges.
    if (handle === 'bottom-right') {
      return { x: element.x + element.width, y: element.y + element.height }
    }

    return { x: element.x, y: element.y + element.height }
  }

  /** Begins a reversible resize gesture from one selected element handle. */
  function startResize(event: PointerEvent, elementId: number, handle: ResizeHandle): void {
    const point = canvasPoint(event)
    selectedElementId.value = elementId
    interaction = {
      mode: 'resize',
      pointerId: event.pointerId,
      startX: point.x,
      startY: point.y,
      originalElements: cloneElements(elements.value),
      elementId,
      resizeHandle: handle,
    }
    canvas.value?.setPointerCapture(event.pointerId)
  }

  /** Resizes a line by moving only the endpoint represented by the active handle. */
  function resizeLine(target: DrawingElement, source: DrawingElement, point: CanvasPoint, handle: ResizeHandle): void {
    // Moving the first endpoint preserves the original second endpoint.
    if (handle === 'start') {
      const endX = source.x + source.width
      const endY = source.y + source.height
      target.x = point.x
      target.y = point.y
      target.width = endX - point.x
      target.height = endY - point.y
      return
    }

    target.width = point.x - source.x
    target.height = point.y - source.y
  }

  /** Resizes a free-aspect rectangle or polygon without allowing unusably small bounds. */
  function resizeFreeShape(target: DrawingElement, source: DrawingElement, point: CanvasPoint, handle: ResizeHandle): void {
    const right = source.x + source.width
    const bottom = source.y + source.height

    // Top-left keeps the opposite bottom-right corner fixed.
    if (handle === 'top-left') {
      target.x = Math.min(point.x, right - MIN_SHAPE_SIZE)
      target.y = Math.min(point.y, bottom - MIN_SHAPE_SIZE)
      target.width = right - target.x
      target.height = bottom - target.y
      return
    }

    // Top-right keeps the opposite bottom-left corner fixed.
    if (handle === 'top-right') {
      target.x = source.x
      target.y = Math.min(point.y, bottom - MIN_SHAPE_SIZE)
      target.width = Math.max(MIN_SHAPE_SIZE, point.x - source.x)
      target.height = bottom - target.y
      return
    }

    // Bottom-right keeps the opposite top-left corner fixed.
    if (handle === 'bottom-right') {
      target.x = source.x
      target.y = source.y
      target.width = Math.max(MIN_SHAPE_SIZE, point.x - source.x)
      target.height = Math.max(MIN_SHAPE_SIZE, point.y - source.y)
      return
    }

    target.x = Math.min(point.x, right - MIN_SHAPE_SIZE)
    target.y = source.y
    target.width = right - target.x
    target.height = Math.max(MIN_SHAPE_SIZE, point.y - source.y)
  }

  /** Resizes a square from the opposite corner while preserving equal sides. */
  function resizeSquare(target: DrawingElement, source: DrawingElement, point: CanvasPoint, handle: ResizeHandle): void {
    // Line-only handles cannot reach a selected square through the component template.
    if (handle === 'start' || handle === 'end') {
      return
    }

    Object.assign(target, squareResizeGeometry(source, point, handle, canvasHeight.value))
  }

  /** Applies geometry changes for the active resize gesture. */
  function resizeElement(target: DrawingElement, source: DrawingElement, point: CanvasPoint, handle: ResizeHandle): void {
    // Lines retain directional signed dimensions and use endpoint resizing.
    if (target.kind === 'line') {
      resizeLine(target, source, point, handle)
      return
    }

    // Squares use locked dimensions regardless of which corner moves.
    if (target.kind === 'square') {
      resizeSquare(target, source, point, handle)
      return
    }

    resizeFreeShape(target, source, point, handle)
  }

  /** Moves one element without allowing any of its geometry to leave the canvas. */
  function moveElement(target: DrawingElement, source: DrawingElement, deltaX: number, deltaY: number): void {
    // Lines need both signed endpoints considered when their translation is constrained.
    if (source.kind === 'line') {
      const endX = source.x + source.width
      const endY = source.y + source.height
      const minimumX = Math.min(source.x, endX)
      const maximumX = Math.max(source.x, endX)
      const minimumY = Math.min(source.y, endY)
      const maximumY = Math.max(source.y, endY)
      target.x = source.x + clamp(deltaX, -minimumX, CANVAS_WIDTH - maximumX)
      target.y = source.y + clamp(deltaY, -minimumY, canvasHeight.value - maximumY)
      return
    }

    target.x = clamp(source.x + deltaX, 0, Math.max(0, CANVAS_WIDTH - source.width))
    target.y = clamp(source.y + deltaY, 0, Math.max(0, canvasHeight.value - source.height))
  }

  /** Applies the active move, resize, or connector-line gesture while the pointer is captured. */
  function continueInteraction(event: PointerEvent): void {
    // Hovering without the captured gesture must not change canvas content.
    if (!interaction || interaction.pointerId !== event.pointerId) {
      return
    }

    const activeInteraction = interaction
    const point = canvasPoint(event)

    // Connector drawing only mutates the transient preview until pointer release commits it.
    if (activeInteraction.mode === 'draw' && draftElement.value) {
      draftElement.value.width = point.x - activeInteraction.startX
      draftElement.value.height = point.y - activeInteraction.startY
      return
    }

    const target = elements.value.find((element) => element.id === activeInteraction.elementId)

    // A stale selected id can occur only after keyboard deletion during a pointer gesture.
    if (!target) {
      return
    }

    const source = activeInteraction.originalElements?.find((element) => element.id === target.id)

    // The immutable source geometry avoids accumulating pointer delta errors.
    if (!source) {
      return
    }

    // Resize gestures route to geometry specific behavior for the selected handle.
    if (activeInteraction.mode === 'resize' && activeInteraction.resizeHandle) {
      resizeElement(target, source, point, activeInteraction.resizeHandle)
      return
    }

    // A real move invalidates the pending press so a later click cannot accidentally edit text.
    if (Math.hypot(point.x - activeInteraction.startX, point.y - activeInteraction.startY) > 3) {
      lastElementPress = null
    }

    moveElement(
      target,
      source,
      point.x - activeInteraction.startX,
      point.y - activeInteraction.startY,
    )
  }

  /** Commits a connector line or records a completed object move or resize. */
  function finishInteraction(event: PointerEvent): void {
    // Pointer-up events unrelated to the captured gesture are ignored.
    if (!interaction || interaction.pointerId !== event.pointerId) {
      return
    }

    const finishedInteraction = interaction
    interaction = null
    canvas.value?.releasePointerCapture(event.pointerId)

    // Completed move and resize gestures share snapshot-based undo recording.
    if (finishedInteraction.mode !== 'draw' && finishedInteraction.originalElements) {
      const current = JSON.stringify(elements.value)
      const previous = JSON.stringify(finishedInteraction.originalElements)

      // Clicking a handle or object without changing geometry should not pollute undo history.
      if (current !== previous) {
        recordMutation(finishedInteraction.originalElements)
      }
      return
    }

    const draft = draftElement.value
    draftElement.value = null

    // Tiny accidental connector gestures are discarded because they are not usable lines.
    if (!draft || Math.hypot(draft.width, draft.height) < MIN_DRAWN_LINE_SIZE) {
      return
    }

    const previousElements = cloneElements(elements.value)
    elements.value.push(draft)
    selectedElementId.value = draft.id
    recordMutation(previousElements)
  }

  /** Converts a rectangular bound into a centered six-sided polygon point list. */
  function polygonPoints(element: DrawingElement): string {
    const leftInset = element.width * 0.24
    const right = element.x + element.width
    const bottom = element.y + element.height
    const middleY = element.y + element.height / 2
    return [
      `${element.x + leftInset},${element.y}`,
      `${right - leftInset},${element.y}`,
      `${right},${middleY}`,
      `${right - leftInset},${bottom}`,
      `${element.x + leftInset},${bottom}`,
      `${element.x},${middleY}`,
    ].join(' ')
  }

  /** Returns a padded selection bound for any drawable element kind. */
  function selectionBounds(element: DrawingElement): { x: number, y: number, width: number, height: number } {
    const x2 = element.x + element.width
    const y2 = element.y + element.height
    return {
      x: Math.min(element.x, x2) - 8,
      y: Math.min(element.y, y2) - 8,
      width: Math.abs(element.width) + 16,
      height: Math.abs(element.height) + 16,
    }
  }

  /** Returns the midpoint used to pull a connector from one side of a selected shape. */
  function connectorPoint(element: DrawingElement, side: ConnectorSide): CanvasPoint {
    // The top handle starts from the horizontal center of the shape's upper edge.
    if (side === 'top') {
      return { x: element.x + element.width / 2, y: element.y }
    }

    // The right handle starts from the vertical center of the shape's right edge.
    if (side === 'right') {
      return { x: element.x + element.width, y: element.y + element.height / 2 }
    }

    // The bottom handle starts from the horizontal center of the shape's lower edge.
    if (side === 'bottom') {
      return { x: element.x + element.width / 2, y: element.y + element.height }
    }

    return { x: element.x, y: element.y + element.height / 2 }
  }

  /** Starts a solid connector line at a selected shape handle. */
  function startConnector(event: PointerEvent, element: DrawingElement, side: ConnectorSide): void {
    const start = connectorPoint(element, side)
    selectedElementId.value = element.id
    draftElement.value = createElement('line', start.x, start.y, 0, 0)
    interaction = {
      mode: 'draw',
      pointerId: event.pointerId,
      startX: start.x,
      startY: start.y,
    }
    canvas.value?.setPointerCapture(event.pointerId)
  }

  /** Returns the optional SVG dash pattern shared by previews and committed objects. */
  function dashPattern(element: DrawingElement): string | undefined {
    // Solid shapes omit the SVG attribute so native stroke rendering remains unchanged.
    if (!element.dashed) {
      return undefined
    }

    return '14 10'
  }

  /** Returns the centered position used to render and edit an element's label. */
  function elementTextPoint(element: DrawingElement): CanvasPoint {
    // Line labels sit just above the midpoint to avoid covering their stroke.
    if (element.kind === 'line') {
      return {
        x: element.x + element.width / 2,
        y: element.y + element.height / 2 - 12,
      }
    }

    return {
      x: element.x + element.width / 2,
      y: element.y + element.height / 2 + 8,
    }
  }

  /** Calculates label geometry against the workbench's current responsive canvas bounds. */
  function drawingTextLayout(element: DrawingElement) {
    return calculateDrawingTextLayout(element, CANVAS_WIDTH, canvasHeight.value)
  }

  /** Commits edited text to the selected element as one undoable mutation. */
  function commitText(): void {
    const editor = textEditor.value

    // Blur can run again after Enter removes the editor, so duplicate commits are ignored.
    if (!editor) {
      return
    }

    const value = editor.value.trim()
    textEditor.value = null

    // Empty input cancels editing so every element retains meaningful default text.
    if (!value) {
      return
    }

    const target = elements.value.find((element) => element.id === editor.elementId)

    // The element may have been deleted by a keyboard event while the input was open.
    if (!target) {
      return
    }

    // Re-entering the same text should not create an unnecessary undo checkpoint.
    if (target.text === value) {
      return
    }

    const previousElements = cloneElements(elements.value)
    target.text = value
    recordMutation(previousElements)
  }

  /** Opens the inline editor for any shape or line label. */
  async function editText(element: DrawingElement): Promise<void> {
    const point = elementTextPoint(element)
    textEditor.value = {
      x: clamp(point.x - 130, 0, CANVAS_WIDTH - 260),
      y: clamp(point.y - 24, 0, Math.max(0, canvasHeight.value - 48)),
      value: element.text,
      elementId: element.id,
    }
    await nextTick()
    textInput.value?.select()
  }

  /** Restores the most recent canvas snapshot while retaining the current state for redo. */
  function undo(): void {
    const previous = undoStack.value.pop()

    // An empty undo stack leaves the current canvas untouched.
    if (!previous) {
      return
    }

    redoStack.value.push(cloneElements(elements.value))
    elements.value = previous
    selectedElementId.value = null
  }

  /** Reapplies the most recently undone snapshot and returns the current state to undo history. */
  function redo(): void {
    const next = redoStack.value.pop()

    // An empty redo stack leaves the current canvas untouched.
    if (!next) {
      return
    }

    undoStack.value.push(cloneElements(elements.value))
    elements.value = next
    selectedElementId.value = null
  }

  /** Removes the selected object while making the deletion recoverable through undo. */
  function deleteSelected(): void {
    // Delete actions without a selection intentionally do nothing.
    if (selectedElementId.value === null) {
      return
    }

    const previousElements = cloneElements(elements.value)
    elements.value = elements.value.filter((element) => element.id !== selectedElementId.value)
    selectedElementId.value = null
    recordMutation(previousElements)
  }

  /** Clears every canvas object as one undoable action. */
  function clearCanvas(): void {
    // An already empty canvas does not need an undo checkpoint.
    if (elements.value.length === 0) {
      return
    }

    const previousElements = cloneElements(elements.value)
    elements.value = []
    selectedElementId.value = null
    recordMutation(previousElements)
  }

  /** Escapes one label before it is inserted into standalone SVG markup. */
  function escapeSvgText(value: string): string {
    const safeText = document.createElement('span')
    safeText.textContent = value
    return safeText.innerHTML
  }

  /** Serializes one element together with its required label. */
  function elementSvgMarkup(element: DrawingElement): string {
    let dash = ''

    // Dashed objects include their presentation attribute in standalone downloads.
    if (element.dashed) {
      dash = ' stroke-dasharray="14 10"'
    }

    let geometry = ''

    // Lines use their signed dimensions as a directional endpoint.
    if (element.kind === 'line') {
      geometry = `<line x1="${element.x}" y1="${element.y}" x2="${element.x + element.width}" y2="${element.y + element.height}" stroke="#263d37" stroke-width="${element.strokeWidth}" stroke-linecap="round"${dash}/>`
    } else if (element.kind === 'polygon') {
      // Polygons serialize the same six-sided geometry shown on the canvas.
      geometry = `<polygon points="${polygonPoints(element)}" fill="#eef4f0" stroke="#263d37" stroke-width="${element.strokeWidth}"${dash}/>`
    } else {
      // Square and rectangle elements share rectangular SVG output.
      geometry = `<rect x="${element.x}" y="${element.y}" width="${element.width}" height="${element.height}" rx="3" fill="#eef4f0" stroke="#263d37" stroke-width="${element.strokeWidth}"${dash}/>`
    }

    const textLayout = drawingTextLayout(element)
    const textLines = textLayout.lines.map((line, index) => {
      let offset = 0

      // Every line after the first advances by the shared line height.
      if (index > 0) {
        offset = textLayout.lineHeight
      }

      return `<tspan x="${textLayout.x}" dy="${offset}">${escapeSvgText(line)}</tspan>`
    }).join('')
    const text = `<text x="${textLayout.x}" y="${textLayout.y}" text-anchor="middle" font-family="Inter, sans-serif" font-size="20" fill="#1f2926"><title>${escapeSvgText(element.text)}</title>${textLines}</text>`
    return `${geometry}${text}`
  }

  /** Serializes the current diagram as a standalone SVG download. */
  function exportSvg(): void {
    const drawingMarkup = elements.value.map(elementSvgMarkup).join('')
    const markup = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS_WIDTH} ${canvasHeight.value}"><rect width="100%" height="100%" fill="#ffffff"/>${drawingMarkup}</svg>`
    const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'flow-diagram.svg'
    link.click()
    URL.revokeObjectURL(url)
  }

  /** Handles drawing-specific keyboard commands without intercepting text entry. */
  function handleKeydown(event: KeyboardEvent): void {
    // The preserved drawing workspace must not intercept shortcuts in developer-tool forms.
    if (!options.active.value) {
      return
    }

    const target = event.target as HTMLElement | null

    // Native text fields retain their expected editing and submission shortcuts.
    if (target?.matches('input, textarea')) {
      return
    }

    // Delete and Backspace both remove the current canvas selection.
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      deleteSelected()
      return
    }

    const commandModifier = event.metaKey || event.ctrlKey

    // Ctrl/Cmd+Z follows standard editor undo behavior, with Shift selecting redo.
    if (commandModifier && event.key.toLowerCase() === 'z') {
      event.preventDefault()

      // Shift modifies the undo shortcut into redo on common desktop platforms.
      if (event.shiftKey) {
        redo()
        return
      }

      undo()
    }
  }

  /** Registers keyboard and responsive-canvas listeners for the mounted workspace. */
  function mountCanvasListeners(): void {
    window.addEventListener('keydown', handleKeydown)
    canvasResizeObserver = new ResizeObserver(syncCanvasAspectRatio)

    // The canvas ref is present after mount and becomes the single responsive measurement target.
    if (canvas.value) {
      canvasResizeObserver.observe(canvas.value)
    }
  }

  /** Releases global listeners and observations when the workspace is removed. */
  function unmountCanvasListeners(): void {
    window.removeEventListener('keydown', handleKeydown)
    canvasResizeObserver?.disconnect()
  }

  onMounted(mountCanvasListeners)
  onBeforeUnmount(unmountCanvasListeners)

  return {
    canvas,
    canvasHeight,
    connectorHandleRadius,
    textInput,
    elements,
    undoStack,
    redoStack,
    selectedElementId,
    draftElement,
    textEditor,
    placeTool,
    dropTool,
    startCanvasInteraction,
    startElementMove,
    resizeHandlePoint,
    startResize,
    continueInteraction,
    finishInteraction,
    polygonPoints,
    selectionBounds,
    connectorPoint,
    startConnector,
    dashPattern,
    elementTextPoint,
    drawingTextLayout,
    commitText,
    editText,
    undo,
    redo,
    deleteSelected,
    clearCanvas,
    exportSvg,
  }
}
