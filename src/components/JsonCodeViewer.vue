<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { json } from '@codemirror/lang-json'
import {
  bracketMatching,
  defaultHighlightStyle,
  syntaxHighlighting,
} from '@codemirror/language'
import type { MatchResult } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import type { Range } from '@codemirror/state'
import { Decoration, EditorView } from '@codemirror/view'

const props = defineProps<{
  content: string
}>()

const host = ref<HTMLDivElement | null>(null)
let editor: EditorView | null = null

const matchingBracketDecoration = Decoration.mark({ class: 'cm-rangeBracket' })
const nonmatchingBracketDecoration = Decoration.mark({ class: 'cm-invalidBracket' })
const bracketRangeDecoration = Decoration.mark({ class: 'cm-bracketRange' })

/** Decorates matching bracket endpoints and the complete range between them. */
function renderBracketRange(match: MatchResult): readonly Range<Decoration>[] {
  let endpointDecoration = nonmatchingBracketDecoration

  // Valid pairs use the stronger matching endpoint treatment.
  if (match.matched) {
    endpointDecoration = matchingBracketDecoration
  }

  const ranges: Range<Decoration>[] = [
    endpointDecoration.range(match.start.from, match.start.to),
  ]

  // Unpaired brackets can only highlight the endpoint that was found.
  if (!match.end) {
    return ranges
  }

  ranges.push(endpointDecoration.range(match.end.from, match.end.to))

  // Mismatched endpoints should not imply a valid enclosed range.
  if (!match.matched) {
    return ranges
  }

  let left = match.start
  let right = match.end

  // Clicking a closing bracket reports the endpoints in reverse document order.
  if (left.from > right.from) {
    left = match.end
    right = match.start
  }

  // Adjacent brackets have no interior content worth decorating.
  if (left.to < right.from) {
    ranges.unshift(bracketRangeDecoration.range(left.to, right.from))
  }

  return ranges
}

const viewerTheme = EditorView.theme({
  '&': {
    minHeight: '190px',
    maxHeight: '540px',
    color: 'var(--foreground)',
    backgroundColor: '#fbfcfb',
    fontSize: '13px',
  },
  '.cm-scroller': {
    overflow: 'auto',
    fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
    lineHeight: '1.58',
  },
  '.cm-content': {
    minHeight: '190px',
    padding: '16px',
    caretColor: 'var(--focus)',
  },
  '.cm-line': {
    padding: '0',
  },
  '.cm-gutters': {
    display: 'none',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  '&.cm-focused .cm-bracketRange': {
    backgroundColor: 'color-mix(in srgb, var(--primary) 9%, transparent)',
    borderBottom: '1px solid color-mix(in srgb, var(--primary) 24%, transparent)',
  },
  '&.cm-focused .cm-rangeBracket': {
    color: '#0c6258',
    backgroundColor: 'color-mix(in srgb, var(--focus) 18%, transparent)',
    outline: '1px solid color-mix(in srgb, var(--focus) 38%, transparent)',
  },
  '&.cm-focused .cm-invalidBracket': {
    color: 'var(--error)',
    backgroundColor: 'var(--error-bg)',
    outline: '1px solid color-mix(in srgb, var(--error) 36%, transparent)',
  },
})

/** Creates the read-only JSON viewer after its host element is mounted. */
function createEditor(): void {
  // Vue can unmount the component before the mount callback receives a usable host.
  if (!host.value) {
    return
  }

  editor = new EditorView({
    state: EditorState.create({
      doc: props.content,
      extensions: [
        json(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        bracketMatching({ renderMatch: renderBracketRange }),
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({
          role: 'textbox',
          'aria-label': 'JSON 输出',
          'aria-readonly': 'true',
          tabindex: '0',
        }),
        viewerTheme,
      ],
    }),
    parent: host.value,
  })
}

onMounted(createEditor)

/** Replaces the read-only document when a tool produces a new JSON result. */
watch(
  () => props.content,
  (content) => {
    // Updates cannot be dispatched before the editor has mounted.
    if (!editor) {
      return
    }

    editor.dispatch({
      changes: {
        from: 0,
        to: editor.state.doc.length,
        insert: content,
      },
      selection: { anchor: 0 },
    })
  },
)

/** Releases CodeMirror DOM observers when the output viewer is removed. */
onBeforeUnmount(() => {
  // Destroying only an initialized editor keeps early unmounts harmless.
  if (editor) {
    editor.destroy()
    editor = null
  }
})
</script>

<template>
  <div ref="host" class="json-code-viewer" />
</template>

<style scoped>
.json-code-viewer {
  min-width: 0;
}
</style>
