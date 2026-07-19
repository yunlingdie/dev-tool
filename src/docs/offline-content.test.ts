import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const offlineDocsRoot = realpathSync(join(process.cwd(), 'public', 'offline-docs', 'current'))

/** Reads one generated offline document as UTF-8 text. */
function readOfflineDocument(relativePath: string): string {
  return readFileSync(join(offlineDocsRoot, relativePath), 'utf8')
}

/** Counts non-overlapping occurrences of one literal fragment. */
function countOccurrences(content: string, fragment: string): number {
  return content.split(fragment).length - 1
}

describe('offline reference documents', () => {
  // Verifies Redis output contains the requested command sections and excludes narrative collections.
  it('publishes compact Redis command references only', () => {
    const arlen = readOfflineDocument('redis/commands/arlen/index.html')
    const get = readOfflineDocument('redis/commands/get/index.html')

    expect(arlen).toContain('<h1>ARLEN</h1>')
    expect(arlen).toContain('Returns the length of an array (max index + 1).')
    expect(arlen).toContain('<h2>Overview</h2>')
    expect(arlen).toContain('<h2>Required arguments</h2>')
    expect(arlen).toContain('ARSET myarray 5 "b"')
    expect(arlen).toContain('Redis Software and Redis Cloud compatibility')
    expect(arlen).toContain('RESP2')
    expect(arlen).toContain('RESP3')
    expect(countOccurrences(get, '<h2>Examples</h2>')).toBe(1)
    expect(readOfflineDocument('redis/commands/ft.aliasadd/index.html')).not.toContain('href="#examples"')
    expect(existsSync(join(offlineDocsRoot, 'redis', 'develop'))).toBe(false)
    expect(existsSync(join(offlineDocsRoot, 'redis', 'operate'))).toBe(false)
  })

  // Verifies PHP pages retain reference bodies while removing the official manual chrome and unrelated chapters.
  it('publishes PHP syntax, function, class, and method references only', () => {
    const nullType = readOfflineDocument('php/zh/language.types.null.html')
    const unset = readOfflineDocument('php/zh/function.unset.html')

    expect(nullType).toContain('<h2 class="title">NULL</h2>')
    expect(nullType).toContain('language.types.null.syntax')
    expect(nullType).not.toContain('navbar')
    expect(nullType).not.toContain('breadcrumbs')
    expect(nullType).not.toContain('search-modal')
    expect(nullType).not.toContain('<script')
    expect(unset).toContain('class="methodsynopsis dc-description"')
    expect(unset).toContain('class="refsect1 parameters"')
    expect(unset).toContain('class="refsect1 returnvalues"')
    expect(unset).toContain('class="refsect1 examples"')
    expect(readOfflineDocument('php/zh/language.types.integer.html')).not.toContain(
      'language.types.float.html#warn.float-precision',
    )
    expect(existsSync(join(offlineDocsRoot, 'php', 'zh', 'datetime.format.html'))).toBe(true)
    expect(existsSync(join(offlineDocsRoot, 'php', 'zh', 'class.datetime.html'))).toBe(true)
    expect(existsSync(join(offlineDocsRoot, 'php', 'zh', 'install.unix.html'))).toBe(false)
    expect(existsSync(join(offlineDocsRoot, 'php', 'zh', 'migration85.html'))).toBe(false)
  })

  // Verifies Laravel keeps command syntax with its direct explanation across modern and legacy versions.
  it('publishes Laravel command and method sections without source promotions', () => {
    const artisan = readOfflineDocument('laravel/13.x/artisan.html')
    const legacyCommands = readOfflineDocument('laravel/4.2/commands.html')
    const index = readOfflineDocument('laravel/13.x/index.html')
    const configuration = readOfflineDocument('laravel/13.x/configuration.html')
    const deployment = readOfflineDocument('laravel/13.x/deployment.html')
    const installation = readOfflineDocument('laravel/13.x/installation.html')
    const starterKits = readOfflineDocument('laravel/13.x/starter-kits.html')

    expect(artisan).toContain('<h2>Writing Commands</h2>')
    expect(artisan).toContain('<h3>Generating Commands</h3>')
    expect(artisan).toContain('php artisan make:command SendEmails')
    expect(artisan).toContain('href="#registering-commands"')
    expect(artisan).not.toContain('Tinkerwell')
    expect(artisan).not.toContain('<img')
    expect(legacyCommands).toContain('php artisan command:make FooCommand')
    expect(index).toContain('Artisan Console')
    expect(index).not.toContain('API Documentation')
    expect(configuration).not.toContain('consider running your applications on a fully-managed platform')
    expect(deployment).not.toContain('If you would like assistance in managing your server')
    expect(installation).not.toContain('href="#next-steps"')
    expect(installation).toContain('aria-disabled="true">start taking your next steps')
    expect(installation).toContain('configuration.html#environment-configuration')
    expect(starterKits).not.toContain('href="#react"')
  })
})
