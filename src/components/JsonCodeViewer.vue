<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { json } from '@codemirror/lang-json'
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  foldInside,
  foldKeymap,
  foldService,
  syntaxHighlighting,
  syntaxTree,
} from '@codemirror/language'
import type { MatchResult } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import type { Range } from '@codemirror/state'
import { Decoration, EditorView, keymap } from '@codemirror/view'
import type { ViewUpdate } from '@codemirror/view'

const props = defineProps<{
  content: string
}>()
const emit = defineEmits<{
  'update:content': [content: string]
}>()

const host = ref<HTMLDivElement | null>(null)
let editor: EditorView | null = null

const matchingBracketDecoration = Decoration.mark({ class: 'cm-rangeBracket' })
const nonmatchingBracketDecoration = Decoration.mark({ class: 'cm-invalidBracket' })
const bracketRangeDecoration = Decoration.mark({ class: 'cm-bracketRange' })

/** Adds folding for inline JSON collections that the multiline fold provider skips. */
function foldInlineJson(state: EditorState, lineStart: number, lineEnd: number): { from: number, to: number } | null {
  let range: { from: number, to: number } | null = null

  syntaxTree(state).iterate({
    from: lineStart,
    to: lineEnd,
    /** Finds the first complete inline object or array beginning on this line. */
    enter(node) {
      // Ancestors beginning on earlier lines must still allow their children to be inspected.
      if (range || node.from < lineStart) {
        return
      }

      // Strings and scalar values cannot hide a collection body.
      if (node.name === 'Object' || node.name === 'Array') {
        // Multiline collections keep the language's default folding behavior.
        if (node.to <= lineEnd) {
          range = foldInside(node.node)
        }
        return false
      }
    },
  })

  return range
}

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
    backgroundColor: 'var(--input)',
    fontSize: '13px',
  },
  '.cm-scroller': {
    overflow: 'auto',
    fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
    lineHeight: '1.58',
  },
  '.cm-content': {
    minHeight: '190px',
    padding: '16px 16px 16px 4px',
    caretColor: 'var(--focus)',
  },
  '.cm-line': {
    padding: '0',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--input)',
    color: 'var(--muted)',
    border: 'none',
    paddingLeft: '8px',
  },
  '.cm-foldGutter .cm-gutterElement': {
    padding: '0 4px',
  },
  '.cm-foldGutter span:hover': {
    color: 'var(--foreground)',
  },
  '.cm-foldPlaceholder': {
    color: 'var(--muted)',
    backgroundColor: 'var(--input)',
    border: '1px solid var(--border)',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  '&.cm-focused .cm-bracketRange': {
    backgroundColor: 'color-mix(in srgb, var(--primary) 9%, transparent)',
    borderBottom: '1px solid color-mix(in srgb, var(--primary) 24%, transparent)',
  },
  '&.cm-focused .cm-rangeBracket': {
    color: 'var(--foreground)',
    backgroundColor: 'color-mix(in srgb, var(--focus) 18%, transparent)',
    outline: '1px solid color-mix(in srgb, var(--focus) 38%, transparent)',
  },
  '&.cm-focused .cm-invalidBracket': {
    color: 'var(--error)',
    backgroundColor: 'var(--error-bg)',
    outline: '1px solid color-mix(in srgb, var(--error) 36%, transparent)',
  },
})

/** Publishes user edits while keeping the source tool input independent. */
function publishDocumentChange(update: ViewUpdate): void {
  // Selection and focus changes do not alter the editable JSON result.
  if (!update.docChanged) {
    return
  }

  emit('update:content', update.state.doc.toString())
}

/** Creates the editable JSON viewer after its host element is mounted. */
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
        foldService.of(foldInlineJson),
        // Fold JSON collections in the view while preserving the full editable document.
        foldGutter(),
        keymap.of(foldKeymap),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        bracketMatching({ renderMatch: renderBracketRange }),
        EditorView.updateListener.of(publishDocumentChange),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({
          role: 'textbox',
          'aria-label': 'JSON 输出',
          'aria-multiline': 'true',
        }),
        viewerTheme,
      ],
    }),
    parent: host.value,
  })
}

onMounted(createEditor)

/** Replaces the editable document when a tool produces a new JSON result. */
watch(
  () => props.content,
  (content) => {
    // Updates cannot be dispatched before the editor has mounted.
    if (!editor) {
      return
    }

    // Edits already emitted by this editor must retain the current cursor position.
    if (content === editor.state.doc.toString()) {
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
