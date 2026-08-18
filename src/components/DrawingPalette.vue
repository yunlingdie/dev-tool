<script setup lang="ts">
import { computed, type Component } from 'vue'
import {
  Hexagon,
  Minus,
  MousePointer2,
  RectangleHorizontal,
  Square,
  Type,
} from '@lucide/vue'

import { language } from '../lib/i18n'
import type { DrawingToolId } from '../tools/drawing'

type PaletteLabels = {
  navigation: string
  shapes: string
  lines: string
  annotations: string
  select: string
  square: string
  rectangle: string
  polygon: string
  line: string
  dashedLine: string
  thickLine: string
  thickDashedLine: string
  text: string
}

type PaletteTool = {
  id: DrawingToolId
  label: string
  icon: Component
}

type PaletteGroup = {
  label: string
  tools: PaletteTool[]
}

const props = defineProps<{
  activeTool: DrawingToolId
}>()

const emit = defineEmits<{
  select: [toolId: DrawingToolId]
}>()

const labelsByLanguage: Record<'zh' | 'en', PaletteLabels> = {
  zh: {
    navigation: '绘图工具',
    shapes: '图形',
    lines: '线条',
    annotations: '标注',
    select: '选择 / 移动',
    square: '正方形',
    rectangle: '长方形',
    polygon: '多边形',
    line: '实线',
    dashedLine: '虚线',
    thickLine: '粗实线',
    thickDashedLine: '粗虚线',
    text: '文本输入框',
  },
  en: {
    navigation: 'Drawing tools',
    shapes: 'Shapes',
    lines: 'Lines',
    annotations: 'Annotations',
    select: 'Select / move',
    square: 'Square',
    rectangle: 'Rectangle',
    polygon: 'Polygon',
    line: 'Solid line',
    dashedLine: 'Dashed line',
    thickLine: 'Thick solid line',
    thickDashedLine: 'Thick dashed line',
    text: 'Text input',
  },
}

// Resolves the palette copy from the application's shared language selection.
const labels = computed(() => labelsByLanguage[language.value])

// Groups the available canvas actions for the compact visual navigation grid.
const drawingToolGroups = computed<PaletteGroup[]>(() => [
  {
    label: labels.value.shapes,
    tools: [
      { id: 'select' as const, label: labels.value.select, icon: MousePointer2 },
      { id: 'square' as const, label: labels.value.square, icon: Square },
      { id: 'rectangle' as const, label: labels.value.rectangle, icon: RectangleHorizontal },
      { id: 'polygon' as const, label: labels.value.polygon, icon: Hexagon },
    ],
  },
  {
    label: labels.value.lines,
    tools: [
      { id: 'line' as const, label: labels.value.line, icon: Minus },
      { id: 'dashed-line' as const, label: labels.value.dashedLine, icon: Minus },
      { id: 'thick-line' as const, label: labels.value.thickLine, icon: Minus },
      { id: 'thick-dashed-line' as const, label: labels.value.thickDashedLine, icon: Minus },
    ],
  },
  {
    label: labels.value.annotations,
    tools: [
      { id: 'text' as const, label: labels.value.text, icon: Type },
    ],
  },
])
</script>

<template>
  <nav class="tool-navigation drawing-tool-navigation" :aria-label="labels.navigation">
    <section v-for="group in drawingToolGroups" :key="group.label" class="nav-section">
      <h2>{{ group.label }}</h2>
      <div class="drawing-tool-grid">
        <button
          v-for="drawingTool in group.tools"
          :key="drawingTool.id"
          type="button"
          class="tool-link drawing-tool-link"
          :class="{
            'tool-link--active': props.activeTool === drawingTool.id,
            [`drawing-tool-link--${drawingTool.id}`]: true,
          }"
          :aria-pressed="props.activeTool === drawingTool.id"
          @click="emit('select', drawingTool.id)"
        >
          <span class="drawing-tool-icon" aria-hidden="true">
            <component :is="drawingTool.icon" :size="22" />
          </span>
          <span>{{ drawingTool.label }}</span>
        </button>
      </div>
    </section>
  </nav>
</template>
