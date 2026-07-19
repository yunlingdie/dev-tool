import { execFileSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, join, posix, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { DomUtils, parseDocument } from 'htmlparser2'
import { marked } from 'marked'
import sanitizeHtml from 'sanitize-html'
import { extract as extractTar, list as listTar } from 'tar'

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUTPUT_ROOT = join(PROJECT_ROOT, 'public', 'offline-docs')
const CACHE_ROOT = join(PROJECT_ROOT, '.cache', 'offline-docs')
const STAGING_ROOT = join(PROJECT_ROOT, '.cache', 'offline-docs-staging')
const RELEASES_ROOT = join(PROJECT_ROOT, '.cache', 'offline-docs-releases')
const ACTIVE_LINK = join(OUTPUT_ROOT, 'current')
const PUBLIC_DOCS_BASE = '/offline-docs/current'
const DEFAULT_PROXY = 'http://127.0.0.1:7892'
const FALLBACK_PROXY = 'socks5h://127.0.0.1:7891'
const REDIS_DATA_URL = 'https://redis.io/docs/latest/docs.ndjson.gz'
const REDIS_LICENSE_URL = 'https://raw.githubusercontent.com/redis/docs/main/LICENSE'
const PHP_URLS = {
  zh: 'https://www.php.net/distributions/manual/php_manual_zh.tar.gz',
  en: 'https://www.php.net/distributions/manual/php_manual_en.tar.gz',
}
const LARAVEL_VERSIONS = [
  'master',
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
]
const ALLOWED_ARCHIVE_ENTRY_TYPES = new Set(['File', 'OldFile', 'Directory'])
const LEGACY_MANAGED_OUTPUTS = ['redis', 'php', 'laravel', 'assets', 'index.html', 'manifest.json']
const REDIS_REFERENCE_ROLES = new Set(['overview', 'parameters', 'syntax', 'example', 'compatibility', 'returns'])
const REDIS_REFERENCE_SECTION_IDS = new Set([
  'required-arguments',
  'redis-software-and-redis-cloud-compatibility',
])
const ANCHOR_PATTERN = /<a\b([^>]*?)\bhref\s*=\s*(["'])(.*?)\2([^>]*)>/gi
const TARGET_ATTRIBUTE_PATTERN = /\s+target\s*=\s*(?:["'][^"']*["']|[^\s>]+)/gi
const EVENT_ATTRIBUTE_PATTERN = /\s+on[a-z]+\s*=\s*(?:["'][^"']*["']|[^\s>]+)/gi

let downloadProxies = [DEFAULT_PROXY, FALLBACK_PROXY]
// An explicit non-empty value lets local environments replace the default proxy.
if (typeof process.env.DOCS_PROXY === 'string' && process.env.DOCS_PROXY.trim() !== '') {
  downloadProxies = [process.env.DOCS_PROXY.trim()]
}

// Prints one concise progress line for long-running synchronization work.
function log(message) {
  process.stdout.write(`[docs] ${message}\n`)
}

// Runs a required local command and forwards its errors to stop an incomplete sync.
function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    ...options,
  })
}

// Downloads an official file once and reuses the cached copy on later runs.
function ensureDownloadedFile(name, url) {
  mkdirSync(CACHE_ROOT, { recursive: true })
  const archivePath = join(CACHE_ROOT, name)

  // A non-empty archive is treated as the reusable local cache.
  if (existsSync(archivePath) && statSync(archivePath).size > 0) {
    log(`使用缓存 ${name}`)
    return archivePath
  }

  const partialPath = `${archivePath}.part`
  let lastError

  // The SOCKS proxy is a fallback when the preferred HTTP proxy cannot complete a transfer.
  for (const activeProxy of downloadProxies) {
    rmSync(partialPath, { force: true })
    log(`下载 ${url}（${activeProxy}）`)
    try {
      run(
        'curl',
        [
          '--fail',
          '--location',
          '--retry',
          '3',
          '--retry-all-errors',
          '--proxy',
          activeProxy,
          '--output',
          partialPath,
          url,
        ],
        { stdio: 'inherit' },
      )
      renameSync(partialPath, archivePath)
      return archivePath
    } catch (error) {
      lastError = error
      // A failed transfer must not become a seemingly valid cache entry.
      rmSync(partialPath, { force: true })
    }
  }

  throw lastError
}

// Downloads and validates an official tar archive before returning its cache path.
function ensureArchive(name, url) {
  const archivePath = ensureDownloadedFile(name, url)
  validateArchive(archivePath)
  return archivePath
}

// Downloads and validates the official Redis gzip feed before returning its cache path.
function ensureGzipFile(name, url) {
  const gzipPath = ensureDownloadedFile(name, url)
  gunzipSync(readFileSync(gzipPath))
  return gzipPath
}

// Rejects one archive member when its type or path could escape the extraction directory.
function validateArchiveEntry(entry) {
  // Documentation archives only need regular files and directories; links and special files are unsafe here.
  if (!ALLOWED_ARCHIVE_ENTRY_TYPES.has(entry.type)) {
    throw new Error(`拒绝归档条目类型 ${entry.type}: ${entry.path}`)
  }

  const normalized = posix.normalize(entry.path)
  const segments = entry.path.split('/')
  // Absolute, Windows-style, backslash, and parent paths can write outside the workspace.
  if (
    entry.path.startsWith('/') ||
    /^[A-Za-z]:/.test(entry.path) ||
    entry.path.includes('\\') ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    segments.includes('..')
  ) {
    throw new Error(`拒绝不安全的归档路径: ${entry.path}`)
  }
}

// Parses and validates every archive member before tar is allowed to write any files.
function validateArchive(archivePath) {
  listTar({
    file: archivePath,
    sync: true,
    strict: true,
    onReadEntry: validateArchiveEntry,
  })
}

// Extracts a validated tar archive into an isolated temporary directory.
function extractArchive(archivePath) {
  validateArchive(archivePath)
  const target = mkdtempSync(join(tmpdir(), 'dev-tool-docs-'))
  extractTar({
    file: archivePath,
    cwd: target,
    sync: true,
    strict: true,
    preservePaths: false,
  })
  return target
}

// Finds the single top-level directory produced by an official source archive.
function findArchiveRoot(extractedRoot) {
  const entries = readdirSync(extractedRoot, { withFileTypes: true })
  const directories = []

  // Archive metadata files are ignored while locating the actual documentation root.
  for (const entry of entries) {
    // Only a real directory can contain the extracted documentation tree.
    if (entry.isDirectory()) {
      directories.push(entry.name)
    }
  }

  // Multiple roots make relative-path publication ambiguous and are rejected.
  if (directories.length !== 1) {
    throw new Error(`归档必须只包含一个根目录: ${extractedRoot}`)
  }

  return join(extractedRoot, directories[0])
}

// Recursively returns regular files and rejects links that could leave the extraction root.
function walkFiles(root) {
  const files = []
  const entries = readdirSync(root, { withFileTypes: true })
  entries.sort(compareDirectoryEntries)

  // Each child is inspected with lstat before it is copied or rendered.
  for (const entry of entries) {
    const fullPath = join(root, entry.name)
    const stats = lstatSync(fullPath)
    // Links are never followed, even if a platform tar implementation created one.
    if (stats.isSymbolicLink()) {
      throw new Error(`拒绝文档目录中的链接: ${fullPath}`)
    }
    // Directories are traversed so nested source pages remain complete.
    if (stats.isDirectory()) {
      files.push(...walkFiles(fullPath))
      continue
    }
    // Only regular files are valid documentation sources.
    if (stats.isFile()) {
      files.push(fullPath)
    }
  }

  return files
}

// Keeps generated indexes stable across filesystems and repeated syncs.
function compareDirectoryEntries(left, right) {
  return left.name.localeCompare(right.name, 'en')
}

// Converts a source Markdown path to the corresponding static HTML path.
function markdownOutputPath(sourceRelativePath) {
  const parsedDirectory = posix.dirname(sourceRelativePath)
  const sourceName = posix.basename(sourceRelativePath, '.md')
  // Hugo and Laravel entry documents must become directory entry pages.
  if (sourceName === 'index' || sourceName === '_index' || sourceName === 'documentation') {
    return posix.join(parsedDirectory, 'index.html')
  }
  return posix.join(parsedDirectory, `${sourceName}.html`)
}

// Removes source metadata that should not be displayed as document prose.
function stripFrontMatter(markdown) {
  // Redis pages commonly begin with YAML front matter delimited by three dashes.
  if (markdown.startsWith('---\n')) {
    const end = markdown.indexOf('\n---\n', 4)
    // Only a complete front-matter block is removed; ordinary horizontal rules remain content.
    if (end !== -1) {
      return markdown.slice(end + 5)
    }
  }
  return markdown
}

// Derives a readable page title from the first heading or the source filename.
function markdownTitle(markdown, sourcePath) {
  const match = /^#\s+(.+)$/m.exec(markdown)
  // A document heading is more useful than its storage filename.
  if (match !== null) {
    return match[1].replace(/[`*_]/g, '').trim()
  }
  return posix.basename(sourcePath, '.md').replaceAll('-', ' ')
}

// Reports whether a reference uses a network or executable URL scheme.
function isExternalReference(reference) {
  const value = reference.trim()
  // Protocol-relative URLs always leave the local documentation origin.
  if (value.startsWith('//')) {
    return true
  }
  // Any explicit scheme is blocked; local documentation only needs paths and fragments.
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) {
    return true
  }
  return false
}

// Maps a Redis feed link to a selected local feed page and blocks all other destinations.
function resolveRedisFeedReference(reference, context) {
  const value = reference.trim()
  // An empty reference stays on the current local page.
  if (value === '') {
    return value
  }
  // Same-command fragments remain clickable only when their retained section exposes the target.
  if (value.startsWith('#') || value.startsWith('?')) {
    // Compact command pages deliberately disable links to sections removed during filtering.
    if (!hasSelectedFragment(context.sourceKey, value, context)) {
      return null
    }
    return value
  }

  let target
  try {
    target = new URL(value, context.canonicalUrl)
  } catch {
    // Invalid URLs cannot identify a safe local document.
    return null
  }

  // Only official Redis documentation URLs can have a local feed equivalent.
  if (target.origin !== 'https://redis.io' || !target.pathname.startsWith('/docs/latest/')) {
    return null
  }

  const normalizedPath = target.pathname.replace(/\/?$/, '/')
  const localUrl = context.pageUrls.get(normalizedPath)
  // Feed pages outside the selected command scope are blocked.
  if (typeof localUrl !== 'string') {
    return null
  }
  // Cross-command fragments are disabled when the compact target page no longer contains that section.
  if (!hasSelectedFragment(normalizedPath, `${target.search}${target.hash}`, context)) {
    return null
  }
  return `${localUrl}${target.search}${target.hash}`
}

// Reports whether one filtered Markdown target still contains the requested fragment.
function hasSelectedFragment(sourceFile, reference, context) {
  const hashIndex = reference.indexOf('#')
  // References without a non-empty fragment do not require an anchor lookup.
  if (hashIndex === -1 || hashIndex === reference.length - 1) {
    return true
  }

  const encodedFragment = reference.slice(hashIndex + 1)
  let decodedFragment = encodedFragment
  try {
    decodedFragment = decodeURIComponent(encodedFragment)
  } catch {
    decodedFragment = encodedFragment
  }
  const selectedFragments = context.pageFragments?.get(sourceFile)
  // A filtered page without a matching anchor must not expose a dead fragment link.
  if (!(selectedFragments instanceof Set)) {
    return false
  }
  return selectedFragments.has(encodedFragment) || selectedFragments.has(decodedFragment)
}

// Maps a Markdown link to a generated local page or blocks it when no local target exists.
function resolveMarkdownReference(reference, context) {
  // Redis feed pages resolve canonical website links through their selected local page map.
  if (context.kind === 'redis-feed') {
    return resolveRedisFeedReference(reference, context)
  }

  const value = reference.trim()
  // An empty reference stays on the current local page.
  if (value === '') {
    return value
  }
  // Filtered Laravel pages keep same-page fragments only when their target anchor survived.
  if (value.startsWith('#') || value.startsWith('?')) {
    // Other Markdown collections are not section-filtered and retain their original fragments.
    if (context.kind === 'laravel' && !hasSelectedFragment(context.sourceFile, value, context)) {
      return null
    }
    return value
  }
  // Network and executable schemes are deliberately non-navigable offline.
  if (isExternalReference(value)) {
    return null
  }
  // Already-local public URLs need no additional mapping.
  if (value.startsWith(`${PUBLIC_DOCS_BASE}/`)) {
    return value
  }

  let pathPart = value
  let suffix = ''
  const suffixIndex = value.search(/[?#]/)
  // Query strings and fragments are preserved after the file target is localized.
  if (suffixIndex !== -1) {
    pathPart = value.slice(0, suffixIndex)
    suffix = value.slice(suffixIndex)
  }

  let sourceTarget
  // Laravel version routes are mapped to the checked-out branch root.
  if (context.kind === 'laravel' && /^\/docs\/[^/]+\//.test(pathPart)) {
    sourceTarget = join(context.sourceBase, pathPart.replace(/^\/docs\/[^/]+\//, ''))
  }
  // Other absolute website routes have no guaranteed local equivalent.
  if (typeof sourceTarget === 'undefined' && pathPart.startsWith('/')) {
    return null
  }
  // Relative Markdown references are resolved from the current source document.
  if (typeof sourceTarget === 'undefined') {
    sourceTarget = resolve(dirname(context.sourceFile), pathPart)
  }

  const candidates = [sourceTarget]
  // Extensionless documentation routes may represent a Markdown file or directory index.
  if (extname(sourceTarget) === '') {
    candidates.push(`${sourceTarget}.md`, join(sourceTarget, 'index.md'), join(sourceTarget, '_index.md'))
  }

  // The first generated Markdown target becomes the local navigation destination.
  for (const candidate of candidates) {
    const localUrl = context.pageUrls.get(candidate)
    // Only files selected for this offline collection may be linked.
    if (typeof localUrl === 'string') {
      // A selected Laravel page may still have lost the linked section during content filtering.
      if (context.kind === 'laravel' && !hasSelectedFragment(candidate, suffix, context)) {
        continue
      }
      return `${localUrl}${suffix}`
    }
  }

  return null
}

// Maps PHP manual links to the extracted local language trees and blocks external targets.
function resolvePhpReference(reference, context) {
  const value = reference.trim()
  // An empty reference stays on the current manual page.
  if (value === '') {
    return value
  }
  // Same-page fragments remain clickable only when the selected PHP body contains their target.
  if (value.startsWith('#') || value.startsWith('?')) {
    // Removed subsections must render as disabled text instead of dead in-page navigation.
    if (!hasSelectedFragment(context.sourceName, value, context)) {
      return null
    }
    return value
  }
  // External schemes cannot navigate away from the offline reader.
  if (isExternalReference(value)) {
    return null
  }
  let targetLanguage = context.language
  let targetValue = value
  const manualMatch = /^\/manual\/(zh|en)\/(.+)$/.exec(value)
  // Official absolute manual routes select the matching downloaded language.
  if (manualMatch !== null) {
    targetLanguage = manualMatch[1]
    targetValue = manualMatch[2]
  }
  // Other site-root routes do not belong to the selected PHP reference pages.
  if (manualMatch === null && value.startsWith('/')) {
    return null
  }

  let pathPart = targetValue
  let suffix = ''
  const suffixIndex = targetValue.search(/[?#]/)
  // Query strings and fragments are retained after checking the target filename.
  if (suffixIndex !== -1) {
    pathPart = targetValue.slice(0, suffixIndex)
    suffix = targetValue.slice(suffixIndex)
  }
  const targetName = posix.normalize(pathPart.replace(/\.php$/, '.html'))
  // PHP many-html pages are flat; parent or nested paths could escape the selected manual directory.
  if (targetName === '..' || targetName.startsWith('../') || targetName.includes('/')) {
    return null
  }
  const targetPages = context.pageNamesByLanguage.get(targetLanguage)
  // Links to pages removed by the reference filter become non-clickable text instead of 404s.
  if (typeof targetPages === 'undefined' || !targetPages.has(targetName)) {
    return null
  }
  const targetFragments = context.pageFragmentsByLanguage.get(targetLanguage)
  // Links to retained files still require their requested subsection to exist locally.
  if (!hasSelectedFragment(targetName, suffix, { pageFragments: targetFragments })) {
    return null
  }
  // Same-language references stay relative so fragments and copied pages remain portable.
  if (targetLanguage === context.language) {
    return `${targetName}${suffix}`
  }
  return `${PUBLIC_DOCS_BASE}/php/${targetLanguage}/${targetName}${suffix}`
}

// Rewrites anchor start tags without relying on an HTML parser or allowing external navigation.
function rewriteAnchors(html, context) {
  let output = ''
  let cursor = 0
  ANCHOR_PATTERN.lastIndex = 0

  // Every anchor is rebuilt so target and inline event handlers cannot escape the reader.
  for (const match of html.matchAll(ANCHOR_PATTERN)) {
    output += html.slice(cursor, match.index)
    const before = match[1].replace(TARGET_ATTRIBUTE_PATTERN, '').replace(EVENT_ATTRIBUTE_PATTERN, '')
    const after = match[4].replace(TARGET_ATTRIBUTE_PATTERN, '').replace(EVENT_ATTRIBUTE_PATTERN, '')
    let resolved
    // PHP pages use their official many-html filename conventions.
    if (context.kind === 'php') {
      resolved = resolvePhpReference(match[3], context)
    } else {
      resolved = resolveMarkdownReference(match[3], context)
    }
    // A missing local target is rendered as non-clickable linked text.
    if (resolved === null) {
      output += `<a${before}${after} aria-disabled="true">`
    } else {
      output += `<a${before}href=${match[2]}${resolved}${match[2]}${after}>`
    }
    cursor = match.index + match[0].length
  }

  return output + html.slice(cursor)
}

// Removes executable and remote-resource markup from one rendered reference body.
function sanitizeReferenceMarkup(html) {
  return sanitizeHtml(html, {
    allowedTags: [...sanitizeHtml.defaults.allowedTags, 'details', 'summary', 'var', 'samp', 'kbd'],
    allowedAttributes: {
      '*': ['id', 'class'],
      a: ['href', 'title', 'name'],
      code: ['class'],
    },
  })
}

// Collects every fragment target that remains after reference markup sanitization.
function collectReferenceFragments(html) {
  const document = parseDocument(html)
  // Only elements with an id or legacy named-anchor attribute can satisfy a fragment link.
  const elements = DomUtils.findAll(
    (node) => typeof node.attribs?.id === 'string' || typeof node.attribs?.name === 'string',
    document.children,
    true,
  )
  const fragments = new Set()
  // Both modern ids and legacy Laravel named anchors are valid browser fragment targets.
  for (const element of elements) {
    for (const attribute of ['id', 'name']) {
      const fragment = element.attribs[attribute]
      // Empty and absent attributes cannot identify a section.
      if (typeof fragment === 'string' && fragment !== '') {
        fragments.add(fragment)
      }
    }
  }
  return fragments
}

// Sanitizes reference content and disables every link that does not resolve locally.
function sanitizeReferenceHtml(html, context) {
  const sanitized = sanitizeReferenceMarkup(html)
  return rewriteAnchors(sanitized, context)
}

// Wraps sanitized Markdown in a standalone local reference page.
function renderMarkdownPage(markdown, title, context) {
  const rendered = marked.parse(stripFrontMatter(markdown), { gfm: true })
  const content = sanitizeReferenceHtml(rendered, context)
  return staticPage(title, content)
}

// Produces a small self-contained shell shared by generated Markdown and directory pages.
function staticPage(title, content) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self' data:; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'none'; connect-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'">
  <title>${escapeHtml(title)}</title>
  <style>body{margin:0;color:#20242a;background:#fff;font:15px/1.7 system-ui,-apple-system,sans-serif}main{max-width:980px;margin:auto;padding:28px 34px 64px}h1,h2,h3,h4{line-height:1.25}a{color:#0969da}a[aria-disabled=true]{color:inherit;text-decoration:underline dotted;cursor:not-allowed}pre,.methodsynopsis{overflow:auto;padding:14px;background:#f6f8fa;border:1px solid #dfe3e8;border-radius:6px}code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}table{display:block;overflow:auto;border-collapse:collapse}td,th{padding:6px 10px;border:1px solid #dfe3e8}.warning,.note{padding:10px 14px;border-left:3px solid #d97706;background:#fff8e6}.verinfo{color:#667085}</style>
</head>
<body><main>${content}</main></body>
</html>`
}

// Escapes generated directory labels before placing them into HTML.
function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

// Writes one generated HTML file and creates its parent directory.
function writeHtml(target, html) {
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, html, 'utf8')
}

// Builds a local directory page from already-generated child documents.
function writeDirectoryPage(target, title, items) {
  let list = '<ul>'
  // Index links are generated from trusted local URLs and escaped human labels.
  for (const item of items) {
    list += `<li><a href="${item.url}">${escapeHtml(item.label)}</a></li>`
  }
  list += '</ul>'
  writeHtml(target, staticPage(title, `<h1>${escapeHtml(title)}</h1>${list}`))
}

// Reports whether one Markdown token is a standalone named anchor for the following heading.
function isNamedAnchorToken(token) {
  return token.type === 'paragraph' && /^<a name="[^"]+"><\/a>\s*$/.test(token.raw.trim())
}

// Detects code, inline syntax, tables, commands, and method signatures inside one token tree.
function tokenContainsReferenceSyntax(token) {
  // Code tokens and tables are direct reference material.
  if (token.type === 'code' || token.type === 'codespan' || token.type === 'table') {
    return true
  }
  // Older Laravel lists sometimes express commands without Markdown code spans.
  if (
    typeof token.text === 'string' &&
    /(?:php\s+artisan|(?:->|::)[A-Za-z_][A-Za-z0-9_]*\s*\(|\b[A-Za-z_][A-Za-z0-9_]*\(\)|--[a-z][a-z-]*)/.test(token.text)
  ) {
    return true
  }
  // Inline child tokens can contain code spans nested inside paragraphs or blockquotes.
  if (Array.isArray(token.tokens) && token.tokens.some(tokenContainsReferenceSyntax)) {
    return true
  }
  // List items keep their own token arrays and must be inspected recursively.
  if (
    Array.isArray(token.items) &&
    token.items.some((item) => Array.isArray(item.tokens) && item.tokens.some(tokenContainsReferenceSyntax))
  ) {
    return true
  }
  return false
}

// Reports whether one token tree contains a link accepted by the supplied location predicate.
function tokenContainsLinkMatching(token, predicate) {
  // A matching inline link is enough to classify its containing prose block.
  if (token.type === 'link' && typeof token.href === 'string' && predicate(token.href)) {
    return true
  }
  // Inline child tokens may contain links nested in paragraphs, emphasis, or quotes.
  if (Array.isArray(token.tokens) && token.tokens.some((child) => tokenContainsLinkMatching(child, predicate))) {
    return true
  }
  // List items keep links in their own nested token arrays.
  if (
    Array.isArray(token.items) &&
    token.items.some(
      (item) => Array.isArray(item.tokens) && item.tokens.some((child) => tokenContainsLinkMatching(child, predicate)),
    )
  ) {
    return true
  }
  return false
}

// Reports whether one Laravel prose block is an external aside rather than reference material.
function isLaravelNonReferenceAside(token) {
  // Prose-only blockquotes in the source are promotional or editorial asides.
  if (token.type === 'blockquote' && !tokenContainsReferenceSyntax(token)) {
    return true
  }
  // Only standalone paragraphs are eligible for external-link aside filtering.
  if (token.type !== 'paragraph' || tokenContainsReferenceSyntax(token)) {
    return false
  }
  const hasExternalLink = tokenContainsLinkMatching(token, isExternalReference)
  // Ordinary explanations without external destinations remain beside their reference syntax.
  if (!hasExternalLink) {
    return false
  }
  const hasLocalLink = tokenContainsLinkMatching(token, (reference) => !isExternalReference(reference))
  return !hasLocalLink
}

// Joins one selected Laravel section while dropping non-reference external asides.
function laravelSectionMarkdown(tokens) {
  let markdown = ''
  // Direct explanatory blocks remain in source order around their code and method references.
  for (const token of tokens) {
    // External prose without commands, methods, syntax, or local references is outside the requested scope.
    if (isLaravelNonReferenceAside(token)) {
      continue
    }
    markdown += token.raw
  }
  return markdown
}

// Selects Laravel H2 sections that contain commands, methods, syntax, code, or reference tables.
function laravelReferenceMarkdown(markdown) {
  const tokens = marked.lexer(stripFrontMatter(markdown), { gfm: true })
  const preamble = []
  const sections = []
  let currentSection = null
  let pendingAnchors = []

  // H2 boundaries retain complete direct explanations and all nested subsections.
  for (const token of tokens) {
    // Named anchors are delayed so an H2 anchor stays with the heading that follows it.
    if (isNamedAnchorToken(token)) {
      pendingAnchors.push(token)
      continue
    }
    // Each H2 starts one independently selectable reference section.
    if (token.type === 'heading' && token.depth === 2) {
      // The preceding section is complete once the next H2 begins.
      if (currentSection !== null) {
        sections.push(currentSection)
      }
      currentSection = [...pendingAnchors, token]
      pendingAnchors = []
      continue
    }

    // Anchors before lower headings belong to the current content block.
    if (pendingAnchors.length > 0) {
      // Content before the first H2 remains part of the document preamble.
      if (currentSection === null) {
        preamble.push(...pendingAnchors)
      } else {
        currentSection.push(...pendingAnchors)
      }
      pendingAnchors = []
    }
    // Tokens before the first H2 form the title and short introduction only.
    if (currentSection === null) {
      preamble.push(token)
    } else {
      currentSection.push(token)
    }
  }

  // A final pending anchor has no heading target but stays with its surrounding content.
  if (pendingAnchors.length > 0) {
    // Documents without H2 sections keep trailing anchors in their preamble.
    if (currentSection === null) {
      preamble.push(...pendingAnchors)
    } else {
      currentSection.push(...pendingAnchors)
    }
  }
  // The last H2 section has no following boundary to push it automatically.
  if (currentSection !== null) {
    sections.push(currentSection)
  }

  const selectedSections = sections.filter((section) => section.some(tokenContainsReferenceSyntax))
  // A page with H2 sections but no reference signal is outside the requested documentation scope.
  if (sections.length > 0 && selectedSections.length === 0) {
    return null
  }
  // Older single-section pages remain useful when their token stream contains reference syntax.
  if (sections.length === 0 && !tokens.some(tokenContainsReferenceSyntax)) {
    return null
  }

  let output = ''
  const titleToken = preamble.find((token) => token.type === 'heading' && token.depth === 1)
  // Every generated page keeps its source H1 when the source provides one.
  if (typeof titleToken !== 'undefined') {
    output += `${titleToken.raw.trimEnd()}\n\n`
  }
  const introductionToken = preamble.find(
    (token) => token.type === 'paragraph' && !isNamedAnchorToken(token),
  )
  // One introductory paragraph explains the page without retaining its source table of contents.
  if (typeof introductionToken !== 'undefined') {
    output += `${introductionToken.raw.trimEnd()}\n\n`
  }

  // Pages without H2 boundaries use their complete filtered token stream.
  if (sections.length === 0) {
    return laravelSectionMarkdown(tokens)
  }
  // Every selected H2 keeps its related nested explanations and examples intact.
  for (const section of selectedSections) {
    output += `${laravelSectionMarkdown(section).trim()}\n\n`
  }
  return output
}

// Renders only selected Laravel reference pages and returns their local index metadata.
function renderLaravelCollection(sourceBase, outputBase, publicBase) {
  const references = []
  const files = walkFiles(sourceBase)
  // Each Markdown source is reduced before it can enter the local link map.
  for (const sourceFile of files) {
    // Repository metadata and non-Markdown assets are outside the text reference collection.
    if (extname(sourceFile).toLowerCase() !== '.md') {
      continue
    }
    const sourceRelative = relative(sourceBase, sourceFile).split(sep).join('/')
    // The official navigation document is replaced with an index of pages that survived filtering.
    if (posix.basename(sourceRelative) === 'documentation.md') {
      continue
    }
    const sourceMarkdown = readFileSync(sourceFile, 'utf8')
    const referenceMarkdown = laravelReferenceMarkdown(sourceMarkdown)
    // Files without commands, methods, syntax, code, or reference tables are not published.
    if (referenceMarkdown === null) {
      continue
    }
    const outputRelative = markdownOutputPath(sourceRelative)
    references.push({
      sourceFile,
      sourceRelative,
      outputRelative,
      markdown: referenceMarkdown,
      title: markdownTitle(stripFrontMatter(sourceMarkdown), sourceRelative),
    })
  }

  const pageUrls = new Map()
  // The complete selected map is built before rendering so filtered targets become disabled links.
  for (const reference of references) {
    pageUrls.set(reference.sourceFile, `${publicBase}/${reference.outputRelative}`)
  }

  const pageFragments = new Map()
  // Fragment maps are built from filtered and sanitized bodies before any page links are rewritten.
  for (const reference of references) {
    const rendered = marked.parse(stripFrontMatter(reference.markdown), { gfm: true })
    const sanitized = sanitizeReferenceMarkup(rendered)
    pageFragments.set(reference.sourceFile, collectReferenceFragments(sanitized))
  }

  const pages = []
  // Every retained file receives the same lightweight local reference shell.
  for (const reference of references) {
    const context = {
      kind: 'laravel',
      sourceBase,
      sourceFile: reference.sourceFile,
      pageUrls,
      pageFragments,
      publicBase,
    }
    writeHtml(
      join(outputBase, reference.outputRelative),
      renderMarkdownPage(reference.markdown, reference.title, context),
    )
    pages.push({ label: reference.title, url: `${publicBase}/${reference.outputRelative}` })
  }
  return pages
}

// Reports whether a Redis canonical URL represents an actual command reference page.
function isSelectedRedisUrl(url) {
  const pathname = new URL(url).pathname
  // Development, operations, and other narrative pages are outside the command-only collection.
  if (!pathname.startsWith('/docs/latest/commands/')) {
    return false
  }
  const slug = pathname.slice('/docs/latest/commands/'.length).replace(/^\/+|\/+$/g, '')
  // The command root is an official navigation page rather than one executable command.
  if (slug === '') {
    return false
  }
  // Redis version summary pages list releases but do not describe an executable command.
  if (/^redis-\d+-\d+-commands$/.test(slug)) {
    return false
  }
  return true
}

// Reports whether one Redis section belongs to the compact command reference contract.
function isSelectedRedisSection(section) {
  return REDIS_REFERENCE_ROLES.has(section.role) || REDIS_REFERENCE_SECTION_IDS.has(section.id)
}

// Converts structured Redis examples into fenced Markdown blocks.
function redisExamplesMarkdown(examples) {
  let markdown = ''
  // Each official example remains separately copyable with its declared language.
  for (const example of examples) {
    let language = 'text'
    // A non-empty official language improves code block readability.
    if (typeof example.language === 'string' && example.language.trim() !== '') {
      language = example.language.trim()
    }
    markdown += `\`\`\`\`${language}\n${example.code}\n\`\`\`\`\n\n`
  }
  return markdown
}

// Converts one Redis command record into the requested compact reference sections.
function redisDocumentMarkdown(document) {
  let markdown = `# ${document.title}\n\n`
  // The feed summary provides useful context before its detailed sections.
  if (typeof document.summary === 'string' && document.summary.trim() !== '') {
    markdown += `${document.summary.trim()}\n\n`
  }

  let examplesWritten = false
  // Only command reference sections are restored in their official source order.
  for (const section of document.sections) {
    // Narrative details, related topics, and complexity articles are outside the compact reference.
    if (!isSelectedRedisSection(section)) {
      continue
    }
    const isExampleSection = section.role === 'example' || section.id === 'examples'
    // Multiple example records are merged under one heading to avoid duplicate sections.
    if (isExampleSection && examplesWritten) {
      continue
    }
    // Empty generated titles are omitted so they do not create blank headings.
    if (typeof section.title === 'string' && section.title.trim() !== '') {
      markdown += `## ${section.title.trim()}\n\n`
    }
    // Code placeholders are removed because complete examples are appended below.
    if (typeof section.text === 'string' && section.text.trim() !== '') {
      markdown += `${section.text.replaceAll('[code example]', '').trim()}\n\n`
    }
    // Structured examples belong directly after their matching Examples explanation.
    if (isExampleSection) {
      markdown += redisExamplesMarkdown(document.examples)
      examplesWritten = true
    }
  }

  // Commands without an example section still receive their structured examples once.
  if (!examplesWritten && document.examples.length > 0) {
    markdown += '## Examples\n\n'
    markdown += redisExamplesMarkdown(document.examples)
  }

  return markdown
}

// Converts a selected Redis canonical path to its stable local index.html path.
function redisOutputRelativePath(url) {
  const pathname = new URL(url).pathname
  const relativePath = pathname.slice('/docs/latest/'.length).replace(/^\/+|\/+$/g, '')
  const normalized = posix.normalize(relativePath)
  // A normalized parent path would escape the Redis publication directory.
  if (normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`拒绝不安全的 Redis URL: ${url}`)
  }
  return posix.join(normalized, 'index.html')
}

// Parses the official Redis NDJSON feed and validates the fields used by the renderer.
function readRedisDocuments(gzipPath) {
  const content = gunzipSync(readFileSync(gzipPath)).toString('utf8')
  const lines = content.split('\n')
  const documents = []

  // NDJSON records are parsed independently so malformed source data stops publication.
  for (const line of lines) {
    // The feed's final newline is not a JSON record.
    if (line.trim() === '') {
      continue
    }
    const document = JSON.parse(line)
    // Only actual command records are retained in the local document set.
    if (!isSelectedRedisUrl(document.url)) {
      continue
    }
    // Required arrays are normalized because index records may omit empty values.
    if (!Array.isArray(document.sections)) {
      document.sections = []
    }
    // Required arrays are normalized because index records may omit empty values.
    if (!Array.isArray(document.examples)) {
      document.examples = []
    }
    documents.push(document)
  }

  return documents
}

// Synchronizes selected Redis production feed records into standalone local pages.
function syncRedis(gzipPath, licensePath) {
  log('生成 Redis 离线文档')
  const documents = readRedisDocuments(gzipPath)
  const outputRoot = join(STAGING_ROOT, 'redis')
  const pageUrls = new Map()
  const pageFragments = new Map()

  // All canonical paths and retained fragments are mapped before rendering so forward references work locally.
  for (const document of documents) {
    const canonicalPath = new URL(document.url).pathname.replace(/\/?$/, '/')
    pageUrls.set(canonicalPath, `${PUBLIC_DOCS_BASE}/redis/${redisOutputRelativePath(document.url)}`)
    const rendered = marked.parse(redisDocumentMarkdown(document), { gfm: true })
    const sanitized = sanitizeReferenceMarkup(rendered)
    pageFragments.set(canonicalPath, collectReferenceFragments(sanitized))
  }

  const commandPages = []
  // Each selected command record becomes one self-contained static HTML page.
  for (const document of documents) {
    const outputRelative = redisOutputRelativePath(document.url)
    const markdown = redisDocumentMarkdown(document)
    const sourceKey = new URL(document.url).pathname.replace(/\/?$/, '/')
    const context = {
      kind: 'redis-feed',
      canonicalUrl: document.url,
      sourceKey,
      pageUrls,
      pageFragments,
    }
    writeHtml(
      join(outputRoot, outputRelative),
      renderMarkdownPage(markdown, document.title, context),
    )
    commandPages.push({
      label: document.title,
      url: `${PUBLIC_DOCS_BASE}/redis/${outputRelative}`,
    })
  }

  writeDirectoryPage(join(outputRoot, 'commands', 'index.html'), 'Redis Commands', commandPages)
  writeDirectoryPage(join(outputRoot, 'index.html'), 'Redis 命令参考', [
    { label: '命令参考', url: `${PUBLIC_DOCS_BASE}/redis/commands/index.html` },
  ])
  mkdirSync(outputRoot, { recursive: true })
  cpSync(licensePath, join(outputRoot, 'LICENSE.txt'))
  writeFileSync(
    join(outputRoot, 'SOURCE.txt'),
    `Redis documentation source: ${REDIS_DATA_URL}\nLicense source: ${REDIS_LICENSE_URL}\n`,
    'utf8',
  )
}

// Synchronizes one Laravel branch and creates an index of retained reference pages.
function syncLaravelVersion(version, archivePath) {
  log(`生成 Laravel ${version} 离线文档`)
  const extracted = extractArchive(archivePath)
  try {
    const sourceRoot = findArchiveRoot(extracted)
    const outputRoot = join(STAGING_ROOT, 'laravel', version)
    const pages = renderLaravelCollection(
      sourceRoot,
      outputRoot,
      `${PUBLIC_DOCS_BASE}/laravel/${version}`,
    )
    writeDirectoryPage(join(outputRoot, 'index.html'), `Laravel ${version} 参考`, pages)
  } finally {
    rmSync(extracted, { recursive: true, force: true })
  }
}

// Reports whether an HTML element has one exact whitespace-separated class name.
function elementHasClass(node, className) {
  return typeof node.attribs?.class === 'string' && node.attribs.class.split(/\s+/).includes(className)
}

// Parses one PHP manual page and returns its stable title and content root.
function parsePhpManualPage(html, sourceName) {
  const document = parseDocument(html)
  const contentRoot = DomUtils.findOne(
    (node) => node.attribs?.id === 'layout-content',
    document.children,
    true,
  )
  // Official many-html pages must expose the stable content container used by the reference extractor.
  if (contentRoot === null) {
    throw new Error(`PHP 页面缺少 layout-content: ${sourceName}`)
  }
  const titleNode = DomUtils.findOne((node) => node.name === 'title', document.children, true)
  // A missing title would make the generated index ambiguous.
  if (titleNode === null) {
    throw new Error(`PHP 页面缺少 title: ${sourceName}`)
  }
  return {
    contentRoot,
    title: DomUtils.getText(titleNode).trim(),
  }
}

// Reports whether one PHP page is a function, method, class, type, or language syntax reference.
function isSelectedPhpPage(fileName, contentRoot) {
  const refentry = DomUtils.findOne(
    (node) => elementHasClass(node, 'refentry'),
    [contentRoot],
    true,
  )
  // A refentry is the official structure shared by PHP functions and class methods.
  if (refentry !== null) {
    return true
  }
  return /^(?:language|functions|control-structures|reserved|class)\./.test(fileName)
}

// Removes related-link sections that do not describe the selected PHP symbol itself.
function removePhpSeeAlsoSections(contentRoot) {
  const seeAlsoSections = DomUtils.findAll(
    (node) => elementHasClass(node, 'seealso'),
    [contentRoot],
  )
  // Each matching subtree is detached before sanitization and local-link rewriting.
  for (const section of seeAlsoSections) {
    DomUtils.removeElement(section)
  }
}

// Selects PHP reference source files before local links are resolved.
function selectPhpReferenceFiles(sourceRoot) {
  const selectedFiles = []
  const files = walkFiles(sourceRoot)
  // Every HTML page is classified from its official content structure or stable core filename.
  for (const file of files) {
    // Styles, scripts, images, and non-HTML metadata are not part of the compact reference output.
    if (extname(file).toLowerCase() !== '.html') {
      continue
    }
    const sourceName = basename(file)
    const html = readFileSync(file, 'utf8')
    const { contentRoot } = parsePhpManualPage(html, sourceName)
    // Installation, migration, FAQ, and narrative chapters do not satisfy the requested reference scope.
    if (!isSelectedPhpPage(sourceName, contentRoot)) {
      continue
    }
    selectedFiles.push(file)
  }
  return selectedFiles
}

// Renders one PHP content root with the shared lightweight local reference shell.
function renderPhpReferencePage(
  html,
  sourceName,
  language,
  pageNamesByLanguage,
  pageFragmentsByLanguage,
) {
  const { contentRoot, title } = parsePhpManualPage(html, sourceName)
  removePhpSeeAlsoSections(contentRoot)
  const context = {
    kind: 'php',
    language,
    sourceName,
    pageNamesByLanguage,
    pageFragmentsByLanguage,
    pageFragments: pageFragmentsByLanguage.get(language),
  }
  const content = sanitizeReferenceHtml(DomUtils.getInnerHTML(contentRoot), context)
  return { title, html: staticPage(title, content) }
}

// Synchronizes one official PHP manual into selected local reference pages only.
function syncPhp(language, archivePath) {
  log(`生成 PHP ${language} 离线文档`)
  const extracted = extractArchive(archivePath)
  try {
    const sourceRoot = findArchiveRoot(extracted)
    const outputRoot = join(STAGING_ROOT, 'php', language)
    const selectedFiles = selectPhpReferenceFiles(sourceRoot)
    const pageNames = new Set(selectedFiles.map((file) => basename(file)))
    pageNames.add('index.html')
    const pageNamesByLanguage = new Map([[language, pageNames]])
    const pageFragments = new Map()
    // Fragment targets are collected from the same filtered PHP bodies that will be published.
    for (const sourceFile of selectedFiles) {
      const sourceName = basename(sourceFile)
      const { contentRoot } = parsePhpManualPage(readFileSync(sourceFile, 'utf8'), sourceName)
      removePhpSeeAlsoSections(contentRoot)
      const sanitized = sanitizeReferenceMarkup(DomUtils.getInnerHTML(contentRoot))
      pageFragments.set(sourceName, collectReferenceFragments(sanitized))
    }
    const pageFragmentsByLanguage = new Map([[language, pageFragments]])
    const pages = []

    // Selected pages are parsed again only after the complete local target set is known.
    for (const sourceFile of selectedFiles) {
      const sourceName = basename(sourceFile)
      const rendered = renderPhpReferencePage(
        readFileSync(sourceFile, 'utf8'),
        sourceName,
        language,
        pageNamesByLanguage,
        pageFragmentsByLanguage,
      )
      writeHtml(join(outputRoot, sourceName), rendered.html)
      pages.push({
        label: rendered.title,
        url: `${PUBLIC_DOCS_BASE}/php/${language}/${sourceName}`,
      })
    }
    writeDirectoryPage(join(outputRoot, 'index.html'), `PHP ${language} 参考`, pages)
  } finally {
    rmSync(extracted, { recursive: true, force: true })
  }
}

// Returns the active generated release while rejecting a user-owned current path.
function readActiveReleasePath() {
  const stats = lstatSync(ACTIVE_LINK, { throwIfNoEntry: false })
  // A missing link represents the first publication and has no prior release to clean.
  if (typeof stats === 'undefined') {
    return null
  }
  // Only this script's symlink may be replaced; a real user file or directory must remain untouched.
  if (!stats.isSymbolicLink()) {
    throw new Error(`拒绝替换非链接路径: ${ACTIVE_LINK}`)
  }

  const activePath = resolve(dirname(ACTIVE_LINK), readlinkSync(ACTIVE_LINK))
  const releaseRelativePath = relative(RELEASES_ROOT, activePath)
  // The active link must stay inside the script-owned release cache before it can be cleaned later.
  if (
    releaseRelativePath === '' ||
    releaseRelativePath === '..' ||
    releaseRelativePath.startsWith(`..${sep}`)
  ) {
    throw new Error(`拒绝项目外的活动文档链接: ${ACTIVE_LINK}`)
  }
  return activePath
}

// Removes generated releases that are no longer selected by the public current link.
function cleanupInactiveReleases(activeReleasePath) {
  const entries = readdirSync(RELEASES_ROOT, { withFileTypes: true })
  // Only generated release directories are considered for cleanup.
  for (const entry of entries) {
    // Unexpected cache files are left untouched because this method owns release directories only.
    if (!entry.isDirectory() || !entry.name.startsWith('release-')) {
      continue
    }
    const releasePath = join(RELEASES_ROOT, entry.name)
    // The active release must remain available through the public symlink.
    if (releasePath === activeReleasePath) {
      continue
    }
    rmSync(releasePath, { recursive: true, force: true })
  }
}

// Switches one public symlink after the complete staged release is ready.
function publishStaging(manifest) {
  writeFileSync(join(STAGING_ROOT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  readActiveReleasePath()
  const releaseName = `release-${Date.now()}-${process.pid}`
  const releasePath = join(RELEASES_ROOT, releaseName)
  const pendingLink = join(OUTPUT_ROOT, `.current-next-${process.pid}`)
  renameSync(STAGING_ROOT, releasePath)

  try {
    rmSync(pendingLink, { force: true })
    symlinkSync(relative(OUTPUT_ROOT, releasePath), pendingLink, 'dir')
    renameSync(pendingLink, ACTIVE_LINK)
  } catch (error) {
    // A failed link switch leaves the previous release active and discards only the unpublished release.
    rmSync(pendingLink, { force: true })
    rmSync(releasePath, { recursive: true, force: true })
    throw error
  }

  // The legacy layout contains only paths previously managed by this script; unrelated root files remain.
  for (const name of LEGACY_MANAGED_OUTPUTS) {
    rmSync(join(OUTPUT_ROOT, name), { recursive: true, force: true })
  }
  cleanupInactiveReleases(releasePath)
}

// Downloads all official sources, generates a complete staging tree, and selects it with one symlink rename.
function main() {
  mkdirSync(dirname(OUTPUT_ROOT), { recursive: true })
  mkdirSync(dirname(STAGING_ROOT), { recursive: true })
  mkdirSync(OUTPUT_ROOT, { recursive: true })
  mkdirSync(RELEASES_ROOT, { recursive: true })

  const redisFeed = ensureGzipFile('redis-docs.ndjson.gz', REDIS_DATA_URL)
  const redisLicense = ensureDownloadedFile('redis-docs-LICENSE', REDIS_LICENSE_URL)
  const phpArchives = {}
  // Both official PHP languages are cached before existing published content is touched.
  for (const language of Object.keys(PHP_URLS)) {
    phpArchives[language] = ensureArchive(`php-manual-${language}.tar.gz`, PHP_URLS[language])
  }
  const laravelArchives = new Map()
  // Every supported Laravel branch is cached before generation begins.
  for (const version of LARAVEL_VERSIONS) {
    const url = `https://codeload.github.com/laravel/docs/tar.gz/refs/heads/${version}`
    laravelArchives.set(version, ensureArchive(`laravel-docs-${version}.tar.gz`, url))
  }

  rmSync(STAGING_ROOT, { recursive: true, force: true })
  mkdirSync(STAGING_ROOT, { recursive: true })

  syncRedis(redisFeed, redisLicense)
  // The PHP language order remains stable in output and logs.
  for (const language of Object.keys(PHP_URLS)) {
    syncPhp(language, phpArchives[language])
  }
  // Each Laravel branch publishes to its own stable version directory.
  for (const version of LARAVEL_VERSIONS) {
    syncLaravelVersion(version, laravelArchives.get(version))
  }

  writeDirectoryPage(join(STAGING_ROOT, 'index.html'), '离线参考文档', [
    { label: 'Redis', url: `${PUBLIC_DOCS_BASE}/redis/index.html` },
    { label: 'PHP 中文', url: `${PUBLIC_DOCS_BASE}/php/zh/index.html` },
    { label: 'PHP English', url: `${PUBLIC_DOCS_BASE}/php/en/index.html` },
    { label: 'Laravel', url: `${PUBLIC_DOCS_BASE}/laravel/master/index.html` },
  ])
  publishStaging({
    generatedAt: new Date().toISOString(),
    redis: {
      source: REDIS_DATA_URL,
      license: REDIS_LICENSE_URL,
      entry: `${PUBLIC_DOCS_BASE}/redis/index.html`,
    },
    php: {
      zh: { source: PHP_URLS.zh, entry: `${PUBLIC_DOCS_BASE}/php/zh/index.html` },
      en: { source: PHP_URLS.en, entry: `${PUBLIC_DOCS_BASE}/php/en/index.html` },
    },
    laravel: {
      versions: LARAVEL_VERSIONS,
      entryPattern: `${PUBLIC_DOCS_BASE}/laravel/{version}/index.html`,
    },
  })
  log('离线文档同步完成')
}

main()
