import { describe, expect, it, vi } from 'vitest'

import { lookupDns } from './dns'

/** Creates one JSON response for deterministic DNS resolver tests. */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('DNS lookup', () => {
  it('queries the selected record type and normalizes resolver records', async () => {
    const fetcher = vi.fn(async () => jsonResponse({
      Status: 0,
      TC: false,
      AD: true,
      Answer: [
        { name: 'example.com.', type: 5, TTL: 300, data: 'www.example.com.' },
        { name: 'www.example.com.', type: 1, TTL: 120, data: '192.0.2.10' },
      ],
      Authority: [
        { name: 'example.com.', type: 2, TTL: 3600, data: 'ns1.example.com.' },
      ],
    }))

    const result = await lookupDns('Example.COM.', 'A', fetcher)
    const requestUrl = new URL(String(fetcher.mock.calls[0]?.[0]))

    expect(requestUrl.origin + requestUrl.pathname).toBe('https://dns.google/resolve')
    expect(requestUrl.searchParams.get('name')).toBe('example.com')
    expect(requestUrl.searchParams.get('type')).toBe('A')
    expect(requestUrl.searchParams.get('edns_client_subnet')).toBe('0.0.0.0/0')
    expect(result).toEqual({
      resolver: 'Google Public DNS',
      query: { name: 'example.com', type: 'A' },
      status: { code: 0, name: 'NOERROR' },
      dnssecValidated: true,
      truncated: false,
      answer: [
        { name: 'example.com.', type: 'CNAME', ttl: 300, data: 'www.example.com.' },
        { name: 'www.example.com.', type: 'A', ttl: 120, data: '192.0.2.10' },
      ],
      authority: [
        { name: 'example.com.', type: 'NS', ttl: 3600, data: 'ns1.example.com.' },
      ],
    })
  })

  it('returns DNS failures such as NXDOMAIN as inspectable results', async () => {
    const fetcher = vi.fn(async () => jsonResponse({
      Status: 3,
      AD: false,
      Comment: 'Name Error',
    }))

    await expect(lookupDns('missing.example', 'AAAA', fetcher)).resolves.toMatchObject({
      status: { code: 3, name: 'NXDOMAIN' },
      answer: [],
      authority: [],
      comment: 'Name Error',
    })
  })

  it.each([
    ['', '域名不能为空'],
    ['https://example.com', '请输入域名，不要包含协议、端口或路径'],
    ['bad..example.com', '域名格式无效'],
    ['-bad.example.com', '域名格式无效'],
  ])('rejects invalid domain input %j', async (input, message) => {
    const fetcher = vi.fn()

    await expect(lookupDns(input, 'A', fetcher)).rejects.toThrow(message)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('reports HTTP and response-shape failures separately', async () => {
    const failedFetch = vi.fn(async () => jsonResponse({}, 503))
    const malformedFetch = vi.fn(async () => jsonResponse({ Answer: [] }))

    await expect(lookupDns('example.com', 'A', failedFetch)).rejects.toThrow(
      'DNS 服务请求失败（HTTP 503）',
    )
    await expect(lookupDns('example.com', 'A', malformedFetch)).rejects.toThrow(
      'DNS 服务返回了无效响应',
    )
  })

  it('uses a readable network error without exposing fetch internals', async () => {
    const fetcher = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })

    await expect(lookupDns('example.com', 'TXT', fetcher)).rejects.toThrow(
      'DNS 查询失败，请检查网络连接后重试',
    )
  })
})
