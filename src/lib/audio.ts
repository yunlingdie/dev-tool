export interface DecodedAudioData {
  duration: number
  sampleRate: number
  numberOfChannels: number
  length: number
  getChannelData: (channel: number) => Float32Array
}

export interface AudioAnalysis {
  file: File
  durationSeconds: number
  sampleRate: number
  channelCount: number
  frameCount: number
  peaks: number[][]
}

export type AudioDecoder = (data: ArrayBuffer) => Promise<DecodedAudioData>

const WAVEFORM_BUCKET_LIMIT = 1200

/** Decodes audio with the browser Web Audio API and releases the temporary context. */
async function decodeAudioBuffer(data: ArrayBuffer): Promise<AudioBuffer> {
  const AudioContextConstructor = globalThis.AudioContext

  // Audio analysis requires browser support for local Web Audio decoding.
  if (typeof AudioContextConstructor !== 'function') {
    throw new Error('当前浏览器不支持音频解析')
  }

  const context = new AudioContextConstructor()

  try {
    return await context.decodeAudioData(data)
  } finally {
    await context.close().catch(() => undefined)
  }
}

/** Downsamples every channel to bounded min/max pairs for a lightweight waveform. */
export function createWaveformPeaks(
  audio: DecodedAudioData,
  bucketLimit = WAVEFORM_BUCKET_LIMIT,
): number[][] {
  // Decoded browser audio should contain frames and channels before waveform rendering.
  if (audio.length <= 0 || audio.numberOfChannels <= 0) {
    return []
  }

  const bucketCount = Math.min(audio.length, Math.max(1, Math.floor(bucketLimit)))
  const channels: number[][] = []

  for (let channelIndex = 0; channelIndex < audio.numberOfChannels; channelIndex += 1) {
    const samples = audio.getChannelData(channelIndex)
    const peaks: number[] = []

    for (let bucketIndex = 0; bucketIndex < bucketCount; bucketIndex += 1) {
      const start = Math.floor((bucketIndex * samples.length) / bucketCount)
      const end = Math.max(
        start + 1,
        Math.floor(((bucketIndex + 1) * samples.length) / bucketCount),
      )
      let minimum = 1
      let maximum = -1

      for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) {
        const sample = samples[sampleIndex]

        // Negative extremes preserve the lower half of the waveform envelope.
        if (sample < minimum) {
          minimum = sample
        }

        // Positive extremes preserve the upper half of the waveform envelope.
        if (sample > maximum) {
          maximum = sample
        }
      }

      peaks.push(minimum, maximum)
    }

    channels.push(peaks)
  }

  return channels
}

/** Extracts reliable browser-provided metadata and compact waveform peaks from one file. */
export async function analyzeAudioFile(
  file: File,
  decoder: AudioDecoder = decodeAudioBuffer,
): Promise<AudioAnalysis> {
  try {
    const audio = await decoder(await file.arrayBuffer())

    return {
      file,
      durationSeconds: audio.duration,
      sampleRate: audio.sampleRate,
      channelCount: audio.numberOfChannels,
      frameCount: audio.length,
      peaks: createWaveformPeaks(audio),
    }
  } catch {
    throw new Error('当前浏览器无法解析此音频格式')
  }
}

/** Formats a decoded duration as a stable hours, minutes, seconds, and milliseconds value. */
export function formatAudioDuration(seconds: number): string {
  // Invalid durations should never render misleading clock values.
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '未知'
  }

  const totalMilliseconds = Math.round(seconds * 1000)
  const hours = Math.floor(totalMilliseconds / 3_600_000)
  const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000)
  const wholeSeconds = Math.floor((totalMilliseconds % 60_000) / 1000)
  const milliseconds = totalMilliseconds % 1000

  return [hours, minutes, wholeSeconds]
    .map((value) => String(value).padStart(2, '0'))
    .join(':') + `.${String(milliseconds).padStart(3, '0')}`
}

/** Formats a byte count with the smallest readable binary unit. */
export function formatAudioFileSize(bytes: number): string {
  // Small files remain exact when expressed directly in bytes.
  if (bytes < 1024) {
    return `${bytes} B`
  }

  // Kilobytes are the clearest unit below one mebibyte.
  if (bytes < 1024 ** 2) {
    return `${(bytes / 1024).toFixed(2)} KB`
  }

  // Megabytes are the clearest unit below one gibibyte.
  if (bytes < 1024 ** 3) {
    return `${(bytes / 1024 ** 2).toFixed(2)} MB`
  }

  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

/** Uses the file extension as a concise user-facing audio format. */
export function audioFileFormat(file: File): string {
  const extensionIndex = file.name.lastIndexOf('.')

  // A real trailing extension is more recognizable than a browser MIME subtype.
  if (extensionIndex > 0 && extensionIndex < file.name.length - 1) {
    return file.name.slice(extensionIndex + 1).toLocaleUpperCase('en-US')
  }

  const mimeSubtype = file.type.replace(/^audio\//, '')

  // A MIME subtype still provides a useful fallback for extensionless files.
  if (mimeSubtype) {
    return mimeSubtype.toLocaleUpperCase('en-US')
  }

  return '未知'
}

/** Returns the browser-provided MIME type or an explicit unknown label. */
export function audioMimeType(file: File): string {
  // Some local files do not include MIME metadata from the operating system.
  if (!file.type) {
    return '未知'
  }

  return file.type
}

/** Describes common mono and stereo layouts while retaining uncommon channel counts. */
export function formatAudioChannelCount(channelCount: number): string {
  // One channel is conventionally described as mono.
  if (channelCount === 1) {
    return '1（单声道）'
  }

  // Two channels are conventionally described as stereo.
  if (channelCount === 2) {
    return '2（立体声）'
  }

  return String(channelCount)
}
