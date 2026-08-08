<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { Check, Copy, Download, LoaderCircle, Play } from '@lucide/vue'

import AudioAnalysisViewer from './AudioAnalysisViewer.vue'
import JsonCodeViewer from './JsonCodeViewer.vue'
import { language, t, translateText } from '../lib/i18n'
import type {
  ToolDefinition,
  ToolField,
  ToolOutput,
  ToolPrefill,
  ToolResult,
  ToolValue,
  ToolValues,
} from '../tools/types'

const props = defineProps<{
  tool: ToolDefinition
  prefill?: ToolPrefill
  active: boolean
}>()

const values = reactive<ToolValues>(
  Object.fromEntries(props.tool.fields.map((field) => [field.key, field.defaultValue])),
)

/** Applies the latest search handoff and immediately processes the transferred value. */
async function applyCurrentPrefill(): Promise<void> {
  const prefill = props.prefill

  // Direct navigation and option-only tools do not provide a search handoff.
  if (!prefill) {
    return
  }

  const field = props.tool.fields.find((candidate) => candidate.key === prefill.fieldKey)

  // Registry drift must not create an undeclared reactive field in the generic form.
  if (!field) {
    return
  }

  // Only native text controls can safely receive an arbitrary pasted string.
  if (field.type !== 'text' && field.type !== 'textarea') {
    return
  }

  // Content recognition can pin direction fields required for deterministic automatic handling.
  if (prefill.presetValues) {
    for (const [key, presetValue] of Object.entries(prefill.presetValues)) {
      const presetField = props.tool.fields.find((candidate) => candidate.key === key)

      // Search metadata must not create fields missing from the selected tool definition.
      if (!presetField) {
        continue
      }

      values[presetField.key] = presetValue
    }
  }

  values[field.key] = prefill.value

  // Field-driven tools rerun through their value watcher, avoiding a duplicate search execution.
  if (props.tool.autoRun) {
    return
  }

  // A later title search cancels any queued content run and waits for explicit user action.
  if (!prefill.autoRun) {
    pendingAutoRun = false
    return
  }

  // A newer content handoff should run once the current async execution has settled.
  if (isRunning.value) {
    pendingAutoRun = true
    return
  }

  await runTool()
}

/** Creates the empty output state declared by the selected tool. */
function createInitialResult(): ToolResult {
  // Multi-output tools need all named boxes visible before their first execution.
  if (props.tool.outputLabels?.length) {
    return {
      output: '',
      outputs: props.tool.outputLabels.map((label) => ({ label, content: '' })),
    }
  }

  return { output: '' }
}

const result = ref<ToolResult>(createInitialResult())
const error = ref('')
const isRunning = ref(false)
let pendingAutoRun = false
const copiedOutputIndex = ref<number | null>(null)
const copiedItemKey = ref('')

/** Localizes labels returned by tool handlers without changing generated content. */
function localizeOutput(item: ToolOutput): ToolOutput {
  return {
    ...item,
    label: translateText(item.label, language.value),
    itemLabels: item.itemLabels?.map((label) => translateText(label, language.value)),
  }
}

/** Keeps only fields that apply to the currently selected mode. */
const visibleFields = computed(() =>
  props.tool.fields.filter((field) => {
    // Unconditional fields are always part of the active form.
    if (!field.showWhen) {
      return true
    }

    return values[field.showWhen.key] === field.showWhen.value
  }),
)

/** Normalizes legacy single results and named multi-results for the shared output renderer. */
const displayedOutputs = computed<ToolOutput[]>(() => {
  // Named outputs are preserved so RSA keys remain separately actionable.
  if (result.value.outputs?.length) {
    return result.value.outputs.map(localizeOutput)
  }

  let outputLabel = t('output')

  // A tool-specific output label takes precedence over the generic translated label.
  if (props.tool.outputLabel) {
    outputLabel = props.tool.outputLabel
  }

  return [
    {
      label: outputLabel,
      content: result.value.output,
      items: result.value.items,
      itemLabels: result.value.itemLabels?.map((label) => translateText(label, language.value)),
      language: result.value.language,
      filename: result.value.filename,
      mimeType: result.value.mimeType,
      downloadHref: result.value.downloadHref,
    },
  ]
})

/** Maps one unified diff prefix to its Git-style presentation class. */
function diffLineClass(line: string): string {
  // Plus-prefixed rows represent content introduced by the new text.
  if (line.startsWith('+ ')) {
    return 'diff-line--added'
  }

  // Minus-prefixed rows represent content removed from the original text.
  if (line.startsWith('- ')) {
    return 'diff-line--removed'
  }

  return 'diff-line--context'
}

/** Builds a stable feedback key for one generated item in one output panel. */
function generatedItemKey(outputIndex: number, itemIndex: number): string {
  return `${outputIndex}-${itemIndex}`
}

/** Executes the current tool and converts thrown values into a visible error state. */
async function runTool(): Promise<void> {
  // Repeated manual clicks are ignored; search handoffs queue through applyCurrentPrefill.
  if (isRunning.value) {
    return
  }

  isRunning.value = true
  error.value = ''
  const executionValues = { ...values }
  const executionPrefillRevision = props.prefill?.revision

  try {
    const nextResult = await props.tool.execute(executionValues)

    // A result belongs on screen only while its search handoff is still the latest one.
    if (executionPrefillRevision === props.prefill?.revision) {
      result.value = nextResult
    }
  } catch (caught) {
    // Errors from superseded searches must not replace feedback for the newer input.
    if (executionPrefillRevision === props.prefill?.revision) {
      // Native Error instances retain the most useful parser or validation detail.
      if (caught instanceof Error) {
        error.value = caught.message
      } else {
        // Non-Error throws still need a readable fallback in the workbench.
        error.value = String(caught)
      }
    }
  } finally {
    const shouldRunPendingAutoRun = pendingAutoRun
    pendingAutoRun = false
    isRunning.value = false

    // Multiple automatic triggers received during one run collapse into one execution of the latest value.
    if (shouldRunPendingAutoRun) {
      await runTool()
    }
  }
}

/** Schedules automatic tools after input changes while retaining only the latest pending values. */
function runAutomaticTool(): void {
  // Manual tools require an explicit command because incomplete inputs should not run eagerly.
  if (!props.tool.autoRun) {
    return
  }

  // An active execution must finish before the newest field state can be processed.
  if (isRunning.value) {
    pendingAutoRun = true
    return
  }

  void runTool()
}

watch(() => props.prefill?.revision, applyCurrentPrefill, { immediate: true })
watch(values, runAutomaticTool, { deep: true, immediate: true })

/** Copies one named output and briefly confirms the completed action. */
async function copyOutput(item: ToolOutput, index: number): Promise<void> {
  // Empty output has nothing meaningful to place on the clipboard.
  if (!item.content) {
    return
  }

  await navigator.clipboard.writeText(item.content)
  copiedOutputIndex.value = index
  window.setTimeout(() => {
    // An older timeout must not clear feedback for a more recently copied output.
    if (copiedOutputIndex.value === index) {
      copiedOutputIndex.value = null
    }
  }, 1400)
}

/** Copies one generated value without replacing the whole-output clipboard action. */
async function copyGeneratedItem(
  value: string,
  outputIndex: number,
  itemIndex: number,
): Promise<void> {
  // Empty generated rows should never overwrite useful clipboard content.
  if (!value) {
    return
  }

  const key = generatedItemKey(outputIndex, itemIndex)
  await navigator.clipboard.writeText(value)
  copiedItemKey.value = key
  window.setTimeout(() => {
    // An older timeout must not clear feedback for a more recently copied row.
    if (copiedItemKey.value === key) {
      copiedItemKey.value = ''
    }
  }, 1400)
}

/** Downloads either decoded Base64 bytes or one named textual output. */
function downloadOutput(item: ToolOutput): void {
  // Empty output and missing binary data leave no useful download target.
  if (!item.content && !item.downloadHref) {
    return
  }

  const anchor = document.createElement('a')
  let objectUrl = ''

  // Base64 file decoding already supplies a byte-preserving data URL.
  if (item.downloadHref) {
    anchor.href = item.downloadHref
  } else {
    // Ordinary output is downloaded as a UTF-8 text blob with the declared MIME type.
    const blob = new Blob([item.content], {
      type: item.mimeType ?? 'text/plain;charset=utf-8',
    })
    objectUrl = URL.createObjectURL(blob)
    anchor.href = objectUrl
  }

  anchor.download = item.filename ?? `${props.tool.id}.txt`
  anchor.click()

  // Object URLs hold memory until explicitly released after the synthetic click.
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl)
  }
}

/** Stores the single File selected by a native file input. */
function updateFile(field: ToolField, event: Event): void {
  const input = event.target as HTMLInputElement

  // Clearing the native picker should also clear the reactive field value.
  if (!input.files?.[0]) {
    values[field.key] = null
    return
  }

  values[field.key] = input.files[0]
}

/** Writes a native text or select value into the generic tool field map. */
function updateValue(field: ToolField, event: Event): void {
  const control = event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  let value: ToolValue = control.value

  // Number inputs must remain numeric for calculations and bound validation.
  if (field.type === 'number') {
    value = control.valueAsNumber
  }

  values[field.key] = value
}
</script>

<template>
  <section class="workbench" :aria-label="t('toolWorkspace')">
    <form class="tool-form" @submit.prevent="runTool">
      <div class="field-grid">
        <div
          v-for="field in visibleFields"
          :key="field.key"
          class="field"
          :class="{ 'field--wide': field.wide }"
        >
          <label :for="`${tool.id}-${field.key}`">{{ field.label }}</label>

          <!-- Select fields present bounded option sets without free-form ambiguity. -->
          <select
            v-if="field.type === 'select'"
            :id="`${tool.id}-${field.key}`"
            :value="values[field.key]"
            @change="updateValue(field, $event)"
          >
            <option
              v-for="option in field.options"
              :key="option.value"
              :value="option.value"
            >
              {{ option.label }}
            </option>
          </select>

          <!-- Textareas preserve multiline source formats and code. -->
          <textarea
            v-else-if="field.type === 'textarea'"
            :id="`${tool.id}-${field.key}`"
            :value="values[field.key]"
            :placeholder="field.placeholder"
            rows="10"
            spellcheck="false"
            @input="updateValue(field, $event)"
          />

          <!-- File inputs keep binary data local to the browser. -->
          <input
            v-else-if="field.type === 'file'"
            :id="`${tool.id}-${field.key}`"
            type="file"
            :accept="field.accept"
            @change="updateFile(field, $event)"
          >

          <!-- Number inputs expose native bounds for counts and bases. -->
          <input
            v-else-if="field.type === 'number'"
            :id="`${tool.id}-${field.key}`"
            type="number"
            :value="values[field.key]"
            :placeholder="field.placeholder"
            :min="field.min"
            :max="field.max"
            @input="updateValue(field, $event)"
          >

          <!-- Remaining scalar fields use the exact native text or date input type. -->
          <input
            v-else
            :id="`${tool.id}-${field.key}`"
            :type="field.type"
            :value="values[field.key]"
            :placeholder="field.placeholder"
            spellcheck="false"
            @input="updateValue(field, $event)"
          >
        </div>
      </div>

      <!-- Field-driven tools execute on every edit, so their submit control is unnecessary. -->
      <div v-if="!tool.autoRun" class="action-row">
        <button class="primary-action" type="submit" :disabled="isRunning">
          <!-- Running tools use motion to communicate that the command is still active. -->
          <LoaderCircle v-if="isRunning" :size="17" class="spin" aria-hidden="true" />
          <!-- Idle tools use the conventional play icon for execution. -->
          <Play v-else :size="17" aria-hidden="true" />
          {{ tool.actionLabel }}
        </button>
      </div>
    </form>

    <p v-if="error" class="error-message" role="alert">{{ error }}</p>

    <!-- Audio results use one shared native player and interactive waveform. -->
    <AudioAnalysisViewer
      v-if="result.audio"
      :analysis="result.audio"
      :active="active"
    />

    <div class="output-list">
      <section
        v-for="(item, index) in displayedOutputs"
        :key="`${item.label}-${index}`"
        class="output-panel"
        :aria-label="`${item.label} ${t('result')}`"
      >
        <header class="output-header">
          <div>
            <span class="output-label">{{ item.label }}</span>
            <span class="output-meta">{{ item.content.length.toLocaleString() }} {{ t('chars') }}</span>
          </div>
          <div class="output-actions">
            <button
              type="button"
              class="icon-button"
              :data-tooltip="`${t('copyOutput')}: ${item.label}`"
              :aria-label="`${t('copyOutput')}: ${item.label}`"
              :disabled="!item.content"
              @click="copyOutput(item, index)"
            >
              <!-- Successful copy feedback appears only on the output that was copied. -->
              <Check v-if="copiedOutputIndex === index" :size="17" aria-hidden="true" />
              <!-- Outputs that were not just copied retain the familiar copy symbol. -->
              <Copy v-else :size="17" aria-hidden="true" />
            </button>
            <button
              type="button"
              class="icon-button"
              :data-tooltip="`${t('downloadOutput')}: ${item.label}`"
              :aria-label="`${t('downloadOutput')}: ${item.label}`"
              :disabled="!item.content && !item.downloadHref"
              @click="downloadOutput(item)"
            >
              <Download :size="17" aria-hidden="true" />
            </button>
          </div>
        </header>
        <!-- List results expose each value as a separately copyable row. -->
        <ul v-if="item.items?.length" class="generated-items">
          <li
            v-for="(generatedItem, itemIndex) in item.items"
            :key="`${generatedItem}-${itemIndex}`"
            class="generated-item"
          >
            <div class="generated-item-content">
              <!-- Optional labels identify structured results without changing generator rows. -->
              <span class="generated-item-label">{{ item.itemLabels?.[itemIndex] }}</span>
              <code>{{ generatedItem }}</code>
            </div>
            <button
              type="button"
              class="icon-button generated-item-copy"
              :data-tooltip="t('copyItem')"
              :aria-label="t('copyItemNumber').replace('{number}', String(itemIndex + 1))"
              @click="copyGeneratedItem(generatedItem, index, itemIndex)"
            >
              <!-- Successful feedback appears only on the row that was copied. -->
              <Check
                v-if="copiedItemKey === generatedItemKey(index, itemIndex)"
                :size="16"
                aria-hidden="true"
              />
              <!-- Rows that were not just copied retain the familiar copy symbol. -->
              <Copy v-else :size="16" aria-hidden="true" />
            </button>
          </li>
        </ul>
        <!-- JSON results use a read-only syntax viewer with bracket-range matching. -->
        <JsonCodeViewer
          v-else-if="item.language === 'json' && item.content"
          :content="item.content"
        />
        <!-- Unified diff rows retain text markers while color separates additions and removals. -->
        <pre v-else-if="item.language === 'diff' && item.content" class="diff-output"><code><span
          v-for="(line, lineIndex) in item.content.split('\n')"
          :key="`${lineIndex}-${line}`"
          class="diff-line"
          :class="diffLineClass(line)"
        >{{ line }}</span></code></pre>
        <!-- Non-list results retain the existing multiline code output. -->
        <pre v-else><code>{{ item.content || t('waitExecution') }}</code></pre>
      </section>
    </div>
  </section>
</template>
