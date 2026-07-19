import md5 from 'crypto-js/md5'

/** Supported text digest algorithms exposed by this toolbox. */
export type HashAlgorithm = 'MD5' | 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512'

/** A normalized view of one date value in common timestamp formats. */
export interface DateConversion {
  iso: string
  unixSeconds: number
  unixMilliseconds: number
}

/** The structured fields extracted from an absolute or base-relative URL. */
export interface UrlAnalysis {
  href: string
  protocol: string
  username: string
  password: string
  host: string
  hostname: string
  port: string
  pathname: string
  search: string
  hash: string
  origin: string
  query: Record<string, string[]>
}

/** The decoded, but deliberately unverified, parts of a JWT. */
export interface ParsedJwt {
  header: Record<string, unknown>
  payload: Record<string, unknown>
  signature: string
}

/** Basic counts useful when inspecting an arbitrary text value. */
export interface TextStats {
  characters: number
  charactersWithoutSpaces: number
  words: number
  lines: number
  bytes: number
}

const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz'

/** Converts a byte sequence to a lowercase hexadecimal string. */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Hashes UTF-8 text with MD5 or a standard Web Crypto SHA digest algorithm. */
export async function hashText(
  input: string,
  algorithm: HashAlgorithm = 'SHA-256',
): Promise<string> {
  // Web Crypto intentionally excludes MD5, so the installed compatibility library handles it.
  if (algorithm === 'MD5') {
    return md5(input).toString()
  }

  // Web Crypto is required so hashing stays standards-based and dependency-free.
  if (!globalThis.crypto?.subtle) {
    throw new Error('Web Crypto is not available in this environment')
  }

  const bytes = new TextEncoder().encode(input)
  const digest = await globalThis.crypto.subtle.digest(algorithm, bytes)
  return bytesToHex(new Uint8Array(digest))
}

/** Validates that a numeral base is supported by the converter. */
function assertBase(base: number): void {
  // Bases 2 through 36 map exactly to the shared digit alphabet.
  if (!Number.isInteger(base) || base < 2 || base > 36) {
    throw new RangeError('Base must be an integer between 2 and 36')
  }
}

/** Parses a signed integer string in an arbitrary base without losing precision. */
function parseBigIntInBase(input: string, base: number): bigint {
  const normalized = input.trim().toLowerCase()

  // Empty input cannot represent an integer.
  if (normalized.length === 0) {
    throw new Error('Value cannot be empty')
  }

  const isNegative = normalized.startsWith('-')
  let unsigned = normalized

  // A leading minus controls the sign and is not part of the digit sequence.
  if (isNegative) {
    unsigned = normalized.slice(1)
  }

  // A standalone sign has no numeric value.
  if (unsigned.length === 0) {
    throw new Error('Value must contain at least one digit')
  }

  let result = 0n
  for (const character of unsigned) {
    const digit = DIGITS.indexOf(character)

    // Each input digit must exist and be valid for the source base.
    if (digit < 0 || digit >= base) {
      throw new Error(`Invalid digit "${character}" for base ${base}`)
    }

    result = result * BigInt(base) + BigInt(digit)
  }

  // The accumulated magnitude is negated only when the source had a minus sign.
  if (isNegative) {
    return -result
  }

  return result
}

/** Converts an integer string between bases 2 and 36 with arbitrary precision. */
export function convertBase(input: string, fromBase: number, toBase: number): string {
  assertBase(fromBase)
  assertBase(toBase)
  return parseBigIntInBase(input, fromBase).toString(toBase)
}

const ROMAN_PAIRS: ReadonlyArray<readonly [number, string]> = [
  [1000, 'M'],
  [900, 'CM'],
  [500, 'D'],
  [400, 'CD'],
  [100, 'C'],
  [90, 'XC'],
  [50, 'L'],
  [40, 'XL'],
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
]

/** Converts an integer from 1 through 3999 to canonical Roman numerals. */
export function numberToRoman(input: number): string {
  // Conventional Roman numerals in this tool are restricted to 1 through 3999.
  if (!Number.isInteger(input) || input < 1 || input > 3999) {
    throw new RangeError('Roman numeral input must be an integer between 1 and 3999')
  }

  let remainder = input
  let result = ''

  for (const [value, symbol] of ROMAN_PAIRS) {
    // Repeating the current symbol consumes all matching place values.
    while (remainder >= value) {
      result += symbol
      remainder -= value
    }
  }

  return result
}

/** Converts a canonical Roman numeral from I through MMMCMXCIX to a number. */
export function romanToNumber(input: string): number {
  const normalized = input.trim().toUpperCase()

  // The pattern rejects non-canonical subtractive and repeated forms.
  if (!/^M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/.test(normalized) || normalized.length === 0) {
    throw new Error('Invalid Roman numeral')
  }

  const values: Record<string, number> = {
    I: 1,
    V: 5,
    X: 10,
    L: 50,
    C: 100,
    D: 500,
    M: 1000,
  }
  let result = 0

  for (let index = 0; index < normalized.length; index += 1) {
    const current = values[normalized[index]]
    const next = values[normalized[index + 1]] ?? 0

    // A smaller symbol before a larger one is a subtractive pair.
    if (current < next) {
      result -= current
    } else {
      // All other symbols add their ordinary value.
      result += current
    }
  }

  return result
}

/** Parses dates, date strings, and second/millisecond timestamps consistently. */
function parseDateInput(input: string | number | Date): Date {
  // Date instances are cloned so callers cannot observe mutation.
  if (input instanceof Date) {
    return new Date(input.getTime())
  }

  // Small numeric timestamps are interpreted as Unix seconds; larger values as milliseconds.
  if (typeof input === 'number') {
    let milliseconds = input

    // Values below the millisecond era threshold are conventional Unix seconds.
    if (Math.abs(input) < 1e12) {
      milliseconds = input * 1000
    }

    return new Date(milliseconds)
  }

  const normalized = input.trim()

  // Numeric strings follow the same seconds-versus-milliseconds rule as numbers.
  if (/^-?\d+(\.\d+)?$/.test(normalized)) {
    return parseDateInput(Number(normalized))
  }

  return new Date(normalized)
}

/** Converts a date-like input to ISO, Unix seconds, and Unix milliseconds. */
export function convertDate(input: string | number | Date): DateConversion {
  const date = parseDateInput(input)

  // Invalid dates are rejected before formatting methods can throw opaque errors.
  if (Number.isNaN(date.getTime())) {
    throw new Error('Invalid date value')
  }

  return {
    iso: date.toISOString(),
    unixSeconds: Math.floor(date.getTime() / 1000),
    unixMilliseconds: date.getTime(),
  }
}

/** Formats a date-like input as YYYY-MM-DD HH:mm:ss in an IANA time zone. */
export function formatDateInTimeZone(
  input: string | number | Date,
  timeZone: string,
): string {
  const date = parseDateInput(input)

  // Invalid dates must not reach Intl.DateTimeFormat.
  if (Number.isNaN(date.getTime())) {
    throw new Error('Invalid date value')
  }

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  )

  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`
}

/** Converts arbitrary bytes to a binary string accepted by btoa. */
function bytesToBinaryString(bytes: Uint8Array): string {
  let result = ''

  for (const byte of bytes) {
    result += String.fromCharCode(byte)
  }

  return result
}

/** Encodes a Unicode string as UTF-8 Base64. */
export function encodeBase64(input: string): string {
  const bytes = new TextEncoder().encode(input)
  return btoa(bytesToBinaryString(bytes))
}

/** Decodes UTF-8 Base64 to its original Unicode string. */
export function decodeBase64(input: string): string {
  let binary: string

  try {
    binary = atob(input.trim())
  } catch {
    throw new Error('Invalid Base64 string')
  }

  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

/** Converts ASCII text to space-separated 8-bit binary bytes. */
export function textToAsciiBinary(input: string): string {
  return Array.from(input, (character) => {
    const code = character.charCodeAt(0)

    // ASCII is seven-bit data represented here in padded eight-bit groups.
    if (code > 0x7f) {
      throw new Error(`Non-ASCII character: ${character}`)
    }

    return code.toString(2).padStart(8, '0')
  }).join(' ')
}

/** Converts space-separated 8-bit ASCII binary bytes back to text. */
export function asciiBinaryToText(input: string): string {
  const normalized = input.trim()

  // Empty binary input represents empty text.
  if (normalized.length === 0) {
    return ''
  }

  return normalized.split(/\s+/).map((byte) => {
    // Exactly eight binary digits keep byte boundaries unambiguous.
    if (!/^[01]{8}$/.test(byte)) {
      throw new Error(`Invalid ASCII byte: ${byte}`)
    }

    const value = Number.parseInt(byte, 2)

    // Values above 127 are bytes, but not ASCII characters.
    if (value > 0x7f) {
      throw new Error(`Byte is outside ASCII range: ${byte}`)
    }

    return String.fromCharCode(value)
  }).join('')
}

/** Converts text code points to JavaScript-style Unicode escape sequences. */
export function textToUnicode(input: string): string {
  return Array.from(input, (character) => {
    const codePoint = character.codePointAt(0) as number

    // Supplementary-plane characters need code-point escape notation.
    if (codePoint > 0xffff) {
      return `\\u{${codePoint.toString(16).toUpperCase()}}`
    }

    return `\\u${codePoint.toString(16).toUpperCase().padStart(4, '0')}`
  }).join('')
}

/** Converts JavaScript-style four-digit or code-point Unicode escapes to text. */
export function unicodeToText(input: string): string {
  const codePointPattern = /\\u\{([0-9a-fA-F]{1,6})\}/g
  const codeUnitPattern = /\\u([0-9a-fA-F]{4})/g
  const withCodePoints = input.replace(codePointPattern, (_match, hexadecimal: string) => {
    const value = Number.parseInt(hexadecimal, 16)

    // Unicode ends at U+10FFFF even though six hexadecimal digits allow more.
    if (value > 0x10ffff) {
      throw new Error(`Invalid Unicode code point: ${hexadecimal}`)
    }

    return String.fromCodePoint(value)
  })

  return withCodePoints.replace(codeUnitPattern, (_match, hexadecimal: string) => (
    String.fromCharCode(Number.parseInt(hexadecimal, 16))
  ))
}

/** Encodes text for use as one URL component. */
export function encodeUrlComponent(input: string): string {
  return encodeURIComponent(input)
}

/** Decodes one URL component and presents malformed escapes as a clear error. */
export function decodeUrlComponent(input: string): string {
  try {
    return decodeURIComponent(input)
  } catch {
    throw new Error('Invalid URL-encoded string')
  }
}

/** Parses an absolute URL, or a relative URL when an explicit base is supplied. */
export function analyzeUrl(input: string, base?: string): UrlAnalysis {
  let url: URL

  try {
    // A base is used only when the caller intentionally supplies one for relative input.
    if (base !== undefined) {
      url = new URL(input, base)
    } else {
      // Without a base, requiring an absolute URL avoids silently inventing an origin.
      url = new URL(input)
    }
  } catch {
    throw new Error('Invalid URL')
  }

  const query: Record<string, string[]> = {}
  for (const [key, value] of url.searchParams) {
    // Repeated query keys are preserved instead of overwriting earlier values.
    if (query[key]) {
      query[key].push(value)
    } else {
      // The first occurrence creates the value list for that query key.
      query[key] = [value]
    }
  }

  return {
    href: url.href,
    protocol: url.protocol,
    username: url.username,
    password: url.password,
    host: url.host,
    hostname: url.hostname,
    port: url.port,
    pathname: url.pathname,
    search: url.search,
    hash: url.hash,
    origin: url.origin,
    query,
  }
}

/** Decodes one unpadded Base64URL segment as UTF-8 text. */
function decodeBase64Url(input: string): string {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/')
  const remainder = base64.length % 4
  let padded = base64

  // One missing byte requires two padding characters.
  if (remainder === 2) {
    padded += '=='
  } else if (remainder === 3) {
    // Two missing bytes require one padding character.
    padded += '='
  } else if (remainder === 1) {
    // A Base64 value cannot have exactly one character in its final block.
    throw new Error('Invalid Base64URL segment')
  }

  return decodeBase64(padded)
}

/** Parses a JWT header and payload without claiming to verify its signature. */
export function parseJwt(input: string): ParsedJwt {
  const parts = input.trim().split('.')

  // Compact JWT serialization always contains header, payload, and signature segments.
  if (parts.length !== 3) {
    throw new Error('JWT must contain exactly three segments')
  }

  try {
    const header = JSON.parse(decodeBase64Url(parts[0])) as unknown
    const payload = JSON.parse(decodeBase64Url(parts[1])) as unknown

    // JWT headers and payloads must be JSON objects for predictable inspection.
    if (!isPlainObject(header) || !isPlainObject(payload)) {
      throw new Error('JWT header and payload must be JSON objects')
    }

    return { header, payload, signature: parts[2] }
  } catch (error) {
    // Purposeful validation errors are retained instead of being obscured.
    if (error instanceof Error && error.message === 'JWT header and payload must be JSON objects') {
      throw error
    }

    throw new Error('JWT contains invalid JSON or Base64URL data')
  }
}

/** Returns whether a value is a non-array JSON object. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Shuffles Unicode code points with Fisher-Yates using an injected random source. */
export function shuffleString(input: string, random: () => number): string {
  const characters = Array.from(input)

  for (let index = characters.length - 1; index > 0; index -= 1) {
    const sample = random()

    // The injected source must follow the Math.random range contract.
    if (sample < 0 || sample >= 1 || !Number.isFinite(sample)) {
      throw new Error('Random source must return a finite number from 0 up to, but not including, 1')
    }

    const replacementIndex = Math.floor(sample * (index + 1))
    const current = characters[index]
    characters[index] = characters[replacementIndex]
    characters[replacementIndex] = current
  }

  return characters.join('')
}

/** Parses a JSON string or passes an already parsed JSON-compatible value through. */
function parseJsonInput(input: string | unknown): unknown {
  // String input represents serialized JSON in these JSON-focused tools.
  if (typeof input === 'string') {
    return JSON.parse(input)
  }

  return input
}

/** Pretty-prints serialized or already parsed JSON with configurable indentation. */
export function formatJson(input: string | unknown, spaces = 2): string {
  // JSON indentation is limited by the platform and negative values are nonsensical.
  if (!Number.isInteger(spaces) || spaces < 0 || spaces > 10) {
    throw new RangeError('JSON indentation must be an integer between 0 and 10')
  }

  const result = JSON.stringify(parseJsonInput(input), null, spaces)

  // Undefined and unsupported root values cannot produce JSON text.
  if (result === undefined) {
    throw new Error('Value cannot be represented as JSON')
  }

  return result
}

/** Removes unnecessary whitespace from serialized or already parsed JSON. */
export function minifyJson(input: string | unknown): string {
  return formatJson(input, 0)
}

/** Converts one JSON-compatible value to a readable CSV cell string. */
function stringifyCsvValue(value: unknown): string {
  // Missing and null values conventionally become empty CSV fields.
  if (value === null || value === undefined) {
    return ''
  }

  // Nested objects and arrays retain their structure as compact JSON.
  if (typeof value === 'object') {
    const serialized = JSON.stringify(value)

    // Ordinary JSON objects serialize to text; unsupported values become empty cells.
    if (serialized === undefined) {
      return ''
    }

    return serialized
  }

  return String(value)
}

/** Escapes one CSV cell according to RFC-style comma-separated quoting rules. */
function escapeCsvCell(value: string): string {
  // Cells containing delimiters, quotes, or line breaks must be quoted.
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }

  return value
}

/** Converts an array of JSON objects, or one object, to comma-separated values. */
export function jsonToCsv(input: string | unknown): string {
  const parsed = parseJsonInput(input)
  let sourceRows: unknown[]

  // Arrays already represent CSV rows and must retain their original order.
  if (Array.isArray(parsed)) {
    sourceRows = parsed
  } else {
    // A single object is treated as a one-row CSV document.
    sourceRows = [parsed]
  }

  // An empty JSON array naturally maps to an empty CSV document.
  if (sourceRows.length === 0) {
    return ''
  }

  // CSV columns require object-shaped rows rather than ambiguous scalar values.
  if (!sourceRows.every(isPlainObject)) {
    throw new Error('JSON to CSV requires an object or an array of objects')
  }

  const rows = sourceRows as Record<string, unknown>[]
  const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row))))

  // Objects without any properties have no CSV columns to emit.
  if (headers.length === 0) {
    return ''
  }

  const lines = [headers.map(escapeCsvCell).join(',')]
  for (const row of rows) {
    lines.push(headers.map((header) => (
      escapeCsvCell(stringifyCsvValue(row[header]))
    )).join(','))
  }

  return lines.join('\r\n')
}

/** Counts Unicode characters, words, lines, non-space characters, and UTF-8 bytes. */
export function countText(input: string): TextStats {
  const words = input.match(/[\p{Script=Han}]|[\p{L}\p{N}_]+/gu) ?? []
  let lines = 0

  // Non-empty text always has at least one line, with newline sequences adding more.
  if (input.length > 0) {
    lines = input.split(/\r\n|\r|\n/).length
  }

  return {
    characters: Array.from(input).length,
    charactersWithoutSpaces: Array.from(input).filter((character) => !/\s/u.test(character)).length,
    words: words.length,
    lines,
    bytes: new TextEncoder().encode(input).length,
  }
}
