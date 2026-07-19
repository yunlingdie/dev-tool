export interface DocumentLink {
  label: string
  path: string
}

export interface DocumentDefinition {
  id: string
  title: string
  content: string
  links: DocumentLink[]
}

export const documents: DocumentDefinition[] = [
  {
    id: 'redis',
    title: 'Redis',
    content: 'Redis 命令、参数、示例、兼容性与返回值参考。',
    links: [
      { label: '命令参考', path: '/offline-docs/current/redis/commands/index.html' },
    ],
  },
  {
    id: 'php',
    title: 'PHP',
    content: 'PHP 语言语法、类型、函数、类与方法参考。',
    links: [
      { label: '中文手册', path: '/offline-docs/current/php/zh/index.html' },
      { label: 'English Manual', path: '/offline-docs/current/php/en/index.html' },
    ],
  },
  {
    id: 'laravel',
    title: 'Laravel',
    content: 'Laravel 命令、方法、语法与代码示例，包含开发版及全部发布版本。',
    links: [
      { label: 'Master（开发版）', path: '/offline-docs/current/laravel/master/index.html' },
      { label: '13.x', path: '/offline-docs/current/laravel/13.x/index.html' },
      { label: '12.x', path: '/offline-docs/current/laravel/12.x/index.html' },
      { label: '11.x', path: '/offline-docs/current/laravel/11.x/index.html' },
      { label: '10.x', path: '/offline-docs/current/laravel/10.x/index.html' },
      { label: '9.x', path: '/offline-docs/current/laravel/9.x/index.html' },
      { label: '8.x', path: '/offline-docs/current/laravel/8.x/index.html' },
      { label: '7.x', path: '/offline-docs/current/laravel/7.x/index.html' },
      { label: '6.x', path: '/offline-docs/current/laravel/6.x/index.html' },
      { label: '5.8', path: '/offline-docs/current/laravel/5.8/index.html' },
      { label: '5.7', path: '/offline-docs/current/laravel/5.7/index.html' },
      { label: '5.6', path: '/offline-docs/current/laravel/5.6/index.html' },
      { label: '5.5', path: '/offline-docs/current/laravel/5.5/index.html' },
      { label: '5.4', path: '/offline-docs/current/laravel/5.4/index.html' },
      { label: '5.3', path: '/offline-docs/current/laravel/5.3/index.html' },
      { label: '5.2', path: '/offline-docs/current/laravel/5.2/index.html' },
      { label: '5.1', path: '/offline-docs/current/laravel/5.1/index.html' },
      { label: '5.0', path: '/offline-docs/current/laravel/5.0/index.html' },
      { label: '4.2', path: '/offline-docs/current/laravel/4.2/index.html' },
    ],
  },
]

/** Filters documents by title and body content while preserving source order. */
export function filterDocuments(source: DocumentDefinition[], query: string): DocumentDefinition[] {
  const normalizedQuery = query.trim().toLocaleLowerCase('zh-CN')

  // An empty query should expose the complete document collection unchanged.
  if (!normalizedQuery) {
    return source
  }

  // Each document contributes its title, body, version labels, and local paths to content filtering.
  return source.filter((document) => {
    const searchableLinks = document.links
      .map((link) => `${document.title} ${link.label}\n${link.path}`)
      .join('\n')
    const searchableContent = `${document.title}\n${document.content}\n${searchableLinks}`.toLocaleLowerCase('zh-CN')
    return searchableContent.includes(normalizedQuery)
  })
}
