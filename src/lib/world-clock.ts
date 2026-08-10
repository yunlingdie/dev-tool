import { formatDateInTimeZone } from './core'

export type WorldClockLanguage = 'zh' | 'en'

export interface WorldClockLocation {
  country: string
  city: string
  countryEn: string
  cityEn: string
  timeZone: string
  aliases?: string[]
  featured?: boolean
}

const MAX_QUERY_RESULTS = 16

const locations: WorldClockLocation[] = [
  { country: '中国', city: '北京', countryEn: 'China', cityEn: 'Beijing', timeZone: 'Asia/Shanghai', aliases: ['中国大陆', 'zhongguo', 'cn'], featured: true },
  { country: '日本', city: '东京', countryEn: 'Japan', cityEn: 'Tokyo', timeZone: 'Asia/Tokyo', aliases: ['nihon', 'jp'], featured: true },
  { country: '印度', city: '新德里', countryEn: 'India', cityEn: 'New Delhi', timeZone: 'Asia/Kolkata', aliases: ['bharat', 'in'], featured: true },
  { country: '阿联酋', city: '迪拜', countryEn: 'United Arab Emirates', cityEn: 'Dubai', timeZone: 'Asia/Dubai', aliases: ['uae', 'ae'], featured: true },
  { country: '英国', city: '伦敦', countryEn: 'United Kingdom', cityEn: 'London', timeZone: 'Europe/London', aliases: ['britain', 'england', 'uk', 'gb'], featured: true },
  { country: '法国', city: '巴黎', countryEn: 'France', cityEn: 'Paris', timeZone: 'Europe/Paris', aliases: ['fr'], featured: true },
  { country: '美国', city: '纽约', countryEn: 'United States', cityEn: 'New York', timeZone: 'America/New_York', aliases: ['usa', 'america', 'us'], featured: true },
  { country: '美国', city: '洛杉矶', countryEn: 'United States', cityEn: 'Los Angeles', timeZone: 'America/Los_Angeles', aliases: ['usa', 'america', 'us'], featured: true },
  { country: '巴西', city: '圣保罗', countryEn: 'Brazil', cityEn: 'Sao Paulo', timeZone: 'America/Sao_Paulo', aliases: ['brasil', 'br'], featured: true },
  { country: '南非', city: '约翰内斯堡', countryEn: 'South Africa', cityEn: 'Johannesburg', timeZone: 'Africa/Johannesburg', aliases: ['za'], featured: true },
  { country: '澳大利亚', city: '悉尼', countryEn: 'Australia', cityEn: 'Sydney', timeZone: 'Australia/Sydney', aliases: ['au'], featured: true },
  { country: '新西兰', city: '奥克兰', countryEn: 'New Zealand', cityEn: 'Auckland', timeZone: 'Pacific/Auckland', aliases: ['nz'], featured: true },
  { country: '新加坡', city: '新加坡', countryEn: 'Singapore', cityEn: 'Singapore', timeZone: 'Asia/Singapore', aliases: ['sg'] },
  { country: '韩国', city: '首尔', countryEn: 'South Korea', cityEn: 'Seoul', timeZone: 'Asia/Seoul', aliases: ['korea', 'kr'] },
  { country: '泰国', city: '曼谷', countryEn: 'Thailand', cityEn: 'Bangkok', timeZone: 'Asia/Bangkok', aliases: ['th'] },
  { country: '越南', city: '胡志明市', countryEn: 'Vietnam', cityEn: 'Ho Chi Minh City', timeZone: 'Asia/Ho_Chi_Minh', aliases: ['vn', 'saigon'] },
  { country: '印度尼西亚', city: '雅加达', countryEn: 'Indonesia', cityEn: 'Jakarta', timeZone: 'Asia/Jakarta', aliases: ['indonesia', 'id'] },
  { country: '加拿大', city: '多伦多', countryEn: 'Canada', cityEn: 'Toronto', timeZone: 'America/Toronto', aliases: ['ca'] },
  { country: '加拿大', city: '温哥华', countryEn: 'Canada', cityEn: 'Vancouver', timeZone: 'America/Vancouver', aliases: ['ca'] },
  { country: '墨西哥', city: '墨西哥城', countryEn: 'Mexico', cityEn: 'Mexico City', timeZone: 'America/Mexico_City', aliases: ['mx'] },
  { country: '阿根廷', city: '布宜诺斯艾利斯', countryEn: 'Argentina', cityEn: 'Buenos Aires', timeZone: 'America/Argentina/Buenos_Aires', aliases: ['ar'] },
  { country: '埃及', city: '开罗', countryEn: 'Egypt', cityEn: 'Cairo', timeZone: 'Africa/Cairo', aliases: ['eg'] },
  { country: '尼日利亚', city: '拉各斯', countryEn: 'Nigeria', cityEn: 'Lagos', timeZone: 'Africa/Lagos', aliases: ['ng'] },
  { country: '肯尼亚', city: '内罗毕', countryEn: 'Kenya', cityEn: 'Nairobi', timeZone: 'Africa/Nairobi', aliases: ['ke'] },
  { country: '俄罗斯', city: '莫斯科', countryEn: 'Russia', cityEn: 'Moscow', timeZone: 'Europe/Moscow', aliases: ['ru'] },
  { country: '土耳其', city: '伊斯坦布尔', countryEn: 'Turkey', cityEn: 'Istanbul', timeZone: 'Europe/Istanbul', aliases: ['tr'] },
]

/** Normalizes country, city, and time-zone text for case-insensitive matching. */
function normalizeQuery(value: string): string {
  return value.trim().toLocaleLowerCase('en-US')
}

/** Returns every searchable country, city, alias, and IANA time-zone term for one location. */
function locationTerms(location: WorldClockLocation): string[] {
  return [
    location.country,
    location.city,
    location.countryEn,
    location.cityEn,
    location.timeZone,
    ...(location.aliases ?? []),
  ].map(normalizeQuery)
}

/** Finds featured clocks by default or locations matching a country, city, or IANA time zone. */
export function findWorldClockLocations(query: string): WorldClockLocation[] {
  const normalizedQuery = normalizeQuery(query)

  // An empty query should present a useful cross-region overview rather than every known city.
  if (normalizedQuery.length === 0) {
    return locations.filter((location) => location.featured)
  }

  return locations
    .filter((location) => locationTerms(location).some((term) => term.includes(normalizedQuery)))
    .slice(0, MAX_QUERY_RESULTS)
}

/** Formats one location's local time using the browser's IANA and daylight-saving rules. */
export function formatWorldClockTime(location: WorldClockLocation, now: Date): string {
  return formatDateInTimeZone(now, location.timeZone)
}

/** Returns a country and city label in the language used by the surrounding interface. */
export function worldClockLocationLabel(location: WorldClockLocation, language: WorldClockLanguage): string {
  // English renders the translated country and city names while Chinese uses the source labels.
  if (language === 'en') {
    return `${location.countryEn} · ${location.cityEn}`
  }

  return `${location.country} · ${location.city}`
}
