import { describe, expect, it, vi } from 'vitest'

import { curlToFetch } from './curl-fetch'

describe('curlToFetch', () => {
  // A simple GET should become one browser Fetch call without unnecessary options.
  it('converts a GET request', () => {
    expect(curlToFetch('curl https://api.example.com/users')).toBe(
      "fetch('https://api.example.com/users');\n",
    )
  })

  // JSON request data should retain its method, content type, and structured body.
  it('converts a JSON POST request', () => {
    const result = curlToFetch(
      `curl -X POST https://api.example.com/users -H 'Content-Type: application/json' --data '{"name":"Ada","active":true}'`,
    )

    expect(result).toContain("method: 'POST'")
    expect(result).toContain("'Content-Type': 'application/json'")
    expect(result).toContain('body: JSON.stringify({')
    expect(result).toContain("'name': 'Ada'")
    expect(result).toContain("'active': true")
  })

  // Headers and basic authentication should remain explicit in the generated options.
  it('converts custom headers and basic authentication', () => {
    const result = curlToFetch(
      `curl -u user:pass -H 'X-Trace: trace-id' https://api.example.com/private`,
    )

    expect(result).toContain("'X-Trace': 'trace-id'")
    expect(result).toContain("'Authorization': 'Basic ' + btoa('user:pass')")
  })

  // Non-fatal converter warnings must stay visible as safe line comments before the code.
  it('prefixes warning lines without hiding the generated code', () => {
    const result = curlToFetch(
      `curl -k -H 'Cookie: session=secret' https://api.example.com`,
    )

    expect(result).toBe(
      '// [insecure] -k is not a supported option\n' +
        '// [forbidden-header] "Cookie" header is forbidden in fetch()\n\n' +
        "fetch('https://api.example.com', {\n" +
        '  headers: {\n' +
        "    'Cookie': 'session=secret'\n" +
        '  }\n' +
        '});\n',
    )
  })

  // Multi-line diagnostics need a comment prefix on every line to remain inert source text.
  it('comments every line of a multi-line warning', () => {
    const result = curlToFetch('curl "https://api.example.com/$TOKEN"')
    const warningBlock = result.split('\n\n', 1)[0]

    for (const line of warningBlock.split('\n')) {
      expect(line).toMatch(/^\/\/ \[expansion\] /)
    }
  })

  // Conversion must only return source text and never send the described HTTP request.
  it('does not execute the generated Fetch call', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    expect(curlToFetch('curl https://api.example.com/users')).toContain('fetch(')
    expect(fetchSpy).not.toHaveBeenCalled()

    fetchSpy.mockRestore()
  })

  // Blank commands should receive a stable error before reaching the shell parser.
  it('rejects empty input', () => {
    expect(() => curlToFetch('  \n\t')).toThrow('cURL input is required')
  })

  // Invalid shell syntax should surface curlconverter's actionable parser diagnostic.
  it('rejects malformed cURL input', () => {
    expect(() => curlToFetch('curl "unterminated')).toThrow('Bash parsing error')
  })
})
