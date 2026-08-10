import {
  AudioLines,
  BadgeCheck,
  Binary,
  Braces,
  CalendarClock,
  ChartNoAxesColumnIncreasing,
  Container,
  FileCode2,
  FileJson,
  FileKey2,
  FileText,
  FingerprintPattern,
  GitCompareArrows,
  Globe2,
  Hash,
  KeyRound,
  Link,
  ListRestart,
  Network,
  NetworkIcon,
  Regex,
  Shuffle,
  SquareTerminal,
  TableProperties,
  TextCursorInput,
} from '@lucide/vue'
import { ulid } from 'ulid'
import { v1 as uuidV1, v4 as uuidV4, v7 as uuidV7 } from 'uuid'

import {
  calculateIpv4Subnet,
  compareText,
  convertIpv4Address,
  formatSqlText,
  formatXml,
  formatYaml,
  generateIpv6Ula,
  generateMacAddress,
  jsonDiff,
  jsonToToml,
  jsonToXml,
  jsonToYaml,
  testRegex,
  tomlToJson,
  tomlToYaml,
  xmlToJson,
  yamlToJson,
  yamlToToml,
} from '../lib/advanced'
import type { DiffPart, MacAddressOptions, SqlDialect } from '../lib/advanced'
import {
  analyzeAudioFile,
  audioFileFormat,
  audioMimeType,
  formatAudioChannelCount,
  formatAudioDuration,
  formatAudioFileSize,
} from '../lib/audio'
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
} from '../lib/core'
import type { HashAlgorithm } from '../lib/core'
import {
  composeToDockerRuns,
  createBase64Download,
  dockerRunToCompose,
  fileToBase64Data,
  generateRsaKeyPair,
} from '../lib/special'
import type { BaseTextEncoding } from '../lib/base-encodings'
import type { FetchMethod } from '../lib/fetch-request'
import type { RsaModulusLength } from '../lib/special'
import {
  findWorldClockLocations,
  formatWorldClockTime,
  worldClockLocationLabel,
} from '../lib/world-clock'
import { language } from '../lib/i18n'
import type { ToolCategory, ToolDefinition, ToolResult, ToolValues } from './types'

export const categories: ToolCategory[] = [
  { id: 'generate', label: '生成器' },
  { id: 'encode', label: '编码与解析' },
  { id: 'data', label: '数据格式' },
  { id: 'network', label: '网络工具' },
  { id: 'developer', label: '开发辅助' },
  { id: 'text', label: '文本与数值' },
]

const categoryById = Object.fromEntries(categories.map((category) => [category.id, category]))

/** Reads a field as text while preserving numeric and boolean values entered by native controls. */
function textValue(values: ToolValues, key: string): string {
  const value = values[key]

  // Files and null are not meaningful textual inputs for converter handlers.
  if (value === null || value instanceof File) {
    return ''
  }

  return String(value)
}

/** Reads a numeric field and rejects values that native input validation did not catch. */
function numberValue(values: ToolValues, key: string): number {
  const value = Number(values[key])

  // Converter calculations require finite numbers rather than NaN or infinities.
  if (!Number.isFinite(value)) {
    throw new Error(`${key} 必须是有效数字`)
  }

  return value
}

/** Reads a required browser File from the generic field map. */
function fileValue(values: ToolValues, key: string): File {
  const value = values[key]

  // File tools cannot run until the user has selected a local file.
  if (!(value instanceof File)) {
    throw new Error('请先选择文件')
  }

  return value
}

/** Produces an ordinary text result for the shared workbench. */
function output(value: unknown): ToolResult {
  // Structured values are formatted so generated reports remain readable and copyable.
  if (typeof value !== 'string') {
    return {
      output: JSON.stringify(value, null, 2),
      language: 'json',
    }
  }

  return { output: value }
}

/** Marks validated JSON text for syntax-aware rendering in the output workbench. */
function jsonOutput(value: string): ToolResult {
  return {
    output: value,
    language: 'json',
  }
}

/** Produces a text result that also preserves individually actionable generated items. */
function itemOutput(items: string[]): ToolResult {
  return {
    output: items.join('\n'),
    items,
  }
}

/** Returns cryptographically strong random bytes for local identifier generators. */
function entropy(length: number): Uint8Array {
  const bytes = new Uint8Array(length)

  // Identifier generation must use browser cryptographic randomness when available.
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error('当前浏览器不支持安全随机数生成')
  }

  globalThis.crypto.getRandomValues(bytes)
  return bytes
}

/** Clamps a requested generator count to a practical browser-safe range. */
function itemCount(values: ToolValues): number {
  return Math.min(100, Math.max(1, Math.floor(numberValue(values, 'count'))))
}

/** Renders line or JSON diff fragments as a conventional unified text view. */
function renderDiff(parts: DiffPart[]): string {
  const lines: string[] = []

  for (const part of parts) {
    let prefix = '  '

    // Added lines use the plus marker familiar from source diffs.
    if (part.added) {
      prefix = '+ '
    } else if (part.removed) {
      // Removed lines use the minus marker familiar from source diffs.
      prefix = '- '
    }

    const partLines = part.value.split('\n')

    // A final empty token represents the source newline, not another diff row.
    if (part.value.endsWith('\n')) {
      partLines.pop()
    }

    lines.push(...partLines.map((line) => `${prefix}${line}`))
  }

  return lines.join('\n')
}

/** Compares two text fields and marks the unified output for Git-style rendering. */
function compareTextTool(values: ToolValues): ToolResult {
  return {
    output: renderDiff(compareText(textValue(values, 'before'), textValue(values, 'after'))),
    language: 'diff',
  }
}

/** Counts one text input and exposes the summary with Chinese field names. */
function countTextTool(values: ToolValues): ToolResult {
  const stats = countText(textValue(values, 'input'))

  return output({
    '字符数': stats.characters,
    '不含空格字符数': stats.charactersWithoutSpaces,
    '单词数': stats.words,
    '行数': stats.lines,
    '字节数': stats.bytes,
  })
}

/** Selects a direction-specific converter without embedding branching in every tool handler. */
function directed(
  values: ToolValues,
  handlers: Record<string, (input: string) => string>,
): ToolResult {
  const direction = textValue(values, 'direction')
  const handler = handlers[direction]

  // A missing handler indicates a corrupted tool definition rather than user input.
  if (!handler) {
    throw new Error('不支持的转换方向')
  }

  return output(handler(textValue(values, 'input')))
}

/** Converts text through the selected Base32 or Base58 codec loaded on demand. */
async function convertBaseEncoding(values: ToolValues): Promise<ToolResult> {
  const { decodeBaseText, encodeBaseText } = await import('../lib/base-encodings')
  const encoding = textValue(values, 'encoding') as BaseTextEncoding

  // Encode mode converts UTF-8 text into the selected representation.
  if (textValue(values, 'direction') === 'encode') {
    return output(encodeBaseText(textValue(values, 'input'), encoding))
  }

  return output(decodeBaseText(textValue(values, 'input'), encoding))
}

/** Parses a PEM X.509 certificate locally and returns structured details. */
async function parseCertificateTool(values: ToolValues): Promise<ToolResult> {
  const { parseCertificate } = await import('../lib/certificate')
  return output(await parseCertificate(textValue(values, 'certificate')))
}

/** Verifies a PEM certificate and PKCS#8 private key by signing a local challenge. */
async function verifyCertificateKeyTool(values: ToolValues): Promise<ToolResult> {
  const { verifyCertificateKeyPair } = await import('../lib/certificate')
  const matches = await verifyCertificateKeyPair(
    textValue(values, 'certificate'),
    textValue(values, 'privateKey'),
  )
  let result = '证书公钥与私钥不匹配'

  // A verified challenge proves that the supplied private key owns the certificate public key.
  if (matches) {
    result = '证书公钥与私钥匹配'
  }

  return output({ matches, result })
}

/** Converts one cURL command into browser Fetch source without executing it. */
async function convertCurlToFetch(values: ToolValues): Promise<ToolResult> {
  const { curlToFetch } = await import('../lib/curl-fetch')
  return output(curlToFetch(textValue(values, 'input')))
}

/** Generates Fetch source from separately entered URL, Header, Body, and Method fields. */
async function convertRequestToFetch(values: ToolValues): Promise<ToolResult> {
  const { buildFetchRequest } = await import('../lib/fetch-request')

  return output(buildFetchRequest({
    url: textValue(values, 'url'),
    body: textValue(values, 'body'),
    headers: textValue(values, 'headers'),
    method: textValue(values, 'method') as FetchMethod,
  }))
}

const uuidHandlers: Record<string, () => string> = {
  v1: uuidV1,
  v4: uuidV4,
  v7: uuidV7,
}

/** Generates one or more UUID values using the selected standard version. */
function generateUuid(values: ToolValues): ToolResult {
  const generator = uuidHandlers[textValue(values, 'version')]

  // A missing UUID generator indicates an unsupported version value.
  if (!generator) {
    throw new Error('不支持的 UUID 版本')
  }

  // The wrapper prevents Array.from's index argument from being treated as UUID's output buffer.
  const items = Array.from({ length: itemCount(values) }, () => generator())
  return itemOutput(items)
}

/** Converts one date input into ISO, Unix, and target-zone representations. */
function convertDateTool(values: ToolValues): ToolResult {
  const input = textValue(values, 'input')
  const converted = convertDate(input)
  const timeZone = textValue(values, 'timeZone')
  const items = [
    { label: 'ISO 时间', value: converted.iso },
    { label: 'Unix 秒级时间戳', value: String(converted.unixSeconds) },
    { label: 'Unix 毫秒级时间戳', value: String(converted.unixMilliseconds) },
    { label: '时区', value: timeZone },
    { label: '本地时间', value: formatDateInTimeZone(input, timeZone) },
  ]

  return {
    output: items.map(({ label, value }) => `${label}: ${value}`).join('\n'),
    items: items.map(({ value }) => value),
    itemLabels: items.map(({ label }) => label),
  }
}

/** Queries country and city clocks and renders their current local times with IANA time zones. */
function queryWorldClock(values: ToolValues): ToolResult {
  const currentLanguage = language.value
  const locations = findWorldClockLocations(textValue(values, 'query'))

  // A query with no matching country or city must explain the empty result instead of showing stale clocks.
  if (locations.length === 0) {
    return output(currentLanguage === 'en' ? 'No matching country, city, or time zone.' : '未找到匹配的国家、城市或时区。')
  }

  const now = new Date()
  const itemLabels = locations.map((location) => worldClockLocationLabel(location, currentLanguage))
  const items = locations.map((location) => `${formatWorldClockTime(location, now)} (${location.timeZone})`)

  return {
    output: items.map((time, index) => `${itemLabels[index]}: ${time}`).join('\n'),
    items,
    itemLabels,
  }
}

/** Converts a JSON array into a downloadable CSV text result. */
function convertJsonCsv(values: ToolValues): ToolResult {
  return {
    output: jsonToCsv(textValue(values, 'input')),
    filename: 'data.csv',
    mimeType: 'text/csv;charset=utf-8',
  }
}

/** Encodes a selected file or prepares decoded Base64 bytes for download. */
async function convertBase64File(values: ToolValues): Promise<ToolResult> {
  // Encode mode reads the selected file and exposes a complete data URL.
  if (textValue(values, 'direction') === 'encode') {
    const data = await fileToBase64Data(fileValue(values, 'file'))
    return output(data.dataUrl)
  }

  const download = createBase64Download(
    textValue(values, 'input'),
    textValue(values, 'filename'),
    textValue(values, 'mimeType'),
  )

  return {
    output: `文件名: ${download.download}\nMIME: ${download.mimeType}\n大小: ${download.size} bytes`,
    filename: download.download,
    mimeType: download.mimeType,
    downloadHref: download.href,
  }
}

/** Parses a local audio file into playable media, waveform peaks, and Chinese metadata rows. */
async function analyzeAudioTool(values: ToolValues): Promise<ToolResult> {
  const analysis = await analyzeAudioFile(fileValue(values, 'file'))
  const items = [
    { label: '文件名', value: analysis.file.name },
    { label: '格式', value: audioFileFormat(analysis.file) },
    { label: 'MIME 类型', value: audioMimeType(analysis.file) },
    { label: '文件大小', value: formatAudioFileSize(analysis.file.size) },
    { label: '时长', value: formatAudioDuration(analysis.durationSeconds) },
    { label: '采样率', value: `${analysis.sampleRate.toLocaleString('zh-CN')} Hz` },
    { label: '声道数', value: formatAudioChannelCount(analysis.channelCount) },
    { label: '采样帧数', value: analysis.frameCount.toLocaleString('zh-CN') },
  ]

  return {
    output: items.map(({ label, value }) => `${label}: ${value}`).join('\n'),
    items: items.map(({ value }) => value),
    itemLabels: items.map(({ label }) => label),
    audio: analysis,
  }
}

/** Generates locally administered MAC addresses with requested presentation options. */
function generateMac(values: ToolValues): ToolResult {
  const options: MacAddressOptions = {
    locallyAdministered: true,
    multicast: false,
    separator: textValue(values, 'separator') as ':' | '-',
    uppercase: textValue(values, 'uppercase') === 'true',
  }

  const items = Array.from(
    { length: itemCount(values) },
    () => generateMacAddress(entropy(6), options),
  )
  return itemOutput(items)
}

/** Converts Docker input in the selected direction and labels multi-service commands. */
function convertDocker(values: ToolValues): ToolResult {
  const input = textValue(values, 'input')

  // Docker Run input produces one modern Compose services document.
  if (textValue(values, 'direction') === 'run-to-compose') {
    return output(dockerRunToCompose(input))
  }

  return output(
    composeToDockerRuns(input)
      .map((item) => `# ${item.serviceName}\n${item.command}`)
      .join('\n\n'),
  )
}

export const tools: ToolDefinition[] = [
  {
    id: 'md5',
    title: 'MD5 计算',
    category: categoryById.encode,
    icon: Hash,
    fields: [
      { key: 'input', label: '文本', type: 'textarea', defaultValue: '', placeholder: '输入需要计算 MD5 的文本', wide: true },
    ],
    actionLabel: '计算 MD5',
    // Calculates a browser-local MD5 digest for the supplied UTF-8 text.
    execute: async (values) => output(await hashText(textValue(values, 'input'), 'MD5')),
  },
  {
    id: 'hash-text',
    title: 'Hash 文本',
    category: categoryById.encode,
    icon: Hash,
    fields: [
      { key: 'algorithm', label: '算法', type: 'select', defaultValue: 'SHA-256', options: ['MD5', 'SHA-1', 'SHA-256', 'SHA-384', 'SHA-512'].map((value) => ({ label: value, value })) },
      { key: 'input', label: '文本', type: 'textarea', defaultValue: '', placeholder: '输入需要计算 Hash 的文本', wide: true },
    ],
    actionLabel: '计算 Hash',
    // Hashes the input with the selected digest algorithm.
    execute: async (values) => output(await hashText(textValue(values, 'input'), textValue(values, 'algorithm') as HashAlgorithm)),
  },
  {
    id: 'uuid', title: 'UUID 生成', category: categoryById.generate, icon: FingerprintPattern,
    fields: [
      { key: 'version', label: '版本', type: 'select', defaultValue: 'v4', options: [{ label: 'UUID v4', value: 'v4' }, { label: 'UUID v7', value: 'v7' }, { label: 'UUID v1', value: 'v1' }] },
      { key: 'count', label: '数量', type: 'number', defaultValue: 5, min: 1, max: 100 },
    ], actionLabel: '生成 UUID', execute: generateUuid,
  },
  {
    id: 'ulid', title: 'ULID 生成', category: categoryById.generate, icon: FingerprintPattern,
    fields: [{ key: 'count', label: '数量', type: 'number', defaultValue: 5, min: 1, max: 100 }],
    actionLabel: '生成 ULID',
    // Generates sortable ULIDs in the requested amount.
    execute: (values) => itemOutput(Array.from({ length: itemCount(values) }, () => ulid())),
  },
  {
    id: 'rsa', title: 'RSA 密钥对生成', category: categoryById.generate, icon: KeyRound,
    fields: [{ key: 'length', label: '密钥长度', type: 'select', defaultValue: '2048', options: [{ label: '2048 bit', value: '2048' }, { label: '3072 bit', value: '3072' }, { label: '4096 bit', value: '4096' }] }],
    actionLabel: '生成密钥对',
    outputLabels: ['公钥', '私钥'],
    // Generates an exportable RSA-OAEP key pair entirely in the browser.
    execute: async (values) => {
      const pair = await generateRsaKeyPair(numberValue(values, 'length') as RsaModulusLength)
      return {
        output: '',
        outputs: [
          {
            label: '公钥',
            content: pair.publicKeyPem,
            filename: 'rsa-public-key.pem',
            mimeType: 'application/x-pem-file;charset=utf-8',
          },
          {
            label: '私钥',
            content: pair.privateKeyPem,
            filename: 'rsa-private-key.pem',
            mimeType: 'application/x-pem-file;charset=utf-8',
          },
        ],
      }
    },
  },
  {
    id: 'date-time', title: '时间日期转换', category: categoryById.text, icon: CalendarClock,
    fields: [
      { key: 'input', label: '日期或时间戳', type: 'text', defaultValue: new Date().toISOString(), placeholder: 'ISO 日期、Unix 秒或毫秒', wide: true },
      { key: 'timeZone', label: '目标时区', type: 'select', defaultValue: 'Asia/Shanghai', options: ['Asia/Shanghai', 'UTC', 'Asia/Tokyo', 'Europe/London', 'America/New_York'].map((value) => ({ label: value, value })) },
    ], actionLabel: '转换时间', autoRun: true, execute: convertDateTool,
  },
  {
    id: 'world-clock', title: '世界时区', category: categoryById.text, icon: Globe2,
    fields: [{ key: 'query', label: '查询国家或城市', type: 'text', defaultValue: '', placeholder: '输入国家、城市或时区，如中国、东京、New York', wide: true }],
    actionLabel: '查询时区', autoRun: true, autoRefreshMs: 1000, outputLabel: '世界时间', execute: queryWorldClock,
  },
  {
    id: 'base-converter', title: '进制转换', category: categoryById.text, icon: Binary,
    fields: [
      { key: 'fromBase', label: '源进制', type: 'number', defaultValue: 10, min: 2, max: 36 },
      { key: 'toBase', label: '目标进制', type: 'number', defaultValue: 16, min: 2, max: 36 },
      { key: 'input', label: '整数', type: 'textarea', defaultValue: '255', wide: true },
    ], actionLabel: '转换进制',
    // Converts an arbitrary-precision integer between bases 2 and 36.
    execute: (values) => output(convertBase(textValue(values, 'input'), numberValue(values, 'fromBase'), numberValue(values, 'toBase'))),
  },
  {
    id: 'roman', title: '罗马数字转换', category: categoryById.text, icon: ListRestart,
    fields: [
      { key: 'direction', label: '方向', type: 'select', defaultValue: 'to-roman', options: [{ label: '数字 → 罗马数字', value: 'to-roman' }, { label: '罗马数字 → 数字', value: 'from-roman' }] },
      { key: 'input', label: '输入', type: 'text', defaultValue: '2026', wide: true },
    ], actionLabel: '转换',
    // Converts between canonical Roman numerals and decimal integers.
    execute: (values) => directed(values, { 'to-roman': (input) => numberToRoman(Number(input)), 'from-roman': (input) => String(romanToNumber(input)) }),
  },
  {
    id: 'base64-string', title: 'Base64 字符串', category: categoryById.encode, icon: FileCode2,
    fields: [
      { key: 'direction', label: '方向', type: 'select', defaultValue: 'encode', options: [{ label: '编码', value: 'encode' }, { label: '解码', value: 'decode' }] },
      { key: 'input', label: '文本', type: 'textarea', defaultValue: '', wide: true },
    ], actionLabel: '转换', execute: (values) => directed(values, { encode: encodeBase64, decode: decodeBase64 }),
  },
  {
    id: 'base32-base58', title: 'Base32 / Base58 编解码', category: categoryById.encode, icon: Binary,
    fields: [
      { key: 'encoding', label: '编码', type: 'select', defaultValue: 'base32', options: [{ label: 'Base32（RFC 4648，补位）', value: 'base32' }, { label: 'Base32（RFC 4648，无补位）', value: 'base32-nopad' }, { label: 'Base58（Bitcoin 字母表）', value: 'base58' }] },
      { key: 'direction', label: '方向', type: 'select', defaultValue: 'encode', options: [{ label: '编码', value: 'encode' }, { label: '解码', value: 'decode' }] },
      { key: 'input', label: '文本', type: 'textarea', defaultValue: 'Dev Toolbox', wide: true },
    ], actionLabel: '转换', execute: convertBaseEncoding,
  },
  {
    id: 'base64-file', title: 'Base64 文件转换', category: categoryById.encode, icon: FileText,
    fields: [
      { key: 'direction', label: '方向', type: 'select', defaultValue: 'encode', options: [{ label: '文件 → Base64', value: 'encode' }, { label: 'Base64 → 文件', value: 'decode' }] },
      { key: 'file', label: '文件', type: 'file', defaultValue: null, showWhen: { key: 'direction', value: 'encode' }, wide: true },
      { key: 'input', label: 'Base64 或 Data URL', type: 'textarea', defaultValue: '', showWhen: { key: 'direction', value: 'decode' }, wide: true },
      { key: 'filename', label: '文件名', type: 'text', defaultValue: 'decoded.bin', showWhen: { key: 'direction', value: 'decode' } },
      { key: 'mimeType', label: 'MIME 类型', type: 'text', defaultValue: 'application/octet-stream', showWhen: { key: 'direction', value: 'decode' } },
    ], actionLabel: '转换文件', execute: convertBase64File,
  },
  {
    id: 'audio-parser', title: '音频解析', category: categoryById.encode, icon: AudioLines,
    fields: [
      { key: 'file', label: '音频文件', type: 'file', defaultValue: null, accept: 'audio/*', wide: true },
    ],
    actionLabel: '解析音频',
    outputLabel: '基础信息',
    execute: analyzeAudioTool,
  },
  {
    id: 'ascii-binary', title: '文本到 ASCII 二进制', category: categoryById.encode, icon: Binary,
    fields: [
      { key: 'direction', label: '方向', type: 'select', defaultValue: 'encode', options: [{ label: '文本 → 二进制', value: 'encode' }, { label: '二进制 → 文本', value: 'decode' }] },
      { key: 'input', label: '输入', type: 'textarea', defaultValue: '', wide: true },
    ], actionLabel: '转换', execute: (values) => directed(values, { encode: textToAsciiBinary, decode: asciiBinaryToText }),
  },
  {
    id: 'unicode', title: '文本转 Unicode', category: categoryById.encode, icon: TextCursorInput,
    fields: [
      { key: 'direction', label: '方向', type: 'select', defaultValue: 'encode', options: [{ label: '文本 → Unicode', value: 'encode' }, { label: 'Unicode → 文本', value: 'decode' }] },
      { key: 'input', label: '输入', type: 'textarea', defaultValue: '', wide: true },
    ], actionLabel: '转换', execute: (values) => directed(values, { encode: textToUnicode, decode: unicodeToText }),
  },
  {
    id: 'yaml-json', title: 'YAML 到 JSON', category: categoryById.data, icon: FileJson,
    fields: [{ key: 'input', label: 'YAML', type: 'textarea', defaultValue: 'name: dev-tool\nactive: true\n', wide: true }],
    actionLabel: '转换为 JSON', execute: (values) => jsonOutput(yamlToJson(textValue(values, 'input'))),
  },
  {
    id: 'yaml-toml', title: 'YAML 到 TOML', category: categoryById.data, icon: FileCode2,
    fields: [{ key: 'input', label: 'YAML', type: 'textarea', defaultValue: 'name: dev-tool\nactive: true\n', wide: true }],
    actionLabel: '转换为 TOML', execute: (values) => output(yamlToToml(textValue(values, 'input'))),
  },
  {
    id: 'json-yaml', title: 'JSON 到 YAML', category: categoryById.data, icon: FileCode2,
    fields: [{ key: 'input', label: 'JSON', type: 'textarea', defaultValue: '{\n  "name": "dev-tool",\n  "active": true\n}', wide: true }],
    actionLabel: '转换为 YAML', execute: (values) => output(jsonToYaml(textValue(values, 'input'))),
  },
  {
    id: 'json-toml', title: 'JSON 到 TOML', category: categoryById.data, icon: FileCode2,
    fields: [{ key: 'input', label: 'JSON', type: 'textarea', defaultValue: '{\n  "name": "dev-tool"\n}', wide: true }],
    actionLabel: '转换为 TOML', execute: (values) => output(jsonToToml(textValue(values, 'input'))),
  },
  {
    id: 'toml-json', title: 'TOML 到 JSON', category: categoryById.data, icon: FileJson,
    fields: [{ key: 'input', label: 'TOML', type: 'textarea', defaultValue: 'name = "dev-tool"\nactive = true\n', wide: true }],
    actionLabel: '转换为 JSON', execute: (values) => jsonOutput(tomlToJson(textValue(values, 'input'))),
  },
  {
    id: 'toml-yaml', title: 'TOML 到 YAML', category: categoryById.data, icon: FileCode2,
    fields: [{ key: 'input', label: 'TOML', type: 'textarea', defaultValue: 'name = "dev-tool"\nactive = true\n', wide: true }],
    actionLabel: '转换为 YAML', execute: (values) => output(tomlToYaml(textValue(values, 'input'))),
  },
  {
    id: 'xml-json', title: 'XML to JSON', category: categoryById.data, icon: FileJson,
    fields: [{ key: 'input', label: 'XML', type: 'textarea', defaultValue: '<root><name>dev-tool</name></root>', wide: true }],
    actionLabel: '转换为 JSON', execute: (values) => jsonOutput(xmlToJson(textValue(values, 'input'))),
  },
  {
    id: 'json-xml', title: 'JSON to XML', category: categoryById.data, icon: FileCode2,
    fields: [{ key: 'input', label: 'JSON', type: 'textarea', defaultValue: '{\n  "root": {\n    "name": "dev-tool"\n  }\n}', wide: true }],
    actionLabel: '转换为 XML', execute: (values) => output(jsonToXml(textValue(values, 'input'))),
  },
  {
    id: 'json-php-array', title: 'JSON 转 PHP 数组', category: categoryById.data, icon: FileCode2,
    fields: [{ key: 'input', label: 'JSON', type: 'textarea', defaultValue: '{\n  "name": "dev-tool",\n  "active": true,\n  "roles": ["admin", "developer"]\n}', wide: true }],
    actionLabel: '转换为 PHP 数组',
    // Loads the PHP conversion code only when this less-common tool is executed.
    execute: async (values) => {
      const { jsonToPhpArray } = await import('../lib/php-array')
      return output(jsonToPhpArray(textValue(values, 'input')))
    },
  },
  {
    id: 'php-array-json', title: 'PHP 数组转 JSON', category: categoryById.data, icon: FileJson,
    fields: [{ key: 'input', label: 'PHP 数组', type: 'textarea', defaultValue: '[\n    "name" => "dev-tool",\n    "active" => true,\n    "roles" => ["admin", "developer"],\n]', wide: true }],
    actionLabel: '转换为 JSON',
    // Loads the safe PHP AST parser only when a PHP array needs conversion.
    execute: async (values) => {
      const { phpArrayToJson } = await import('../lib/php-array')
      return jsonOutput(phpArrayToJson(textValue(values, 'input')))
    },
  },
  {
    id: 'url-codec', title: 'URL 编码 / 解码', category: categoryById.encode, icon: Link,
    fields: [
      { key: 'direction', label: '方向', type: 'select', defaultValue: 'encode', options: [{ label: '编码', value: 'encode' }, { label: '解码', value: 'decode' }] },
      { key: 'input', label: '字符串', type: 'textarea', defaultValue: '', wide: true },
    ], actionLabel: '转换', execute: (values) => directed(values, { encode: encodeUrlComponent, decode: decodeUrlComponent }),
  },
  {
    id: 'url-parser', title: 'URL 分析器', category: categoryById.network, icon: Globe2,
    fields: [{ key: 'input', label: 'URL', type: 'textarea', defaultValue: 'https://example.com:443/path?q=dev#result', wide: true }],
    actionLabel: '分析 URL', execute: (values) => output(analyzeUrl(textValue(values, 'input'))),
  },
  {
    id: 'jwt-parser', title: 'JWT 解析器', category: categoryById.encode, icon: FileKey2,
    fields: [{ key: 'input', label: 'JWT', type: 'textarea', defaultValue: '', wide: true }],
    actionLabel: '解析 JWT', execute: (values) => output(parseJwt(textValue(values, 'input'))),
  },
  {
    id: 'certificate-parser', title: '证书解析器', category: categoryById.encode, icon: FileKey2,
    fields: [{ key: 'certificate', label: 'PEM X.509 证书', type: 'textarea', defaultValue: '', placeholder: '-----BEGIN CERTIFICATE-----', wide: true }],
    actionLabel: '解析证书', execute: parseCertificateTool,
  },
  {
    id: 'certificate-key-match', title: '证书公私钥验证', category: categoryById.encode, icon: BadgeCheck,
    fields: [
      { key: 'certificate', label: 'PEM X.509 证书', type: 'textarea', defaultValue: '', placeholder: '-----BEGIN CERTIFICATE-----', wide: true },
      { key: 'privateKey', label: 'PKCS#8 私钥', type: 'textarea', defaultValue: '', placeholder: '-----BEGIN PRIVATE KEY-----', wide: true },
    ],
    actionLabel: '验证密钥', execute: verifyCertificateKeyTool,
  },
  {
    id: 'shuffle', title: '打乱字符串', category: categoryById.text, icon: Shuffle,
    fields: [{ key: 'input', label: '文本', type: 'textarea', defaultValue: '', wide: true }],
    actionLabel: '打乱', execute: (values) => output(shuffleString(textValue(values, 'input'), Math.random)),
  },
  {
    id: 'json-diff', title: 'JSON 差异比较', category: categoryById.data, icon: GitCompareArrows,
    fields: [
      { key: 'before', label: '原 JSON', type: 'textarea', defaultValue: '{\n  "value": 1\n}', wide: true },
      { key: 'after', label: '新 JSON', type: 'textarea', defaultValue: '{\n  "value": 2\n}', wide: true },
    ], actionLabel: '比较 JSON', execute: (values) => output(renderDiff(jsonDiff(textValue(values, 'before'), textValue(values, 'after')))),
  },
  {
    id: 'json-format', title: 'JSON 美化和格式化', category: categoryById.data, icon: Braces,
    fields: [
      { key: 'spaces', label: '缩进空格', type: 'select', defaultValue: '2', options: [{ label: '2 spaces', value: '2' }, { label: '4 spaces', value: '4' }] },
      { key: 'input', label: 'JSON', type: 'textarea', defaultValue: '{"name":"dev-tool","active":true}', wide: true },
    ], actionLabel: '格式化 JSON', autoRun: true, execute: (values) => jsonOutput(formatJson(textValue(values, 'input'), numberValue(values, 'spaces'))),
  },
  {
    id: 'json-minify', title: 'JSON 压缩', category: categoryById.data, icon: Braces,
    fields: [{ key: 'input', label: 'JSON', type: 'textarea', defaultValue: '{\n  "name": "dev-tool"\n}', wide: true }],
    actionLabel: '压缩 JSON', execute: (values) => jsonOutput(minifyJson(textValue(values, 'input'))),
  },
  {
    id: 'json-csv', title: 'JSON 转 CSV', category: categoryById.data, icon: TableProperties,
    fields: [{ key: 'input', label: 'JSON 数组', type: 'textarea', defaultValue: '[\n  { "name": "Ada", "role": "admin" },\n  { "name": "Lin", "role": "developer" }\n]', wide: true }],
    actionLabel: '转换为 CSV', execute: convertJsonCsv,
  },
  {
    id: 'sql-format', title: 'SQL 美化和格式化', category: categoryById.developer, icon: FileCode2,
    fields: [
      { key: 'dialect', label: 'SQL 方言', type: 'select', defaultValue: 'sql', options: [{ label: '标准 SQL', value: 'sql' }, { label: 'MySQL', value: 'mysql' }, { label: 'PostgreSQL', value: 'postgresql' }, { label: 'SQLite', value: 'sqlite' }, { label: 'MariaDB', value: 'mariadb' }, { label: 'Transact-SQL', value: 'transactsql' }] },
      { key: 'input', label: 'SQL', type: 'textarea', defaultValue: 'select id,name from users where active=1 order by id desc;', wide: true },
    ], actionLabel: '格式化 SQL', execute: (values) => output(formatSqlText(textValue(values, 'input'), textValue(values, 'dialect') as SqlDialect)),
  },
  {
    id: 'docker-converter', title: 'Docker Run / Compose 转换', category: categoryById.developer, icon: Container,
    fields: [
      { key: 'direction', label: '方向', type: 'select', defaultValue: 'run-to-compose', options: [{ label: 'docker run → Compose', value: 'run-to-compose' }, { label: 'Compose → docker run', value: 'compose-to-run' }] },
      { key: 'input', label: 'Docker 配置', type: 'textarea', defaultValue: 'docker run -d --name web -p 8080:80 nginx:alpine', wide: true },
    ], actionLabel: '转换 Docker 配置', execute: convertDocker,
  },
  {
    id: 'curl-fetch', title: 'cURL 转 Fetch', category: categoryById.developer, icon: SquareTerminal,
    fields: [{ key: 'input', label: 'cURL 命令', type: 'textarea', defaultValue: `curl 'https://api.example.com/users' -H 'Content-Type: application/json' --data-raw '{"name":"Ada"}'`, wide: true }],
    actionLabel: '转换为 Fetch', execute: convertCurlToFetch,
  },
  {
    id: 'request-fetch', title: 'URL / Headers / Body / Method 转 Fetch', category: categoryById.developer, icon: SquareTerminal,
    fields: [
      { key: 'url', label: 'URL', type: 'text', defaultValue: 'https://api.example.com/users', placeholder: 'https://api.example.com/users', wide: true },
      { key: 'method', label: 'Method', type: 'select', defaultValue: 'POST', options: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].map((value) => ({ label: value, value })) },
      { key: 'headers', label: 'Headers', type: 'textarea', defaultValue: '{}', placeholder: '{"Authorization":"Bearer token"}', wide: true },
      { key: 'body', label: 'Body', type: 'textarea', defaultValue: '{"name":"Ada"}', placeholder: 'JSON 或纯文本 Body', wide: true },
    ],
    actionLabel: '生成 Fetch',
    execute: convertRequestToFetch,
  },
  {
    id: 'xml-format', title: 'XML 格式化', category: categoryById.data, icon: FileCode2,
    fields: [{ key: 'input', label: 'XML', type: 'textarea', defaultValue: '<root><name>dev-tool</name></root>', wide: true }],
    actionLabel: '格式化 XML', execute: (values) => output(formatXml(textValue(values, 'input'))),
  },
  {
    id: 'yaml-format', title: 'YAML 美化和格式化', category: categoryById.data, icon: FileCode2,
    fields: [{ key: 'input', label: 'YAML', type: 'textarea', defaultValue: 'root: {name: dev-tool, active: true}', wide: true }],
    actionLabel: '格式化 YAML', execute: (values) => output(formatYaml(textValue(values, 'input'))),
  },
  {
    id: 'regex-tester', title: 'Regex Tester', category: categoryById.developer, icon: Regex,
    fields: [
      { key: 'pattern', label: '正则表达式', type: 'text', defaultValue: '(?<word>\\w+)', wide: true },
      { key: 'flags', label: 'Flags', type: 'text', defaultValue: 'gi', placeholder: 'gimuy' },
      { key: 'input', label: '测试文本', type: 'textarea', defaultValue: 'hello regex tester', wide: true },
    ], actionLabel: '执行匹配', execute: (values) => output(testRegex(textValue(values, 'input'), textValue(values, 'pattern'), textValue(values, 'flags'))),
  },
  {
    id: 'ipv4-subnet', title: 'IPv4 子网计算器', category: categoryById.network, icon: Network,
    fields: [{ key: 'input', label: 'CIDR', type: 'text', defaultValue: '192.168.1.42/24', wide: true }],
    actionLabel: '计算子网', execute: (values) => output(calculateIpv4Subnet(textValue(values, 'input'))),
  },
  {
    id: 'ipv4-converter', title: 'IPv4 地址转换器', category: categoryById.network, icon: NetworkIcon,
    fields: [{ key: 'input', label: 'IPv4 / 整数 / 十六进制 / 二进制', type: 'text', defaultValue: '192.168.1.1', wide: true }],
    actionLabel: '转换地址', execute: (values) => output(convertIpv4Address(textValue(values, 'input'))),
  },
  {
    id: 'mac-generator', title: 'MAC 地址生成器', category: categoryById.generate, icon: Network,
    fields: [
      { key: 'count', label: '数量', type: 'number', defaultValue: 5, min: 1, max: 100 },
      { key: 'separator', label: '分隔符', type: 'select', defaultValue: ':', options: [{ label: '冒号 (:)', value: ':' }, { label: '连字符 (-)', value: '-' }] },
      { key: 'uppercase', label: '字母格式', type: 'select', defaultValue: 'true', options: [{ label: '大写', value: 'true' }, { label: '小写', value: 'false' }] },
    ], actionLabel: '生成 MAC', execute: generateMac,
  },
  {
    id: 'ipv6-ula', title: 'IPv6 ULA 生成器', category: categoryById.generate, icon: Network,
    fields: [{ key: 'count', label: '数量', type: 'number', defaultValue: 5, min: 1, max: 100 }],
    actionLabel: '生成 IPv6 ULA',
    // Generates RFC 4193 locally assigned /48 prefixes from secure entropy.
    execute: (values) => itemOutput(Array.from({ length: itemCount(values) }, () => generateIpv6Ula(entropy(5)))),
  },
  {
    id: 'text-compare', title: '文本比较', category: categoryById.text, icon: GitCompareArrows,
    fields: [
      { key: 'before', label: '原文本', type: 'textarea', defaultValue: 'first line\nold value\n', wide: true },
      { key: 'after', label: '新文本', type: 'textarea', defaultValue: 'first line\nnew value\n', wide: true },
    ], actionLabel: '比较文本', execute: compareTextTool,
  },
  {
    id: 'text-stats', title: '文本统计', category: categoryById.text, icon: ChartNoAxesColumnIncreasing,
    fields: [{ key: 'input', label: '文本', type: 'textarea', defaultValue: '', wide: true }],
    actionLabel: '统计文本', execute: countTextTool,
  },
]

/** Finds a tool by route id while keeping the initial selection deterministic. */
export function findTool(id: string): ToolDefinition {
  const selected = tools.find((tool) => tool.id === id)

  // Unknown URL fragments fall back to the first useful tool instead of leaving a blank shell.
  if (!selected) {
    return tools[0]
  }

  return selected
}
