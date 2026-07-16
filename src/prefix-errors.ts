/** One stable validation finding produced while building a prefix-command registry. */
export interface PrefixCommandValidationIssue {
  code: string
  message: string
  path: readonly string[]
}

/** Thrown when prefix-command definitions cannot form a valid registry. */
export class PrefixCommandValidationError extends Error {
  readonly issues: readonly PrefixCommandValidationIssue[]

  constructor(issues: readonly PrefixCommandValidationIssue[]) {
    super(formatValidationIssues(issues))
    this.name = 'PrefixCommandValidationError'
    this.issues = Object.freeze(
      issues.map((issue) => Object.freeze({ ...issue, path: Object.freeze([...issue.path]) }))
    )
  }
}

/** Stable failure categories emitted while tokenizing, routing, or parsing a prefix command. */
export type PrefixCommandParseErrorCode =
  | 'input-too-long'
  | 'invalid-flag'
  | 'missing-flag-value'
  | 'missing-option'
  | 'missing-subcommand'
  | 'parser-failed'
  | 'too-many-options'
  | 'too-many-tokens'
  | 'unexpected-flag-value'
  | 'unknown-flag'
  | 'unknown-subcommand'
  | 'unterminated-quote'

/** A structured user-input failure suitable for an application-level error response. */
export class PrefixCommandParseError extends Error {
  readonly code: PrefixCommandParseErrorCode
  readonly input?: string
  readonly option?: string
  readonly path: readonly string[]

  constructor(config: {
    code: PrefixCommandParseErrorCode
    input?: string
    message: string
    option?: string
    path: readonly string[]
  }) {
    super(config.message)
    this.name = 'PrefixCommandParseError'
    this.code = config.code
    this.input = config.input
    this.option = config.option
    this.path = Object.freeze([...config.path])
  }
}

/** Internal signal created by `PrefixParserContext.fail()`. */
export class PrefixParserFailure extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PrefixParserFailure'
  }
}

function formatValidationIssues(issues: readonly PrefixCommandValidationIssue[]): string {
  const details = issues
    .map(
      (issue) => `- ${issue.path.length === 0 ? '<root>' : issue.path.join('.')}: ${issue.message}`
    )
    .join('\n')
  return `Invalid prefix command tree:\n\n${details}`
}
