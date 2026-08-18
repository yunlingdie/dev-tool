import { nextTick, onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

import type { DrawingElement, DrawingToolId } from '../tools/drawing'

export const CANVAS_WIDTH = 1200
const DEFAULT_CANVAS_HEIGHT = 760
const MIN_ELEMENT_SIZE = 8
export const connectorSides = ['top', 'right', 'bottom', 'left'] as const
export type ConnectorSide = typeof connectorSides[number]

interface DrawingCanvasOptions {
  activeTool: Readonly<Ref<DrawingToolId>>
  active: Readonly<Ref<boolean>>
  textDefault: Readonly<Ref<string>>
}

interface DrawingInteraction {
  mode: 'draw' | 'move'
  pointerId: number
  startX: number
  startY: number
  originalElements?: DrawingElement[]
  elementId?: number
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
  const textEditor = ref<{ x: number, y: number, value: string, elementId: number | null } | null>(null)
  let nextElementId = 1
  let canvasResizeObserver: ResizeObserver | null = null
  let interaction: DrawingInteraction | null = null

  /** Creates a detached snapshot so undo history cannot be mutated by later pointer moves. */
  function cloneElements(source: DrawingElement[]): DrawingElement[] {
    return source.map((element) => ({ ...element }))
  }

  /** Stores one completed mutation and invalidates redo states from the abandoned branch. */
  function recordMutation(previousElements: DrawingElement[]): void {
    undoStack.value.push(cloneElements(previousElements))
    redoStack.value = []
  }

  /** Converts one pointer position into the fixed SVG coordinate system. */
  function canvasPoint(event: PointerEvent): { x: number, y: number } {
    const bounds = canvas.value?.getBoundingClientRect()

    // A missing or collapsed SVG can only occur during unmount, so the neutral point is sufficient.
    if (!bounds || bounds.width === 0 || bounds.height === 0) {
      return { x: 0, y: 0 }
    }

    return {
      x: Math.max(0, Math.min(CANVAS_WIDTH, (event.clientX - bounds.left) * CANVAS_WIDTH / bounds.width)),
      y: Math.max(0, Math.min(canvasHeight.value, (event.clientY - bounds.top) * canvasHeight.value / bounds.height)),
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

  /** Returns a new drawable element configured from the selected palette tool. */
  function createDraft(tool: DrawingToolId, x: number, y: number): DrawingElement {
    const elementId = nextElementId
    let kind: DrawingElement['kind'] = 'square'
    let strokeWidth = 2
    let dashed = false
    nextElementId += 1

    // Rectangle keeps free width and height while using the shared box renderer.
    if (tool === 'rectangle') {
      kind = 'rectangle'
    }

    // Polygon uses its own SVG point geometry while box shapes use rectangular bounds.
    if (tool === 'polygon') {
      kind = 'polygon'
    }

    // Every line style shares endpoints and differs only in stroke presentation.
    if (tool.includes('line')) {
      kind = 'line'
    }

    // Thick variants remain visually distinct at every canvas scale.
    if (tool.includes('thick')) {
      strokeWidth = 7
    }

    // Dashed variants use the same geometry so users can switch styles without changed behavior.
    if (tool.includes('dashed')) {
      dashed = true
    }

    return {
      id: elementId,
      kind,
      x,
      y,
      width: 0,
      height: 0,
      strokeWidth,
      dashed,
    }
  }

  /** Updates a draft from its anchor while preserving a true square for the square tool. */
  function resizeDraft(element: DrawingElement, point: { x: number, y: number }, activeInteraction: DrawingInteraction): DrawingElement {
    let deltaX = point.x - activeInteraction.startX
    let deltaY = point.y - activeInteraction.startY

    // Lines retain signed dimensions because those values encode endpoint direction.
    if (element.kind === 'line') {
      return { ...element, width: deltaX, height: deltaY }
    }

    // Only the square tool locks dimensions; rectangles retain the full pointer bounds.
    if (element.kind === 'square') {
      const size = Math.min(Math.abs(deltaX), Math.abs(deltaY))
      deltaX = Math.sign(deltaX || 1) * size
      deltaY = Math.sign(deltaY || 1) * size
    }

    return {
      ...element,
      x: Math.min(activeInteraction.startX, activeInteraction.startX + deltaX),
      y: Math.min(activeInteraction.startY, activeInteraction.startY + deltaY),
      width: Math.abs(deltaX),
      height: Math.abs(deltaY),
    }
  }

  /** Starts drawing on empty canvas space or opens the inline text editor. */
  async function startCanvasInteraction(event: PointerEvent): Promise<void> {
    const point = canvasPoint(event)

    // Selection mode clears the current selection when empty canvas space is clicked.
    if (options.activeTool.value === 'select') {
      selectedElementId.value = null
      return
    }

    // Text is entered inline because a drag gesture is unnecessary for a label.
    if (options.activeTool.value === 'text') {
      textEditor.value = {
        x: Math.min(point.x, CANVAS_WIDTH - 270),
        y: Math.min(point.y, canvasHeight.value - 48),
        value: '',
        elementId: null,
      }
      await nextTick()
      textInput.value?.focus()
      return
    }

    draftElement.value = createDraft(options.activeTool.value, point.x, point.y)
    interaction = {
      mode: 'draw',
      pointerId: event.pointerId,
      startX: point.x,
      startY: point.y,
    }
    canvas.value?.setPointerCapture(event.pointerId)
  }

  /** Selects an existing object and begins a reversible move gesture in selection mode. */
  function startElementMove(event: PointerEvent, elementId: number): void {
    // Shape tools draw over existing content instead of unexpectedly moving it.
    if (options.activeTool.value !== 'select') {
      return
    }

    const point = canvasPoint(event)
    selectedElementId.value = elementId
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

  /** Applies the active draw or move gesture while the pointer remains captured by the canvas. */
  function continueInteraction(event: PointerEvent): void {
    // Hovering without an active gesture must not change canvas content.
    if (!interaction || interaction.pointerId !== event.pointerId) {
      return
    }

    const activeInteraction = interaction
    const point = canvasPoint(event)

    // Drawing only mutates the transient preview until pointer release commits it.
    if (activeInteraction.mode === 'draw' && draftElement.value) {
      draftElement.value = resizeDraft(draftElement.value, point, activeInteraction)
      return
    }

    const target = elements.value.find((element) => element.id === activeInteraction.elementId)

    // A stale selected id can occur only after keyboard deletion during a pointer gesture.
    if (!target) {
      return
    }

    const source = activeInteraction.originalElements?.find((element) => element.id === target.id)

    // The immutable source position is required to avoid accumulating pointer delta errors.
    if (!source) {
      return
    }

    target.x = source.x + point.x - activeInteraction.startX
    target.y = source.y + point.y - activeInteraction.startY
  }

  /** Commits a sufficiently sized drawing or records a completed object move. */
  function finishInteraction(event: PointerEvent): void {
    // Pointer-up events unrelated to the captured gesture are ignored.
    if (!interaction || interaction.pointerId !== event.pointerId) {
      return
    }

    const finishedInteraction = interaction
    interaction = null
    canvas.value?.releasePointerCapture(event.pointerId)

    // A completed move records its pre-drag snapshot only when position actually changed.
    if (finishedInteraction.mode === 'move' && finishedInteraction.originalElements) {
      const current = JSON.stringify(elements.value)
      const previous = JSON.stringify(finishedInteraction.originalElements)

      // Clicking without moving should select an object without polluting undo history.
      if (current !== previous) {
        recordMutation(finishedInteraction.originalElements)
      }
      return
    }

    const draft = draftElement.value
    draftElement.value = null

    // Tiny accidental gestures are discarded because they are not usable diagram objects.
    if (!draft || Math.hypot(draft.width, draft.height) < MIN_ELEMENT_SIZE) {
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
  function connectorPoint(element: DrawingElement, side: ConnectorSide): { x: number, y: number } {
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

  /** Starts a solid line at a selected shape handle regardless of the active palette tool. */
  function startConnector(event: PointerEvent, element: DrawingElement, side: ConnectorSide): void {
    const start = connectorPoint(element, side)
    selectedElementId.value = element.id
    draftElement.value = createDraft('line', start.x, start.y)
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

  /** Commits a new text label or replaces the selected label after inline editing. */
  function commitText(): void {
    const editor = textEditor.value

    // Blur can run again after Enter removes the editor, so duplicate commits are ignored.
    if (!editor) {
      return
    }

    const value = editor.value.trim()
    textEditor.value = null

    // Empty input cancels label creation and preserves an existing label unchanged.
    if (!value) {
      return
    }

    const previousElements = cloneElements(elements.value)

    // Existing text keeps its position and identity so selection remains stable.
    if (editor.elementId !== null) {
      const target = elements.value.find((element) => element.id === editor.elementId)

      // The text may have been deleted by a keyboard event while the input was open.
      if (!target) {
        return
      }

      target.text = value
      target.width = Math.max(80, value.length * 18)
      recordMutation(previousElements)
      return
    }

    const element: DrawingElement = {
      id: nextElementId,
      kind: 'text',
      x: editor.x,
      y: editor.y,
      width: Math.max(80, value.length * 18),
      height: 34,
      strokeWidth: 0,
      dashed: false,
      text: value,
    }
    nextElementId += 1
    elements.value.push(element)
    selectedElementId.value = element.id
    recordMutation(previousElements)
  }

  /** Reopens the inline editor when a text label is double-clicked in selection mode. */
  async function editText(element: DrawingElement): Promise<void> {
    // Only text objects in selection mode support direct editing.
    if (options.activeTool.value !== 'select' || element.kind !== 'text') {
      return
    }

    textEditor.value = {
      x: element.x,
      y: Math.max(0, element.y - 28),
      value: element.text ?? options.textDefault.value,
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

  /** Serializes the current diagram as a standalone SVG download. */
  function exportSvg(): void {
    const drawingMarkup = elements.value.map((element) => {
      let dash = ''

      // Dashed objects include their presentation attribute in standalone downloads.
      if (element.dashed) {
        dash = ' stroke-dasharray="14 10"'
      }

      // Text is escaped through a temporary DOM node before entering downloaded markup.
      if (element.kind === 'text') {
        const safeText = document.createElement('span')
        safeText.textContent = element.text ?? ''
        return `<text x="${element.x}" y="${element.y + 26}" font-family="Inter, sans-serif" font-size="24" fill="#1f2926">${safeText.innerHTML}</text>`
      }

      // Lines use their signed dimensions as a directional endpoint.
      if (element.kind === 'line') {
        return `<line x1="${element.x}" y1="${element.y}" x2="${element.x + element.width}" y2="${element.y + element.height}" stroke="#263d37" stroke-width="${element.strokeWidth}" stroke-linecap="round"${dash}/>`
      }

      // Polygons serialize the same six-sided geometry shown on the canvas.
      if (element.kind === 'polygon') {
        return `<polygon points="${polygonPoints(element)}" fill="#eef4f0" stroke="#263d37" stroke-width="${element.strokeWidth}"${dash}/>`
      }

      return `<rect x="${element.x}" y="${element.y}" width="${element.width}" height="${element.height}" rx="3" fill="#eef4f0" stroke="#263d37" stroke-width="${element.strokeWidth}"${dash}/>`
    }).join('')
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
    startCanvasInteraction,
    startElementMove,
    continueInteraction,
    finishInteraction,
    polygonPoints,
    selectionBounds,
    connectorPoint,
    startConnector,
    dashPattern,
    commitText,
    editText,
    undo,
    redo,
    deleteSelected,
    clearCanvas,
    exportSvg,
  }
}
