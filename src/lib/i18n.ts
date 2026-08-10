import { ref, watch } from 'vue'

import type { ToolCategory, ToolDefinition } from '../tools/types'

export type Language = 'zh' | 'en'

const LANGUAGE_STORAGE_KEY = 'dev-tool-language'

const messages = {
  zh: {
    closeNavigation: '关闭导航',
    close: '关闭',
    searchTools: '搜索工具',
    searchToolsOrPaste: '搜索工具或粘贴内容',
    openNavigation: '打开导航',
    navigation: '导航',
    developerTools: '开发工具',
    localTools: '个本地工具',
    localProcessing: '本地处理',
    toolHistory: '工具历史',
    history: '历史',
    quickOpen: '快速打开',
    allTools: '全部工具',
    suggestedActions: '建议操作',
    searchResults: '搜索结果',
    noMatchingTools: '没有匹配的工具',
    closeSearch: '关闭搜索',
    toolWorkspace: '工具工作区',
    output: '输出',
    chars: '字符',
    copyOutput: '复制输出',
    downloadOutput: '下载输出',
    copyItem: '复制此项',
    copyItemNumber: '复制第 {number} 项',
    waitExecution: '等待执行',
    result: '结果',
    websiteLanguage: '网站语言',
    chinese: '中文',
    english: 'English',
  },
  en: {
    closeNavigation: 'Close navigation',
    close: 'Close',
    searchTools: 'Search tools',
    searchToolsOrPaste: 'Search tools or paste content',
    openNavigation: 'Open navigation',
    navigation: 'Navigation',
    developerTools: 'Developer tools',
    localTools: 'local tools',
    localProcessing: 'Local processing',
    toolHistory: 'Tool history',
    history: 'History',
    quickOpen: 'Quick open',
    allTools: 'All tools',
    suggestedActions: 'Suggested actions',
    searchResults: 'Search results',
    noMatchingTools: 'No matching tools',
    closeSearch: 'Close search',
    toolWorkspace: 'Tool workspace',
    output: 'Output',
    chars: 'chars',
    copyOutput: 'Copy output',
    downloadOutput: 'Download output',
    copyItem: 'Copy this item',
    copyItemNumber: 'Copy item {number}',
    waitExecution: 'Waiting for execution',
    result: 'result',
    websiteLanguage: 'Website language',
    chinese: '中文',
    english: 'English',
  },
} as const

type MessageKey = keyof typeof messages.zh

const categoryTranslations: Record<string, string> = {
  generate: 'Generators',
  encode: 'Encoding & Parsing',
  data: 'Data Formats',
  network: 'Network Tools',
  developer: 'Developer Tools',
  text: 'Text & Numbers',
}

const toolTitleTranslations: Record<string, string> = {
  md5: 'MD5 Calculator',
  'hash-text': 'Hash Text',
  uuid: 'UUID Generator',
  ulid: 'ULID Generator',
  rsa: 'RSA Key Pair Generator',
  'date-time': 'Date & Time Converter',
  'world-clock': 'World Clock',
  'base-converter': 'Base Converter',
  roman: 'Roman Numeral Converter',
  'base64-string': 'Base64 String',
  'base32-base58': 'Base32 / Base58 Codec',
  'base64-file': 'Base64 File Converter',
  'audio-parser': 'Audio Parser',
  'ascii-binary': 'Text to ASCII Binary',
  unicode: 'Text to Unicode',
  'yaml-json': 'YAML to JSON',
  'yaml-toml': 'YAML to TOML',
  'json-yaml': 'JSON to YAML',
  'json-toml': 'JSON to TOML',
  'toml-json': 'TOML to JSON',
  'toml-yaml': 'TOML to YAML',
  'xml-json': 'XML to JSON',
  'json-xml': 'JSON to XML',
  'json-php-array': 'JSON to PHP Array',
  'php-array-json': 'PHP Array to JSON',
  'url-codec': 'URL Encode / Decode',
  'url-parser': 'URL Analyzer',
  'jwt-parser': 'JWT Parser',
  'certificate-parser': 'Certificate Parser',
  'certificate-key-match': 'Certificate Key Verification',
  shuffle: 'Shuffle String',
  'json-diff': 'JSON Diff',
  'json-format': 'JSON Formatter',
  'json-minify': 'JSON Minifier',
  'json-csv': 'JSON to CSV',
  'sql-format': 'SQL Formatter',
  'docker-converter': 'Docker Run / Compose Converter',
  'curl-fetch': 'cURL to Fetch',
  'request-fetch': 'URL / Headers / Body / Method to Fetch',
  'xml-format': 'XML Formatter',
  'yaml-format': 'YAML Formatter',
  'regex-tester': 'Regex Tester',
  'ipv4-subnet': 'IPv4 Subnet Calculator',
  'ipv4-converter': 'IPv4 Address Converter',
  'mac-generator': 'MAC Address Generator',
  'ipv6-ula': 'IPv6 ULA Generator',
  'text-compare': 'Text Compare',
  'text-stats': 'Text Statistics',
}

const textTranslations: Record<string, string> = {
  生成器: 'Generators',
  '编码与解析': 'Encoding & Parsing',
  数据格式: 'Data Formats',
  网络工具: 'Network Tools',
  开发辅助: 'Developer Tools',
  文本与数值: 'Text & Numbers',
  文本: 'Text',
  算法: 'Algorithm',
  版本: 'Version',
  数量: 'Count',
  密钥长度: 'Key length',
  日期或时间戳: 'Date or timestamp',
  查询国家或城市: 'Country or city',
  目标时区: 'Time zone',
  源进制: 'From base',
  目标进制: 'To base',
  整数: 'Integer',
  方向: 'Direction',
  编码: 'Encoding',
  文件: 'File',
  音频文件: 'Audio file',
  输入: 'Input',
  字符串: 'String',
  URL: 'URL',
  JWT: 'JWT',
  'PEM X.509 证书': 'PEM X.509 certificate',
  'PKCS#8 私钥': 'PKCS#8 private key',
  '原 JSON': 'Original JSON',
  '新 JSON': 'New JSON',
  缩进空格: 'Indent spaces',
  'JSON 数组': 'JSON array',
  'SQL 方言': 'SQL dialect',
  SQL: 'SQL',
  'Docker 配置': 'Docker configuration',
  'cURL 命令': 'cURL command',
  Headers: 'Headers',
  Body: 'Body',
  Method: 'Method',
  正则表达式: 'Regular expression',
  Flags: 'Flags',
  测试文本: 'Test text',
  CIDR: 'CIDR',
  'IPv4 / 整数 / 十六进制 / 二进制': 'IPv4 / integer / hex / binary',
  分隔符: 'Separator',
  字母格式: 'Letter case',
  '基础信息': 'Basic information',
  'ISO 时间': 'ISO time',
  'Unix 秒级时间戳': 'Unix seconds timestamp',
  'Unix 毫秒级时间戳': 'Unix milliseconds timestamp',
  时区: 'Time zone',
  本地时间: 'Local time',
  公钥: 'Public key',
  私钥: 'Private key',
  转换: 'Convert',
  '计算 MD5': 'Calculate MD5',
  '计算 Hash': 'Calculate Hash',
  '生成 UUID': 'Generate UUID',
  '生成 ULID': 'Generate ULID',
  生成密钥对: 'Generate key pair',
  转换时间: 'Convert time',
  转换进制: 'Convert base',
  转换文件: 'Convert file',
  解析音频: 'Parse audio',
  '转换为 JSON': 'Convert to JSON',
  '转换为 TOML': 'Convert to TOML',
  '转换为 YAML': 'Convert to YAML',
  '转换为 XML': 'Convert to XML',
  '转换为 PHP 数组': 'Convert to PHP array',
  分析: 'Analyze',
  '分析 URL': 'Analyze URL',
  '解析 JWT': 'Parse JWT',
  解析证书: 'Parse certificate',
  验证密钥: 'Verify key',
  打乱: 'Shuffle',
  '比较 JSON': 'Compare JSON',
  '格式化 JSON': 'Format JSON',
  '压缩 JSON': 'Minify JSON',
  '转换为 CSV': 'Convert to CSV',
  '格式化 SQL': 'Format SQL',
  '转换 Docker 配置': 'Convert Docker config',
  '转换为 Fetch': 'Convert to Fetch',
  '生成 Fetch': 'Generate Fetch',
  '格式化 XML': 'Format XML',
  '格式化 YAML': 'Format YAML',
  执行匹配: 'Run match',
  计算子网: 'Calculate subnet',
  转换地址: 'Convert address',
  '生成 MAC': 'Generate MAC',
  '生成 IPv6 ULA': 'Generate IPv6 ULA',
  比较文本: 'Compare text',
  统计文本: 'Count text',
  '输入需要计算 MD5 的文本': 'Enter text to calculate MD5',
  '输入需要计算 Hash 的文本': 'Enter text to calculate Hash',
  'ISO 日期、Unix 秒或毫秒': 'ISO date, Unix seconds, or milliseconds',
  '输入国家、城市或时区，如中国、东京、New York': 'Enter a country, city, or time zone, e.g. China, Tokyo, New York',
  查询时区: 'Search time zones',
  世界时间: 'World times',
  'JSON 或纯文本 Body': 'JSON or plain text body',
  '搜索工具': 'Search tools',
  '检测到 JSON': 'JSON detected',
  '检测到 JSON 数组': 'JSON array detected',
  '检测到 PEM 证书': 'PEM certificate detected',
  '检测到 JWT': 'JWT detected',
  '检测到 cURL 命令': 'cURL command detected',
  '检测到 Docker Run': 'Docker Run detected',
  '检测到 PHP 数组': 'PHP array detected',
  '检测到 XML': 'XML detected',
  '检测到 URL': 'URL detected',
  '检测到 IPv4 CIDR': 'IPv4 CIDR detected',
  '检测到 IPv4 地址': 'IPv4 address detected',
  '检测到 SQL': 'SQL detected',
}

const optionTranslations: Record<string, string> = {
  编码: 'Encode',
  解码: 'Decode',
  大写: 'Uppercase',
  小写: 'Lowercase',
  '数字 → 罗马数字': 'Number → Roman numeral',
  '罗马数字 → 数字': 'Roman numeral → number',
  '文件 → Base64': 'File → Base64',
  'Base64 → 文件': 'Base64 → file',
  '文本 → 二进制': 'Text → binary',
  '二进制 → 文本': 'Binary → text',
  '文本 → Unicode': 'Text → Unicode',
  'Unicode → 文本': 'Unicode → text',
  '标准 SQL': 'Standard SQL',
  'docker run → Compose': 'docker run → Compose',
  'Compose → docker run': 'Compose → docker run',
  '冒号 (:)': 'Colon (:)',
  '连字符 (-)': 'Hyphen (-)',
  'Base32（RFC 4648，补位）': 'Base32 (RFC 4648, padded)',
  'Base32（RFC 4648，无补位）': 'Base32 (RFC 4648, unpadded)',
  'Base58（Bitcoin 字母表）': 'Base58 (Bitcoin alphabet)',
}

/** Reads the persisted language and falls back to Chinese for unknown values or unavailable storage. */
function readStoredLanguage(): Language {
  // Server-side and test environments do not expose browser storage.
  if (typeof window === 'undefined') {
    return 'zh'
  }

  try {
    const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY)

    // Only the two supported language values may affect the initial interface language.
    if (stored === 'en') {
      return 'en'
    }
  } catch {
    // Storage access can be blocked by browser privacy settings; the default remains usable.
  }

  return 'zh'
}

export const language = ref<Language>(readStoredLanguage())

/** Persists the selected language whenever the user changes the picker. */
watch(language, (nextLanguage) => {
  // Browser storage is the persistence boundary; non-browser consumers need no side effect.
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, nextLanguage)
  } catch {
    // A storage failure must not prevent the in-memory language switch.
  }
})

/** Updates the language only when the requested value is one of the supported options. */
export function setLanguage(nextLanguage: string): void {
  // English is selected explicitly; every other value resolves to the safe Chinese default.
  if (nextLanguage === 'en') {
    language.value = 'en'
    return
  }

  language.value = 'zh'
}

/** Returns one common interface message in the active language. */
export function t(key: MessageKey): string {
  return messages[language.value][key]
}

/** Translates a known registry label while preserving technical values without a dictionary entry. */
export function translateText(value: string, currentLanguage: Language = language.value): string {
  // Chinese remains the source language and therefore needs no lookup or cloning.
  if (currentLanguage === 'zh') {
    return value
  }

  return textTranslations[value] ?? value
}

/** Translates one bounded select option while preserving protocol values and symbols. */
function translateOption(value: string, currentLanguage: Language): string {
  // Chinese keeps the source option text unchanged.
  if (currentLanguage === 'zh') {
    return value
  }

  return optionTranslations[value] ?? translateText(value, currentLanguage)
}

/** Returns the display label for one tool category. */
export function translateCategory(category: ToolCategory, currentLanguage: Language = language.value): string {
  // Chinese uses the registry's canonical category labels.
  if (currentLanguage === 'zh') {
    return category.label
  }

  return categoryTranslations[category.id] ?? category.label
}

/** Creates a display-only localized tool definition without changing execution values or handlers. */
export function localizeTool(tool: ToolDefinition, currentLanguage: Language = language.value): ToolDefinition {
  // The canonical Chinese definition is already complete and can be reused directly.
  if (currentLanguage === 'zh') {
    return tool
  }

  const fields = tool.fields.map((field) => {
    const localizedField = {
      ...field,
      label: translateText(field.label, currentLanguage),
      options: field.options?.map((option) => ({
        ...option,
        label: translateOption(option.label, currentLanguage),
      })),
    }

    // Placeholders are optional and should stay absent when the source field has none.
    if (field.placeholder !== undefined) {
      localizedField.placeholder = translateText(field.placeholder, currentLanguage)
    }

    return localizedField
  })

  const localizedTool: ToolDefinition = {
    ...tool,
    title: toolTitleTranslations[tool.id] ?? translateText(tool.title, currentLanguage),
    category: { ...tool.category, label: translateCategory(tool.category, currentLanguage) },
    fields,
    actionLabel: translateText(tool.actionLabel, currentLanguage),
  }

  // Optional output labels are translated only when the tool declares them.
  if (tool.outputLabel !== undefined) {
    localizedTool.outputLabel = translateText(tool.outputLabel, currentLanguage)
  }

  // Optional named outputs are translated only when the tool declares them.
  if (tool.outputLabels !== undefined) {
    localizedTool.outputLabels = tool.outputLabels.map((label) => translateText(label, currentLanguage))
  }

  return localizedTool
}
