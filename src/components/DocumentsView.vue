<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowLeft, ArrowRight, FileText, Search } from '@lucide/vue'

import { filterDocuments } from '../docs/definitions'
import type { DocumentDefinition, DocumentLink } from '../docs/definitions'

interface SelectedDocument {
  documentTitle: string
  link: DocumentLink
}

const props = defineProps<{
  documents: DocumentDefinition[]
}>()

const searchQuery = ref('')
const selectedDocument = ref<SelectedDocument | null>(null)

/** Produces the visible document collection from the current content query. */
const filteredDocuments = computed(() => filterDocuments(props.documents, searchQuery.value))

/** Opens one trusted project-local document inside the current workspace. */
function openDocument(documentTitle: string, link: DocumentLink): void {
  selectedDocument.value = { documentTitle, link }
}

/** Returns from the local reader to the searchable document collection. */
function closeDocument(): void {
  selectedDocument.value = null
}
</script>

<template>
  <!-- A selected local entry replaces the collection without changing the application location. -->
  <section v-if="selectedDocument" class="document-reader" aria-label="本地文档阅读器">
    <div class="document-reader-toolbar">
      <button type="button" class="document-reader-back" @click="closeDocument">
        <ArrowLeft :size="16" aria-hidden="true" />
        <span>返回文档</span>
      </button>
      <div class="document-reader-title">
        <span>{{ selectedDocument.documentTitle }}</span>
        <strong>{{ selectedDocument.link.label }}</strong>
      </div>
      <span class="document-reader-status">本地文档</span>
    </div>
    <iframe
      :key="selectedDocument.link.path"
      class="document-reader-frame"
      :src="selectedDocument.link.path"
      :title="`${selectedDocument.documentTitle} ${selectedDocument.link.label}`"
      sandbox="allow-same-origin"
      referrerpolicy="no-referrer"
    />
  </section>

  <!-- The collection remains visible until a local document is selected. -->
  <section v-else class="documents-view" aria-label="文档库">
    <div class="document-toolbar">
      <label class="document-filter">
        <Search :size="17" aria-hidden="true" />
        <span class="sr-only">筛选文档内容</span>
        <input v-model="searchQuery" type="search" placeholder="筛选文档内容" autocomplete="off">
      </label>
      <span class="document-result-count">{{ filteredDocuments.length }} / {{ documents.length }} 篇</span>
    </div>

    <!-- The empty state remains available when the document registry has no entries. -->
    <div v-if="documents.length === 0" class="document-empty">
      <div class="document-empty-icon" aria-hidden="true"><FileText :size="22" /></div>
      <h2>暂无文档</h2>
    </div>

    <!-- A populated registry can still have no documents matching the current query. -->
    <div v-else-if="filteredDocuments.length === 0" class="document-empty">
      <div class="document-empty-icon" aria-hidden="true"><Search :size="22" /></div>
      <h2>没有匹配的文档</h2>
    </div>

    <!-- Matching documents render outside the tool workbench as readable content sections. -->
    <div v-else class="document-results">
      <article v-for="document in filteredDocuments" :key="document.id" class="document-entry">
        <h2>{{ document.title }}</h2>
        <div class="document-content">{{ document.content }}</div>
        <nav class="document-links" :aria-label="`${document.title} 文档链接`">
          <button
            v-for="link in document.links"
            :key="link.path"
            type="button"
            class="document-link"
            @click="openDocument(document.title, link)"
          >
            <span>{{ link.label }}</span>
            <ArrowRight :size="14" aria-hidden="true" />
          </button>
        </nav>
      </article>
    </div>
  </section>
</template>
