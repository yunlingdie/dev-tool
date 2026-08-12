import { describe, expect, it } from 'vitest'

import { language, localizeTool, setLanguage, t } from './i18n'
import { tools } from '../tools/definitions'

describe('language state', () => {
  // English localization should change display labels while retaining the registered tool id.
  it('localizes a tool definition without changing its route identity', () => {
    const localized = localizeTool(tools[0], 'en')

    expect(localized.id).toBe('md5')
    expect(localized.title).toBe('MD5 Calculator')
    expect(localized.fields[0].label).toBe('Text')
    expect(localized.actionLabel).toBe('Calculate MD5')

    const compareTool = tools.find((tool) => tool.id === 'text-compare')
    expect(localizeTool(compareTool!, 'en').fields.at(-1)?.label).toBe('Show differences only')
  })

  // Unsupported values must return to Chinese so persisted or malformed browser data stays safe.
  it('falls back to Chinese for unsupported language values', () => {
    setLanguage('en')
    expect(language.value).toBe('en')
    expect(t('searchTools')).toBe('Search tools')

    setLanguage('unsupported')
    expect(language.value).toBe('zh')
    expect(t('searchTools')).toBe('搜索工具')
  })
})
