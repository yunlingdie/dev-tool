<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { Code2, Menu, Search, X } from '@lucide/vue'

import ToolSearchDialog from './components/ToolSearchDialog.vue'
import ToolWorkbench from './components/ToolWorkbench.vue'
import { categories, findTool, tools } from './tools/definitions'
import type { ToolSearchSuggestion } from './tools/search'
import type { ToolDefinition, ToolPrefill } from './tools/types'

const MAX_TOOL_HISTORY = 10

/** Reads the application path from the URL fragment without retaining the hash marker. */
function routePath(): string {
  return window.location.hash.replace(/^#\/?/, '')
}

const selectedTool = ref(findTool(routePath()))
const openedTools = ref<ToolDefinition[]>([selectedTool.value])
const toolPrefills = reactive<Record<string, ToolPrefill>>({})
const searchDialogOpen = ref(false)
const mobileNavigationOpen = ref(false)
let prefillRevision = 0

/** Returns the registered tools belonging to one navigation category. */
function toolsForCategory(categoryId: string): ToolDefinition[] {
  return tools.filter((tool) => tool.category.id === categoryId)
}

/** Adds a tool once while preserving stable history positions and the session limit. */
function rememberTool(tool: ToolDefinition): void {
  const existingIndex = openedTools.value.findIndex((openedTool) => openedTool.id === tool.id)

  // Switching to an opened tool must not move its existing history tab.
  if (existingIndex >= 0) {
    return
  }

  openedTools.value.push(tool)

  // History at or below the limit needs no cache cleanup.
  if (openedTools.value.length <= MAX_TOOL_HISTORY) {
    return
  }

  const expiredTools = openedTools.value.splice(
    0,
    openedTools.value.length - MAX_TOOL_HISTORY,
  )

  for (const expiredTool of expiredTools) {
    delete toolPrefills[expiredTool.id]
  }
}

/** Closes one history tab, clears its state, and selects the nearest remaining tool. */
async function closeHistoryTool(tool: ToolDefinition): Promise<void> {
  const closingIndex = openedTools.value.findIndex((openedTool) => openedTool.id === tool.id)

  // A stale close event must not remove an unrelated history entry.
  if (closingIndex < 0) {
    return
  }

  const wasSelected = selectedTool.value.id === tool.id
  openedTools.value.splice(closingIndex, 1)
  delete toolPrefills[tool.id]

  // Closing a background tab must leave the active workbench and URL untouched.
  if (!wasSelected) {
    return
  }

  // The same index selects the right neighbor, while the final index falls back to the left.
  if (openedTools.value.length > 0) {
    const replacementIndex = Math.min(closingIndex, openedTools.value.length - 1)
    selectTool(openedTools.value[replacementIndex])
    return
  }

  // Let Vue unmount the final workbench before reopening the clean default tool.
  await nextTick()
  selectTool(findTool(''))
}

/** Selects a tool, updates the shareable URL, and closes the mobile drawer. */
function selectTool(tool: ToolDefinition): void {
  selectedTool.value = tool
  rememberTool(tool)
  mobileNavigationOpen.value = false

  // The URL only needs replacing when navigation selects a different fragment.
  if (routePath() !== tool.id) {
    window.history.replaceState(null, '', `#/${tool.id}`)
  }
}

/** Opens the global tool search while releasing the small-screen navigation drawer. */
function openToolSearch(): void {
  mobileNavigationOpen.value = false
  searchDialogOpen.value = true
}

/** Closes the global tool search from any native or explicit close action. */
function closeToolSearch(): void {
  searchDialogOpen.value = false
}

/** Activates a search result and sends the untouched value to its declared input field. */
function selectSearchSuggestion(suggestion: ToolSearchSuggestion): void {
  // Generators and option-only tools can be opened without receiving incompatible text.
  if (suggestion.fieldKey) {
    prefillRevision += 1
    toolPrefills[suggestion.tool.id] = {
      fieldKey: suggestion.fieldKey,
      value: suggestion.value,
      revision: prefillRevision,
      // Detected content is actionable; ordinary title queries should not execute as source data.
      autoRun: suggestion.kind === 'content',
      presetValues: suggestion.presetValues,
    }
  }

  searchDialogOpen.value = false
  selectTool(suggestion.tool)
}

/** Synchronizes browser fragment navigation with the active tool. */
function handleHashChange(): void {
  const tool = findTool(routePath())
  selectedTool.value = tool
  rememberTool(tool)

  // Removed or unknown routes must expose the actual fallback tool in the URL.
  if (routePath() !== tool.id) {
    window.history.replaceState(null, '', `#/${tool.id}`)
  }
}

/** Registers the only global listener used by the single-page router. */
onMounted(() => {
  window.addEventListener('hashchange', handleHashChange)

  // Bare, removed, and unknown routes resolve to the selected fallback tool.
  if (routePath() !== selectedTool.value.id) {
    window.history.replaceState(null, '', `#/${selectedTool.value.id}`)
  }
})

/** Releases the global fragment listener when the app is unmounted. */
onBeforeUnmount(() => {
  window.removeEventListener('hashchange', handleHashChange)
})
</script>

<template>
  <div class="app-shell">
    <!-- The backdrop exists only while the small-screen navigation drawer is open. -->
    <button
      v-if="mobileNavigationOpen"
      class="navigation-backdrop"
      type="button"
      aria-label="关闭导航"
      @click="mobileNavigationOpen = false"
    />

    <aside class="sidebar" :class="{ 'sidebar--open': mobileNavigationOpen }">
      <div class="brand-row">
        <div class="brand-mark" aria-hidden="true"><Code2 :size="19" /></div>
        <div>
          <strong>Dev Toolbox</strong>
          <span>{{ tools.length }} 个本地工具</span>
        </div>
        <button
          type="button"
          class="sidebar-close icon-button"
          aria-label="关闭导航"
          data-tooltip="关闭导航"
          @click="mobileNavigationOpen = false"
        >
          <X :size="18" aria-hidden="true" />
        </button>
      </div>

      <!-- Tool search opens a content-aware command dialog. -->
      <button
        type="button"
        class="search-trigger"
        @click="openToolSearch"
      >
        <Search :size="16" aria-hidden="true" />
        <span>搜索工具</span>
      </button>

      <nav class="tool-navigation" aria-label="开发工具">
        <section v-for="category in categories" :key="category.id" class="nav-section">
          <h2>{{ category.label }}</h2>
          <button
            v-for="tool in toolsForCategory(category.id)"
            :key="tool.id"
            type="button"
            class="tool-link"
            :class="{ 'tool-link--active': selectedTool.id === tool.id }"
            :aria-current="selectedTool.id === tool.id ? 'page' : undefined"
            @click="selectTool(tool)"
          >
            <component :is="tool.icon" :size="16" aria-hidden="true" />
            <span>{{ tool.title }}</span>
          </button>
        </section>
      </nav>
    </aside>

    <main class="main-area">
      <header class="tool-header">
        <button
          type="button"
          class="mobile-menu icon-button"
          aria-label="打开导航"
          data-tooltip="导航"
          @click="mobileNavigationOpen = true"
        >
          <Menu :size="19" aria-hidden="true" />
        </button>

        <div class="tool-heading">
          <span>{{ selectedTool.category.label }}</span>
          <h1>{{ selectedTool.title }}</h1>
        </div>

        <div class="local-status"><span aria-hidden="true" />本地处理</div>
      </header>

      <!-- Bounded session history keeps stable tabs directly reachable and individually closeable. -->
      <nav class="tool-history" aria-label="工具历史">
        <span class="tool-history-label">历史</span>
        <div class="tool-history-items">
          <div
            v-for="tool in openedTools"
            :key="tool.id"
            class="tool-history-item"
            :class="{ 'tool-history-item--active': selectedTool.id === tool.id }"
          >
            <button
              type="button"
              class="tool-history-select"
              :aria-current="selectedTool.id === tool.id ? 'page' : undefined"
              @click="selectTool(tool)"
            >
              <component :is="tool.icon" :size="14" aria-hidden="true" />
              <span>{{ tool.title }}</span>
            </button>
            <button
              type="button"
              class="tool-history-close"
              :aria-label="`关闭 ${tool.title}`"
              :data-tooltip="`关闭 ${tool.title}`"
              @click="closeHistoryTool(tool)"
            >
              <X :size="13" aria-hidden="true" />
            </button>
          </div>
        </div>
      </nav>

      <div class="content-frame">
        <!-- Open workbenches stay mounted for state preservation; closing a tab unmounts its state. -->
        <ToolWorkbench
          v-for="tool in openedTools"
          v-show="selectedTool.id === tool.id"
          :key="tool.id"
          :tool="tool"
          :prefill="toolPrefills[tool.id]"
        />
      </div>
    </main>

    <ToolSearchDialog
      :open="searchDialogOpen"
      @close="closeToolSearch"
      @select="selectSearchSuggestion"
    />
  </div>
</template>
