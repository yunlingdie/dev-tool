import { base32, base32nopad, base58, type BytesCoder } from '@scure/base'

/** Base encodings available to the text conversion tool. */
export type BaseTextEncoding = 'base32' | 'base32-nopad' | 'base58'

const MAX_BASE58_INPUT_LENGTH = 10_000
const UTF8_ENCODER = new TextEncoder()
const STRICT_UTF8_DECODER = new TextDecoder('utf-8', { fatal: true })

const BASE_CODERS: Readonly<Record<BaseTextEncoding, BytesCoder>> = {
  base32,
  'base32-nopad': base32nopad,
  base58,
}

const BASE_ENCODING_LABELS: Readonly<Record<BaseTextEncoding, string>> = {
  base32: 'Base32',
  'base32-nopad': 'unpadded Base32',
  base58: 'Base58',
}

/** Rejects oversized Base58 input before its quadratic conversion can begin. */
function assertBase58InputLength(
  encoding: BaseTextEncoding,
  length: number,
  unit: 'UTF-8 bytes' | 'encoded characters',
): void {
  // Only Base58 needs this guard because its radix conversion has quadratic complexity.
  if (encoding === 'base58' && length > MAX_BASE58_INPUT_LENGTH) {
    throw new RangeError(
      `Base58 input must not exceed ${MAX_BASE58_INPUT_LENGTH.toLocaleString('en-US')} ${unit}`,
    )
  }
}

/** Extracts a readable detail from any value thrown by a codec or UTF-8 decoder. */
function getErrorDetail(error: unknown): string {
  // Native errors carry the useful validation detail without an extra "Error:" prefix.
  if (error instanceof Error && error.message.length > 0) {
    return error.message
  }

  // Non-Error throws still need a stable string for the user-facing wrapper.
  return String(error)
}

/** Adds the failed operation and encoding name to a low-level conversion error. */
function createBaseEncodingError(
  operation: 'encode' | 'decode',
  encoding: BaseTextEncoding,
  error: unknown,
): Error {
  return new Error(
    `Failed to ${operation} ${BASE_ENCODING_LABELS[encoding]} text: ${getErrorDetail(error)}`,
    { cause: error },
  )
}

/** Encodes UTF-8 text using the selected Base32 or Base58 representation. */
export function encodeBaseText(input: string, encoding: BaseTextEncoding): string {
  const bytes = UTF8_ENCODER.encode(input)
  assertBase58InputLength(encoding, bytes.length, 'UTF-8 bytes')

  try {
    return BASE_CODERS[encoding].encode(bytes)
  } catch (error) {
    // Codec errors are wrapped so the UI can identify which conversion failed.
    throw createBaseEncodingError('encode', encoding, error)
  }
}

/** Decodes Base32 or Base58 input as strictly valid UTF-8 text. */
export function decodeBaseText(input: string, encoding: BaseTextEncoding): string {
  assertBase58InputLength(encoding, input.length, 'encoded characters')

  try {
    const bytes = BASE_CODERS[encoding].decode(input)
    return STRICT_UTF8_DECODER.decode(bytes)
  } catch (error) {
    // Codec and fatal UTF-8 errors share one clear user-facing error shape.
    throw createBaseEncodingError('decode', encoding, error)
  }
}
