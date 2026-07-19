import { tools } from './definitions'
import type { ToolDefinition, ToolField } from './types'

export type ToolSearchSuggestionKind = 'all' | 'content' | 'title'

export interface ToolSearchSuggestion {
  tool: ToolDefinition
  kind: ToolSearchSuggestionKind
  reason: string
  value: string
  fieldKey?: string
}

interface ContentRoute {
  toolId: string
  fieldKey: string
  reason: string
}

type JsonRootKind = 'array' | 'object' | 'scalar'

type JsonInspection =
  | { valid: false }
  | { valid: true; rootKind: JsonRootKind; csvCompatible: boolean }

const searchAliases: Record<string, string[]> = {
  'json-format': ['JSON 格式化', 'JSON 美化', 'format JSON', 'pretty JSON'],
  'json-php-array': ['JSON 转 PHP', 'JSON PHP 数组'],
  'php-array-json': ['PHP 数组转 JSON', 'PHP to JSON'],
  'curl-fetch': ['curl 转 fetch', 'curl2fetch'],
  'url-parser': ['URL 解析', '网址分析'],
  'sql-format': ['SQL 格式化', 'SQL 美化'],
}

const toolById = new Map(tools.map((tool) => [tool.id, tool]))

/** Normalizes titles and queries so spacing and separators do not weaken direct matches. */
function normalizeSearchText(value: string): string {
  return value.toLocaleLowerCase('zh-CN').replace(/[\s/_-]+/g, '')
}

/** Finds the field that should receive text entered through ordinary title search. */
function preferredInputField(tool: ToolDefinition): ToolField | undefined {
  const compatibleFields = tool.fields.filter((field) => {
    // Search text can only be assigned to controls that accept scalar text.
    return field.type === 'text' || field.type === 'textarea'
  })
  const namedInput = compatibleFields.find((field) => field.key === 'input')

  // Conventional input fields are more reliable than definition order for mixed forms.
  if (namedInput) {
    return namedInput
  }

  return compatibleFields[0]
}

/** Parses JSON for high-confidence content routing without changing the original input. */
function inspectJson(value: string): JsonInspection {
  try {
    const parsed = JSON.parse(value)

    // Arrays support PHP-array conversion and need row-shape inspection before CSV is offered.
    if (Array.isArray(parsed)) {
      // CSV rows must each be non-null, non-array JSON objects; an empty array is also valid.
      const csvCompatible = parsed.every((item) => (
        typeof item === 'object' && item !== null && !Array.isArray(item)
      ))
      return { valid: true, rootKind: 'array', csvCompatible }
    }

    // Non-null objects support every registered single-source JSON conversion.
    if (typeof parsed === 'object' && parsed !== null) {
      return { valid: true, rootKind: 'object', csvCompatible: false }
    }

    return { valid: true, rootKind: 'scalar', csvCompatible: false }
  } catch {
    return { valid: false }
  }
}

/** Accepts only complete HTTP(S) URLs as URL-tool candidates. */
function looksLikeUrl(value: string): boolean {
  try {
    const url = new URL(value)

    // Network utilities in this toolbox are intended for web URLs rather than arbitrary schemes.
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/** Validates that one Base64URL JWT section decodes to a JSON object. */
function isJwtJsonSection(value: string): boolean {
  try {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
    const parsed: unknown = JSON.parse(atob(padded))

    // JWT header and payload sections are JSON objects rather than arrays or primitives.
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
  } catch {
    return false
  }
}

/** Detects a compact JWT whose header and payload are valid Base64URL JSON objects. */
function looksLikeJwt(value: string): boolean {
  const sections = value.split('.')

  // Compact JWT serialization always contains exactly header, payload, and signature sections.
  if (sections.length !== 3) {
    return false
  }

  const [header, payload, signature] = sections

  // Base64URL syntax rejects dotted hostnames and arbitrary three-part prose before decoding.
  if (
    !/^[A-Za-z0-9_-]+$/.test(header)
    || !/^[A-Za-z0-9_-]+$/.test(payload)
    || !/^[A-Za-z0-9_-]*$/.test(signature)
  ) {
    return false
  }

  return isJwtJsonSection(header) && isJwtJsonSection(payload)
}

/** Detects a complete PEM certificate marker before offering certificate parsing. */
function looksLikeCertificate(value: string): boolean {
  return /^-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----$/.test(value)
}

/** Detects a shell cURL command without treating prose containing the word as executable input. */
function looksLikeCurl(value: string): boolean {
  return /^curl(?:\s|$)/i.test(value)
}

/** Detects an XML document with a matching-looking root element. */
function looksLikeXml(value: string): boolean {
  return /^(?:<\?xml[^>]*>\s*)?(?:<[A-Za-z_][\w:.-]*(?:\s[^<>]*?)?\s*\/>|<([A-Za-z_][\w:.-]*)(?:\s[^<>]*?)?>[\s\S]*<\/\1>)$/.test(value)
}

/** Detects PHP array syntax by its container and key-value operator. */
function looksLikePhpArray(value: string): boolean {
  return /^(?:array\s*\(|\[)[\s\S]*=>/i.test(value)
}

/** Detects Docker Run commands supported by the existing bidirectional converter. */
function looksLikeDockerRun(value: string): boolean {
  return /^docker\s+(?:run|container\s+run)(?:\s|$)/i.test(value)
}

/** Detects common executable SQL statements while avoiding isolated SQL keywords in prose. */
function looksLikeSql(value: string): boolean {
  return /^(?:select|insert\s+into|update|delete\s+from|with|create|alter|drop|truncate)\b/i.test(value)
}

/** Detects dotted IPv4 text with an optional CIDR suffix. */
function ipv4Kind(value: string): 'address' | 'cidr' | null {
  const addressPattern = '(?:\\d{1,3}\\.){3}\\d{1,3}'

  // A suffix identifies subnet calculations rather than address representation conversion.
  if (new RegExp(`^${addressPattern}\\/\\d{1,2}$`).test(value)) {
    return 'cidr'
  }

  // A bare dotted address belongs to the IPv4 representation converter.
  if (new RegExp(`^${addressPattern}$`).test(value)) {
    return 'address'
  }

  return null
}

/** Creates only the JSON operations that support the detected document root. */
function jsonRoutes(rootKind: JsonRootKind, csvCompatible: boolean): ContentRoute[] {
  const routes: ContentRoute[] = [
    { toolId: 'json-format', fieldKey: 'input', reason: '检测到 JSON' },
  ]

  // Objects and arrays are both representable as PHP arrays.
  if (rootKind === 'object' || rootKind === 'array') {
    routes.push({ toolId: 'json-php-array', fieldKey: 'input', reason: '检测到 JSON' })
  }

  // CSV conversion is meaningful only when every array item can become one row.
  if (csvCompatible) {
    routes.push({
      toolId: 'json-csv',
      fieldKey: 'input',
      reason: '检测到 JSON 数组',
    })
  }

  routes.push(
    { toolId: 'json-minify', fieldKey: 'input', reason: '检测到 JSON' },
    { toolId: 'json-yaml', fieldKey: 'input', reason: '检测到 JSON' },
  )

  // TOML and XML libraries require a named object at the document root.
  if (rootKind === 'object') {
    routes.push(
      { toolId: 'json-toml', fieldKey: 'input', reason: '检测到 JSON' },
      { toolId: 'json-xml', fieldKey: 'input', reason: '检测到 JSON' },
    )
  }

  return routes
}

/** Maps one pasted value to only high-confidence tools that can consume it unchanged. */
function contentRoutes(rawValue: string): ContentRoute[] {
  const value = rawValue.trim()

  // Blank search belongs to ordinary tool browsing rather than content recognition.
  if (!value) {
    return []
  }

  const json = inspectJson(value)

  // Valid JSON has a precise family of transformations and should not fall through to text rules.
  if (json.valid) {
    return jsonRoutes(json.rootKind, json.csvCompatible)
  }

  // PEM markers are more specific than the generic multiline text rules below.
  if (looksLikeCertificate(value)) {
    return [{ toolId: 'certificate-parser', fieldKey: 'certificate', reason: '检测到 PEM 证书' }]
  }

  // A compact token should open the parser rather than generic URL or text utilities.
  if (looksLikeJwt(value)) {
    return [{ toolId: 'jwt-parser', fieldKey: 'input', reason: '检测到 JWT' }]
  }

  // A complete command maps directly to the cURL converter's source field.
  if (looksLikeCurl(value)) {
    return [{ toolId: 'curl-fetch', fieldKey: 'input', reason: '检测到 cURL 命令' }]
  }

  // Docker Run is the only Docker input shape that can be inferred without changing form options.
  if (looksLikeDockerRun(value)) {
    return [{ toolId: 'docker-converter', fieldKey: 'input', reason: '检测到 Docker Run' }]
  }

  // PHP key-value syntax is unambiguous enough to offer its dedicated converter.
  if (looksLikePhpArray(value)) {
    return [{ toolId: 'php-array-json', fieldKey: 'input', reason: '检测到 PHP 数组' }]
  }

  // XML content supports both formatting and conversion from the same source field.
  if (looksLikeXml(value)) {
    return [
      { toolId: 'xml-format', fieldKey: 'input', reason: '检测到 XML' },
      { toolId: 'xml-json', fieldKey: 'input', reason: '检测到 XML' },
    ]
  }

  // Complete HTTP(S) URLs have two useful operations that accept the exact pasted value.
  if (looksLikeUrl(value)) {
    return [
      { toolId: 'url-parser', fieldKey: 'input', reason: '检测到 URL' },
      { toolId: 'url-codec', fieldKey: 'input', reason: '检测到 URL' },
    ]
  }

  const detectedIpv4Kind = ipv4Kind(value)

  // CIDR text is directly consumable by the subnet calculator.
  if (detectedIpv4Kind === 'cidr') {
    return [{ toolId: 'ipv4-subnet', fieldKey: 'input', reason: '检测到 IPv4 CIDR' }]
  }

  // Bare dotted addresses belong to representation conversion rather than subnet math.
  if (detectedIpv4Kind === 'address') {
    return [{ toolId: 'ipv4-converter', fieldKey: 'input', reason: '检测到 IPv4 地址' }]
  }

  // Leading statement syntax is sufficient to offer formatting without attempting execution.
  if (looksLikeSql(value)) {
    return [{ toolId: 'sql-format', fieldKey: 'input', reason: '检测到 SQL' }]
  }

  return []
}

/** Resolves one static content route into a rendered suggestion with the untouched source value. */
function contentSuggestion(route: ContentRoute, rawValue: string): ToolSearchSuggestion {
  const tool = toolById.get(route.toolId)

  // Static search routes must stay aligned with the central tool registry.
  if (!tool) {
    throw new Error(`搜索工具不存在: ${route.toolId}`)
  }

  return {
    tool,
    kind: 'content',
    reason: route.reason,
    value: rawValue,
    fieldKey: route.fieldKey,
  }
}

/** Creates an ordinary catalog suggestion and attaches a compatible input field when one exists. */
function catalogSuggestion(
  tool: ToolDefinition,
  kind: 'all' | 'title',
  rawValue: string,
): ToolSearchSuggestion {
  const suggestion: ToolSearchSuggestion = {
    tool,
    kind,
    reason: tool.category.label,
    value: rawValue,
  }
  const inputField = preferredInputField(tool)

  // Generators and other option-only tools have no text field to prefill.
  if (inputField && rawValue) {
    suggestion.fieldKey = inputField.key
  }

  return suggestion
}

/** Returns content-aware operations first, then falls back to normalized catalog search. */
export function getToolSearchSuggestions(rawValue: string): ToolSearchSuggestion[] {
  const value = rawValue.trim()

  // Opening search without a query should expose the complete stable tool catalog.
  if (!value) {
    return tools.map((tool) => catalogSuggestion(tool, 'all', rawValue))
  }

  const routes = contentRoutes(rawValue)

  // High-confidence content should produce focused actions instead of unrelated title matches.
  if (routes.length) {
    return routes.map((route) => contentSuggestion(route, rawValue))
  }

  const query = normalizeSearchText(value)

  return tools
    .filter((tool) => {
      // Most registry entries rely on their canonical title and do not need aliases.
      const aliases = searchAliases[tool.id] ?? []
      const searchable = normalizeSearchText(
        [tool.title, tool.id, tool.category.label, ...aliases].join(' '),
      )

      // Catalog results require the normalized query to appear in title, id, category, or aliases.
      return searchable.includes(query)
    })
    .map((tool) => catalogSuggestion(tool, 'title', rawValue))
}
