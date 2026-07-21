<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { AudioLines } from '@lucide/vue'
import WaveSurfer from 'wavesurfer.js'

import { formatAudioDuration } from '../lib/audio'
import type { AudioAnalysis } from '../lib/audio'

const props = defineProps<{
  analysis: AudioAnalysis
  active: boolean
}>()

const waveformElement = ref<HTMLElement | null>(null)
const audioElement = ref<HTMLAudioElement | null>(null)
const waveformError = ref('')
let waveSurfer: WaveSurfer | null = null
let loadRevision = 0

/** Exposes delayed media failures that occur after the waveform load promise settles. */
function showWaveformError(): void {
  waveformError.value = '音频播放器加载失败'
}

/** Creates the shared native player and WaveSurfer binding after both elements exist. */
function ensureWaveSurfer(): WaveSurfer | null {
  // Reusing one instance lets WaveSurfer revoke the prior Blob URL when a new file is loaded.
  if (waveSurfer) {
    return waveSurfer
  }

  // Vue refs are unavailable until the component has mounted.
  if (!waveformElement.value || !audioElement.value) {
    return null
  }

  waveSurfer = WaveSurfer.create({
    container: waveformElement.value,
    media: audioElement.value,
    height: 104,
    waveColor: '#8ca19a',
    progressColor: '#d45f32',
    cursorColor: '#1e706a',
    cursorWidth: 2,
    barWidth: 2,
    barGap: 2,
    barRadius: 1,
    barMinHeight: 2,
    normalize: true,
    dragToSeek: true,
  })
  waveSurfer.on('error', showWaveformError)

  return waveSurfer
}

/** Loads one analyzed File with precomputed peaks so the waveform does not decode it again. */
async function loadAudio(): Promise<void> {
  const revision = ++loadRevision
  const player = audioElement.value
  const waveform = ensureWaveSurfer()

  // Loading can only start after the mounted media and waveform controls are available.
  if (!player || !waveform) {
    return
  }

  player.pause()
  waveformError.value = ''

  try {
    await waveform.loadBlob(
      props.analysis.file,
      props.analysis.peaks,
      props.analysis.durationSeconds,
    )
  } catch {
    // Superseded loads must not replace the current file with stale feedback.
    if (revision !== loadRevision) {
      return
    }

    waveformError.value = '音频播放器加载失败'
  }
}

/** Pauses hidden history entries without discarding their playback position or waveform. */
function pauseWhenInactive(active: boolean): void {
  // Background tools must not keep playing audio after the user switches history tabs.
  if (!active) {
    audioElement.value?.pause()
  }
}

/** Releases WaveSurfer listeners, its Blob URL, and the external media source. */
function disposeAudio(): void {
  loadRevision += 1
  audioElement.value?.pause()
  waveSurfer?.destroy()
  waveSurfer = null

  // Clearing the external element releases its reference to the revoked Blob URL.
  if (audioElement.value) {
    audioElement.value.removeAttribute('src')
    audioElement.value.load()
  }
}

/** Loads the initial audio only after Vue has exposed the rendered player elements. */
onMounted(() => {
  void loadAudio()
})

watch(() => props.analysis, () => {
  void loadAudio()
})
watch(() => props.active, pauseWhenInactive)
onBeforeUnmount(disposeAudio)
</script>

<template>
  <section class="audio-result-panel" aria-label="音频播放与波形">
    <header class="audio-result-header">
      <div class="audio-result-identity">
        <AudioLines :size="18" aria-hidden="true" />
        <div>
          <span>音频预览</span>
          <strong>{{ analysis.file.name }}</strong>
        </div>
      </div>
      <code>{{ formatAudioDuration(analysis.durationSeconds) }}</code>
    </header>
    <div class="audio-result-body">
      <audio
        ref="audioElement"
        class="audio-player"
        controls
        preload="metadata"
        :aria-label="`播放 ${analysis.file.name}`"
      />
      <div
        ref="waveformElement"
        class="audio-waveform"
        role="group"
        aria-label="音频波形，可点击或拖动定位"
      />
      <!-- Player initialization errors belong next to the media surface that failed. -->
      <p v-if="waveformError" class="audio-waveform-error" role="alert">
        {{ waveformError }}
      </p>
    </div>
  </section>
</template>
