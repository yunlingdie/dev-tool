import type { Component } from 'vue'

import type { AudioAnalysis } from '../lib/audio'

export type ToolValue = string | number | boolean | File | null
export type ToolValues = Record<string, ToolValue>

export interface ToolOption {
  label: string
  value: string
}

export interface ToolField {
  key: string
  label: string
  type: 'text' | 'textarea' | 'number' | 'select' | 'file'
  defaultValue: ToolValue
  placeholder?: string
  options?: ToolOption[]
  min?: number
  max?: number
  accept?: string
  wide?: boolean
  showWhen?: {
    key: string
    value: ToolValue
  }
}

export interface ToolResult {
  output: string
  items?: string[]
  itemLabels?: string[]
  language?: 'json' | 'diff'
  filename?: string
  mimeType?: string
  downloadHref?: string
  outputs?: ToolOutput[]
  audio?: AudioAnalysis
}

export interface ToolOutput {
  label: string
  content: string
  items?: string[]
  itemLabels?: string[]
  language?: 'json' | 'diff'
  filename?: string
  mimeType?: string
  downloadHref?: string
}

export interface ToolPrefill {
  fieldKey: string
  value: string
  revision: number
  autoRun: boolean
  presetValues?: ToolValues
}

export interface ToolDefinition {
  id: string
  title: string
  category: ToolCategory
  icon: Component
  fields: ToolField[]
  actionLabel: string
  execute: (values: ToolValues) => ToolResult | Promise<ToolResult>
  autoRun?: boolean
  outputLabel?: string
  outputLabels?: string[]
}

export interface ToolCategory {
  id: string
  label: string
}
