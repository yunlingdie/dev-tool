import { describe, expect, it } from 'vitest'

import {
  analyzeUrl,
  asciiBinaryToText,
  convertBase,
  convertDate,
  countText,
  decodeBase64,
  decodeUrlComponent,
  encodeBase64,
  encodeUrlComponent,
  formatDateInTimeZone,
  formatJson,
  hashText,
  jsonToCsv,
  minifyJson,
  numberToRoman,
  parseJwt,
  romanToNumber,
  shuffleString,
  textToAsciiBinary,
  textToUnicode,
  unicodeToText,
} from './core'

/** Encodes JSON as an unpadded Base64URL value for JWT test fixtures. */
function encodeBase64UrlFixture(value: unknown): string {
  return encodeBase64(JSON.stringify(value))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

describe('hashText', () => {
  it('hashes text with MD5 for legacy compatibility', async () => {
    await expect(hashText('abc', 'MD5')).resolves.toBe('900150983cd24fb0d6963f7d28e17f72')
  })

  it('hashes UTF-8 text with SHA-256', async () => {
    await expect(hashText('abc')).resolves.toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })
})

describe('number conversions', () => {
  it('converts signed arbitrary-precision integers between bases', () => {
    expect(convertBase('-ff', 16, 2)).toBe('-11111111')
    expect(convertBase('9007199254740993', 10, 36)).toBe('2gosa7pa2gx')
  })

  it('rejects digits that do not belong to the source base', () => {
    expect(() => convertBase('102', 2, 10)).toThrow('Invalid digit')
  })

  it('round-trips canonical Roman numerals', () => {
    expect(numberToRoman(1994)).toBe('MCMXCIV')
    expect(romanToNumber('MCMXCIV')).toBe(1994)
    expect(() => romanToNumber('IIII')).toThrow('Invalid Roman numeral')
  })
})

describe('date conversions', () => {
  it('recognizes Unix seconds and milliseconds', () => {
    expect(convertDate(0)).toEqual({
      iso: '1970-01-01T00:00:00.000Z',
      unixSeconds: 0,
      unixMilliseconds: 0,
    })
    expect(convertDate('1704067200000').iso).toBe('2024-01-01T00:00:00.000Z')
  })

  it('formats a timestamp in a requested time zone', () => {
    expect(formatDateInTimeZone(0, 'Asia/Shanghai')).toBe('1970-01-01 08:00:00')
  })
})

describe('text encodings', () => {
  it('round-trips Unicode text through UTF-8 Base64', () => {
    expect(decodeBase64(encodeBase64('你好, Vue!'))).toBe('你好, Vue!')
  })

  it('round-trips ASCII binary and rejects non-ASCII input', () => {
    expect(textToAsciiBinary('Az')).toBe('01000001 01111010')
    expect(asciiBinaryToText('01000001 01111010')).toBe('Az')
    expect(() => textToAsciiBinary('你')).toThrow('Non-ASCII')
  })

  it('round-trips BMP and supplementary Unicode code points', () => {
    const escaped = textToUnicode('A你😀')
    expect(escaped).toBe('\\u0041\\u4F60\\u{1F600}')
    expect(unicodeToText(escaped)).toBe('A你😀')
  })
})

describe('URL and JWT parsing', () => {
  it('encodes and decodes one URL component', () => {
    const encoded = encodeUrlComponent('a/b?c=你好')
    expect(encoded).toBe('a%2Fb%3Fc%3D%E4%BD%A0%E5%A5%BD')
    expect(decodeUrlComponent(encoded)).toBe('a/b?c=你好')
  })

  it('preserves repeated URL query values', () => {
    const result = analyzeUrl('https://user:pass@example.com:8443/a?q=1&q=2#top')
    expect(result.hostname).toBe('example.com')
    expect(result.port).toBe('8443')
    expect(result.query).toEqual({ q: ['1', '2'] })
  })

  it('decodes JWT JSON without verifying the signature', () => {
    const token = [
      encodeBase64UrlFixture({ alg: 'none', typ: 'JWT' }),
      encodeBase64UrlFixture({ sub: '用户-1', admin: true }),
      'signature',
    ].join('.')

    expect(parseJwt(token)).toEqual({
      header: { alg: 'none', typ: 'JWT' },
      payload: { sub: '用户-1', admin: true },
      signature: 'signature',
    })
  })
})

describe('text and JSON utilities', () => {
  it('shuffles by Unicode code point with an injected random source', () => {
    const samples = [0, 0]
    let index = 0
    const random = (): number => {
      const sample = samples[index]
      index += 1
      return sample
    }

    expect(shuffleString('A😀B', random)).toBe('😀BA')
  })

  it('formats and minifies JSON', () => {
    expect(formatJson('{"a":1,"b":[true]}')).toBe('{\n  "a": 1,\n  "b": [\n    true\n  ]\n}')
    expect(minifyJson('{ "a": 1 }')).toBe('{"a":1}')
  })

  it('converts heterogeneous object rows to escaped CSV', () => {
    expect(jsonToCsv([
      { name: 'Ada, A.', active: true },
      { name: 'Lin', note: 'line 1\nline 2' },
    ])).toBe('name,active,note\r\n"Ada, A.",true,\r\nLin,,"line 1\nline 2"')
  })

  it('counts Unicode text without splitting emoji surrogate pairs', () => {
    expect(countText('Hello 世界😀\nnext')).toEqual({
      characters: 14,
      charactersWithoutSpaces: 12,
      words: 4,
      lines: 2,
      bytes: 21,
    })
  })
})
