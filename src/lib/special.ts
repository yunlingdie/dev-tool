import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

export type RsaModulusLength = 2048 | 3072 | 4096

export interface RsaKeyPairPem {
  publicKeyPem: string
  privateKeyPem: string
}

export interface Base64FileData {
  fileName: string
  mimeType: string
  size: number
  base64: string
  dataUrl: string
}

export interface Base64DownloadData {
  href: string
  download: string
  mimeType: string
  size: number
}

export interface ParsedBase64DataUrl {
  buffer: ArrayBuffer
  mimeType: string
}

export interface DockerRunConversion {
  serviceName: string
  command: string
}

interface DockerRunConfig {
  image: string
  command: string[]
  ports: string[]
  volumes: string[]
  environment: string[]
  detach: boolean
  name?: string
  restart?: string
  network?: string
  workingDir?: string
  entrypoint?: string
}

interface ParsedDockerOption {
  name: string
  value?: string
}

interface DockerOptionValue {
  value: string
  nextIndex: number
}

interface ParsedDataUrlParts {
  base64: string
  mimeType: string
}

const DEFAULT_MIME_TYPE = 'application/octet-stream'
const VALID_RSA_MODULUS_LENGTHS: RsaModulusLength[] = [2048, 3072, 4096]
const SHORT_VALUE_OPTIONS = new Set(['-p', '-v', '-e', '-w'])

/** Generates an RSA-OAEP key pair and exports browser-compatible SPKI/PKCS8 PEM strings. */
export async function generateRsaKeyPair(
  modulusLength: RsaModulusLength = 2048,
): Promise<RsaKeyPairPem> {
  // Only the offered secure key sizes are accepted so an invalid UI value cannot create a weak key.
  if (!VALID_RSA_MODULUS_LENGTHS.includes(modulusLength)) {
    throw new Error('RSA key size must be 2048, 3072, or 4096 bits')
  }

  // RSA generation depends on WebCrypto and should fail clearly in unsupported browser contexts.
  if (!globalThis.crypto?.subtle) {
    throw new Error('WebCrypto is not available in this environment')
  }

  const keyPair = await globalThis.crypto.subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['encrypt', 'decrypt'],
  )
  const [publicKey, privateKey] = await Promise.all([
    globalThis.crypto.subtle.exportKey('spki', keyPair.publicKey),
    globalThis.crypto.subtle.exportKey('pkcs8', keyPair.privateKey),
  ])

  return {
    publicKeyPem: arrayBufferToPem(publicKey, 'PUBLIC KEY'),
    privateKeyPem: arrayBufferToPem(privateKey, 'PRIVATE KEY'),
  }
}

/** Encodes binary data as a Base64 string without relying on Node.js Buffer. */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  // btoa is required because this module is intentionally implemented for browser use.
  if (typeof globalThis.btoa !== 'function') {
    throw new Error('Base64 encoding is not available in this environment')
  }

  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x8000
  let binary = ''

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }

  return globalThis.btoa(binary)
}

/** Decodes a Base64 string into a standalone ArrayBuffer. */
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  // atob is required because this module is intentionally implemented for browser use.
  if (typeof globalThis.atob !== 'function') {
    throw new Error('Base64 decoding is not available in this environment')
  }

  const binary = globalThis.atob(base64.replace(/\s/g, ''))
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return bytes.buffer
}

/** Builds a Base64 data URL from binary content and its MIME type. */
export function arrayBufferToDataUrl(
  buffer: ArrayBuffer,
  mimeType = DEFAULT_MIME_TYPE,
): string {
  return `data:${mimeType};base64,${arrayBufferToBase64(buffer)}`
}

/** Parses a Base64 data URL into its MIME type and binary content. */
export function dataUrlToArrayBuffer(dataUrl: string): ParsedBase64DataUrl {
  const parsed = parseBase64DataUrl(dataUrl)

  return {
    buffer: base64ToArrayBuffer(parsed.base64),
    mimeType: parsed.mimeType,
  }
}

/** Reads a browser File and returns the values needed by Base64 file tools. */
export async function fileToBase64Data(file: File): Promise<Base64FileData> {
  const buffer = await file.arrayBuffer()
  let mimeType = file.type

  // Files without a declared type need a stable MIME type for a valid data URL.
  if (!mimeType) {
    mimeType = DEFAULT_MIME_TYPE
  }

  const base64 = arrayBufferToBase64(buffer)

  return {
    fileName: file.name,
    mimeType,
    size: file.size,
    base64,
    dataUrl: `data:${mimeType};base64,${base64}`,
  }
}

/** Creates href/download metadata for an anchor-based Base64 file download. */
export function createBase64Download(
  base64OrDataUrl: string,
  fileName: string,
  mimeType = DEFAULT_MIME_TYPE,
): Base64DownloadData {
  let base64 = base64OrDataUrl
  let resolvedMimeType = mimeType

  // Existing data URLs carry their own MIME type and should not be wrapped a second time.
  if (/^data:/i.test(base64OrDataUrl)) {
    const parsed = parseBase64DataUrl(base64OrDataUrl)
    base64 = parsed.base64
    resolvedMimeType = parsed.mimeType
  }

  const normalizedBase64 = base64.replace(/\s/g, '')
  const size = base64ToArrayBuffer(normalizedBase64).byteLength

  return {
    href: `data:${resolvedMimeType};base64,${normalizedBase64}`,
    download: fileName,
    mimeType: resolvedMimeType,
    size,
  }
}

/** Converts one docker run command into a modern Compose YAML document. */
export function dockerRunToCompose(command: string): string {
  const config = parseDockerRun(command)
  const serviceName = createComposeServiceName(config)
  const service: Record<string, unknown> = {
    image: config.image,
  }

  // container_name preserves an explicitly requested docker run --name value.
  if (config.name) {
    service.container_name = config.name
  }

  // Empty lists are omitted to keep the generated Compose document focused.
  if (config.ports.length > 0) {
    service.ports = config.ports
  }

  // Empty lists are omitted to keep the generated Compose document focused.
  if (config.volumes.length > 0) {
    service.volumes = config.volumes
  }

  // List syntax preserves both KEY=value and host-inherited KEY environment forms.
  if (config.environment.length > 0) {
    service.environment = config.environment
  }

  // Compose has no service-level detach setting, so a valid extension field preserves round trips.
  if (config.detach) {
    service['x-docker-run-detach'] = true
  }

  // Restart policy maps directly between docker run and Compose.
  if (config.restart) {
    service.restart = config.restart
  }

  // network_mode is the direct Compose equivalent of docker run --network.
  if (config.network) {
    service.network_mode = config.network
  }

  // working_dir is the direct Compose equivalent of docker run --workdir.
  if (config.workingDir) {
    service.working_dir = config.workingDir
  }

  // Array syntax prevents Compose from reinterpreting spaces inside the executable path.
  if (config.entrypoint !== undefined) {
    service.entrypoint = [config.entrypoint]
  }

  // Array syntax preserves the exact argv boundary of the docker run command.
  if (config.command.length > 0) {
    service.command = config.command
  }

  return stringifyYaml(
    {
      services: {
        [serviceName]: service,
      },
    },
    { lineWidth: 0 },
  )
}

/** Converts every Compose service into an individually runnable docker run command. */
export function composeToDockerRuns(composeYaml: string): DockerRunConversion[] {
  const document = parseYaml(composeYaml) as unknown

  // A Compose conversion needs an object document with a services map.
  if (!isRecord(document) || !isRecord(document.services)) {
    throw new Error('Compose YAML must contain a services object')
  }

  const conversions: DockerRunConversion[] = []

  for (const [serviceName, rawService] of Object.entries(document.services)) {
    // Each service must be an object so its Docker fields can be inspected safely.
    if (!isRecord(rawService)) {
      throw new Error(`Compose service "${serviceName}" must be an object`)
    }

    conversions.push({
      serviceName,
      command: composeServiceToDockerRun(serviceName, rawService),
    })
  }

  return conversions
}

/** Wraps DER key bytes in the standard 64-column PEM envelope. */
function arrayBufferToPem(buffer: ArrayBuffer, label: string): string {
  const base64 = arrayBufferToBase64(buffer)
  const lines = base64.match(/.{1,64}/g)

  // Exported RSA keys are never empty, but retaining a fallback keeps the helper total.
  if (!lines) {
    throw new Error('Cannot encode an empty key')
  }

  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----`
}

/** Extracts MIME type and payload from a Base64-only data URL. */
function parseBase64DataUrl(dataUrl: string): ParsedDataUrlParts {
  const match = /^data:([^;,]*)(?:;[^;,]*)*;base64,([\s\S]*)$/i.exec(dataUrl)

  // Non-Base64 data URLs need different percent-decoding semantics and are outside this tool.
  if (!match) {
    throw new Error('Expected a Base64 data URL')
  }

  let mimeType = match[1]

  // An omitted data URL media type should download as generic binary content.
  if (!mimeType) {
    mimeType = DEFAULT_MIME_TYPE
  }

  return {
    mimeType,
    base64: match[2],
  }
}

/** Splits shell-like input into argv tokens without executing or expanding it. */
function tokenizeShell(input: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote = ''
  let escaping = false
  let tokenStarted = false

  for (const character of input.trim()) {
    // A backslash outside single quotes protects exactly the following character.
    if (escaping) {
      current += character
      escaping = false
      continue
    }

    // Single-quoted shell text treats every character except the closing quote literally.
    if (quote === "'") {
      // The matching quote closes the current quoted segment without joining a literal quote.
      if (character === "'") {
        quote = ''
        continue
      }

      current += character
      continue
    }

    // Double-quoted text supports a closing quote and backslash-protected characters.
    if (quote === '"') {
      // A matching double quote closes the current quoted segment.
      if (character === '"') {
        quote = ''
        continue
      }

      // Backslash lets common command examples retain spaces or quotes inside double quotes.
      if (character === '\\') {
        escaping = true
        continue
      }

      current += character
      continue
    }

    // Outside quotes, whitespace terminates a token but repeated whitespace is ignored.
    if (/\s/.test(character)) {
      // A started token may be empty because shell input can contain an explicit empty string.
      if (tokenStarted) {
        tokens.push(current)
        current = ''
        tokenStarted = false
      }

      continue
    }

    // Backslash outside quotes escapes the following character instead of becoming data.
    if (character === '\\') {
      escaping = true
      tokenStarted = true
      continue
    }

    // Quotes begin a quoted segment and allow empty quoted tokens.
    if (character === "'" || character === '"') {
      quote = character
      tokenStarted = true
      continue
    }

    current += character
    tokenStarted = true
  }

  // A dangling backslash cannot be interpreted without silently changing the command.
  if (escaping) {
    throw new Error('Docker command ends with an unfinished escape')
  }

  // An open quote signals incomplete user input and should not produce a misleading conversion.
  if (quote) {
    throw new Error('Docker command contains an unclosed quote')
  }

  // The final token has no trailing whitespace to flush it inside the loop.
  if (tokenStarted) {
    tokens.push(current)
  }

  return tokens
}

/** Parses the supported docker run fields into a neutral configuration object. */
function parseDockerRun(command: string): DockerRunConfig {
  const tokens = tokenizeShell(command)
  let index = 0

  // sudo is accepted because copied local Docker commands commonly include it.
  if (tokens[index] === 'sudo') {
    index += 1
  }

  // Requiring the Docker executable avoids treating arbitrary shell input as a container command.
  if (tokens[index] !== 'docker') {
    throw new Error('Expected a docker run command')
  }

  index += 1

  // `docker container run` is an official synonym for `docker run`.
  if (tokens[index] === 'container') {
    index += 1
  }

  // Only run commands have the option and image layout supported by this converter.
  if (tokens[index] !== 'run') {
    throw new Error('Expected a docker run command')
  }

  index += 1

  const config: DockerRunConfig = {
    image: '',
    command: [],
    ports: [],
    volumes: [],
    environment: [],
    detach: false,
  }

  while (index < tokens.length) {
    const token = tokens[index]

    // A standalone separator explicitly marks the end of docker run options.
    if (token === '--') {
      index += 1
      break
    }

    // The first non-option token is the image; every later token belongs to its command argv.
    if (!token.startsWith('-') || token === '-') {
      config.image = token
      index += 1
      break
    }

    const option = parseDockerOption(token)

    // Detach is a flag and therefore consumes no following value.
    if (option.name === '-d' || option.name === '--detach') {
      config.detach = parseDockerBooleanFlag(option.value)
      index += 1
      continue
    }

    // Name maps to Compose container_name.
    if (option.name === '--name') {
      const result = requireDockerOptionValue(option, tokens, index)
      config.name = result.value
      index = result.nextIndex
      continue
    }

    // Publish options are repeatable and retain Docker's full port syntax.
    if (option.name === '-p' || option.name === '--publish') {
      const result = requireDockerOptionValue(option, tokens, index)
      config.ports.push(result.value)
      index = result.nextIndex
      continue
    }

    // Volume options are repeatable and retain Docker's bind or volume syntax.
    if (option.name === '-v' || option.name === '--volume') {
      const result = requireDockerOptionValue(option, tokens, index)
      config.volumes.push(result.value)
      index = result.nextIndex
      continue
    }

    // Environment options are repeatable and may contain either KEY or KEY=value.
    if (option.name === '-e' || option.name === '--env') {
      const result = requireDockerOptionValue(option, tokens, index)
      config.environment.push(result.value)
      index = result.nextIndex
      continue
    }

    // Restart has one scalar Compose equivalent.
    if (option.name === '--restart') {
      const result = requireDockerOptionValue(option, tokens, index)
      config.restart = result.value
      index = result.nextIndex
      continue
    }

    // Docker accepts both --network and its --net alias.
    if (option.name === '--network' || option.name === '--net') {
      const result = requireDockerOptionValue(option, tokens, index)
      config.network = result.value
      index = result.nextIndex
      continue
    }

    // Working directory accepts both the short and long Docker spellings.
    if (option.name === '-w' || option.name === '--workdir') {
      const result = requireDockerOptionValue(option, tokens, index)
      config.workingDir = result.value
      index = result.nextIndex
      continue
    }

    // Entrypoint is a single Docker executable override.
    if (option.name === '--entrypoint') {
      const result = requireDockerOptionValue(option, tokens, index)
      config.entrypoint = result.value
      index = result.nextIndex
      continue
    }

    throw new Error(`Unsupported docker run option: ${option.name}`)
  }

  // An option separator may precede the image, so the image is read after the option loop when needed.
  if (!config.image && index < tokens.length) {
    config.image = tokens[index]
    index += 1
  }

  // Docker cannot run without an image, and emitting invalid Compose would hide that input error.
  if (!config.image) {
    throw new Error('Docker run command must include an image')
  }

  config.command = tokens.slice(index)
  return config
}

/** Separates long `--key=value` and supported attached short option values. */
function parseDockerOption(token: string): ParsedDockerOption {
  // Long options may carry their value after an equals sign.
  if (token.startsWith('--')) {
    const equalsIndex = token.indexOf('=')

    // No equals sign means the value, when required, is in the next argv token.
    if (equalsIndex === -1) {
      return { name: token }
    }

    return {
      name: token.slice(0, equalsIndex),
      value: token.slice(equalsIndex + 1),
    }
  }

  const shortName = token.slice(0, 2)

  // Docker permits attached forms such as -p8080:80 for value-taking short options.
  if (token.length > 2 && SHORT_VALUE_OPTIONS.has(shortName)) {
    return {
      name: shortName,
      value: token.slice(2),
    }
  }

  return { name: token }
}

/** Resolves an inline or following docker option value and its next parser position. */
function requireDockerOptionValue(
  option: ParsedDockerOption,
  tokens: string[],
  currentIndex: number,
): DockerOptionValue {
  // Inline values already belong to the current argv token, including an explicitly empty value.
  if (option.value !== undefined) {
    return {
      value: option.value,
      nextIndex: currentIndex + 1,
    }
  }

  const valueIndex = currentIndex + 1

  // A missing value would otherwise consume the image or return undefined silently.
  if (valueIndex >= tokens.length) {
    throw new Error(`Docker option ${option.name} requires a value`)
  }

  return {
    value: tokens[valueIndex],
    nextIndex: valueIndex + 1,
  }
}

/** Interprets Docker's optional explicit boolean form for flag options. */
function parseDockerBooleanFlag(value: string | undefined): boolean {
  // An omitted flag value is Docker's normal true form.
  if (value === undefined || value === 'true') {
    return true
  }

  // Docker also accepts the explicit --detach=false spelling.
  if (value === 'false') {
    return false
  }

  throw new Error(`Invalid boolean flag value: ${value}`)
}

/** Creates a valid, stable Compose service key from the name or image. */
function createComposeServiceName(config: DockerRunConfig): string {
  let source = config.name

  // Without --name, the final image path segment provides the clearest service label.
  if (!source) {
    const imageWithoutDigest = config.image.split('@')[0]
    const imageWithoutTag = imageWithoutDigest.replace(/:[^/]+$/, '')
    const imageSegments = imageWithoutTag.split('/')
    source = imageSegments[imageSegments.length - 1]
  }

  let serviceName = source.toLowerCase().replace(/[^a-z0-9_-]+/g, '-')
  serviceName = serviceName.replace(/^[^a-z0-9]+/, '').replace(/-+$/, '')

  // A fully stripped source still needs a legal service key for valid Compose output.
  if (!serviceName) {
    serviceName = 'app'
  }

  return serviceName
}

/** Converts one validated Compose service object into a quoted docker run command. */
function composeServiceToDockerRun(
  serviceName: string,
  service: Record<string, unknown>,
): string {
  // A docker run command cannot represent build-only Compose services without first building an image.
  if (typeof service.image !== 'string' || !service.image) {
    throw new Error(`Compose service "${serviceName}" must define an image`)
  }

  const tokens = ['docker', 'run']

  // Detach is restored only when the forward converter's extension explicitly recorded it.
  if (service['x-docker-run-detach'] === true) {
    tokens.push('-d')
  }

  // container_name is the direct equivalent of docker run --name.
  if (typeof service.container_name === 'string' && service.container_name) {
    tokens.push('--name', service.container_name)
  }

  appendRepeatedDockerOption(tokens, '-p', service.ports, formatComposePort, 'ports')
  appendRepeatedDockerOption(tokens, '-v', service.volumes, formatComposeVolume, 'volumes')

  for (const environment of readComposeEnvironment(service.environment)) {
    tokens.push('-e', environment)
  }

  // Restart policy maps directly when it is a non-empty string.
  if (typeof service.restart === 'string' && service.restart) {
    tokens.push('--restart', service.restart)
  }

  const network = readComposeNetwork(service)

  // A service without an explicit network should keep Docker's default network behavior.
  if (network) {
    tokens.push('--network', network)
  }

  // Compose working_dir maps directly to docker run --workdir.
  if (typeof service.working_dir === 'string' && service.working_dir) {
    tokens.push('--workdir', service.working_dir)
  }

  const entrypoint = readComposeArgv(service.entrypoint, 'entrypoint')

  // Docker's override accepts one executable; remaining Compose entrypoint argv follows the image.
  if (entrypoint.length > 0) {
    tokens.push('--entrypoint', entrypoint[0])
  }

  tokens.push(service.image)

  // Remaining entrypoint arguments must precede command arguments to preserve final argv order.
  if (entrypoint.length > 1) {
    tokens.push(...entrypoint.slice(1))
  }

  tokens.push(...readComposeArgv(service.command, 'command'))

  return tokens.map(quoteShellToken).join(' ')
}

/** Appends repeatable Docker options after validating a Compose list field. */
function appendRepeatedDockerOption(
  tokens: string[],
  option: string,
  value: unknown,
  formatter: (value: unknown) => string,
  fieldName: string,
): void {
  // Missing Compose list fields simply mean no matching docker run flags.
  if (value === undefined) {
    return
  }

  // Ports and volumes must be lists because each item becomes a separate Docker flag.
  if (!Array.isArray(value)) {
    throw new Error(`Compose ${fieldName} must be an array`)
  }

  for (const item of value) {
    tokens.push(option, formatter(item))
  }
}

/** Formats Compose short or long port syntax as a docker run publish value. */
function formatComposePort(port: unknown): string {
  // String and number short syntax can pass through unchanged.
  if (typeof port === 'string' || typeof port === 'number') {
    return String(port)
  }

  // Long syntax requires an object with at least the target container port.
  if (!isRecord(port) || (typeof port.target !== 'string' && typeof port.target !== 'number')) {
    throw new Error('Compose port entries must be strings, numbers, or long-syntax objects')
  }

  const parts: string[] = []

  // host_ip is meaningful only when Compose explicitly supplies it.
  if (typeof port.host_ip === 'string' && port.host_ip) {
    parts.push(port.host_ip)
  }

  // published may be absent to request an automatically allocated host port.
  if (typeof port.published === 'string' || typeof port.published === 'number') {
    parts.push(String(port.published))
  }

  parts.push(String(port.target))
  let formatted = parts.join(':')

  // Non-TCP protocols need an explicit suffix in docker run syntax.
  if (typeof port.protocol === 'string' && port.protocol && port.protocol !== 'tcp') {
    formatted += `/${port.protocol}`
  }

  return formatted
}

/** Formats Compose short or long volume syntax as a docker run volume value. */
function formatComposeVolume(volume: unknown): string {
  // Short syntax already matches docker run's accepted volume format.
  if (typeof volume === 'string') {
    return volume
  }

  // Long syntax needs a target and a string source when a source is present.
  if (!isRecord(volume) || typeof volume.target !== 'string') {
    throw new Error('Compose volume entries must be strings or long-syntax objects')
  }

  let formatted = volume.target

  // A source distinguishes a bind/named volume from an anonymous volume target.
  if (typeof volume.source === 'string' && volume.source) {
    formatted = `${volume.source}:${volume.target}`
  }

  // read_only has a direct :ro suffix in docker run short syntax.
  if (volume.read_only === true) {
    formatted += ':ro'
  }

  return formatted
}

/** Normalizes Compose environment list or map syntax into Docker KEY/value strings. */
function readComposeEnvironment(environment: unknown): string[] {
  // Missing environment configuration produces no docker run flags.
  if (environment === undefined) {
    return []
  }

  // List syntax already matches Docker's KEY and KEY=value forms.
  if (Array.isArray(environment)) {
    return environment.map((value) => String(value))
  }

  // Map syntax is the only other Compose environment representation.
  if (!isRecord(environment)) {
    throw new Error('Compose environment must be an array or object')
  }

  const values: string[] = []

  for (const [key, value] of Object.entries(environment)) {
    // Null means inherit the named variable from the host environment.
    if (value === null || value === undefined) {
      values.push(key)
      continue
    }

    // Scalars have an unambiguous KEY=value Docker representation.
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      values.push(`${key}=${String(value)}`)
      continue
    }

    throw new Error(`Compose environment value for "${key}" must be scalar or null`)
  }

  return values
}

/** Selects the direct network_mode or the first named Compose network. */
function readComposeNetwork(service: Record<string, unknown>): string | undefined {
  // network_mode most directly matches docker run --network.
  if (typeof service.network_mode === 'string' && service.network_mode) {
    return service.network_mode
  }

  // Array syntax lists networks by name in priority order.
  if (Array.isArray(service.networks) && service.networks.length > 0) {
    return String(service.networks[0])
  }

  // Object syntax uses network names as keys; Docker run can attach to only one at startup here.
  if (isRecord(service.networks)) {
    const names = Object.keys(service.networks)

    // At least one key is required before selecting the first network.
    if (names.length > 0) {
      return names[0]
    }
  }

  return undefined
}

/** Normalizes Compose string or list command fields into argv tokens. */
function readComposeArgv(value: unknown, fieldName: string): string[] {
  // Missing command fields contribute no argv tokens.
  if (value === undefined || value === null) {
    return []
  }

  // Array syntax already expresses an exact argv boundary.
  if (Array.isArray(value)) {
    return value.map((item) => String(item))
  }

  // String syntax is split with the same quote-aware tokenizer used for docker run input.
  if (typeof value === 'string') {
    return tokenizeShell(value)
  }

  throw new Error(`Compose ${fieldName} must be a string or array`)
}

/** Quotes one argv token so the generated command can be pasted into a POSIX-like shell. */
function quoteShellToken(value: string): string {
  // Empty argv values require quotes or the shell would omit them entirely.
  if (value === '') {
    return "''"
  }

  // Shell-neutral tokens are left readable and need no quoting.
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) {
    return value
  }

  return `'${value.replace(/'/g, `'"'"'`)}'`
}

/** Narrows unknown YAML values to plain object-like records. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
