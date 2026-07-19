<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { ArrowRight, Search, X } from '@lucide/vue'

import { getToolSearchSuggestions } from '../tools/search'
import type { ToolSearchSuggestion } from '../tools/search'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  close: []
  select: [suggestion: ToolSearchSuggestion]
}>()

const dialogElement = ref<HTMLDialogElement | null>(null)
const searchInput = ref<HTMLTextAreaElement | null>(null)
const query = ref('')
const activeSuggestionIndex = ref(0)

/** Produces content-aware actions or ordinary catalog matches for the current value. */
const suggestions = computed(() => getToolSearchSuggestions(query.value))

/** Labels the result mode without exposing implementation details in the dialog. */
const resultLabel = computed(() => {
  // Blank search is a browsable catalog rather than a filtered result set.
  if (!query.value.trim()) {
    return '全部工具'
  }

  // Content matches are actions inferred from the pasted value.
  if (suggestions.value[0]?.kind === 'content') {
    return '建议操作'
  }

  return '搜索结果'
})

/** Exposes the highlighted option to assistive technology while results exist. */
const activeSuggestionId = computed(() => {
  // Empty results have no valid descendant for the search control to reference.
  if (!suggestions.value.length) {
    return undefined
  }

  return `tool-search-option-${activeSuggestionIndex.value}`
})

/** Scrolls the keyboard-highlighted option into the visible result viewport. */
async function revealActiveSuggestion(): Promise<void> {
  await nextTick()
  const option = document.getElementById(`tool-search-option-${activeSuggestionIndex.value}`)

  // Closed dialogs and empty results do not render an option to reveal.
  if (!option) {
    return
  }

  option.scrollIntoView({ block: 'nearest' })
}

/** Resets keyboard selection whenever the user changes the search value. */
async function resetActiveSuggestion(): Promise<void> {
  activeSuggestionIndex.value = 0
  await revealActiveSuggestion()
}

watch(query, resetActiveSuggestion)

/** Synchronizes the native modal with its parent-controlled open state. */
async function syncDialogState(isOpen: boolean): Promise<void> {
  await nextTick()
  const dialog = dialogElement.value

  // The post-render watcher may run once before the dialog ref is available.
  if (!dialog) {
    return
  }

  // Every new search starts clean and places focus in the multiline search field.
  if (isOpen) {
    query.value = ''
    activeSuggestionIndex.value = 0

    // showModal throws when called on an already-open dialog.
    if (!dialog.open) {
      dialog.showModal()
    }

    await revealActiveSuggestion()
    searchInput.value?.focus()
    return
  }

  // Parent closure must also release the browser's modal focus trap.
  if (dialog.open) {
    dialog.close()
  }
}

watch(() => props.open, syncDialogState, { immediate: true, flush: 'post' })

/** Requests parent closure after Escape or the native dialog close action. */
function handleDialogClose(): void {
  emit('close')
}

/** Requests closure from the explicit icon button. */
function requestClose(): void {
  emit('close')
}

/** Closes only when the click lands on the dialog surface outside its content panel. */
function closeFromBackdrop(event: MouseEvent): void {
  // Clicks inside the panel bubble through the dialog and must leave it open.
  if (event.target !== event.currentTarget) {
    return
  }

  emit('close')
}

/** Moves the active option through the current suggestions with wraparound. */
async function moveSelection(step: number): Promise<void> {
  const count = suggestions.value.length

  // Empty results have no valid keyboard destination.
  if (!count) {
    return
  }

  activeSuggestionIndex.value = (activeSuggestionIndex.value + step + count) % count
  await revealActiveSuggestion()
}

/** Moves search selection with arrow keys only after any IME composition has finished. */
async function handleSearchArrow(event: KeyboardEvent, step: number): Promise<void> {
  // Arrow keys belong to the Chinese IME candidate list while text composition is active.
  if (event.isComposing) {
    return
  }

  event.preventDefault()
  await moveSelection(step)
}

/** Opens the option currently highlighted by keyboard navigation. */
function chooseActiveSuggestion(): void {
  const suggestion = suggestions.value[activeSuggestionIndex.value]

  // Enter does nothing when the current query has no matches.
  if (!suggestion) {
    return
  }

  chooseSuggestion(suggestion)
}

/** Selects the highlighted tool on Enter without intercepting an active IME composition. */
function handleSearchEnter(event: KeyboardEvent): void {
  // Enter confirms the current Chinese IME candidate before it should activate a tool.
  if (event.isComposing) {
    return
  }

  event.preventDefault()
  chooseActiveSuggestion()
}

/** Emits one selected tool together with its untouched search value and target field. */
function chooseSuggestion(suggestion: ToolSearchSuggestion): void {
  emit('select', suggestion)
}
</script>

<template>
  <dialog
    ref="dialogElement"
    class="tool-search-dialog"
    aria-labelledby="tool-search-title"
    @close="handleDialogClose"
    @click="closeFromBackdrop"
  >
    <section class="tool-search-panel">
      <header class="tool-search-header">
        <div>
          <span>快速打开</span>
          <h2 id="tool-search-title">搜索工具</h2>
        </div>
        <button
          type="button"
          class="icon-button"
          aria-label="关闭搜索"
          data-tooltip="关闭搜索"
          @click="requestClose"
        >
          <X :size="18" aria-hidden="true" />
        </button>
      </header>

      <label class="tool-search-input">
        <Search :size="18" aria-hidden="true" />
        <span class="sr-only">搜索工具或输入待处理内容</span>
        <textarea
          ref="searchInput"
          v-model="query"
          rows="3"
          placeholder="搜索工具或粘贴内容"
          autocomplete="off"
          spellcheck="false"
          aria-controls="tool-search-results"
          :aria-activedescendant="activeSuggestionId"
          @keydown.down="handleSearchArrow($event, 1)"
          @keydown.up="handleSearchArrow($event, -1)"
          @keydown.enter.exact="handleSearchEnter"
        />
      </label>

      <div class="tool-search-result-header">
        <span>{{ resultLabel }}</span>
        <span>{{ suggestions.length }}</span>
      </div>

      <!-- Matching tools stay in one compact command list for mouse and keyboard selection. -->
      <div
        v-if="suggestions.length"
        id="tool-search-results"
        class="tool-search-results"
        role="listbox"
      >
        <button
          v-for="(suggestion, index) in suggestions"
          :id="`tool-search-option-${index}`"
          :key="suggestion.tool.id"
          type="button"
          class="tool-search-result"
          :class="{ 'tool-search-result--active': activeSuggestionIndex === index }"
          role="option"
          :aria-selected="activeSuggestionIndex === index"
          @mouseenter="activeSuggestionIndex = index"
          @click="chooseSuggestion(suggestion)"
        >
          <span class="tool-search-result-icon">
            <component :is="suggestion.tool.icon" :size="17" aria-hidden="true" />
          </span>
          <span class="tool-search-result-copy">
            <strong>{{ suggestion.tool.title }}</strong>
            <small>{{ suggestion.reason }}</small>
          </span>
          <ArrowRight :size="16" aria-hidden="true" />
        </button>
      </div>

      <!-- Empty feedback occupies the same stable result area as populated searches. -->
      <p v-else class="tool-search-empty">没有匹配的工具</p>
    </section>
  </dialog>
</template>
