import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { documents, filterDocuments } from './definitions'
import type { DocumentDefinition } from './definitions'

const fixtures: DocumentDefinition[] = [
  {
    id: 'docker',
    title: 'Docker 开发环境',
    content: '使用 Compose 启动本地服务。',
    links: [{ label: 'Compose reference', path: '/offline-docs/docker/compose/index.html' }],
  },
  {
    id: 'json',
    title: 'JSON 处理',
    content: 'Format and compare structured data.',
    links: [{ label: 'JSON specification', path: '/offline-docs/json/index.html' }],
  },
]

describe('document registry', () => {
  it('contains the requested official document groups exactly once', () => {
    expect(documents.map((document) => document.id)).toEqual(['redis', 'php', 'laravel'])
    expect(new Set(documents.map((document) => document.id)).size).toBe(documents.length)
  })

  it('contains every Laravel version exposed by the official version selector', () => {
    const laravelDocument = documents.find((document) => document.id === 'laravel')

    expect(laravelDocument?.links.map((link) => link.label)).toEqual([
      'Master（开发版）',
      '13.x',
      '12.x',
      '11.x',
      '10.x',
      '9.x',
      '8.x',
      '7.x',
      '6.x',
      '5.8',
      '5.7',
      '5.6',
      '5.5',
      '5.4',
      '5.3',
      '5.2',
      '5.1',
      '5.0',
      '4.2',
    ])
  })

  it('uses only project-local offline document paths', () => {
    const paths = documents.flatMap((document) => document.links.map((link) => link.path))

    expect(paths.every((path) => path.startsWith('/offline-docs/current/'))).toBe(true)
    expect(paths.every((path) => !path.includes('://'))).toBe(true)
  })

  it('points every registered document link at an existing local entry', () => {
    const paths = documents.flatMap((document) => document.links.map((link) => link.path))

    expect(paths.every((path) => existsSync(join(process.cwd(), 'public', path)))).toBe(true)
  })

  it('keeps the full source order for a blank query', () => {
    expect(filterDocuments(fixtures, '  ')).toEqual(fixtures)
  })

  it('matches document titles and body content', () => {
    expect(filterDocuments(fixtures, 'docker').map((document) => document.id)).toEqual(['docker'])
    expect(filterDocuments(fixtures, 'compose').map((document) => document.id)).toEqual(['docker'])
  })

  it('matches document link labels and URLs', () => {
    expect(filterDocuments(documents, 'Laravel 5.8').map((document) => document.id)).toEqual(['laravel'])
    expect(filterDocuments(documents, 'Redis 命令').map((document) => document.id)).toEqual(['redis'])
    expect(filterDocuments(documents, 'php/zh').map((document) => document.id)).toEqual(['php'])
  })

  it('normalizes query whitespace and letter case', () => {
    expect(filterDocuments(fixtures, '  FORMAT  ').map((document) => document.id)).toEqual(['json'])
  })

  it('returns no documents when content does not match', () => {
    expect(filterDocuments(fixtures, 'certificate')).toEqual([])
  })
})
