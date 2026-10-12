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

/** HMAC algorithms that can be generated and verified entirely in the browser. */
export type JwtHmacAlgorithm = 'HS256' | 'HS384' | 'HS512'

/** A parsed JWT together with the result of HMAC signature verification. */
export interface VerifiedJwt extends ParsedJwt {
  algorithm: JwtHmacAlgorithm
  valid: boolean
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

/** Encodes UTF-8 text as unpadded Base64URL for JWT compact serialization. */
function encodeBase64Url(input: string): string {
  return encodeBase64(input)
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

/** Maps one JWT HMAC label to the matching Web Crypto digest. */
function jwtHmacHash(algorithm: JwtHmacAlgorithm): 'SHA-256' | 'SHA-384' | 'SHA-512' {
  switch (algorithm) {
    // HS256 is the JWT name for HMAC with SHA-256.
    case 'HS256':
      return 'SHA-256'
    // HS384 is the JWT name for HMAC with SHA-384.
    case 'HS384':
      return 'SHA-384'
    // HS512 is the JWT name for HMAC with SHA-512.
    case 'HS512':
      return 'SHA-512'
  }
}

/** Reads and validates the HMAC algorithm declared by a JWT header. */
function jwtHmacAlgorithm(header: Record<string, unknown>): JwtHmacAlgorithm {
  const algorithm = header.alg

  // Only explicit HMAC algorithms can be safely verified with the shared secret field.
  if (algorithm !== 'HS256' && algorithm !== 'HS384' && algorithm !== 'HS512') {
    throw new Error('JWT alg 必须是 HS256、HS384 或 HS512')
  }

  return algorithm
}

/** Rejects an absent secret before a caller accidentally creates an unsigned-equivalent token. */
function assertJwtSecret(secret: string): void {
  // Empty HMAC secrets are technically possible but unsafe for an interactive signing tool.
  if (secret.length === 0) {
    throw new Error('JWT 密钥不能为空')
  }
}

/** Signs JWT compact data with a browser-local HMAC key and returns Base64URL text. */
async function signJwtData(data: string, secret: string, algorithm: JwtHmacAlgorithm): Promise<string> {
  assertJwtSecret(secret)

  // Web Crypto keeps the supplied secret and generated signature local to the browser.
  if (!globalThis.crypto?.subtle) {
    throw new Error('当前浏览器不支持 JWT 签名')
  }

  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: { name: jwtHmacHash(algorithm) } },
    false,
    ['sign'],
  )
  const signature = await globalThis.crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))
  return btoa(bytesToBinaryString(new Uint8Array(signature)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
}

/** Compares two compact-signature strings without stopping at the first mismatched character. */
function constantTimeTextEqual(left: string, right: string): boolean {
  // Differently sized signatures cannot match and must not enter an out-of-bounds comparison.
  if (left.length !== right.length) {
    return false
  }

  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    // Every character is compared so a matching prefix does not change the loop duration.
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }

  return difference === 0
}

/** Creates a compact HMAC-signed JWT from an object payload. */
export async function createJwt(
  payload: Record<string, unknown>,
  secret: string,
  algorithm: JwtHmacAlgorithm = 'HS256',
): Promise<string> {
  const header = { alg: algorithm, typ: 'JWT' }
  const signingInput = `${encodeBase64Url(JSON.stringify(header))}.${encodeBase64Url(JSON.stringify(payload))}`
  const signature = await signJwtData(signingInput, secret, algorithm)

  return `${signingInput}.${signature}`
}

/** Verifies a compact HMAC-signed JWT and returns its decoded header and payload. */
export async function verifyJwtSignature(input: string, secret: string): Promise<VerifiedJwt> {
  const parsed = parseJwt(input)
  const algorithm = jwtHmacAlgorithm(parsed.header)
  const signingInput = input.trim().split('.').slice(0, 2).join('.')
  const expectedSignature = await signJwtData(signingInput, secret, algorithm)

  return {
    ...parsed,
    algorithm,
    valid: constantTimeTextEqual(parsed.signature, expectedSignature),
  }
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

/** Checks whether a YYYY-MM-DD value represents a real calendar date. */
function isDateString(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)

  // Non-matching strings cannot provide the year, month, and day required for validation.
  if (!match) {
    return false
  }

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(0)
  date.setUTCHours(0, 0, 0, 0)
  date.setUTCFullYear(year, month - 1, day)

  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
}

/** Checks common date-time strings with optional fractions and UTC offsets. */
function isDateTimeString(value: string): boolean {
  const match = /^(\d{4}-\d{2}-\d{2})[T ](?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:(?:0\d|1[0-3]):?[0-5]\d|14:?00))?$/.exec(value)

  // A complete time component is required before the calendar portion is checked.
  if (!match) {
    return false
  }

  return isDateString(match[1])
}

/** Checks standalone 24-hour time strings with optional fractions and UTC offsets. */
function isTimeString(value: string): boolean {
  return /^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:(?:0\d|1[0-3]):?[0-5]\d|14:?00))?$/.test(value)
}

/** Checks dotted IPv4 addresses without accepting out-of-range octets. */
function isIpv4String(value: string): boolean {
  const octets = value.split('.')

  // IPv4 always contains exactly four decimal octets.
  if (octets.length !== 4) {
    return false
  }

  return octets.every((octet) => /^(?:0|[1-9]\d{0,2})$/.test(octet) && Number(octet) <= 255)
}

/** Checks colon-delimited IPv6 values with the platform URL parser. */
function isIpv6String(value: string): boolean {
  // A colon is required so ordinary hostnames are not delegated to the IPv6 parser.
  if (!value.includes(':')) {
    return false
  }

  try {
    const url = new URL(`http://[${value}]/`)
    return url.hostname.startsWith('[') && url.hostname.endsWith(']')
  } catch {
    // URL parsing rejects malformed or out-of-range IPv6 segments.
    return false
  }
}

/** Checks absolute HTTP and HTTPS URLs without treating ordinary text as a relative URL. */
function isUrlString(value: string): boolean {
  // Only absolute web URLs belong to the URL marker used by this toolbox.
  if (!/^https?:\/\/\S+$/i.test(value)) {
    return false
  }

  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    // URL parsing rejects malformed hosts, ports, and escape sequences.
    return false
  }
}

/** Checks mainland mobile numbers or explicit international E.164-style numbers. */
function isPhoneString(value: string): boolean {
  const compact = value.replace(/[\s()-]/g, '')

  // Unprefixed phone detection stays narrow to avoid classifying arbitrary numeric IDs.
  if (/^1[3-9]\d{9}$/.test(compact)) {
    return true
  }

  return /^\+[1-9]\d{7,14}$/.test(compact)
}

/** Checks compact JWT text by validating its segments and decoded JSON objects. */
function isJwtString(value: string): boolean {
  // Requiring three non-empty Base64URL segments avoids treating arbitrary dotted text as a JWT.
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) {
    return false
  }

  try {
    parseJwt(value)
    return true
  } catch {
    // Malformed Base64URL or non-object JSON segments are not valid JWT values.
    return false
  }
}

/** Checks common six-octet MAC address representations. */
function isMacAddressString(value: string): boolean {
  return /^(?:[0-9a-f]{2}([:-]))(?:[0-9a-f]{2}\1){4}[0-9a-f]{2}$/i.test(value)
    || /^(?:[0-9a-f]{4}\.){2}[0-9a-f]{4}$/i.test(value)
}

/** Checks IPv4 and IPv6 CIDR notation and returns its matching marker. */
function cidrMarker(value: string): 'ipv4_cidr' | 'ipv6_cidr' | undefined {
  const parts = value.split('/')

  // CIDR notation contains one address and one numeric prefix length.
  if (parts.length !== 2 || !/^\d{1,3}$/.test(parts[1])) {
    return undefined
  }

  const prefixLength = Number(parts[1])

  // IPv4 networks allow prefix lengths from zero through 32.
  if (isIpv4String(parts[0]) && prefixLength <= 32) {
    return 'ipv4_cidr'
  }

  // IPv6 networks allow prefix lengths from zero through 128.
  if (isIpv6String(parts[0]) && prefixLength <= 128) {
    return 'ipv6_cidr'
  }

  return undefined
}

/** Checks a MongoDB ObjectId represented as 12 hexadecimal bytes. */
function isObjectIdString(value: string): boolean {
  return /^[0-9a-f]{24}$/i.test(value)
}

/** Checks an 18-character Chinese resident identity number and its checksum. */
function isChineseIdCardString(value: string): boolean {
  const normalized = value.toUpperCase()

  // The address, birth date, sequence, and checksum fields must occupy their fixed positions.
  if (!/^[1-9]\d{5}\d{8}\d{3}[\dX]$/.test(normalized)) {
    return false
  }

  const birthday = `${normalized.slice(6, 10)}-${normalized.slice(10, 12)}-${normalized.slice(12, 14)}`

  // Impossible calendar dates cannot belong to a valid identity number.
  if (!isDateString(birthday)) {
    return false
  }

  // A zero sequence code is reserved and does not identify a person.
  if (normalized.slice(14, 17) === '000') {
    return false
  }

  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
  const checkCharacters = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2']
  const checksum = normalized
    .slice(0, 17)
    .split('')
    .reduce((sum, digit, index) => sum + Number(digit) * weights[index], 0)

  return checkCharacters[checksum % 11] === normalized[17]
}

/** Checks a separated or compact bank-card number with the Luhn checksum. */
function isBankCardString(value: string): boolean {
  // Only digits, spaces, and hyphens are accepted before separator removal.
  if (!/^[\d -]+$/.test(value)) {
    return false
  }

  const digits = value.replace(/[ -]/g, '')

  // Common payment card numbers contain 12 through 19 digits and never start with zero.
  if (!/^[1-9]\d{11,18}$/.test(digits)) {
    return false
  }

  let checksum = 0
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index])

    // Every second digit from the right is doubled by the Luhn algorithm.
    if ((digits.length - index) % 2 === 0) {
      digit *= 2

      // Doubled decimal digits are reduced to their digit sum.
      if (digit > 9) {
        digit -= 9
      }
    }

    checksum += digit
  }

  return checksum % 10 === 0
}

/** Checks RFC-style data URLs and validates Base64 payloads when declared. */
function isDataUrlString(value: string): boolean {
  const match = /^data:([^,]*),([\s\S]*)$/i.exec(value)

  // The metadata and payload must be separated by the first comma.
  if (!match) {
    return false
  }

  const metadata = match[1]

  // Metadata may omit the media type but any supplied parameters must be syntactically bounded.
  if (!/^(?:[a-z]+\/[a-z0-9.+-]+)?(?:;[a-z0-9!#$&^_.+-]+=[^;,]+)*(?:;base64)?$/i.test(metadata)) {
    return false
  }

  // Non-Base64 data URLs carry URL-escaped text and need no binary decoding.
  if (!metadata.toLowerCase().endsWith(';base64')) {
    return true
  }

  try {
    atob(match[2])
    return true
  } catch {
    // Declared Base64 payloads must decode successfully.
    return false
  }
}

/** Checks ASCII DNS domain names with bounded labels and a named top-level domain. */
function isDomainString(value: string): boolean {
  let normalized = value

  // A final root-label dot is valid DNS notation but not part of the labels themselves.
  if (normalized.endsWith('.')) {
    normalized = normalized.slice(0, -1)
  }

  // DNS names are bounded to 253 visible characters and must include a parent domain.
  if (normalized.length === 0 || normalized.length > 253 || !normalized.includes('.')) {
    return false
  }

  const labels = normalized.split('.')

  // Every label must stay within DNS length limits and cannot begin or end with a hyphen.
  if (!labels.every((label) => /^(?!-)[a-z0-9-]{1,63}(?<!-)$/.test(label))) {
    return false
  }

  const topLevelDomain = labels[labels.length - 1]
  return /^[a-z]{2,63}$/i.test(topLevelDomain)
    || /^xn--[a-z0-9-]{2,59}$/i.test(topLevelDomain)
}

/** Returns the most specific safe marker for one JSON string value. */
function desensitizedStringMarker(value: string): string {
  const uuidMatch = /^[0-9a-f]{8}-[0-9a-f]{4}-([1-8])[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.exec(value)

  // UUID versions share one canonical layout, with the version encoded in the third group.
  if (uuidMatch) {
    return `uuid${uuidMatch[1]}`
  }

  // ULIDs use 26 Crockford Base32 characters and a bounded timestamp prefix.
  if (/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/i.test(value)) {
    return 'ulid'
  }

  // MongoDB ObjectIds are fixed-width hexadecimal identifiers.
  if (isObjectIdString(value)) {
    return 'objectid'
  }

  // JWT parsing confirms both compact serialization and decoded JSON objects.
  if (isJwtString(value)) {
    return 'jwt'
  }

  // Full date-times take precedence over their date prefix.
  if (isDateTimeString(value)) {
    return 'YYYY-MM-DD HH:MM:SS'
  }

  // Calendar-only values keep their expected presentation shape.
  if (isDateString(value)) {
    return 'YYYY-MM-DD'
  }

  // Standalone time values keep their expected presentation shape.
  if (isTimeString(value)) {
    return 'HH:MM:SS'
  }

  // Email recognition remains intentionally syntax-based and does not claim deliverability.
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return 'email'
  }

  // Data URLs have their own scheme and optional Base64 payload validation.
  if (isDataUrlString(value)) {
    return 'data_url'
  }

  // Absolute web URLs are checked before IP literals embedded in their hosts.
  if (isUrlString(value)) {
    return 'url'
  }

  const networkMarker = cidrMarker(value)

  // CIDR values retain their address family in the marker.
  if (networkMarker) {
    return networkMarker
  }

  // Valid dotted decimal addresses receive the IPv4 marker.
  if (isIpv4String(value)) {
    return 'ipv4'
  }

  // Valid compressed or expanded colon addresses receive the IPv6 marker.
  if (isIpv6String(value)) {
    return 'ipv6'
  }

  // Six-octet hardware addresses are normalized to one MAC marker.
  if (isMacAddressString(value)) {
    return 'mac'
  }

  // Resident identity numbers require both a valid birth date and checksum.
  if (isChineseIdCardString(value)) {
    return 'id_card'
  }

  // Payment card numbers require a plausible length and successful Luhn checksum.
  if (isBankCardString(value)) {
    return 'bank_card'
  }

  // Phone recognition runs after dates and IPs to reduce numeric false positives.
  if (isPhoneString(value)) {
    return 'phone'
  }

  // Bare hostnames are checked last so more specific network formats take precedence.
  if (isDomainString(value)) {
    return 'domain'
  }

  return 'string'
}

/** Replaces JSON leaf values with stable type markers while preserving its structure. */
export function desensitizeJson(input: string | unknown, spaces = 2): string {
  /** Converts one parsed JSON value without exposing its original leaf content. */
  function desensitizeValue(value: unknown): unknown {
    // Arrays retain their length and nesting while each contained value is desensitized.
    if (Array.isArray(value)) {
      return value.map(desensitizeValue)
    }

    // JSON null is represented by an explicit marker instead of being mistaken for an object.
    if (value === null) {
      return 'null'
    }

    // Object keys describe the schema and remain intact while their values are desensitized.
    if (typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .map(([key, nestedValue]) => [key, desensitizeValue(nestedValue)]),
      )
    }

    // Strings receive the most specific semantic marker before primitive fallback.
    if (typeof value === 'string') {
      return desensitizedStringMarker(value)
    }

    // Remaining primitive values expose only their JSON type.
    return typeof value
  }

  return formatJson(desensitizeValue(parseJsonInput(input)), spaces)
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
