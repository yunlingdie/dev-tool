import { describe, expect, it } from 'vitest'
import { validate as validateUuid, version as uuidVersion } from 'uuid'

import { tools } from './definitions'
import type { ToolDefinition, ToolValues } from './types'

const expectedToolIds = [
  'hash-text',
  'uuid',
  'ulid',
  'rsa',
  'date-time',
  'base-converter',
  'roman',
  'base64-string',
  'base32-base58',
  'base64-file',
  'audio-parser',
  'ascii-binary',
  'unicode',
  'yaml-json',
  'yaml-toml',
  'json-yaml',
  'json-toml',
  'toml-json',
  'toml-yaml',
  'xml-json',
  'json-xml',
  'json-php-array',
  'php-array-json',
  'url-codec',
  'url-parser',
  'jwt-parser',
  'certificate-parser',
  'certificate-key-match',
  'shuffle',
  'json-diff',
  'json-format',
  'json-minify',
  'json-csv',
  'sql-format',
  'docker-converter',
  'curl-fetch',
  'xml-format',
  'yaml-format',
  'regex-tester',
  'ipv4-subnet',
  'ipv4-converter',
  'mac-generator',
  'ipv6-ula',
  'text-compare',
  'text-stats',
]

/** Finds a required registered tool and fails the test with a specific missing id. */
function toolById(id: string): ToolDefinition {
  const tool = tools.find((candidate) => candidate.id === id)

  // Contract tests cannot execute a tool that is missing from the registry.
  if (!tool) {
    throw new Error(`Missing tool: ${id}`)
  }

  return tool
}

/** Creates an executable value map from one tool's declared field defaults. */
function defaultValues(tool: ToolDefinition): ToolValues {
  return Object.fromEntries(tool.fields.map((field) => [field.key, field.defaultValue]))
}

describe('tool registry', () => {
  it('contains every requested tool exactly once and in the intended order', () => {
    expect(tools.map((tool) => tool.id)).toEqual(expectedToolIds)
    expect(new Set(tools.map((tool) => tool.id)).size).toBe(tools.length)
  })

  it('executes representative text, format, network, and Docker tools', async () => {
    const baseTool = toolById('base-converter')
    const yamlTool = toolById('yaml-json')
    const subnetTool = toolById('ipv4-subnet')
    const dockerTool = toolById('docker-converter')

    await expect(Promise.resolve(baseTool.execute(defaultValues(baseTool)))).resolves.toMatchObject({ output: 'ff' })
    await expect(Promise.resolve(yamlTool.execute(defaultValues(yamlTool)))).resolves.toMatchObject({
      output: expect.stringContaining('"name": "dev-tool"'),
    })
    await expect(Promise.resolve(subnetTool.execute(defaultValues(subnetTool)))).resolves.toMatchObject({
      output: expect.stringContaining('192.168.1.0'),
    })
    await expect(Promise.resolve(dockerTool.execute(defaultValues(dockerTool)))).resolves.toMatchObject({
      output: expect.stringContaining('services:'),
    })
  })

  it('registers audio parsing as an audio-only local file tool', async () => {
    const audioTool = toolById('audio-parser')

    expect(audioTool.fields).toEqual([
      expect.objectContaining({
        key: 'file',
        type: 'file',
        accept: 'audio/*',
      }),
    ])
    await expect(audioTool.execute(defaultValues(audioTool))).rejects.toThrow('请先选择文件')
  })

  it('renders date conversion as separately copyable Chinese rows', async () => {
    const dateTool = toolById('date-time')
    const values = defaultValues(dateTool)
    values.input = '1970-01-01T00:00:00.000Z'
    values.timeZone = 'Asia/Shanghai'
    const result = await Promise.resolve(dateTool.execute(values))

    expect(result).toEqual({
      output: [
        'ISO 时间: 1970-01-01T00:00:00.000Z',
        'Unix 秒级时间戳: 0',
        'Unix 毫秒级时间戳: 0',
        '时区: Asia/Shanghai',
        '本地时间: 1970-01-01 08:00:00',
      ].join('\n'),
      items: [
        '1970-01-01T00:00:00.000Z',
        '0',
        '0',
        'Asia/Shanghai',
        '1970-01-01 08:00:00',
      ],
      itemLabels: ['ISO 时间', 'Unix 秒级时间戳', 'Unix 毫秒级时间戳', '时区', '本地时间'],
    })
  })

  it('marks text comparison as a line-safe unified diff', async () => {
    const compareTool = toolById('text-compare')
    const values = defaultValues(compareTool)
    const result = await Promise.resolve(compareTool.execute(values))

    expect(result).toEqual({
      output: ['  first line', '- old value', '+ new value'].join('\n'),
      language: 'diff',
    })
  })

  it('labels text statistics output in Chinese', async () => {
    const statsTool = toolById('text-stats')
    const values = defaultValues(statsTool)
    values.input = 'Hello 世界😀\nnext'
    const result = await Promise.resolve(statsTool.execute(values))

    expect(result.language).toBe('json')
    expect(JSON.parse(result.output)).toEqual({
      '字符数': 14,
      '不含空格字符数': 12,
      '单词数': 4,
      '行数': 2,
      '字节数': 21,
    })
  })

  it('generates five valid and unique UUIDs by default for every supported version', async () => {
    const uuidTool = toolById('uuid')

    for (const version of ['v1', 'v4', 'v7']) {
      const values = defaultValues(uuidTool)
      values.version = version
      const result = await Promise.resolve(uuidTool.execute(values))
      const generated = result.output.split('\n')

      expect(generated).toHaveLength(5)
      expect(new Set(generated).size).toBe(5)
      expect(generated.every(validateUuid)).toBe(true)
      expect(generated.every((value) => uuidVersion(value) === Number(version.slice(1)))).toBe(true)
    }
  })

  it('exposes each counted generator result as an individually copyable item', async () => {
    for (const toolId of ['uuid', 'ulid', 'mac-generator', 'ipv6-ula']) {
      const generatorTool = toolById(toolId)
      const result = await Promise.resolve(generatorTool.execute(defaultValues(generatorTool)))
      const items = result.items

      expect(result).toHaveProperty('items')
      expect(items).toHaveLength(5)
      expect(result.output).toBe(items?.join('\n'))
    }
  })

  it('marks JSON-producing tools for syntax-aware output rendering', async () => {
    for (const toolId of ['json-format', 'yaml-json', 'toml-json', 'xml-json', 'php-array-json', 'url-parser']) {
      const jsonTool = toolById(toolId)
      const result = await Promise.resolve(jsonTool.execute(defaultValues(jsonTool)))

      expect(result.language).toBe('json')
    }
  })

  it('executes both PHP array conversion tools through the registry', async () => {
    const jsonToPhpTool = toolById('json-php-array')
    const phpToJsonTool = toolById('php-array-json')
    const phpResult = await Promise.resolve(jsonToPhpTool.execute(defaultValues(jsonToPhpTool)))
    const jsonResult = await Promise.resolve(phpToJsonTool.execute(defaultValues(phpToJsonTool)))

    expect(phpResult.output).toContain("'name' => 'dev-tool'")
    expect(JSON.parse(jsonResult.output)).toMatchObject({ name: 'dev-tool', active: true })
  })

  it('executes the Base32/Base58 and cURL-to-Fetch tools through the registry', async () => {
    const baseTool = toolById('base32-base58')
    const curlTool = toolById('curl-fetch')
    const baseResult = await Promise.resolve(baseTool.execute(defaultValues(baseTool)))
    const curlResult = await Promise.resolve(curlTool.execute(defaultValues(curlTool)))

    expect(baseResult.output).toBe('IRSXMICUN5XWYYTPPA======')
    expect(curlResult.output).toContain("fetch('https://api.example.com/users'")
    expect(curlResult.output).toContain("method: 'POST'")
  })

  it('returns RSA public and private keys as two named outputs', async () => {
    const rsaTool = toolById('rsa')
    const result = await Promise.resolve(rsaTool.execute(defaultValues(rsaTool)))

    expect(rsaTool.outputLabels).toEqual(['公钥', '私钥'])
    expect(result.output).toBe('')
    expect(result.outputs).toEqual([
      expect.objectContaining({
        label: '公钥',
        content: expect.stringMatching(/^-----BEGIN PUBLIC KEY-----/),
        filename: 'rsa-public-key.pem',
      }),
      expect.objectContaining({
        label: '私钥',
        content: expect.stringMatching(/^-----BEGIN PRIVATE KEY-----/),
        filename: 'rsa-private-key.pem',
      }),
    ])
  })
})
