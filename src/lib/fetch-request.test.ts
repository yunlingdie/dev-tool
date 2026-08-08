import { describe, expect, it, vi } from 'vitest'

import { buildFetchRequest } from './fetch-request'

describe('buildFetchRequest', () => {
  // JSON request bodies require a JSON content type and remain structured in the generated source.
  it('generates a JSON POST request', () => {
    expect(buildFetchRequest({
      url: 'https://api.example.com/users',
      method: 'POST',
      headers: '',
      body: '{"name":"Ada","active":true}',
    })).toBe(
      'fetch("https://api.example.com/users", {\n' +
        '  method: "POST",\n' +
        '  headers: {\n' +
        '    "Content-Type": "application/json"\n' +
        '  },\n' +
        '  body: JSON.stringify({\n' +
        '  "name": "Ada",\n' +
        '  "active": true\n' +
        '})\n' +
        '});\n',
    )
  })

  // Non-JSON bodies are valid Fetch strings and must not be parsed or modified.
  it('generates a raw text request body', () => {
    expect(buildFetchRequest({
      url: '/api/users/1',
      method: 'PATCH',
      headers: '{"X-Trace":"trace-id"}',
      body: 'name=Ada',
    })).toBe(
      'fetch("/api/users/1", {\n' +
        '  method: "PATCH",\n' +
        '  headers: {\n' +
        '    "X-Trace": "trace-id"\n' +
        '  },\n' +
        '  body: "name=Ada"\n' +
        '});\n',
    )
  })

  // An explicit content type must take precedence over the JSON body's default header.
  it('preserves a custom content type', () => {
    const result = buildFetchRequest({
      url: '/api/users/1',
      method: 'PUT',
      headers: '{"Content-Type":"application/merge-patch+json"}',
      body: '{"active":false}',
    })

    expect(result).toContain('"Content-Type": "application/merge-patch+json"')
    expect(result).not.toContain('"Content-Type": "application/json"')
  })

  // Empty bodies remain absent so read requests render as valid Fetch calls.
  it('generates a request without a body', () => {
    expect(buildFetchRequest({
      url: '/api/health',
      method: 'GET',
      headers: '{"X-Request-ID":"health-check"}',
      body: '',
    })).toBe(
      'fetch("/api/health", {\n' +
        '  method: "GET",\n' +
        '  headers: {\n' +
        '    "X-Request-ID": "health-check"\n' +
        '  }\n' +
        '});\n',
    )
  })

  // Source generation must remain local and never execute the represented HTTP request.
  it('does not execute Fetch', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    expect(buildFetchRequest({
      url: 'https://api.example.com/users',
      method: 'POST',
      headers: '',
      body: '{}',
    })).toContain('fetch(')
    expect(fetchSpy).not.toHaveBeenCalled()

    fetchSpy.mockRestore()
  })

  // Fetch requires a destination and rejects request bodies for these read-only methods.
  it('rejects invalid URL and method-body combinations', () => {
    expect(() => buildFetchRequest({ url: ' ', method: 'POST', headers: '', body: '' })).toThrow('URL 不能为空')
    expect(() => buildFetchRequest({ url: '/api/health', method: 'GET', headers: '', body: '{}' })).toThrow('GET 和 HEAD 请求不能包含 Body')
  })

  // Invalid Header JSON should be reported before source generation produces misleading code.
  it('rejects invalid Header input', () => {
    expect(() => buildFetchRequest({
      url: '/api/users',
      method: 'POST',
      headers: 'Authorization: Bearer token',
      body: '',
    })).toThrow('Header 必须是 JSON 对象')
  })
})
