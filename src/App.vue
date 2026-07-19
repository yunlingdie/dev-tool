<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { BookOpenText, Code2, Menu, Search, Wrench, X } from '@lucide/vue'

import DocumentsView from './components/DocumentsView.vue'
import ToolSearchDialog from './components/ToolSearchDialog.vue'
import ToolWorkbench from './components/ToolWorkbench.vue'
import { documents } from './docs/definitions'
import { categories, findTool, tools } from './tools/definitions'
import type { ToolSearchSuggestion } from './tools/search'
import type { ToolDefinition, ToolPrefill } from './tools/types'

type AppSection = 'tools' | 'documents'

const DOCUMENTS_ROUTE = 'docs'

/** Reads the application path from the URL fragment without retaining the hash marker. */
function routePath(): string {
  return window.location.hash.replace(/^#\/?/, '')
}

/** Maps the reserved document route to its workspace while preserving all tool routes. */
function sectionForRoute(path: string): AppSection {
  // Only the exact reserved path should leave the existing tool workspace.
  if (path === DOCUMENTS_ROUTE) {
    return 'documents'
  }

  return 'tools'
}

const initialRoutePath = routePath()
const activeSection = ref<AppSection>(sectionForRoute(initialRoutePath))
let initialToolId = initialRoutePath

// The document route should retain the deterministic default tool for a later workspace switch.
if (activeSection.value === 'documents') {
  initialToolId = ''
}

const selectedTool = ref(findTool(initialToolId))
const openedTools = ref<ToolDefinition[]>([selectedTool.value])
const toolPrefills = reactive<Record<string, ToolPrefill>>({})
const searchDialogOpen = ref(false)
const mobileNavigationOpen = ref(false)
let prefillRevision = 0

/** Returns the registered tools belonging to one navigation category. */
function toolsForCategory(categoryId: string): ToolDefinition[] {
  return tools.filter((tool) => tool.category.id === categoryId)
}

/** Adds a tool to the session history once while preserving first-open order. */
function rememberTool(tool: ToolDefinition): void {
  // Reopening a tool should activate its existing workbench instead of duplicating history.
  if (openedTools.value.some((openedTool) => openedTool.id === tool.id)) {
    return
  }

  openedTools.value.push(tool)
}

/** Selects a tool, updates the shareable URL, and closes the mobile drawer. */
function selectTool(tool: ToolDefinition): void {
  activeSection.value = 'tools'
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
    }
  }

  searchDialogOpen.value = false
  selectTool(suggestion.tool)
}

/** Switches between the independent tool and document workspaces. */
function selectSection(section: AppSection): void {
  activeSection.value = section
  mobileNavigationOpen.value = false
  let targetPath = selectedTool.value.id

  // The document workspace currently has one stable top-level route.
  if (section === 'documents') {
    targetPath = DOCUMENTS_ROUTE
  }

  // Replacing only changed fragments avoids redundant browser history mutations.
  if (routePath() !== targetPath) {
    window.history.replaceState(null, '', `#/${targetPath}`)
  }
}

/** Synchronizes browser fragment navigation with the active tool. */
function handleHashChange(): void {
  const path = routePath()
  activeSection.value = sectionForRoute(path)

  // Document navigation must not overwrite the tool remembered for returning users.
  if (activeSection.value === 'tools') {
    const tool = findTool(path)
    selectedTool.value = tool
    rememberTool(tool)
  }
}

/** Registers the only global listener used by the single-page router. */
onMounted(() => {
  window.addEventListener('hashchange', handleHashChange)

  // A bare initial URL receives a deterministic tool fragment for refresh and sharing.
  if (!routePath()) {
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

      <!-- Active styling makes the two independent workspaces explicit. -->
      <nav class="workspace-switcher" aria-label="工作区">
        <button
          type="button"
          class="workspace-switch"
          :class="{ 'workspace-switch--active': activeSection === 'tools' }"
          :aria-pressed="activeSection === 'tools'"
          @click="selectSection('tools')"
        >
          <Wrench :size="15" aria-hidden="true" />
          <span>工具</span>
          <span class="workspace-count">{{ tools.length }}</span>
        </button>
        <button
          type="button"
          class="workspace-switch"
          :class="{ 'workspace-switch--active': activeSection === 'documents' }"
          :aria-pressed="activeSection === 'documents'"
          @click="selectSection('documents')"
        >
          <BookOpenText :size="15" aria-hidden="true" />
          <span>文档</span>
          <span class="workspace-count">{{ documents.length }}</span>
        </button>
      </nav>

      <!-- Tool search opens a content-aware command dialog from the tool workspace. -->
      <button
        v-if="activeSection === 'tools'"
        type="button"
        class="search-trigger"
        @click="openToolSearch"
      >
        <Search :size="16" aria-hidden="true" />
        <span>搜索工具</span>
      </button>

      <!-- Tool categories never mix with the independent document registry. -->
      <nav v-if="activeSection === 'tools'" class="tool-navigation" aria-label="开发工具">
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

      <!-- The document sidebar stays intentionally minimal until real content exists. -->
      <div v-else class="document-sidebar-summary">
        <BookOpenText :size="19" aria-hidden="true" />
        <strong>文档</strong>
        <span>{{ documents.length }} 篇</span>
      </div>
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

        <!-- Tool routes retain their existing category and title heading. -->
        <div v-if="activeSection === 'tools'" class="tool-heading">
          <span>{{ selectedTool.category.label }}</span>
          <h1>{{ selectedTool.title }}</h1>
        </div>

        <!-- The document route has a heading independent from tool definitions. -->
        <div v-else class="tool-heading">
          <span>文档库</span>
          <h1>文档</h1>
        </div>

        <!-- Tool processing status applies only to executable tools. -->
        <div v-if="activeSection === 'tools'" class="local-status"><span aria-hidden="true" />本地处理</div>

        <!-- Document status reports registry size without implying tool execution. -->
        <div v-else class="local-status document-status"><BookOpenText :size="14" aria-hidden="true" />{{ documents.length }} 篇</div>
      </header>

      <!-- Session history keeps every opened workbench directly reachable without resetting it. -->
      <nav v-if="activeSection === 'tools'" class="tool-history" aria-label="工具历史">
        <span class="tool-history-label">历史</span>
        <div class="tool-history-items">
          <button
            v-for="tool in openedTools"
            :key="tool.id"
            type="button"
            class="tool-history-item"
            :class="{ 'tool-history-item--active': selectedTool.id === tool.id }"
            :aria-current="selectedTool.id === tool.id ? 'page' : undefined"
            @click="selectTool(tool)"
          >
            <component :is="tool.icon" :size="14" aria-hidden="true" />
            <span>{{ tool.title }}</span>
          </button>
        </div>
      </nav>

      <div class="content-frame">
        <!-- Keyed workbenches stay cached so each history entry retains form and result state. -->
        <KeepAlive>
          <ToolWorkbench
            v-if="activeSection === 'tools'"
            :key="selectedTool.id"
            :tool="selectedTool"
            :prefill="toolPrefills[selectedTool.id]"
          />
        </KeepAlive>

        <!-- Documents use their own filter and rendering surface. -->
        <DocumentsView v-if="activeSection === 'documents'" :documents="documents" />
      </div>
    </main>

    <ToolSearchDialog
      :open="searchDialogOpen"
      @close="closeToolSearch"
      @select="selectSearchSuggestion"
    />
  </div>
</template>
