import { PrefixCommandParseError } from './prefix-errors.ts'

const maximumPrefixInputLength = 16_384
const maximumPrefixTokens = 256

/** One cooked command-line token and its exact source range. */
export interface PrefixToken {
  readonly end: number
  readonly raw: string
  readonly start: number
  readonly value: string
}

/** Splits shell-like input while supporting single quotes, double quotes, and backslash escapes. */
export function tokenizePrefixInput(input: string, path: readonly string[] = []): PrefixToken[] {
  if (input.length > maximumPrefixInputLength) {
    throw new PrefixCommandParseError({
      code: 'input-too-long',
      message: `Prefix command input cannot exceed ${maximumPrefixInputLength} characters.`,
      path
    })
  }
  const tokens: PrefixToken[] = []
  let index = 0

  while (index < input.length) {
    while (isWhitespaceCode(input.charCodeAt(index))) {
      index += 1
    }
    if (index >= input.length) {
      break
    }

    const start = index
    let quoteCode = 0
    let value = ''

    while (index < input.length) {
      const characterCode = input.charCodeAt(index)
      if (quoteCode === 0 && isWhitespaceCode(characterCode)) {
        break
      }
      if (characterCode === 92) {
        index += 1
        if (index < input.length) {
          value += input[index]
          index += 1
          continue
        }
        value += '\\'
        break
      }
      if (characterCode === 34 || characterCode === 39) {
        if (quoteCode === characterCode) {
          quoteCode = 0
          index += 1
          continue
        }
        if (quoteCode === 0) {
          quoteCode = characterCode
          index += 1
          continue
        }
      }
      value += input[index]
      index += 1
    }

    if (quoteCode !== 0) {
      throw new PrefixCommandParseError({
        code: 'unterminated-quote',
        input: input.slice(start),
        message: `Unterminated ${String.fromCharCode(quoteCode)} quote.`,
        path
      })
    }

    const end = index
    // tasky: Token objects stay monomorphic and unfrozen because dispatch never exposes or reuses them.
    tokens.push({ end, raw: input.slice(start, end), start, value })
    if (tokens.length > maximumPrefixTokens) {
      throw new PrefixCommandParseError({
        code: 'too-many-tokens',
        message: `Prefix commands cannot contain more than ${maximumPrefixTokens} tokens.`,
        path
      })
    }
  }

  return tokens
}

function isWhitespaceCode(code: number): boolean {
  // tasky: Discord command lines are overwhelmingly ASCII; keep that path branch-only for V8.
  if (code === 32 || (code >= 9 && code <= 13)) {
    return true
  }
  return code > 127 && /\s/u.test(String.fromCharCode(code))
}
