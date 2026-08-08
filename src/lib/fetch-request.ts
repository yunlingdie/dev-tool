/** HTTP methods supported by the URL, Body, and Method Fetch generator. */
export type FetchMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'

export interface FetchRequestInput {
  url: string
  method: FetchMethod
  body: string
}

/** Converts a JSON or text request body into Fetch option lines. */
function fetchBodyOptions(body: string): string[] {
  try {
    const parsed = JSON.parse(body)

    return [
      '  headers: {\n    "Content-Type": "application/json"\n  }',
      `  body: JSON.stringify(${JSON.stringify(parsed, null, 2)})`,
    ]
  } catch {
    // Non-JSON payloads must remain verbatim strings instead of being rewritten as JSON.
    return [`  body: ${JSON.stringify(body)}`]
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

  const options = [`  method: ${JSON.stringify(input.method)}`]

  // A supplied payload needs its corresponding headers and body option in the generated call.
  if (hasBody) {
    options.push(...fetchBodyOptions(input.body))
  }

  return `fetch(${JSON.stringify(url)}, {\n${options.join(',\n')}\n});\n`
}
