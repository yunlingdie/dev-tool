<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { en, zh_cn } from '@nuxt/ui/locale'

import DrawingPalette from './components/DrawingPalette.vue'
import DrawingWorkbench from './components/DrawingWorkbench.vue'
import ToolSearchDialog from './components/ToolSearchDialog.vue'
import ToolWorkbench from './components/ToolWorkbench.vue'
import { language, localizeTool, setLanguage, t, translateCategory } from './lib/i18n'
import { categories, findTool, tools } from './tools/definitions'
import type { DrawingToolId } from './tools/drawing'
import type { ToolSearchSuggestion } from './tools/search'
import type { ToolDefinition, ToolPrefill } from './tools/types'

const MAX_TOOL_HISTORY = 10
const THEME_STORAGE_KEY = 'dev-tool-theme'
type AppScene = 'tools' | 'drawing'
type ColorTheme = 'light' | 'dark'

/** Restores the explicit theme choice while keeping the light design as the default. */
function initialTheme(): ColorTheme {
  // Only the persisted dark value changes the default daytime presentation.
  if (window.localStorage.getItem(THEME_STORAGE_KEY) === 'dark') {
    return 'dark'
  }

  return 'light'
}

/** Reads the application path from the URL fragment without retaining the hash marker. */
function routePath(): string {
  return window.location.hash.replace(/^#\/?/, '')
}

/** Resolves the dedicated drawing route without changing existing tool routes. */
function initialScene(): AppScene {
  // The drawing route is the only fragment that belongs to the second application scene.
  if (routePath() === 'drawing') {
    return 'drawing'
  }

  return 'tools'
}

const selectedTool = ref(findTool(routePath()))
const openedTools = ref<ToolDefinition[]>([selectedTool.value])
const toolPrefills = reactive<Record<string, ToolPrefill>>({})
const searchDialogOpen = ref(false)
const mobileNavigationOpen = ref(false)
const activeScene = ref<AppScene>(initialScene())
const colorTheme = ref<ColorTheme>(initialTheme())
const drawingWorkbench = ref<{ placeTool: (toolId: DrawingToolId) => void } | null>(null)
let prefillRevision = 0

/** Applies the selected palette to the document and persists it across reloads. */
function applyColorTheme(nextTheme: ColorTheme): void {
  document.documentElement.dataset.theme = nextTheme
  document.documentElement.classList.toggle('dark', nextTheme === 'dark')
  window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme)
}

watch(colorTheme, applyColorTheme, { immediate: true })

/** Converts the Nuxt UI switch state into the application's named theme. */
function setNightMode(enabled: boolean): void {
  // Checked means the user explicitly requested the darker palette.
  if (enabled) {
    colorTheme.value = 'dark'
    return
  }

  colorTheme.value = 'light'
}

/** Describes the action performed by the theme switch in the current state. */
const themeToggleLabel = computed(() => {
  // Night mode exposes the inverse action so assistive text stays actionable.
  if (colorTheme.value === 'dark') {
    return t('switchToLight')
  }

  return t('switchToDark')
})

const sceneLabels = computed(() => {
  // Drawing navigation follows the same language choice as the rest of the toolbox.
  if (language.value === 'en') {
    return {
      tools: 'Developer tools',
      drawing: 'Drawing tool',
      drawingCategory: 'Canvas',
      drawingTitle: 'Drawing tool',
    }
  }

  return {
    tools: '开发工具',
    drawing: '绘图工具',
    drawingCategory: '画布',
    drawingTitle: '绘图工具',
  }
})

/** Builds the scene choices from the same localized labels shown in the page header. */
const sceneOptions = computed(() => [
  { value: 'tools', label: sceneLabels.value.tools },
  { value: 'drawing', label: sceneLabels.value.drawing },
])

/** Builds the website-language choices from the shared translation catalog. */
const languageOptions = computed(() => [
  { value: 'zh', label: t('chinese') },
  { value: 'en', label: t('english') },
])

const localizedCategories = computed(() => categories.map((category) => ({
  ...category,
  label: translateCategory(category, language.value),
})))

/** Describes whether the active workspace keeps processing local or queries a remote service. */
const processingStatus = computed(() => {
  // Network-backed tools must disclose that their entered value leaves the browser.
  if (activeScene.value === 'tools' && selectedTool.value.requiresNetwork) {
    return t('networkRequest')
  }

  return t('localProcessing')
})

/** Returns one display-only localized tool while preserving its canonical route and handler. */
function displayTool(tool: ToolDefinition): ToolDefinition {
  return localizeTool(tool, language.value)
}

/** Builds Nuxt UI navigation items while retaining the existing tool selection and history. */
const navigationGroups = computed(() => localizedCategories.value.map((category) => ({
  ...category,
  items: tools.filter((tool) => tool.category.id === category.id).map((tool) => ({
    label: displayTool(tool).title,
    toolIcon: tool.icon,
    active: selectedTool.value.id === tool.id,
    /** Selects a catalog tool using the shared hash navigation handler. */
    onSelect: () => selectTool(tool),
  })),
})))

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
  activeScene.value = 'tools'
  selectedTool.value = tool
  rememberTool(tool)
  mobileNavigationOpen.value = false

  // The URL only needs replacing when navigation selects a different fragment.
  if (routePath() !== tool.id) {
    window.history.replaceState(null, '', `#/${tool.id}`)
  }
}

/** Changes the application scene and writes a shareable fragment for the selected workspace. */
function selectScene(nextScene: string): void {
  mobileNavigationOpen.value = false

  // Drawing owns one stable route because its temporary objects are intentionally local state.
  if (nextScene === 'drawing') {
    activeScene.value = 'drawing'
    window.history.replaceState(null, '', '#/drawing')
    return
  }

  activeScene.value = 'tools'
  window.history.replaceState(null, '', `#/${selectedTool.value.id}`)
}

/** Places a palette material through the mounted drawing workbench and closes mobile navigation. */
function placeDrawingTool(toolId: DrawingToolId): void {
  const workbench = drawingWorkbench.value

  // The drawing workbench remains mounted with v-show, but the guard keeps navigation safe during teardown.
  if (!workbench) {
    return
  }

  workbench.placeTool(toolId)
  mobileNavigationOpen.value = false
}

/** Opens the global tool search while releasing the small-screen navigation drawer. */
function openToolSearch(): void {
  mobileNavigationOpen.value = false
  searchDialogOpen.value = true
}

/** Stores the selected website language in the shared persistent language state. */
function selectLanguage(nextLanguage: string): void {
  // Only the English option changes away from the default Chinese interface.
  if (nextLanguage === 'en') {
    setLanguage('en')
    return
  }

  setLanguage('zh')
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
  // The drawing fragment switches scenes without entering the developer-tool registry.
  if (routePath() === 'drawing') {
    activeScene.value = 'drawing'
    return
  }

  activeScene.value = 'tools'
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

  // The drawing route is already canonical and should not be replaced by the fallback tool.
  if (activeScene.value === 'drawing') {
    return
  }

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
  <UApp :locale="language === 'en' ? en : zh_cn" class="app-shell">
    <!-- The backdrop dismisses navigation only while the small-screen drawer is open. -->
    <button v-if="mobileNavigationOpen" class="navigation-backdrop" type="button" :aria-label="t('closeNavigation')" @click="mobileNavigationOpen = false" />

    <aside class="sidebar bg-default border-r border-default" :class="{ 'sidebar--open': mobileNavigationOpen }">
      <div class="brand-row">
        <div class="brand-mark bg-primary text-inverted"><UIcon name="i-lucide-code-xml" class="size-5" /></div>
        <div class="brand-copy">
          <strong class="text-highlighted">Dev Toolbox</strong>
          <USelect
            :model-value="activeScene"
            :items="sceneOptions"
            :aria-label="t('navigation')"
            color="neutral"
            variant="none"
            size="sm"
            class="w-full"
            @update:model-value="selectScene"
          />
        </div>
        <UButton class="sidebar-close" color="neutral" variant="ghost" icon="i-lucide-x" :aria-label="t('closeNavigation')" @click="mobileNavigationOpen = false" />
      </div>

      <!-- Developer tools retain their searchable categorized catalog. -->
      <template v-if="activeScene === 'tools'">
        <UButton color="neutral" variant="outline" icon="i-lucide-search" class="search-trigger" :label="t('searchTools')" @click="openToolSearch">
          <template #trailing><UKbd value="/" /></template>
        </UButton>
        <div class="tool-navigation" :aria-label="t('developerTools')">
          <section v-for="category in navigationGroups" :key="category.id" class="nav-section">
            <h2 class="text-dimmed">{{ category.label }}</h2>
            <UNavigationMenu :items="category.items" orientation="vertical" color="primary" :aria-label="category.label">
              <template #item-leading="{ item }">
                <component :is="item.toolIcon" :size="16" aria-hidden="true" class="shrink-0" />
              </template>
            </UNavigationMenu>
          </section>
        </div>
      </template>
      <!-- Drawing navigation exposes draggable materials for the canvas scene. -->
      <DrawingPalette v-else @place="placeDrawingTool" />
    </aside>

    <main class="main-area">
      <header class="tool-header bg-default border-b border-default">
        <UButton class="mobile-menu" color="neutral" variant="ghost" icon="i-lucide-menu" :aria-label="t('openNavigation')" @click="mobileNavigationOpen = true" />
        <div class="tool-heading">
          <!-- The drawing scene uses its own location and title in the shared header. -->
          <template v-if="activeScene === 'drawing'">
            <span class="text-muted">{{ sceneLabels.drawingCategory }}</span>
            <h1 class="text-highlighted">{{ sceneLabels.drawingTitle }}</h1>
          </template>
          <template v-else>
            <span class="text-muted">{{ displayTool(selectedTool).category.label }}</span>
            <h1 class="text-highlighted">{{ displayTool(selectedTool).title }}</h1>
          </template>
        </div>
        <div class="tool-header-actions">
          <UTooltip :text="themeToggleLabel">
            <USwitch :model-value="colorTheme === 'dark'" color="primary" size="sm" :aria-label="themeToggleLabel" checked-icon="i-lucide-moon" unchecked-icon="i-lucide-sun" @update:model-value="setNightMode" />
          </UTooltip>
          <USelect :model-value="language" :items="languageOptions" :aria-label="t('websiteLanguage')" color="neutral" size="sm" class="language-picker" @update:model-value="selectLanguage" />
          <UBadge class="local-status" color="neutral" variant="subtle" :label="processingStatus" />
        </div>
      </header>

      <!-- History tabs select cached workbenches and provide a separate close action. -->
      <nav v-if="activeScene === 'tools'" class="tool-history border-b border-default" :aria-label="t('toolHistory')">
        <span class="tool-history-label text-dimmed">{{ t('history') }}</span>
        <div class="tool-history-items">
          <UFieldGroup v-for="tool in openedTools" :key="tool.id" class="shrink-0">
            <!-- The selected history entry uses the primary accent; inactive entries stay neutral. -->
            <UButton :color="selectedTool.id === tool.id ? 'primary' : 'neutral'" :variant="selectedTool.id === tool.id ? 'soft' : 'ghost'" size="sm" :aria-current="selectedTool.id === tool.id ? 'page' : undefined" @click="selectTool(tool)">
              <component :is="tool.icon" :size="14" aria-hidden="true" />
              <span>{{ displayTool(tool).title }}</span>
            </UButton>
            <UTooltip :text="`${t('close')} ${displayTool(tool).title}`">
              <UButton color="neutral" variant="ghost" size="sm" icon="i-lucide-x" :aria-label="`${t('close')} ${displayTool(tool).title}`" @click="closeHistoryTool(tool)" />
            </UTooltip>
          </UFieldGroup>
        </div>
      </nav>

      <!-- Both scenes stay mounted so switching preserves temporary canvas and form state. -->
      <DrawingWorkbench ref="drawingWorkbench" v-show="activeScene === 'drawing'" :active="activeScene === 'drawing'" />
      <div v-show="activeScene === 'tools'" class="content-frame">
        <ToolWorkbench v-for="tool in openedTools" v-show="selectedTool.id === tool.id" :key="tool.id" :tool="displayTool(tool)" :prefill="toolPrefills[tool.id]" :active="selectedTool.id === tool.id" />
      </div>
    </main>
    <ToolSearchDialog :open="searchDialogOpen" @close="closeToolSearch" @select="selectSearchSuggestion" />
  </UApp>
</template>
