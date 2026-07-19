import { describe, expect, it } from 'vitest'

import { getToolSearchSuggestions } from './search'

/** Returns suggestion ids in their user-visible order. */
function suggestionIds(value: string): string[] {
  return getToolSearchSuggestions(value).map((suggestion) => suggestion.tool.id)
}

describe('tool search suggestions', () => {
  it('finds catalog tools by normalized titles and aliases', () => {
    expect(suggestionIds('uuid')[0]).toBe('uuid')
    expect(suggestionIds('JSON 格式化')[0]).toBe('json-format')
  })

  it('offers focused JSON operations and preserves the exact pasted value', () => {
    const input = '  {\n  "name": "dev-tool"\n}\n'
    const suggestions = getToolSearchSuggestions(input)

    expect(suggestions.slice(0, 2).map((suggestion) => suggestion.tool.id)).toEqual([
      'json-format',
      'json-php-array',
    ])
    expect(suggestions.every((suggestion) => suggestion.value === input)).toBe(true)
    expect(suggestions.every((suggestion) => suggestion.fieldKey === 'input')).toBe(true)
    expect(new Set(suggestions.map((suggestion) => suggestion.tool.id)).size).toBe(suggestions.length)
  })

  it('offers CSV only for JSON arrays', () => {
    expect(suggestionIds('[{"name":"Ada"}]')).toContain('json-csv')
    expect(suggestionIds('{"name":"Ada"}')).not.toContain('json-csv')
    expect(suggestionIds('[1, 2]')).not.toContain('json-csv')
    expect(suggestionIds('[{"name":"Ada"}]')).not.toContain('json-toml')
    expect(suggestionIds('[{"name":"Ada"}]')).not.toContain('json-xml')
  })

  it('does not offer object-only conversions for JSON scalar roots', () => {
    expect(suggestionIds('1')).toEqual(['json-format', 'json-minify', 'json-yaml'])
  })

  it('does not infer JSON tools from invalid JSON', () => {
    expect(suggestionIds('{name: nope}')).toEqual([])
  })

  it('does not mistake arbitrary dotted text or hostnames for JWT content', () => {
    expect(suggestionIds('foo.bar.baz')).toEqual([])
    expect(suggestionIds('www.example.com')).toEqual([])
  })

  it.each([
    ['curl https://example.com', 'curl-fetch', 'input'],
    ['https://example.com/path?q=1', 'url-parser', 'input'],
    ['eyJhbGciOiJub25lIn0.eyJzdWIiOiIxIn0.', 'jwt-parser', 'input'],
    ['<root><name>dev-tool</name></root>', 'xml-format', 'input'],
    ['<root />', 'xml-format', 'input'],
    ['docker run --rm nginx', 'docker-converter', 'input'],
    ['SELECT * FROM users', 'sql-format', 'input'],
    ['192.168.1.8/24', 'ipv4-subnet', 'input'],
  ])('routes high-confidence content %s to %s', (input, toolId, fieldKey) => {
    const suggestion = getToolSearchSuggestions(input)[0]

    expect(suggestion?.tool.id).toBe(toolId)
    expect(suggestion?.fieldKey).toBe(fieldKey)
  })

  it('keeps every declared prefill target aligned with a text-capable registry field', () => {
    const samples = [
      '{"name":"dev-tool"}',
      'curl https://example.com',
      'https://example.com',
      '<root />',
      'SELECT 1',
      'PHP 数组转 JSON',
    ]

    for (const sample of samples) {
      for (const suggestion of getToolSearchSuggestions(sample)) {
        // Suggestions without a target are generators or other option-only tools.
        if (!suggestion.fieldKey) {
          continue
        }

        const field = suggestion.tool.fields.find((candidate) => candidate.key === suggestion.fieldKey)
        expect(field).toBeDefined()
        expect(['text', 'textarea']).toContain(field?.type)
      }
    }
  })
})
