<script setup lang="ts">
import { computed, toRef } from 'vue'
import { Download, Redo2, Trash2, Undo2 } from '@lucide/vue'

import {
  CANVAS_WIDTH,
  connectorSides,
  shapeResizeHandles,
  useDrawingCanvas,
} from '../composables/useDrawingCanvas'
import { language } from '../lib/i18n'

const props = defineProps<{
  active: boolean
}>()
const lineResizeHandles = ['start', 'end'] as const

const labels = computed(() => {
  // English labels keep the drawing workspace consistent with the global language picker.
  if (language.value === 'en') {
    return {
      title: 'Untitled flow',
      canvas: 'Drawing canvas',
      empty: 'Drag a shape or line from the left onto the canvas',
      undo: 'Undo',
      redo: 'Redo',
      delete: 'Delete selected',
      clear: 'Clear canvas',
      export: 'Export SVG',
      textPlaceholder: 'Enter text',
      textDefault: 'Text',
      objects: 'objects',
    }
  }

  return {
    title: '未命名流程图',
    canvas: '绘图画布',
    empty: '从左侧拖拽图形或线条到画布',
    undo: '撤销',
    redo: '重做',
    delete: '删除所选',
    clear: '清空画布',
    export: '导出 SVG',
    textPlaceholder: '输入文本',
    textDefault: '文本',
    objects: '个对象',
  }
})

const textDefault = computed(() => labels.value.textDefault)
const {
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
  resizeHandlePoint,
  startConnector,
  startResize,
  dashPattern,
  drawingTextLayout,
  placeTool,
  dropTool,
  commitText,
  editText,
  undo,
  redo,
  deleteSelected,
  clearCanvas,
  exportSvg,
} = useDrawingCanvas({
  active: toRef(props, 'active'),
  textDefault,
})

/** Returns the vertical offset for one rendered label line. */
function textLineOffset(index: number, lineHeight: number): number {
  // The first tspan starts at the text node baseline and later lines advance uniformly.
  if (index === 0) {
    return 0
  }

  return lineHeight
}

defineExpose({ placeTool })
</script>

<template>
  <section class="drawing-workbench">
    <div class="drawing-toolbar">
      <div class="drawing-document-title">
        <strong>{{ labels.title }}</strong>
        <span>{{ elements.length }} {{ labels.objects }}</span>
      </div>

      <div class="drawing-actions">
        <button type="button" class="icon-button" :disabled="undoStack.length === 0" :aria-label="labels.undo" :data-tooltip="labels.undo" @click="undo">
          <Undo2 :size="17" aria-hidden="true" />
        </button>
        <button type="button" class="icon-button" :disabled="redoStack.length === 0" :aria-label="labels.redo" :data-tooltip="labels.redo" @click="redo">
          <Redo2 :size="17" aria-hidden="true" />
        </button>
        <button type="button" class="icon-button" :disabled="selectedElementId === null" :aria-label="labels.delete" :data-tooltip="labels.delete" @click="deleteSelected">
          <Trash2 :size="17" aria-hidden="true" />
        </button>
        <span class="drawing-action-divider" aria-hidden="true" />
        <button type="button" class="drawing-text-action" :disabled="elements.length === 0" @click="clearCanvas">
          {{ labels.clear }}
        </button>
        <button type="button" class="drawing-export-action" :disabled="elements.length === 0" @click="exportSvg">
          <Download :size="16" aria-hidden="true" />
          {{ labels.export }}
        </button>
      </div>
    </div>

    <div class="drawing-canvas-shell">
      <svg
        ref="canvas"
        class="drawing-canvas"
        :viewBox="`0 0 ${CANVAS_WIDTH} ${canvasHeight}`"
        preserveAspectRatio="none"
        role="application"
        :aria-label="labels.canvas"
        @pointerdown="startCanvasInteraction"
        @pointermove="continueInteraction"
        @pointerup="finishInteraction"
        @pointercancel="finishInteraction"
        @dragover.prevent
        @drop="dropTool"
      >
        <defs>
          <pattern id="drawing-grid-small" width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#e8ece9" stroke-width="1" />
          </pattern>
          <pattern id="drawing-grid" width="100" height="100" patternUnits="userSpaceOnUse">
            <rect width="100" height="100" fill="url(#drawing-grid-small)" />
            <path d="M 100 0 L 0 0 0 100" fill="none" stroke="#dce3de" stroke-width="1.4" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="#ffffff" />
        <rect width="100%" height="100%" fill="url(#drawing-grid)" />

        <g
          v-for="element in elements"
          :key="element.id"
          class="drawing-element"
          @pointerdown.stop="startElementMove($event, element.id)"
          @dblclick.stop="editText(element)"
        >
          <!-- Box shapes share rendering while their drag constraints remain independent. -->
          <rect
            v-if="element.kind === 'square' || element.kind === 'rectangle'"
            :x="element.x"
            :y="element.y"
            :width="element.width"
            :height="element.height"
            rx="3"
            fill="#eef4f0"
            stroke="#263d37"
            :stroke-width="element.strokeWidth"
            :stroke-dasharray="dashPattern(element)"
          />
          <!-- Polygon tools render as a balanced six-sided process shape. -->
          <polygon
            v-if="element.kind === 'polygon'"
            :points="polygonPoints(element)"
            fill="#eef4f0"
            stroke="#263d37"
            :stroke-width="element.strokeWidth"
          />
          <!-- A transparent stroke gives thin lines a practical drag and selection target. -->
          <line
            v-if="element.kind === 'line'"
            class="drawing-line-hit-target"
            :x1="element.x"
            :y1="element.y"
            :x2="element.x + element.width"
            :y2="element.y + element.height"
          />
          <!-- Signed line dimensions preserve the direction of the original drag. -->
          <line
            v-if="element.kind === 'line'"
            :x1="element.x"
            :y1="element.y"
            :x2="element.x + element.width"
            :y2="element.y + element.height"
            stroke="#263d37"
            :stroke-width="element.strokeWidth"
            :stroke-dasharray="dashPattern(element)"
            stroke-linecap="round"
          />
          <!-- Every label shares a bounded layout so long text cannot escape its drawing area. -->
          <text
            class="drawing-element-label"
            :class="{
              'drawing-element-label--line': element.kind === 'line',
              'drawing-element-label--shape': element.kind !== 'line',
            }"
            :x="drawingTextLayout(element).x"
            :y="drawingTextLayout(element).y"
            text-anchor="middle"
          >
            <title>{{ element.text }}</title>
            <tspan
              v-for="(line, lineIndex) in drawingTextLayout(element).lines"
              :key="`${element.id}-${lineIndex}`"
              :x="drawingTextLayout(element).x"
              :dy="textLineOffset(lineIndex, drawingTextLayout(element).lineHeight)"
            >{{ line }}</tspan>
          </text>
          <!-- The selected object's bound remains visible without changing exported geometry. -->
          <rect
            v-if="selectedElementId === element.id"
            class="drawing-selection"
            v-bind="selectionBounds(element)"
          />
          <!-- Selected process shapes expose four handles that pull out a solid line. -->
          <g v-if="selectedElementId === element.id && (element.kind === 'square' || element.kind === 'rectangle' || element.kind === 'polygon')">
            <circle
              v-for="side in connectorSides"
              :key="side"
              class="drawing-connector-handle"
              :cx="connectorPoint(element, side).x"
              :cy="connectorPoint(element, side).y"
              :r="connectorHandleRadius"
              vector-effect="non-scaling-stroke"
              @pointerdown.stop="startConnector($event, element, side)"
            />
          </g>
          <!-- Selected shapes expose four corner handles for direct resizing. -->
          <g v-if="selectedElementId === element.id && element.kind !== 'line'">
            <rect
              v-for="handle in shapeResizeHandles"
              :key="handle"
              class="drawing-resize-handle drawing-shape-resize-handle"
              :class="`drawing-resize-handle--${handle}`"
              :x="resizeHandlePoint(element, handle).x - connectorHandleRadius * 0.7"
              :y="resizeHandlePoint(element, handle).y - connectorHandleRadius * 0.7"
              :width="connectorHandleRadius * 1.4"
              :height="connectorHandleRadius * 1.4"
              vector-effect="non-scaling-stroke"
              @pointerdown.stop="startResize($event, element.id, handle)"
            />
          </g>
          <!-- Selected lines expose both endpoints so their direction and length can be adjusted. -->
          <g v-if="selectedElementId === element.id && element.kind === 'line'">
            <circle
              v-for="handle in lineResizeHandles"
              :key="handle"
              class="drawing-resize-handle drawing-line-endpoint-handle"
              :cx="resizeHandlePoint(element, handle).x"
              :cy="resizeHandlePoint(element, handle).y"
              :r="connectorHandleRadius * 0.78"
              vector-effect="non-scaling-stroke"
              @pointerdown.stop="startResize($event, element.id, handle)"
            />
          </g>
        </g>

        <!-- The current drag uses a translucent preview until pointer release commits it. -->
        <g v-if="draftElement" class="drawing-draft">
          <!-- Box previews share bounds while only squares enforce equal sides. -->
          <rect
            v-if="draftElement.kind === 'square' || draftElement.kind === 'rectangle'"
            :x="draftElement.x"
            :y="draftElement.y"
            :width="draftElement.width"
            :height="draftElement.height"
            rx="3"
          />
          <!-- Polygon previews use the same six-sided geometry as committed objects. -->
          <polygon v-if="draftElement.kind === 'polygon'" :points="polygonPoints(draftElement)" />
          <!-- Line previews preserve the selected width and dash treatment. -->
          <line
            v-if="draftElement.kind === 'line'"
            :x1="draftElement.x"
            :y1="draftElement.y"
            :x2="draftElement.x + draftElement.width"
            :y2="draftElement.y + draftElement.height"
            :stroke-width="draftElement.strokeWidth"
            :stroke-dasharray="dashPattern(draftElement)"
          />
        </g>

        <!-- Text entry stays inside SVG coordinates so it follows responsive canvas sizing. -->
        <foreignObject v-if="textEditor" :x="textEditor.x" :y="textEditor.y" width="260" height="48">
          <input
            ref="textInput"
            v-model="textEditor.value"
            class="drawing-text-input"
            :placeholder="labels.textPlaceholder"
            @pointerdown.stop
            @keydown.enter.prevent="commitText"
            @blur="commitText"
          >
        </foreignObject>
      </svg>

      <!-- Empty guidance disappears as soon as the first object is created or drafted. -->
      <div v-if="elements.length === 0 && !draftElement && !textEditor" class="drawing-empty-state">
        <span>{{ labels.empty }}</span>
      </div>
    </div>
  </section>
</template>
