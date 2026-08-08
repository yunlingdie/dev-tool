import { describe, expect, it, vi } from 'vitest'

import { buildFetchRequest } from './fetch-request'

describe('buildFetchRequest', () => {
  // JSON request bodies require a JSON content type and remain structured in the generated source.
  it('generates a JSON POST request', () => {
    expect(buildFetchRequest({
      url: 'https://api.example.com/users',
      method: 'POST',
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
      body: 'name=Ada',
    })).toBe(
      'fetch("/api/users/1", {\n' +
        '  method: "PATCH",\n' +
        '  body: "name=Ada"\n' +
        '});\n',
    )
  })

  // Empty bodies remain absent so read requests render as valid Fetch calls.
  it('generates a request without a body', () => {
    expect(buildFetchRequest({
      url: '/api/health',
      method: 'GET',
      body: '',
    })).toBe(
      'fetch("/api/health", {\n' +
        '  method: "GET"\n' +
        '});\n',
    )
  })

  // Source generation must remain local and never execute the represented HTTP request.
  it('does not execute Fetch', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    expect(buildFetchRequest({
      url: 'https://api.example.com/users',
      method: 'POST',
      body: '{}',
    })).toContain('fetch(')
    expect(fetchSpy).not.toHaveBeenCalled()

    fetchSpy.mockRestore()
  })

  // Fetch requires a destination and rejects request bodies for these read-only methods.
  it('rejects invalid URL and method-body combinations', () => {
    expect(() => buildFetchRequest({ url: ' ', method: 'POST', body: '' })).toThrow('URL 不能为空')
    expect(() => buildFetchRequest({ url: '/api/health', method: 'GET', body: '{}' })).toThrow('GET 和 HEAD 请求不能包含 Body')
  })
})
