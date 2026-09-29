<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  Combobox,
  ComboboxInput,
  ComboboxOption,
  ComboboxOptions,
  Dialog,
  DialogPanel,
  DialogTitle,
  TransitionChild,
  TransitionRoot,
} from '@headlessui/vue'
import { ArrowRight, Search, X } from '@lucide/vue'

import { language, localizeTool, t, translateText } from '../lib/i18n'
import { getToolSearchSuggestions } from '../tools/search'
import type { ToolSearchSuggestion } from '../tools/search'
import type { ToolDefinition } from '../tools/types'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  close: []
  select: [suggestion: ToolSearchSuggestion]
}>()

const query = ref('')

/** Returns the localized display definition for one search suggestion. */
function displaySuggestionTool(suggestion: ToolSearchSuggestion): ToolDefinition {
  return localizeTool(suggestion.tool, language.value)
}

/** Returns a localized explanation for one content-aware or catalog search result. */
function displaySuggestionReason(suggestion: ToolSearchSuggestion): string {
  return translateText(suggestion.reason, language.value)
}

/** Produces content-aware actions or ordinary catalog matches for the current value. */
const suggestions = computed(() => getToolSearchSuggestions(query.value))

/** Labels the result mode without exposing implementation details in the dialog. */
const resultLabel = computed(() => {
  // Blank search is a browsable catalog rather than a filtered result set.
  if (!query.value.trim()) {
    return t('allTools')
  }

  // Content matches are actions inferred from the pasted value.
  if (suggestions.value[0]?.kind === 'content') {
    return t('suggestedActions')
  }

  return t('searchResults')
})

/** Keeps the search field synchronized with the unmodified text typed or pasted by the user. */
function updateQuery(event: Event): void {
  query.value = (event.target as HTMLTextAreaElement).value
}

/** Requests parent closure from the Headless UI dialog dismissal action. */
function requestClose(): void {
  emit('close')
}

/** Publishes the selected command and leaves route and prefill handling to the application shell. */
function chooseSuggestion(suggestion: ToolSearchSuggestion | null): void {
  // Combobox nullable state has no actionable tool to publish.
  if (!suggestion) {
    return
  }

  emit('select', suggestion)
}

/** Clears previous search text each time a new command dialog session starts. */
function resetSearch(isOpen: boolean): void {
  // Closing is animated in place and should not mutate the departing result list.
  if (!isOpen) {
    return
  }

  query.value = ''
}

watch(() => props.open, resetSearch)
</script>

<template>
  <TransitionRoot appear :show="open" as="template">
    <Dialog class="tool-search-dialog" @close="requestClose">
      <TransitionChild
        as="template"
        enter="tool-search-backdrop-transition"
        enter-from="tool-search-backdrop-hidden"
        leave="tool-search-backdrop-transition"
        leave-to="tool-search-backdrop-hidden"
      >
        <div class="tool-search-backdrop" aria-hidden="true" />
      </TransitionChild>

      <div class="tool-search-positioner">
        <TransitionChild
          as="template"
          enter="tool-search-panel-transition"
          enter-from="tool-search-panel-hidden"
          leave="tool-search-panel-transition"
          leave-to="tool-search-panel-hidden"
        >
          <DialogPanel class="tool-search-panel">
            <Combobox
              :model-value="null"
              nullable
              @update:model-value="chooseSuggestion"
            >
              <header class="tool-search-header">
                <div>
                  <span>{{ t('quickOpen') }}</span>
                  <DialogTitle id="tool-search-title">{{ t('searchTools') }}</DialogTitle>
                </div>
                <button
                  type="button"
                  class="icon-button"
                  :aria-label="t('closeSearch')"
                  :data-tooltip="t('closeSearch')"
                  @click="requestClose"
                >
                  <X :size="18" aria-hidden="true" />
                </button>
              </header>

              <label class="tool-search-input">
                <Search :size="18" aria-hidden="true" />
                <span class="sr-only">{{ t('searchToolsOrPaste') }}</span>
                <ComboboxInput
                  as="textarea"
                  rows="3"
                  :placeholder="t('searchToolsOrPaste')"
                  autocomplete="off"
                  spellcheck="false"
                  autofocus
                  @change="updateQuery"
                />
              </label>

              <div class="tool-search-result-header">
                <span>{{ resultLabel }}</span>
                <span>{{ suggestions.length }}</span>
              </div>

              <!-- Headless UI owns active-option focus while the existing command layout remains unchanged. -->
              <ComboboxOptions
                v-if="suggestions.length"
                id="tool-search-results"
                static
                class="tool-search-results"
              >
                <ComboboxOption
                  v-for="suggestion in suggestions"
                  :key="suggestion.tool.id"
                  v-slot="{ active }"
                  :value="suggestion"
                  as="template"
                >
                  <li
                    class="tool-search-result"
                    :class="{ 'tool-search-result--active': active }"
                  >
                    <span class="tool-search-result-icon">
                      <component :is="displaySuggestionTool(suggestion).icon" :size="17" aria-hidden="true" />
                    </span>
                    <span class="tool-search-result-copy">
                      <strong>{{ displaySuggestionTool(suggestion).title }}</strong>
                      <small>{{ displaySuggestionReason(suggestion) }}</small>
                    </span>
                    <ArrowRight :size="16" aria-hidden="true" />
                  </li>
                </ComboboxOption>
              </ComboboxOptions>

              <!-- Empty feedback occupies the same stable result area as populated searches. -->
              <p v-else class="tool-search-empty">{{ t('noMatchingTools') }}</p>
            </Combobox>
          </DialogPanel>
        </TransitionChild>
      </div>
    </Dialog>
  </TransitionRoot>
</template>
