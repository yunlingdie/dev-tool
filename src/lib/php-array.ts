import { Engine as PhpParser } from 'php-parser'

type JsonPrimitive = string | number | boolean | null
type JsonValue = JsonPrimitive | JsonValue[] | JsonObject
type PhpArrayKey = bigint | string

interface JsonObject {
  [key: string]: JsonValue
}

interface PhpNode {
  kind: string
  [key: string]: unknown
}

interface PhpProgramNode extends PhpNode {
  children: PhpNode[]
  errors: unknown[]
}

interface PhpArrayNode extends PhpNode {
  items: PhpEntryNode[]
  kind: 'array'
}

interface PhpEntryNode extends PhpNode {
  byRef: boolean
  key: PhpNode | null
  kind: 'entry'
  unpack: boolean
  value: PhpNode
}

interface PhpArrayEntryValue {
  key: PhpArrayKey
  value: JsonValue
}

const PHP_INT_MIN = -(2n ** 63n)
const PHP_INT_MAX = 2n ** 63n - 1n
const JS_SAFE_INTEGER_MIN = BigInt(Number.MIN_SAFE_INTEGER)
const JS_SAFE_INTEGER_MAX = BigInt(Number.MAX_SAFE_INTEGER)

const phpParser = new PhpParser({
  parser: {
    extractDoc: false,
    suppressErrors: false,
    version: '8.3',
  },
  ast: {
    withPositions: false,
    withSource: false,
  },
})

/** Returns whether a parsed JSON value is a non-array object. */
function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Rejects one exact integer before conversion could lose precision. */
function assertSafeInteger(integer: bigint, source: string): void {
  // JSON numbers cannot exactly retain integers outside JavaScript's safe range.
  if (integer < JS_SAFE_INTEGER_MIN || integer > JS_SAFE_INTEGER_MAX) {
    throw new Error(`Integer exceeds the JavaScript safe integer range: ${source}`)
  }
}

/** Validates JSON number tokens before JSON.parse can round large integers. */
function assertJsonIntegerSafety(input: string): void {
  let index = 0
  let insideString = false
  let escaped = false

  // The scanner tracks JSON strings only to avoid treating their digits as number tokens.
  while (index < input.length) {
    const character = input[index]

    // String contents are skipped while honoring escaped quotes and backslashes.
    if (insideString) {
      // The character after a backslash cannot close the current JSON string.
      if (escaped) {
        escaped = false
      } else if (character === '\\') {
        // A backslash marks the following string character as escaped.
        escaped = true
      } else if (character === '"') {
        // An unescaped quote returns the scanner to structural JSON text.
        insideString = false
      }

      index += 1
      continue
    }

    // A structural quote starts a string whose contents must not be number-scanned.
    if (character === '"') {
      insideString = true
      index += 1
      continue
    }

    // Only a minus sign or digit can begin a JSON number token.
    if (character === '-' || /\d/.test(character)) {
      const match = input.slice(index).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/)

      // Invalid JSON may not form a number token and is left for JSON.parse to reject.
      if (!match) {
        index += 1
        continue
      }

      const literal = match[0]

      // Plain integer tokens can be checked exactly with BigInt before JSON.parse.
      if (/^-?\d+$/.test(literal)) {
        assertSafeInteger(BigInt(literal), literal)
      } else {
        const numeric = Number(literal)

        // JSON.parse accepts overflowing exponents as infinity, which PHP array output cannot preserve.
        if (!Number.isFinite(numeric)) {
          throw new Error(`Number is outside the finite numeric range: ${literal}`)
        }

        // Decimal or exponent syntax that resolves to an unsafe integer is also lossy.
        if (Number.isInteger(numeric) && !Number.isSafeInteger(numeric)) {
          throw new Error(`Integer exceeds the JavaScript safe integer range: ${literal}`)
        }
      }

      index += literal.length
      continue
    }

    index += 1
  }
}

/** Escapes a string for an exact PHP single-quoted string literal. */
function escapePhpString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

/** Indents one generated PHP line according to its nested array depth. */
function indentPhp(depth: number): string {
  return '  '.repeat(depth)
}

/** Formats already-rendered PHP array entries as one short array expression. */
function formatPhpArrayEntries(entries: string[], depth: number): string {
  // Empty JSON collections share PHP's single empty-array representation.
  if (entries.length === 0) {
    return '[]'
  }

  const innerIndent = indentPhp(depth + 1)
  const outerIndent = indentPhp(depth)
  return `[\n${entries.map((entry) => `${innerIndent}${entry}`).join(',\n')}\n${outerIndent}]`
}

/** Recursively formats one JSON-compatible value as a PHP literal. */
function formatPhpValue(value: JsonValue, depth: number): string {
  // PHP and JSON use the same null literal spelling.
  if (value === null) {
    return 'null'
  }

  // JSON arrays become PHP entries without explicit keys.
  if (Array.isArray(value)) {
    const entries = value.map((item) => formatPhpValue(item, depth + 1))
    return formatPhpArrayEntries(entries, depth)
  }

  // JSON objects become PHP entries with safely quoted string keys.
  if (isJsonObject(value)) {
    const entries = Object.entries(value).map(([key, item]) => (
      `'${escapePhpString(key)}' => ${formatPhpValue(item, depth + 1)}`
    ))
    return formatPhpArrayEntries(entries, depth)
  }

  // Strings use single quotes so dollar signs cannot trigger PHP interpolation.
  if (typeof value === 'string') {
    return `'${escapePhpString(value)}'`
  }

  // Numeric values have already passed finite and safe-integer validation.
  if (typeof value === 'number') {
    return String(value)
  }

  // Boolean is the only remaining JSON primitive after the earlier guards.
  if (value) {
    return 'true'
  }

  return 'false'
}

/** Converts a JSON object or array string to a formatted PHP short array. */
export function jsonToPhpArray(input: string): string {
  let parsed: unknown

  assertJsonIntegerSafety(input)

  try {
    parsed = JSON.parse(input) as unknown
  } catch {
    throw new Error('Invalid JSON input')
  }

  // PHP array conversion intentionally rejects scalar JSON roots.
  if (!Array.isArray(parsed) && !isJsonObject(parsed)) {
    throw new Error('JSON root must be an object or array')
  }

  return formatPhpValue(parsed, 0)
}

/** Removes an optional PHP opening tag before eval-mode AST parsing. */
function unwrapPhpSource(input: string): string {
  let source = input.trim()
  const openingTag = source.match(/^<\?php\b/i)

  // An accepted opening tag is syntax decoration rather than an AST statement.
  if (openingTag) {
    source = source.slice(openingTag[0].length).trim()
  }

  return source
}

/** Returns whether an unknown AST value has the common node shape. */
function isPhpNode(value: unknown): value is PhpNode {
  return typeof value === 'object' && value !== null && 'kind' in value
}

/** Parses PHP source and extracts its one permitted root array expression. */
function parseRootPhpArray(input: string): PhpArrayNode {
  const source = unwrapPhpSource(input)

  // Empty source cannot contain the required array expression.
  if (source.length === 0) {
    throw new Error('PHP input cannot be empty')
  }

  let program: PhpProgramNode
  try {
    program = phpParser.parseEval(source) as unknown as PhpProgramNode
  } catch {
    throw new Error('Invalid PHP array syntax')
  }

  // Parser recovery errors are rejected even if a partial AST was produced.
  if (program.errors.length > 0) {
    throw new Error('Invalid PHP array syntax')
  }

  // Exactly one statement prevents hidden code before or after the array.
  if (program.children.length !== 1) {
    throw new Error('PHP input must contain exactly one array statement')
  }

  const statement = program.children[0]
  let expression: unknown

  // A plain array expression is accepted for paste-friendly input.
  if (statement.kind === 'expressionstatement') {
    expression = statement.expression
  } else if (statement.kind === 'return') {
    // A return wrapper matches common PHP config files without executing them.
    expression = statement.expr
  } else {
    // All other statement kinds could introduce behavior or extra declarations.
    throw new Error('PHP input must be an array expression or return statement')
  }

  // The root must be an actual PHP array rather than another expression type.
  if (!isPhpNode(expression) || expression.kind !== 'array') {
    throw new Error('PHP root value must be an array')
  }

  return expression as PhpArrayNode
}

/** Reads and validates the source text held by a PHP numeric AST node. */
function readPhpNumberLiteral(node: PhpNode): string {
  // Runtime php-parser number nodes expose their literal value as a string.
  if (typeof node.value !== 'string' && typeof node.value !== 'number') {
    throw new Error('Invalid PHP number literal')
  }

  return String(node.value).replace(/_/g, '')
}

/** Parses an integer PHP literal exactly, returning null for floating-point syntax. */
function parsePhpIntegerLiteral(node: PhpNode): bigint | null {
  const literal = readPhpNumberLiteral(node)

  // Hexadecimal integer syntax maps directly to an exact BigInt.
  if (/^0[xX][0-9a-fA-F]+$/.test(literal)) {
    return BigInt(literal)
  }

  // Binary integer syntax maps directly to an exact BigInt.
  if (/^0[bB][01]+$/.test(literal)) {
    return BigInt(literal)
  }

  // Explicit octal syntax maps directly to an exact BigInt.
  if (/^0[oO][0-7]+$/.test(literal)) {
    return BigInt(`0o${literal.slice(2)}`)
  }

  // Legacy leading-zero PHP integers are octal rather than decimal.
  if (/^0[0-7]+$/.test(literal) && literal.length > 1) {
    return BigInt(`0o${literal.slice(1)}`)
  }

  // Plain decimal digits are exact integers, including zero itself.
  if (/^\d+$/.test(literal)) {
    return BigInt(literal)
  }

  return null
}

/** Converts a PHP number node to a finite JavaScript number for JSON output. */
function convertPhpNumber(node: PhpNode): number {
  const literal = readPhpNumberLiteral(node)
  const integer = parsePhpIntegerLiteral(node)
  let value: number

  // Exact integer syntax is converted from BigInt before entering JSON's number model.
  if (integer !== null) {
    assertSafeInteger(integer, readPhpNumberLiteral(node))
    value = Number(integer)
  } else {
    // Decimal and exponent syntax follow JavaScript's compatible IEEE-754 parsing.
    value = Number(literal)
  }

  // JSON cannot represent NaN or either infinity value.
  if (!Number.isFinite(value)) {
    throw new Error(`PHP number is outside the JSON numeric range: ${literal}`)
  }

  // Exponent or decimal syntax can still describe an integer outside the safe range.
  if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
    throw new Error(`Integer exceeds the JavaScript safe integer range: ${literal}`)
  }

  return value
}

/** Converts a string key using PHP's decimal-integer key coercion rule. */
function normalizePhpStringKey(value: string): PhpArrayKey {
  // Only canonical decimal integer strings without a plus sign become integer keys.
  if (/^-?(0|[1-9]\d*)$/.test(value)) {
    const integer = BigInt(value)

    // PHP keeps decimal strings outside its signed 64-bit integer range as strings.
    if (integer >= PHP_INT_MIN && integer <= PHP_INT_MAX) {
      return integer
    }
  }

  return value
}

/** Converts a numeric PHP node, with an optional unary sign, to an integer array key. */
function convertPhpNumericKey(node: PhpNode, sign = 1n): bigint {
  const integer = parsePhpIntegerLiteral(node)

  // Integer literal syntax preserves key precision exactly.
  if (integer !== null) {
    assertSafeInteger(integer * sign, readPhpNumberLiteral(node))
    return integer * sign
  }

  const numeric = convertPhpNumber(node)
  const signed = numeric * Number(sign)

  // PHP truncates floating-point array keys toward zero.
  if (Number.isSafeInteger(Math.trunc(signed))) {
    return BigInt(Math.trunc(signed))
  }

  throw new Error('Floating-point PHP array key is outside the safe integer range')
}

/** Converts one whitelisted PHP scalar node to a normalized PHP array key. */
function convertPhpKey(node: PhpNode): PhpArrayKey {
  // PHP string keys may be coerced to integers when their spelling is canonical.
  if (node.kind === 'string') {
    if (typeof node.value !== 'string') {
      throw new Error('Invalid PHP string key')
    }

    return normalizePhpStringKey(node.value)
  }

  // Integer and floating-point literal keys follow PHP's numeric key rules.
  if (node.kind === 'number') {
    return convertPhpNumericKey(node)
  }

  // PHP coerces boolean keys to integer zero or one.
  if (node.kind === 'boolean') {
    if (node.value === true) {
      return 1n
    }

    if (node.value === false) {
      return 0n
    }

    throw new Error('Invalid PHP boolean key')
  }

  // PHP coerces a null array key to the empty string.
  if (node.kind === 'nullkeyword') {
    return ''
  }

  // Unary signs are permitted only when they directly wrap a numeric literal.
  if (node.kind === 'unary') {
    if ((node.type !== '+' && node.type !== '-') || !isPhpNode(node.what) || node.what.kind !== 'number') {
      throw new Error('PHP array keys allow unary plus or minus only on numbers')
    }

    // Minus changes the exact integer key sign; plus leaves it unchanged.
    if (node.type === '-') {
      return convertPhpNumericKey(node.what, -1n)
    }

    return convertPhpNumericKey(node.what)
  }

  throw new Error(`Unsupported PHP array key expression: ${node.kind}`)
}

/** Builds a collision-safe identity string for one normalized PHP array key. */
function identifyPhpKey(key: PhpArrayKey): string {
  // Integer and string keys use separate namespaces to preserve PHP key identity.
  if (typeof key === 'bigint') {
    return `integer:${key.toString()}`
  }

  return `string:${key}`
}

/** Determines whether normalized PHP entries form exactly the keys 0 through n-1. */
function hasSequentialIntegerKeys(entries: Map<string, PhpArrayEntryValue>): boolean {
  let expected = 0n

  for (let index = 0; index < entries.size; index += 1) {
    // Any missing numeric position makes the PHP array associative or mixed.
    if (!entries.has(identifyPhpKey(expected))) {
      return false
    }

    expected += 1n
  }

  return true
}

/** Converts normalized PHP entries to a JSON array ordered by numeric key. */
function phpEntriesToJsonArray(entries: Map<string, PhpArrayEntryValue>): JsonValue[] {
  const result: JsonValue[] = []

  for (let index = 0; index < entries.size; index += 1) {
    const entry = entries.get(identifyPhpKey(BigInt(index)))

    // Sequential-key validation guarantees every indexed entry is present.
    if (!entry) {
      throw new Error('Internal PHP array key normalization error')
    }

    result.push(entry.value)
  }

  return result
}

/** Converts normalized associative PHP entries to a prototype-safe JSON object. */
function phpEntriesToJsonObject(entries: Map<string, PhpArrayEntryValue>): JsonObject {
  const result = Object.create(null) as JsonObject

  for (const entry of entries.values()) {
    let property: string

    // JSON object property names stringify PHP integer keys.
    if (typeof entry.key === 'bigint') {
      property = entry.key.toString()
    } else {
      // Non-numeric PHP string keys retain their exact text.
      property = entry.key
    }

    result[property] = entry.value
  }

  return result
}

/** Converts one PHP array AST node while applying PHP key and append semantics. */
function convertPhpArray(node: PhpArrayNode): JsonValue[] | JsonObject {
  const entries = new Map<string, PhpArrayEntryValue>()
  let nextAutomaticKey = 0n

  for (const item of node.items) {
    // php-parser always emits entry nodes; any other node shape is rejected defensively.
    if (!isPhpNode(item) || item.kind !== 'entry') {
      throw new Error('Unsupported PHP array item')
    }

    // References and unpacking can depend on runtime state and are never evaluated.
    if (item.byRef || item.unpack) {
      throw new Error('PHP array references and unpacking are not supported')
    }

    let key: PhpArrayKey

    // Entries without explicit keys use PHP's next automatic integer key.
    if (item.key === null) {
      if (nextAutomaticKey > PHP_INT_MAX) {
        throw new Error('PHP automatic array key exceeds the signed 64-bit range')
      }

      key = nextAutomaticKey
      nextAutomaticKey += 1n
    } else {
      // Explicit keys are normalized before duplicate detection and append tracking.
      key = convertPhpKey(item.key)

      // An explicit integer key advances later automatic keys when it reaches the current maximum.
      if (typeof key === 'bigint' && key >= nextAutomaticKey) {
        nextAutomaticKey = key + 1n
      }
    }

    const value = convertPhpValue(item.value)
    entries.set(identifyPhpKey(key), { key, value })
  }

  // Exact keys 0 through n-1 have an unambiguous JSON array representation.
  if (hasSequentialIntegerKeys(entries)) {
    return phpEntriesToJsonArray(entries)
  }

  return phpEntriesToJsonObject(entries)
}

/** Converts one strictly whitelisted PHP literal AST node to JSON-compatible data. */
function convertPhpValue(node: PhpNode): JsonValue {
  // Nested PHP arrays recurse through the same key normalization rules.
  if (node.kind === 'array') {
    return convertPhpArray(node as PhpArrayNode)
  }

  // php-parser has already decoded safe non-interpolated PHP strings.
  if (node.kind === 'string') {
    if (typeof node.value !== 'string') {
      throw new Error('Invalid PHP string literal')
    }

    return node.value
  }

  // PHP numeric literals enter JSON's finite IEEE-754 number model.
  if (node.kind === 'number') {
    return convertPhpNumber(node)
  }

  // Boolean nodes must contain an actual boolean rather than a malformed AST value.
  if (node.kind === 'boolean') {
    if (typeof node.value !== 'boolean') {
      throw new Error('Invalid PHP boolean literal')
    }

    return node.value
  }

  // The dedicated null keyword maps directly to JSON null.
  if (node.kind === 'nullkeyword') {
    return null
  }

  // Unary plus and minus are accepted only for a directly nested numeric literal.
  if (node.kind === 'unary') {
    if ((node.type !== '+' && node.type !== '-') || !isPhpNode(node.what) || node.what.kind !== 'number') {
      throw new Error('PHP unary plus or minus may only wrap a number')
    }

    const numeric = convertPhpNumber(node.what)

    // Unary minus changes the numeric sign while unary plus retains it.
    if (node.type === '-') {
      return -numeric
    }

    return numeric
  }

  throw new Error(`Unsupported PHP expression: ${node.kind}`)
}

/** Converts one safe PHP array expression to formatted JSON without executing PHP. */
export function phpArrayToJson(input: string): string {
  const array = parseRootPhpArray(input)
  return JSON.stringify(convertPhpArray(array), null, 2)
}
