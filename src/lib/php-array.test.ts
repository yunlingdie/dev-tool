import { describe, expect, it } from 'vitest'

import { jsonToPhpArray, phpArrayToJson } from './php-array'

describe('jsonToPhpArray', () => {
  it('formats nested objects and arrays with PHP short-array syntax', () => {
    expect(jsonToPhpArray('{"name":"Ada","flags":[true,null],"meta":{"level":2}}')).toBe(
      "[\n  'name' => 'Ada',\n  'flags' => [\n    true,\n    null\n  ],\n  'meta' => [\n    'level' => 2\n  ]\n]",
    )
  })

  it('escapes quotes and backslashes without interpolating dollar signs', () => {
    expect(jsonToPhpArray('{"text":"It\'s \\\\ $safe"}')).toBe(
      "[\n  'text' => 'It\\'s \\\\ $safe'\n]",
    )
  })

  it('rejects JSON scalar roots', () => {
    expect(() => jsonToPhpArray('"scalar"')).toThrow('JSON root must be an object or array')
  })

  it('rejects unsafe JSON integers before JSON parsing can round them', () => {
    expect(() => jsonToPhpArray('[9007199254740993]')).toThrow('safe integer range')
    expect(() => jsonToPhpArray('{"value": 9.007199254740993e15}')).toThrow('safe integer range')
  })

  it('rejects exponent values that overflow the finite JSON number range', () => {
    expect(() => jsonToPhpArray('[1e400]')).toThrow('finite numeric range')
  })

  it('does not number-scan digits inside JSON strings', () => {
    expect(jsonToPhpArray('["9007199254740993"]')).toBe("[\n  '9007199254740993'\n]")
  })
})

describe('phpArrayToJson', () => {
  it('converts nested short arrays and scalar literals', () => {
    const php = "['name' => 'Ada', 'flags' => [true, null, -2.5], 'meta' => ['level' => +2]]"

    expect(JSON.parse(phpArrayToJson(php))).toEqual({
      name: 'Ada',
      flags: [true, null, -2.5],
      meta: { level: 2 },
    })
  })

  it('accepts long arrays with optional PHP, return, and closing-tag wrappers', () => {
    const php = "<?php return array('items' => array('a', 'b')); ?>"

    expect(JSON.parse(phpArrayToJson(php))).toEqual({ items: ['a', 'b'] })
  })

  it('decodes PHP string escaping without evaluating interpolation', () => {
    const php = String.raw`['single' => 'It\'s \\ safe', 'double' => "line\n\$literal", 'tag' => '?> <?php']`

    expect(JSON.parse(phpArrayToJson(php))).toEqual({
      single: "It's \\ safe",
      double: 'line\n$literal',
      tag: '?> <?php',
    })
  })

  it('applies automatic integer keys before deciding between arrays and objects', () => {
    expect(JSON.parse(phpArrayToJson("[0 => 'a', 'b', 2 => 'c']"))).toEqual(['a', 'b', 'c'])
    expect(JSON.parse(phpArrayToJson("[2 => 'c', 'd', 'name' => 'Ada']"))).toEqual({
      2: 'c',
      3: 'd',
      name: 'Ada',
    })
  })

  it('normalizes mixed key types and keeps the last duplicate value', () => {
    const php = "['1' => 'first', 1 => 'last', '01' => 'leading', false => 'zero']"

    expect(JSON.parse(phpArrayToJson(php))).toEqual({
      0: 'zero',
      1: 'last',
      '01': 'leading',
    })
  })

  it('preserves prototype-sensitive keys without mutating object prototypes', () => {
    const converted = JSON.parse(
      phpArrayToJson("['__proto__' => ['polluted' => true], 'constructor' => 'kept']"),
    ) as Record<string, unknown>

    expect(Object.prototype.hasOwnProperty.call(converted, '__proto__')).toBe(true)
    expect((converted.__proto__ as Record<string, unknown>).polluted).toBe(true)
    expect(converted).toHaveProperty('constructor', 'kept')
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('rejects unsafe PHP integer values and keys instead of silently rounding them', () => {
    expect(() => phpArrayToJson('[9007199254740993]')).toThrow('safe integer range')
    expect(() => phpArrayToJson("[9007199254740993 => 'value']")).toThrow('safe integer range')
    expect(() => phpArrayToJson('[9.007199254740993e15]')).toThrow('safe integer range')
  })

  it.each([
    "[$value]",
    '[danger()]',
    '[1 + 2]',
    '[...$values]',
    '[&$value]',
    "['key' => new Thing()]",
  ])('rejects executable or runtime-dependent expression: %s', (php) => {
    expect(() => phpArrayToJson(php)).toThrow()
  })

  it('rejects additional statements around an otherwise valid array', () => {
    expect(() => phpArrayToJson("echo 'before'; return [];"))
      .toThrow('exactly one array statement')
  })
})
