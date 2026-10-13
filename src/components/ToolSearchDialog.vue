<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { language, localizeTool, t, translateText } from '../lib/i18n'
import { getToolSearchSuggestions } from '../tools/search'
import type { ToolSearchSuggestion } from '../tools/search'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{
  close: []
  select: [suggestion: ToolSearchSuggestion]
}>()
const query = ref('')
const activeIndex = ref(0)

/** Preserves content recognition and catalog filtering for the complete multiline query. */
const suggestions = computed(() => getToolSearchSuggestions(query.value))

/** Labels catalog browsing, recognized content actions, and ordinary filtered searches. */
const resultLabel = computed(() => {
  // An empty query shows the complete catalog.
  if (!query.value.trim()) {
    return t('allTools')
  }
  // Recognized content carries actionable tool handoffs.
  if (suggestions.value[0]?.kind === 'content') {
    return t('suggestedActions')
  }
  return t('searchResults')
})

/** Publishes a selected tool and leaves navigation and content handoff to the shell. */
function chooseSuggestion(index: number): void {
  const suggestion = suggestions.value[index]
  // Empty search results have no command to execute.
  if (suggestion) {
    emit('select', suggestion)
  }
}

/** Keeps the active command visible when the keyboard moves through a long result list. */
async function scrollToActive(): Promise<void> {
  await nextTick()
  document.getElementById(`tool-search-option-${activeIndex.value}`)?.scrollIntoView({ block: 'nearest' })
}

/** Navigates commands while Shift+Enter retains multiline source entry. */
function handleSearchKey(event: KeyboardEvent): void {
  // Arrow navigation applies only when a command is available.
  if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && suggestions.value.length) {
    event.preventDefault()
    // Down advances and up moves backward, wrapping within the current results.
    const direction = event.key === 'ArrowDown' ? 1 : -1
    activeIndex.value = (activeIndex.value + direction + suggestions.value.length) % suggestions.value.length
    void scrollToActive()
  } else if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    // Enter executes the highlighted command; composition and Shift+Enter keep editing text.
    event.preventDefault()
    chooseSuggestion(activeIndex.value)
  }
}

/** Resets the query only when a new search session opens. */
watch(() => props.open, (isOpen) => {
  // Closing preserves departing content during the modal animation.
  if (isOpen) {
    query.value = ''
    activeIndex.value = 0
  }
})

/** New results start at the first command so a prior index cannot select a different tool. */
watch(suggestions, () => {
  activeIndex.value = 0
})
</script>

<template>
  <UModal :open="open" :title="t('searchTools')" :description="t('quickOpen')" :close="{ 'aria-label': t('closeSearch') }" :ui="{ content: 'max-w-2xl', body: 'p-0 sm:p-0' }" @update:open="emit('close')">
    <template #body>
      <div class="p-4">
        <UTextarea
          v-model="query"
          :placeholder="t('searchToolsOrPaste')"
          :aria-label="t('searchToolsOrPaste')"
          :aria-activedescendant="`tool-search-option-${activeIndex}`"
          aria-controls="tool-search-results"
          aria-autocomplete="list"
          :rows="3"
          autofocus
          spellcheck="false"
          class="w-full"
          @keydown="handleSearchKey"
        />
      </div>
      <div class="flex items-center justify-between border-y border-default px-4 py-2 text-xs text-muted">
        <span>{{ resultLabel }}</span>
        <UBadge color="neutral" variant="soft" size="sm">{{ suggestions.length }}</UBadge>
      </div>
      <div id="tool-search-results" role="listbox" :aria-label="resultLabel" class="max-h-[45vh] overflow-y-auto p-2">
        <UButton
          v-for="(suggestion, index) in suggestions"
          :id="`tool-search-option-${index}`"
          :key="suggestion.tool.id"
          role="option"
          :aria-selected="activeIndex === index"
          :tabindex="-1"
          color="neutral"
          variant="ghost"
          class="w-full justify-start p-3"
          :class="{ 'bg-primary/10': activeIndex === index }"
          @pointermove="activeIndex = index"
          @click="chooseSuggestion(index)"
        >
          <component :is="suggestion.tool.icon" :size="18" aria-hidden="true" class="shrink-0" />
          <span class="min-w-0 flex-1 text-left">
            <span class="block truncate font-medium">{{ localizeTool(suggestion.tool, language).title }}</span>
            <span class="block truncate text-xs text-muted">{{ translateText(suggestion.reason, language) }}</span>
          </span>
          <UIcon name="i-lucide-arrow-right" class="size-4 shrink-0 text-dimmed" />
        </UButton>
        <!-- An empty result set needs persistent feedback instead of an inert command list. -->
        <p v-if="!suggestions.length" class="p-8 text-center text-sm text-muted">{{ t('noMatchingTools') }}</p>
      </div>
    </template>
  </UModal>
</template>
