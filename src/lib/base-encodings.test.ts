import { describe, expect, it } from 'vitest'

import {
  decodeBaseText,
  encodeBaseText,
  type BaseTextEncoding,
} from './base-encodings'

const RFC_4648_BASE32_VECTORS = [
  ['', '', ''],
  ['f', 'MY======', 'MY'],
  ['fo', 'MZXQ====', 'MZXQ'],
  ['foo', 'MZXW6===', 'MZXW6'],
  ['foob', 'MZXW6YQ=', 'MZXW6YQ'],
  ['fooba', 'MZXW6YTB', 'MZXW6YTB'],
  ['foobar', 'MZXW6YTBOI======', 'MZXW6YTBOI'],
] as const

const SUPPORTED_ENCODINGS: readonly BaseTextEncoding[] = [
  'base32',
  'base32-nopad',
  'base58',
]

describe('Base32 text encoding', () => {
  it('matches the official RFC 4648 padded and unpadded vectors', () => {
    for (const [plainText, padded, unpadded] of RFC_4648_BASE32_VECTORS) {
      expect(encodeBaseText(plainText, 'base32')).toBe(padded)
      expect(decodeBaseText(padded, 'base32')).toBe(plainText)
      expect(encodeBaseText(plainText, 'base32-nopad')).toBe(unpadded)
      expect(decodeBaseText(unpadded, 'base32-nopad')).toBe(plainText)
    }
  })

  it('preserves Unicode text through UTF-8 bytes', () => {
    const input = '你好，Base32 编解码 😀'

    for (const encoding of ['base32', 'base32-nopad'] as const) {
      expect(decodeBaseText(encodeBaseText(input, encoding), encoding)).toBe(input)
    }
  })

  it('rejects lowercase, invalid tail bits, and malformed padding', () => {
    for (const input of ['mzxw6===', 'A7======', 'MZXW6', 'MZXW6====']) {
      expect(() => decodeBaseText(input, 'base32')).toThrow('Failed to decode Base32 text')
    }

    expect(() => decodeBaseText('MZXW6===', 'base32-nopad')).toThrow(
      'Failed to decode unpadded Base32 text',
    )
    expect(() => decodeBaseText('A7', 'base32-nopad')).toThrow(
      'Failed to decode unpadded Base32 text',
    )
  })
})

describe('Base58 text encoding', () => {
  it('matches Bitcoin-alphabet vectors and preserves leading zero bytes', () => {
    expect(encodeBaseText('hello world', 'base58')).toBe('StV1DL6CwTryKyV')
    expect(decodeBaseText('StV1DL6CwTryKyV', 'base58')).toBe('hello world')
    expect(encodeBaseText('\0\0hello world', 'base58')).toBe('11StV1DL6CwTryKyV')
    expect(decodeBaseText('11StV1DL6CwTryKyV', 'base58')).toBe('\0\0hello world')
  })

  it('preserves Unicode text through UTF-8 bytes', () => {
    const input = '你好，Base58 编解码 😀'
    expect(decodeBaseText(encodeBaseText(input, 'base58'), 'base58')).toBe(input)
  })

  it('rejects characters outside the Bitcoin Base58 alphabet', () => {
    for (const input of ['0', 'O', 'I', 'l', 'StV1 DL6CwTryKyV']) {
      expect(() => decodeBaseText(input, 'base58')).toThrow('Failed to decode Base58 text')
    }
  })

  it('rejects decoded bytes that are not valid UTF-8', () => {
    expect(() => decodeBaseText('5Q', 'base58')).toThrow('Failed to decode Base58 text')
  })

  it('allows exactly 10,000 bytes or characters and rejects larger input', () => {
    const limitText = '\0'.repeat(10_000)
    const limitEncoded = '1'.repeat(10_000)

    expect(encodeBaseText(limitText, 'base58')).toBe(limitEncoded)
    expect(decodeBaseText(limitEncoded, 'base58')).toBe(limitText)
    expect(() => encodeBaseText('a'.repeat(10_001), 'base58')).toThrow(
      'Base58 input must not exceed 10,000 UTF-8 bytes',
    )
    expect(() => encodeBaseText('你'.repeat(3_334), 'base58')).toThrow(
      'Base58 input must not exceed 10,000 UTF-8 bytes',
    )
    expect(() => decodeBaseText('1'.repeat(10_001), 'base58')).toThrow(
      'Base58 input must not exceed 10,000 encoded characters',
    )
  })
})

describe('empty base-encoded text', () => {
  it('allows empty input for every supported encoding', () => {
    for (const encoding of SUPPORTED_ENCODINGS) {
      expect(encodeBaseText('', encoding)).toBe('')
      expect(decodeBaseText('', encoding)).toBe('')
    }
  })
})
