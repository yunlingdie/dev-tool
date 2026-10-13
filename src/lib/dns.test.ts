import { describe, expect, it, vi } from 'vitest'

import { DNS_RECORD_TYPES, formatDnsLookup, lookupDns } from './dns'

/** Creates one JSON response for deterministic DNS resolver tests. */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('DNS lookup', () => {
  it('formats actual answers by record type, omits empty types, and deduplicates aliases', async () => {
    const fetcher = vi.fn(async (input: string | URL) => {
      const type = new URL(String(input)).searchParams.get('type')
      const answers: Record<string, unknown[]> = {
        A: [
          { name: 'example.com.', type: 5, TTL: 300, data: 'alias.example.com.' },
          { name: 'alias.example.com.', type: 1, TTL: 300, data: '192.0.2.10' },
          { name: 'alias.example.com.', type: 1, TTL: 300, data: '192.0.2.11' },
        ],
        AAAA: [{ name: 'alias.example.com.', type: 28, TTL: 300, data: '2001:db8::1' }],
        CNAME: [{ name: 'example.com.', type: 5, TTL: 300, data: 'alias.example.com.' }],
        MX: [{ name: 'example.com.', type: 15, TTL: 300, data: '10 mail.example.com.' }],
        TXT: [{ name: 'example.com.', type: 16, TTL: 300, data: '"v=spf1 -all"' }],
      }

      return jsonResponse({
        Status: 0,
        Answer: answers[type ?? ''] ?? [],
        Authority: [{ name: 'example.com.', type: 6, TTL: 300, data: 'negative-answer SOA' }],
      })
    })

    expect(formatDnsLookup(await lookupDns('example.com', fetcher))).toBe([
      'A: 192.0.2.10, 192.0.2.11',
      'AAAA: 2001:db8::1',
      'CNAME: alias.example.com.',
      'MX: 10 mail.example.com.',
      'TXT: "v=spf1 -all"',
    ].join('\n'))
  })

  it('reports empty answers without presenting authority records as resolved data', async () => {
    const fetcher = vi.fn(async () => jsonResponse({
      Status: 0,
      Authority: [{ name: 'example.com.', type: 6, TTL: 300, data: 'negative-answer SOA' }],
    }))

    expect(formatDnsLookup(await lookupDns('example.com', fetcher))).toBe('未找到 DNS 解析记录')
  })

  it('retains a resolver failure status when no answers can be formatted', async () => {
    const fetcher = vi.fn(async () => jsonResponse({ Status: 3 }))

    expect(formatDnsLookup(await lookupDns('missing.example', fetcher)))
      .toBe('未找到 DNS 解析记录（NXDOMAIN）')
  })

  it('queries every supported record type and normalizes resolver records', async () => {
    const fetcher = vi.fn(async (input: string | URL) => {
      const type = new URL(String(input)).searchParams.get('type')
      // Only the A fixture has answers so empty record groups remain covered in the same run.
      const answer = type === 'A'
        ? [
            { name: 'example.com.', type: 5, TTL: 300, data: 'www.example.com.' },
            { name: 'www.example.com.', type: 1, TTL: 120, data: '192.0.2.10' },
          ]
        : []

      return jsonResponse({
        Status: 0,
        TC: false,
        AD: true,
        Answer: answer,
        Authority: [
          { name: 'example.com.', type: 2, TTL: 3600, data: 'ns1.example.com.' },
        ],
      })
    })

    const result = await lookupDns('Example.COM.', fetcher)
    const requestUrls = fetcher.mock.calls.map(([input]) => new URL(String(input)))

    expect(fetcher).toHaveBeenCalledTimes(DNS_RECORD_TYPES.length)
    expect(requestUrls.map((url) => url.origin + url.pathname)).toEqual(
      DNS_RECORD_TYPES.map(() => 'https://dns.google/resolve'),
    )
    expect(requestUrls.map((url) => url.searchParams.get('name'))).toEqual(
      DNS_RECORD_TYPES.map(() => 'example.com'),
    )
    expect(requestUrls.map((url) => url.searchParams.get('type'))).toEqual(DNS_RECORD_TYPES)
    expect(requestUrls.map((url) => url.searchParams.get('edns_client_subnet'))).toEqual(
      DNS_RECORD_TYPES.map(() => '0.0.0.0/0'),
    )
    expect(result).toEqual({
      resolver: 'Google Public DNS',
      query: { name: 'example.com' },
      results: [
        {
          type: 'A',
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
        },
        ...DNS_RECORD_TYPES.slice(1).map((type) => ({
          type,
          status: { code: 0, name: 'NOERROR' },
          dnssecValidated: true,
          truncated: false,
          answer: [],
          authority: [
            { name: 'example.com.', type: 'NS', ttl: 3600, data: 'ns1.example.com.' },
          ],
        })),
      ],
    })
  })

  it('returns DNS failures such as NXDOMAIN as inspectable results', async () => {
    const fetcher = vi.fn(async () => jsonResponse({
      Status: 3,
      AD: false,
      Comment: 'Name Error',
    }))

    const result = await lookupDns('missing.example', fetcher)

    expect(result.results).toHaveLength(DNS_RECORD_TYPES.length)
    expect(result.results.every((item) => (
      item.status.code === 3
      && item.status.name === 'NXDOMAIN'
      && item.answer.length === 0
      && item.authority.length === 0
      && item.comment === 'Name Error'
    ))).toBe(true)
  })

  it.each([
    ['', '域名不能为空'],
    ['https://example.com', '请输入域名，不要包含协议、端口或路径'],
    ['bad..example.com', '域名格式无效'],
    ['-bad.example.com', '域名格式无效'],
  ])('rejects invalid domain input %j', async (input, message) => {
    const fetcher = vi.fn()

    await expect(lookupDns(input, fetcher)).rejects.toThrow(message)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('reports HTTP and response-shape failures separately', async () => {
    const failedFetch = vi.fn(async () => jsonResponse({}, 503))
    const malformedFetch = vi.fn(async () => jsonResponse({ Answer: [] }))

    await expect(lookupDns('example.com', failedFetch)).rejects.toThrow(
      /DNS [A-Z]+ 服务请求失败（HTTP 503）/,
    )
    await expect(lookupDns('example.com', malformedFetch)).rejects.toThrow(
      /DNS [A-Z]+ 服务返回了无效响应/,
    )
  })

  it('uses a readable network error without exposing fetch internals', async () => {
    const fetcher = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })

    await expect(lookupDns('example.com', fetcher)).rejects.toThrow(
      /DNS [A-Z]+ 查询失败，请检查网络连接后重试/,
    )
  })
})
