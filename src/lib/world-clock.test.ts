import { describe, expect, it } from 'vitest'

import {
  findWorldClockLocations,
  formatWorldClockTime,
  worldClockLocationLabel,
} from './world-clock'

describe('world clock', () => {
  // The empty state must show a bounded overview spanning the major regions.
  it('returns the featured international clocks for an empty query', () => {
    const results = findWorldClockLocations('')

    expect(results).toHaveLength(12)
    expect(results.map((location) => location.timeZone)).toContain('Asia/Shanghai')
    expect(results.map((location) => location.timeZone)).toContain('America/New_York')
  })

  // Country and city terms must find all matching locations rather than one arbitrary time zone.
  it('finds matching country and city locations', () => {
    expect(findWorldClockLocations('美国').map((location) => location.city)).toEqual(['纽约', '洛杉矶'])
    expect(findWorldClockLocations('tokyo').map((location) => location.timeZone)).toEqual(['Asia/Tokyo'])
    expect(findWorldClockLocations('not-a-country')).toEqual([])
  })

  // Intl formatting must apply each IANA offset to the same instant consistently.
  it('formats and labels an international local time', () => {
    const [beijing] = findWorldClockLocations('北京')

    expect(formatWorldClockTime(beijing, new Date('1970-01-01T00:00:00.000Z'))).toBe('1970-01-01 08:00:00')
    expect(worldClockLocationLabel(beijing, 'zh')).toBe('中国 · 北京')
    expect(worldClockLocationLabel(beijing, 'en')).toBe('China · Beijing')
  })
})
