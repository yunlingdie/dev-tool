import { toJavaScriptWarn } from 'curlconverter'
import type { Warnings } from 'curlconverter'

const JAVASCRIPT_LINE_BREAK = /\r\n|[\n\r\u2028\u2029]/g

/** Formats converter warnings as non-executable JavaScript line comments. */
function formatWarnings(warnings: Warnings): string {
  const comments: string[] = []

  for (const [warningId, message] of warnings) {
    const safeWarningId = warningId.replace(JAVASCRIPT_LINE_BREAK, ' ')

    for (const line of message.split(JAVASCRIPT_LINE_BREAK)) {
      comments.push(`// [${safeWarningId}] ${line}`)
    }
  }

  return comments.join('\n')
}

/** Converts a cURL command to browser Fetch source code without executing either command. */
export function curlToFetch(input: string): string {
  // Empty input cannot describe an HTTP request and produces an unclear parser error.
  if (input.trim().length === 0) {
    throw new Error('cURL input is required')
  }

  const [code, warnings] = toJavaScriptWarn(input)
  const warningComments = formatWarnings(warnings)

  // Warning-free conversions should preserve curlconverter's generated source exactly.
  if (warningComments.length === 0) {
    return code
  }

  return `${warningComments}\n\n${code}`
}
