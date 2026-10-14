<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'

import AudioAnalysisViewer from './AudioAnalysisViewer.vue'
import JsonCodeViewer from './JsonCodeViewer.vue'
import { desensitizeJson } from '../lib/core'
import { language, t, translateText } from '../lib/i18n'
import type {
  ToolDefinition,
  ToolOutput,
  ToolPrefill,
  ToolResult,
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
let autoRefreshTimer: number | undefined
const copiedOutputIndex = ref<number | null>(null)
const copiedItemKey = ref('')
const diffOutputElements = new Map<number, HTMLPreElement>()

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
      diffOnly: result.value.diffOnly,
      filename: result.value.filename,
      mimeType: result.value.mimeType,
      downloadHref: result.value.downloadHref,
    },
  ]
})

/** Stores an edited result without changing the source fields used to generate it. */
function updateOutputContent(index: number, content: string): void {
  const outputs = result.value.outputs

  // Named output panels update only their matching result entry.
  if (outputs?.length) {
    const target = outputs[index]

    // A stale editor event cannot update an output removed by a newer execution.
    if (!target) {
      return
    }

    target.content = content
    return
  }

  result.value.output = content
}

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

/** Prepares one diff output once so rendering and navigation reuse the same line metadata. */
function prepareDiffOutput(content: string, diffOnly: boolean | undefined): {
  lines: Array<{ content: string, originalIndex: number }>
  changedLines: Array<{ content: string, originalIndex: number }>
  totalLineCount: number
} {
  const allLines = content.split('\n')
  const changedLines = allLines.flatMap((line, originalIndex) => {
    // Context rows are intentionally omitted because only changed content needs navigation markers.
    return line.startsWith('+ ') || line.startsWith('- ') ? [{ content: line, originalIndex }] : []
  })

  // The optional compact mode omits equal context rows while preserving diff markers.
  const lines = diffOnly
    ? changedLines
    : allLines.map((line, originalIndex) => ({ content: line, originalIndex }))

  return { lines, changedLines, totalLineCount: allLines.length }
}

/** Caches presentation data for every displayed output during the current render. */
const preparedDiffOutputs = computed(() => displayedOutputs.value.map((item) => {
  // Non-diff output has no rows or navigation markers to prepare.
  if (item.language !== 'diff') {
    return undefined
  }

  return prepareDiffOutput(item.content, item.diffOnly)
}))

/** Retains each rendered diff scroller so its matching navigation marker can scroll it. */
function setDiffOutputElement(index: number, element: Element | null): void {
  // Vue invokes function refs with null when the corresponding output is removed.
  if (!element) {
    diffOutputElements.delete(index)
    return
  }

  diffOutputElements.set(index, element as HTMLPreElement)
}

/** Scrolls a diff output to the selected changed row without affecting other result panels. */
function scrollToDiffLine(outputIndex: number, lineIndex: number): void {
  const output = diffOutputElements.get(outputIndex)

  // Outputs can disappear after a new execution, so stale marker clicks are ignored.
  if (!output) {
    return
  }

  const line = output.querySelector<HTMLElement>(`[data-diff-line-index="${lineIndex}"]`)

  // The row lookup guards against an output being replaced between click and DOM update.
  if (!line) {
    return
  }

  output.scrollTo({ top: line.offsetTop - output.offsetTop, behavior: 'smooth' })
}

/** Updates the active text comparison display without recalculating its unchanged diff result. */
function setDiffOnly(enabled: boolean): void {
  result.value.diffOnly = enabled
}

/** Builds a stable feedback key for one generated item in one output panel. */
function generatedItemKey(outputIndex: number, itemIndex: number): string {
  return `${outputIndex}-${itemIndex}`
}

/** Executes the current tool and converts thrown values into a visible error state. */
async function runTool(mode: 'normal' | 'desensitize' = 'normal'): Promise<void> {
  // Repeated manual clicks are ignored; search handoffs queue through applyCurrentPrefill.
  if (isRunning.value) {
    return
  }

  isRunning.value = true
  error.value = ''
  const executionValues = { ...values }
  const executionPrefillRevision = props.prefill?.revision

  try {
    let nextResult = await props.tool.execute(executionValues)

    // Desensitization transforms only tools that explicitly produce user-facing JSON.
    if (mode === 'desensitize' && props.tool.supportsJsonDesensitization) {
      nextResult = {
        ...nextResult,
        output: desensitizeJson(nextResult.output),
        language: 'json',
      }
    }

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

/** Stops the active world-clock refresh timer before a tool or tab changes state. */
function clearAutoRefresh(): void {
  // No timer exists until an active tool requests periodic current-time updates.
  if (autoRefreshTimer === undefined) {
    return
  }

  window.clearInterval(autoRefreshTimer)
  autoRefreshTimer = undefined
}

/** Starts periodic execution only for active auto-run tools that declare a refresh interval. */
function syncAutoRefresh(): void {
  clearAutoRefresh()

  const refreshInterval = props.tool.autoRefreshMs

  // Hidden tabs and ordinary manual tools must not consume a periodic browser timer.
  if (!props.active || !props.tool.autoRun || !refreshInterval) {
    return
  }

  autoRefreshTimer = window.setInterval(() => {
    // Current-time output must use the latest field values on every tick.
    void runTool()
  }, refreshInterval)
}

watch(() => props.prefill?.revision, applyCurrentPrefill, { immediate: true })
watch(values, runAutomaticTool, { deep: true, immediate: true })
watch([() => props.active, () => props.tool.autoRefreshMs], syncAutoRefresh, { immediate: true })
onBeforeUnmount(clearAutoRefresh)

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
</script>

<template>
  <section class="workbench" :aria-label="t('toolWorkspace')">
    <UForm :state="values" :loading-auto="false" class="tool-form" @submit="runTool()">
      <div class="field-grid">
        <UFormField
          v-for="field in visibleFields"
          :key="field.key"
          :name="field.key"
          :label="field.label"
          class="min-w-0"
          :class="{ 'field--wide': field.wide }"
        >
          <!-- Select fields constrain values to the tool's declared options. -->
          <USelect
            v-if="field.type === 'select'"
            :model-value="String(values[field.key])"
            :items="field.options ?? []"
            class="w-full"
            @update:model-value="values[field.key] = $event"
          />
          <!-- Multiline source stays intact for parsers, keys, and code tools. -->
          <UTextarea
            v-else-if="field.type === 'textarea'"
            :model-value="String(values[field.key] ?? '')"
            :placeholder="field.placeholder"
            :rows="10"
            spellcheck="false"
            class="w-full"
            :ui="{ base: 'font-mono text-sm' }"
            @update:model-value="values[field.key] = $event"
          />
          <!-- Uploads keep the original File object local for binary and audio tools. -->
          <UFileUpload
            v-else-if="field.type === 'file'"
            :model-value="values[field.key] as File | null"
            :accept="field.accept"
            :label="field.label"
            :file-image="false"
            :aria-label="field.label"
            layout="list"
            class="w-full"
            @update:model-value="values[field.key] = $event"
          />
          <!-- Numeric controls retain native count bounds and emit numbers. -->
          <UInput
            v-else-if="field.type === 'number'"
            :model-value="values[field.key] as number"
            type="number"
            :placeholder="field.placeholder"
            :min="field.min"
            :max="field.max"
            class="w-full"
            @update:model-value="values[field.key] = $event"
          />
          <!-- Remaining fields accept plain text without changing parser semantics. -->
          <UInput
            v-else
            :model-value="String(values[field.key] ?? '')"
            :placeholder="field.placeholder"
            spellcheck="false"
            class="w-full"
            @update:model-value="values[field.key] = $event"
          />
        </UFormField>
      </div>

      <!-- Formatting tools expose desensitization alongside manual execution where supported. -->
      <div v-if="!tool.autoRun || tool.supportsJsonDesensitization" class="action-row">
        <!-- Auto-run tools process field changes without an extra execute button. -->
        <UButton v-if="!tool.autoRun" type="submit" color="primary" icon="i-lucide-play" :loading="isRunning" :label="tool.actionLabel" class="primary-action" />
        <!-- Desensitization is available only on the existing JSON-producing tool contract. -->
        <UButton v-if="tool.supportsJsonDesensitization" color="neutral" variant="outline" icon="i-lucide-shield" :disabled="isRunning" :label="translateText('脱敏')" @click="runTool('desensitize')" />
      </div>
    </UForm>

    <!-- Tool failures stay visible next to the input that produced them. -->
    <UAlert v-if="error" color="error" variant="soft" icon="i-lucide-circle-alert" :description="error" role="alert" />

    <!-- Audio results use one shared native player and interactive waveform. -->
    <AudioAnalysisViewer
      v-if="result.audio"
      :analysis="result.audio"
      :active="active"
    />

    <div class="output-list">
      <UCard
        v-for="(item, index) in displayedOutputs"
        :key="`${item.label}-${index}`"
        as="section"
        class="output-panel"
        :ui="{ header: 'p-3 sm:px-4', body: 'p-0 sm:p-0' }"
        :aria-label="`${item.label} ${t('result')}`"
      >
        <template #header>
          <div class="output-header">
            <div>
              <span class="output-label">{{ item.label }}</span>
              <span class="output-meta">{{ item.content.length.toLocaleString() }} {{ t('chars') }}</span>
            </div>
            <!-- Diff display mode is colocated with its result so toggling never requires another comparison. -->
            <div v-if="item.language === 'diff' && item.content" class="diff-only-toggle">
              <USwitch :model-value="item.diffOnly === true" color="primary" size="sm" :label="translateText('只显示不一样的地方')" @update:model-value="setDiffOnly" />
            </div>
            <div class="output-actions">
              <UTooltip :text="`${t('copyOutput')}: ${item.label}`">
                <!-- A checked icon briefly identifies the output that was copied. -->
                <UButton color="neutral" variant="ghost" size="sm" :icon="copiedOutputIndex === index ? 'i-lucide-check' : 'i-lucide-copy'" :aria-label="`${t('copyOutput')}: ${item.label}`" :disabled="!item.content" @click="copyOutput(item, index)" />
              </UTooltip>
              <UTooltip :text="`${t('downloadOutput')}: ${item.label}`">
                <UButton color="neutral" variant="ghost" size="sm" icon="i-lucide-download" :aria-label="`${t('downloadOutput')}: ${item.label}`" :disabled="!item.content && !item.downloadHref" @click="downloadOutput(item)" />
              </UTooltip>
            </div>
          </div>
        </template>
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
            <UTooltip :text="t('copyItem')">
              <!-- Copied rows show confirmation without changing the generated value. -->
              <UButton color="neutral" variant="ghost" size="sm" :icon="copiedItemKey === generatedItemKey(index, itemIndex) ? 'i-lucide-check' : 'i-lucide-copy'" :aria-label="t('copyItemNumber').replace('{number}', String(itemIndex + 1))" @click="copyGeneratedItem(generatedItem, index, itemIndex)" />
            </UTooltip>
          </li>
        </ul>
        <!-- JSON results stay editable without writing changes back to the source form. -->
        <JsonCodeViewer
          v-else-if="item.language === 'json' && item.content"
          :content="item.content"
          @update:content="updateOutputContent(index, $event)"
        />
        <!-- Unified diff rows retain text markers while color separates additions and removals. -->
        <div v-else-if="item.language === 'diff' && item.content" class="diff-output-wrap">
          <pre :ref="(element) => setDiffOutputElement(index, element)" class="diff-output"><code><span
            v-for="line in preparedDiffOutputs[index]?.lines"
            :key="`${line.originalIndex}-${line.content}`"
            class="diff-line"
            :class="diffLineClass(line.content)"
            :data-diff-line-index="line.originalIndex"
          >{{ line.content }}</span></code></pre>
          <div class="diff-navigation" :aria-label="t('diffNavigation')">
            <button
              v-for="line in preparedDiffOutputs[index]?.changedLines"
              :key="line.originalIndex"
              type="button"
              class="diff-navigation-marker"
              :class="diffLineClass(line.content)"
              :style="{ top: `${((line.originalIndex + 0.5) / preparedDiffOutputs[index]!.totalLineCount) * 100}%` }"
              :aria-label="t('goToDifferenceLine').replace('{number}', String(line.originalIndex + 1))"
              @click="scrollToDiffLine(index, line.originalIndex)"
            />
          </div>
        </div>
        <!-- Non-list results retain the existing multiline code output. -->
        <pre v-else><code>{{ item.content || t('waitExecution') }}</code></pre>
      </UCard>
    </div>
  </section>
</template>
