export const DNS_RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'NS', 'TXT', 'SOA', 'SRV', 'CAA'] as const

export type DnsRecordType = (typeof DNS_RECORD_TYPES)[number]

export interface DnsRecord {
  name: string
  type: string
  ttl: number
  data: string
}

export interface DnsRecordLookupResult {
  type: DnsRecordType
  status: {
    code: number
    name: string
  }
  dnssecValidated: boolean
  truncated: boolean
  answer: DnsRecord[]
  authority: DnsRecord[]
  comment?: string
}

export interface DnsLookupResult {
  resolver: string
  query: {
    name: string
  }
  results: DnsRecordLookupResult[]
}

type DnsFetch = (input: string | URL, init?: RequestInit) => Promise<Response>

const DNS_RESOLVER_URL = 'https://dns.google/resolve'

const DNS_STATUS_NAMES: Record<number, string> = {
  0: 'NOERROR',
  1: 'FORMERR',
  2: 'SERVFAIL',
  3: 'NXDOMAIN',
  4: 'NOTIMP',
  5: 'REFUSED',
}

const DNS_TYPE_NAMES: Record<number, string> = {
  1: 'A',
  2: 'NS',
  5: 'CNAME',
  6: 'SOA',
  12: 'PTR',
  15: 'MX',
  16: 'TXT',
  28: 'AAAA',
  33: 'SRV',
  257: 'CAA',
}

/** Narrows an unknown JSON value to an object with string keys. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Validates and converts a user-entered DNS name to its ASCII hostname form. */
function normalizeDnsName(input: string): string {
  const trimmed = input.trim()

  // DNS lookup needs a name rather than an empty form value.
  if (!trimmed) {
    throw new Error('域名不能为空')
  }

  // A trailing root dot is valid DNS notation but is unnecessary in the displayed query.
  const name = trimmed.endsWith('.') ? trimmed.slice(0, -1) : trimmed

  // URLs, ports, credentials, paths, and whitespace are not domain-name input.
  if (/[\s/:?#@]/.test(name)) {
    throw new Error('请输入域名，不要包含协议、端口或路径')
  }

  let asciiName: string

  try {
    asciiName = new URL(`http://${name}`).hostname
  } catch {
    throw new Error('域名格式无效')
  }

  // RFC DNS names are limited to 253 characters without the optional root dot.
  if (asciiName.length === 0 || asciiName.length > 253) {
    throw new Error('域名格式无效')
  }

  const labels = asciiName.split('.')

  for (const label of labels) {
    // DNS labels are bounded to 63 bytes and cannot begin or end with a hyphen.
    if (!/^[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?$/i.test(label)) {
      throw new Error('域名格式无效')
    }
  }

  return asciiName.toLowerCase()
}

/** Returns the conventional mnemonic for a DNS response status code. */
function dnsStatusName(code: number): string {
  return DNS_STATUS_NAMES[code] ?? `RCODE_${code}`
}

/** Returns a readable DNS record type while retaining unknown numeric types. */
function dnsTypeName(code: number): string {
  return DNS_TYPE_NAMES[code] ?? `TYPE${code}`
}

/** Converts one resolver section into stable records for the JSON output panel. */
function parseDnsRecords(value: unknown): DnsRecord[] {
  // Missing sections are valid when the resolver has no matching records.
  if (!Array.isArray(value)) {
    return []
  }

  const records: DnsRecord[] = []

  for (const item of value) {
    // Malformed entries are ignored while valid records in the same response remain useful.
    if (
      !isRecord(item)
      || typeof item.name !== 'string'
      || typeof item.type !== 'number'
      || typeof item.TTL !== 'number'
      || typeof item.data !== 'string'
    ) {
      continue
    }

    records.push({
      name: item.name,
      type: dnsTypeName(item.type),
      ttl: item.TTL,
      data: item.data,
    })
  }

  return records
}

/** Queries one DNS record type and normalizes its resolver response. */
async function lookupDnsRecord(
  name: string,
  type: DnsRecordType,
  fetcher: DnsFetch,
): Promise<DnsRecordLookupResult> {
  const url = new URL(DNS_RESOLVER_URL)
  url.searchParams.set('name', name)
  url.searchParams.set('type', type)
  url.searchParams.set('edns_client_subnet', '0.0.0.0/0')

  let response: Response

  try {
    response = await fetcher(url, { headers: { Accept: 'application/json' } })
  } catch {
    throw new Error(`DNS ${type} 查询失败，请检查网络连接后重试`)
  }

  // Transport failures are distinct from valid DNS error statuses such as NXDOMAIN.
  if (!response.ok) {
    throw new Error(`DNS ${type} 服务请求失败（HTTP ${response.status}）`)
  }

  let payload: unknown

  try {
    payload = await response.json()
  } catch {
    throw new Error(`DNS ${type} 服务返回了无效 JSON`)
  }

  // A numeric Status field is required to interpret the DNS response code safely.
  if (!isRecord(payload) || typeof payload.Status !== 'number') {
    throw new Error(`DNS ${type} 服务返回了无效响应`)
  }

  const result: DnsRecordLookupResult = {
    type,
    status: {
      code: payload.Status,
      name: dnsStatusName(payload.Status),
    },
    dnssecValidated: payload.AD === true,
    truncated: payload.TC === true,
    answer: parseDnsRecords(payload.Answer),
    authority: parseDnsRecords(payload.Authority),
  }

  // Resolver comments are optional and should appear only when the service supplied one.
  if (typeof payload.Comment === 'string' && payload.Comment.length > 0) {
    result.comment = payload.Comment
  }

  return result
}

/** Queries every supported DNS record type and preserves their stable display order. */
export async function lookupDns(
  input: string,
  fetcher: DnsFetch = fetch,
): Promise<DnsLookupResult> {
  const name = normalizeDnsName(input)
  const results = await Promise.all(
    DNS_RECORD_TYPES.map((type) => lookupDnsRecord(name, type, fetcher)),
  )

  return {
    resolver: 'Google Public DNS',
    query: { name },
    results,
  }
}
