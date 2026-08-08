/** HTTP methods supported by the URL, Body, and Method Fetch generator. */
export type FetchMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'

export interface FetchRequestInput {
  url: string
  method: FetchMethod
  headers: string
  body: string
}

/** Parses Header JSON into string values suitable for a Fetch headers object. */
function parseHeaders(input: string): Record<string, string> {
  const source = input.trim()

  // Empty Header input means the generated request should omit the headers option.
  if (source.length === 0) {
    return {}
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(source)
  } catch {
    throw new Error('Header 必须是 JSON 对象')
  }

  // Fetch headers must be represented by a JSON object rather than an array or primitive.
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Header 必须是 JSON 对象')
  }

  const headers: Record<string, string> = {}

  for (const [name, value] of Object.entries(parsed)) {
    // Header values are scalar strings; nested JSON cannot be sent as one header value.
    if (value === null || typeof value === 'object') {
      throw new Error('Header 值必须是字符串、数字或布尔值')
    }

    headers[name] = String(value)
  }

  return headers
}

/** Formats headers with indentation that matches the generated Fetch options object. */
function formatHeaders(headers: Record<string, string>): string {
  return JSON.stringify(headers, null, 2).replace(/\n/g, '\n  ')
}

/** Converts a JSON or text request body into one Fetch body option. */
function fetchBodyOption(body: string): { option: string; isJson: boolean } {
  try {
    const parsed = JSON.parse(body)

    return { option: `  body: JSON.stringify(${JSON.stringify(parsed, null, 2)})`, isJson: true }
  } catch {
    // Non-JSON payloads must remain verbatim strings instead of being rewritten as JSON.
    return { option: `  body: ${JSON.stringify(body)}`, isJson: false }
  }
}

/** Generates Fetch source from a URL, request body, and HTTP method without sending a request. */
export function buildFetchRequest(input: FetchRequestInput): string {
  const url = input.url.trim()
  const hasBody = input.body.trim().length > 0

  // A generated Fetch call needs a target even when callers intentionally use a relative path.
  if (url.length === 0) {
    throw new Error('URL 不能为空')
  }

  // Browsers reject GET and HEAD requests with a body, so source generation must stop early.
  if (hasBody && (input.method === 'GET' || input.method === 'HEAD')) {
    throw new Error('GET 和 HEAD 请求不能包含 Body')
  }

  const headers = parseHeaders(input.headers)
  const options = [`  method: ${JSON.stringify(input.method)}`]
  const bodyOption = hasBody ? fetchBodyOption(input.body) : null

  // JSON bodies need a default content type unless the caller supplied one explicitly.
  if (bodyOption?.isJson && !Object.keys(headers).some((name) => name.toLowerCase() === 'content-type')) {
    headers['Content-Type'] = 'application/json'
  }

  // Non-empty Header input belongs in the generated Fetch options object.
  if (Object.keys(headers).length > 0) {
    options.push(`  headers: ${formatHeaders(headers)}`)
  }

  // A supplied payload needs its corresponding headers and body option in the generated call.
  if (bodyOption) {
    options.push(bodyOption.option)
  }

  return `fetch(${JSON.stringify(url)}, {\n${options.join(',\n')}\n});\n`
}
