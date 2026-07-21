import { describe, expect, it, vi } from 'vitest'

import {
  analyzeAudioFile,
  audioFileFormat,
  audioMimeType,
  createWaveformPeaks,
  formatAudioChannelCount,
  formatAudioDuration,
  formatAudioFileSize,
} from './audio'
import type { DecodedAudioData } from './audio'

/** Builds deterministic decoded audio data without requiring Web Audio in Node. */
function decodedAudio(channels: number[][], sampleRate = 8000): DecodedAudioData {
  return {
    duration: channels[0].length / sampleRate,
    sampleRate,
    numberOfChannels: channels.length,
    length: channels[0].length,
    getChannelData: (channel) => new Float32Array(channels[channel]),
  }
}

describe('audio analysis helpers', () => {
  // Min/max pairs must retain both waveform halves for every decoded channel.
  it('downsamples each channel into bounded min and max peaks', () => {
    const audio = decodedAudio([
      [0.25, -0.5, 0.75, -0.25],
      [-1, -0.25, 0.5, 1],
    ])

    expect(createWaveformPeaks(audio, 2)).toEqual([
      [-0.5, 0.25, -0.25, 0.75],
      [-1, -0.25, 0.5, 1],
    ])
  })

  // Silent and empty audio must produce finite lightweight waveform values.
  it('handles silent and empty decoded audio', () => {
    expect(createWaveformPeaks(decodedAudio([[0, 0, 0, 0]]), 2)).toEqual([
      [0, 0, 0, 0],
    ])
    expect(createWaveformPeaks({
      duration: 0,
      sampleRate: 8000,
      numberOfChannels: 0,
      length: 0,
      getChannelData: () => new Float32Array(),
    })).toEqual([])
  })

  // The async analyzer should retain only the File, reliable metadata, and compact peaks.
  it('builds an analysis from an injected browser decoder', async () => {
    const file = new File(['audio'], 'tone.wav', { type: 'audio/wav' })
    const audio = decodedAudio([[0.5, -0.5, 0.25, -0.25]], 4)
    const decoder = vi.fn().mockResolvedValue(audio)

    await expect(analyzeAudioFile(file, decoder)).resolves.toEqual({
      file,
      durationSeconds: 1,
      sampleRate: 4,
      channelCount: 1,
      frameCount: 4,
      peaks: [[0.5, 0.5, -0.5, -0.5, 0.25, 0.25, -0.25, -0.25]],
    })
    expect(decoder).toHaveBeenCalledOnce()
  })

  // Decoder failures should become one stable Chinese message for every unsupported format.
  it('normalizes browser decoder failures', async () => {
    const file = new File(['not audio'], 'broken.mp3', { type: 'audio/mpeg' })
    const decoder = vi.fn().mockRejectedValue(new Error('EncodingError'))

    await expect(analyzeAudioFile(file, decoder)).rejects.toThrow(
      '当前浏览器无法解析此音频格式',
    )
  })

  // Metadata formatters should produce readable Chinese-facing values and fallbacks.
  it('formats duration, size, format, MIME, and channels', () => {
    expect(formatAudioDuration(3723.456)).toBe('01:02:03.456')
    expect(formatAudioDuration(Number.NaN)).toBe('未知')
    expect(formatAudioFileSize(4044)).toBe('3.95 KB')
    expect(audioFileFormat(new File([], 'tone.wav', { type: 'audio/wav' }))).toBe('WAV')
    expect(audioFileFormat(new File([], 'track', { type: 'audio/mpeg' }))).toBe('MPEG')
    expect(audioMimeType(new File([], 'track'))).toBe('未知')
    expect(formatAudioChannelCount(1)).toBe('1（单声道）')
    expect(formatAudioChannelCount(2)).toBe('2（立体声）')
    expect(formatAudioChannelCount(6)).toBe('6')
  })
})
