import { describe, expect, it } from 'vitest'

import {
  analyzeUrl,
  asciiBinaryToText,
  convertBase,
  convertDate,
  countText,
  createJwt,
  decodeBase64,
  decodeUrlComponent,
  desensitizeJson,
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
  verifyJwtSignature,
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

  it('creates and verifies an HS256 JWT locally', async () => {
    const token = await createJwt({ sub: '用户-1', admin: true }, 'test-secret')

    await expect(verifyJwtSignature(token, 'test-secret')).resolves.toMatchObject({
      algorithm: 'HS256',
      header: { alg: 'HS256', typ: 'JWT' },
      payload: { sub: '用户-1', admin: true },
      valid: true,
    })
    await expect(verifyJwtSignature(token, 'wrong-secret')).resolves.toMatchObject({ valid: false })
  })

  it('rejects empty signing secrets and non-HMAC JWT algorithms', async () => {
    await expect(createJwt({ sub: 'user-1' }, '')).rejects.toThrow('JWT 密钥不能为空')
    const token = [
      encodeBase64UrlFixture({ alg: 'none', typ: 'JWT' }),
      encodeBase64UrlFixture({ sub: 'user-1' }),
      'signature',
    ].join('.')

    await expect(verifyJwtSignature(token, 'test-secret')).rejects.toThrow('JWT alg 必须是')
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

  it('desensitizes JSON leaves while preserving keys and collection structure', () => {
    const jwt = [
      encodeBase64UrlFixture({ alg: 'HS256', typ: 'JWT' }),
      encodeBase64UrlFixture({ sub: 'user-1' }),
      'signature',
    ].join('.')
    const result = desensitizeJson(JSON.stringify({
      uuid1: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
      uuid4: '550e8400-e29b-41d4-a716-446655440000',
      uuid7: '0199d645-86f8-7a81-9652-204d8a828677',
      ulid: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      createdAt: '2026-10-12T09:08:07+08:00',
      birthday: '1990-02-28',
      alarm: '09:08:07',
      email: 'ada@example.com',
      phone: '+86 138-0013-8000',
      website: 'https://example.com/users?id=1',
      ipv4: '192.168.1.20',
      ipv6: '2001:db8::1',
      jwt,
      mac: '00:1A:2B:3C:4D:5E',
      ipv4Cidr: '10.0.0.0/8',
      ipv6Cidr: '2001:db8::/32',
      objectId: '507f1f77bcf86cd799439011',
      idCard: '11010519491231002X',
      bankCard: '4111 1111 1111 1111',
      dataUrl: 'data:text/plain;base64,SGVsbG8=',
      domain: 'api.example.com',
      profile: { name: 'Ada', age: 37, active: true, note: null },
      roles: ['admin', 'developer'],
      invalidValues: ['2026-02-30', '999.168.1.20', '12345678'],
    }))

    expect(JSON.parse(result)).toEqual({
      uuid1: 'uuid1',
      uuid4: 'uuid4',
      uuid7: 'uuid7',
      ulid: 'ulid',
      createdAt: 'YYYY-MM-DD HH:MM:SS',
      birthday: 'YYYY-MM-DD',
      alarm: 'HH:MM:SS',
      email: 'email',
      phone: 'phone',
      website: 'url',
      ipv4: 'ipv4',
      ipv6: 'ipv6',
      jwt: 'jwt',
      mac: 'mac',
      ipv4Cidr: 'ipv4_cidr',
      ipv6Cidr: 'ipv6_cidr',
      objectId: 'objectid',
      idCard: 'id_card',
      bankCard: 'bank_card',
      dataUrl: 'data_url',
      domain: 'domain',
      profile: { name: 'string', age: 'number', active: 'boolean', note: 'null' },
      roles: ['string', 'string'],
      invalidValues: ['string', 'string', 'string'],
    })
  })

  it('reports each supported UUID version from its canonical version nibble', () => {
    const uuidValues = Array.from(
      { length: 8 },
      (_, index) => `00000000-0000-${index + 1}000-8000-000000000000`,
    )

    expect(JSON.parse(desensitizeJson(JSON.stringify(uuidValues)))).toEqual([
      'uuid1',
      'uuid2',
      'uuid3',
      'uuid4',
      'uuid5',
      'uuid6',
      'uuid7',
      'uuid8',
    ])
  })

  it('rejects malformed values for structured sensitive-data markers', () => {
    const values = [
      'header_payload.payload.signature',
      '00:1A:2B:3C:4D',
      '10.0.0.0/33',
      '2001:db8::/129',
      '507f1f77bcf86cd79943901z',
      '110105194912310021',
      '4111 1111 1111 1112',
      'data:text/plain;base64,***',
      '-invalid.example.com',
    ]

    expect(JSON.parse(desensitizeJson(JSON.stringify(values)))).toEqual(
      Array.from({ length: values.length }, () => 'string'),
    )
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
