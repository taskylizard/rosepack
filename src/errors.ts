/** Stable, human-readable messages used by compile-time and runtime validation. */
export const ROSEPACK_TYPE_MESSAGES = {
  emptySubcommands: 'A command or subcommand group must contain at least one subcommand.',
  executableGroup:
    'A subcommand group cannot define execute(). Put execute() on a child subcommand.',
  helperFreeLeaf:
    'Executable subcommand leaves must use slashSub({ ... }) so their options can be inferred.',
  invalidNode: 'A subcommand node must be an executable slashSub() leaf or a subcommand group.',
  missingRootExecute: 'A flat command must define execute().',
  mixedOptions:
    'A command with subcommands cannot define root options. Put options on executable leaves.',
  nestedGroup:
    'Discord supports only command -> group -> subcommand. Nested subcommand groups are invalid.',
  rootExecute:
    'A command with subcommands cannot define root execute(). Put execute() on a subcommand leaf.',
  tooManySubcommands: 'Discord allows at most 25 subcommands.'
} as const

/** A readable marker placed at the property responsible for an invalid definition. */
export interface RosepackTypeError<TMessage extends string> {
  readonly $rosepackError: TMessage
}

export type ApplicationCommandValidationErrorCode = 'duplicate-name' | 'invalid-name-length'

export class ApplicationCommandValidationError extends Error {
  constructor(
    readonly code: ApplicationCommandValidationErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'ApplicationCommandValidationError'
  }
}

export type ModalValidationErrorCode =
  | 'ambiguous-route'
  | 'duplicate-parameter'
  | 'empty-route-segment'
  | 'field-count'
  | 'field-id-length'
  | 'field-label-length'
  | 'field-length-range'
  | 'invalid-parameter'
  | 'route-length'
  | 'title-length'

export class ModalValidationError extends Error {
  constructor(
    readonly code: ModalValidationErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'ModalValidationError'
  }
}

export type ModalRouteErrorCode = 'custom-id-length' | 'missing-parameter' | 'unknown-route'

export class ModalRouteError extends Error {
  constructor(
    readonly code: ModalRouteErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'ModalRouteError'
  }
}

export class ModalValueError extends Error {
  readonly code = 'missing-required-field'

  constructor(readonly field: string) {
    super(`Modal submission is missing required field "${field}".`)
    this.name = 'ModalValueError'
  }
}
