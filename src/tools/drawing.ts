export type DrawingToolId =
  | 'select'
  | 'square'
  | 'rectangle'
  | 'polygon'
  | 'line'
  | 'dashed-line'
  | 'thick-line'
  | 'thick-dashed-line'
  | 'text'

export type DrawingElementKind = 'square' | 'rectangle' | 'polygon' | 'line' | 'text'

export interface DrawingElement {
  id: number
  kind: DrawingElementKind
  x: number
  y: number
  width: number
  height: number
  strokeWidth: number
  dashed: boolean
  text?: string
}
