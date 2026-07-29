import type {
  CommandInteraction,
  ComponentInteraction,
  EditInteractionContent,
  InteractionContent,
  Member,
  ModalSubmitInteraction,
  Permission,
  PermissionName
} from 'oceanic.js'
import { MessageFlags } from 'oceanic.js'
import { normalizeResponseContent } from './responses.ts'

const guardBrand = Symbol('rosepack.guard')
const guardDecisionBrand = Symbol('rosepack.guard-decision')
const guildGuardEffect = Symbol('rosepack.guild-guard-effect')

/** The reusable interaction-level context available to a guard. */
export interface GuardContext<TApp = unknown> {
  readonly app: TApp
  readonly interaction: CommandInteraction | ComponentInteraction | ModalSubmitInteraction
}

interface GuardResponseContext<TApp> extends GuardContext<TApp> {
  readonly acknowledged: boolean
  editResponse(content: EditInteractionContent | string): Promise<void>
}

/** Content and visibility used when a guard denies an interaction. */
export interface GuardDenyOptions {
  readonly ephemeral?: boolean
  readonly message?: InteractionContent | string
}

/** A branded, explicit result from a guard. */
export type GuardDecision =
  | { readonly [guardDecisionBrand]: true; readonly allowed: true }
  | {
      readonly [guardDecisionBrand]: true
      readonly allowed: false
      readonly options: GuardDenyOptions
    }

/** An app-bound interaction guard. */
export interface Guard<TApp = unknown, TGuild extends boolean = false> {
  (context: GuardContext<TApp>): GuardDecision | Promise<GuardDecision>
  readonly [guardBrand]: true
  readonly [guildGuardEffect]: TGuild
}

/** Interaction fields proven by a guild-producing guard. */
export type GuildInteraction<TInteraction> = Omit<
  TInteraction,
  'guildID' | 'member' | 'memberPermissions'
> & {
  readonly guildID: string
  readonly member: Member
  readonly memberPermissions: Permission
}

export type GuardedContext<
  TContext extends { readonly interaction: unknown },
  TGuards extends readonly unknown[] | undefined
> = TGuards extends readonly unknown[]
  ? Extract<TGuards[number], { readonly [guildGuardEffect]: true }> extends never
    ? TContext
    : Omit<TContext, 'interaction'> & {
        readonly interaction: GuildInteraction<TContext['interaction']>
      }
  : TContext

/** Callable guard factory with built-in interaction guards and decision constructors. */
export interface GuardBuilder<TApp> {
  (guard: (context: GuardContext<TApp>) => GuardDecision | Promise<GuardDecision>): Guard<TApp>
  allow(): GuardDecision
  deny(
    message?: InteractionContent | string,
    options?: Omit<GuardDenyOptions, 'message'>
  ): GuardDecision
  guild(options?: GuardDenyOptions): Guard<TApp, true>
  role(roleID: string, options?: GuardDenyOptions): Guard<TApp, true>
  userPermissions(
    permissions: PermissionName | readonly PermissionName[],
    options?: GuardDenyOptions
  ): Guard<TApp, true>
}

type GuardCallback<TApp> = (context: GuardContext<TApp>) => GuardDecision | Promise<GuardDecision>

const allowDecision: GuardDecision = Object.freeze({
  [guardDecisionBrand]: true as const,
  allowed: true as const
})

export function createGuardBuilder<TApp>(): GuardBuilder<TApp> {
  const deny: GuardBuilder<TApp>['deny'] = (message, options = {}) => {
    const denyOptions = Object.freeze({ ...options, message })
    return Object.freeze({
      [guardDecisionBrand]: true as const,
      allowed: false as const,
      options: denyOptions
    })
  }
  const guild: GuardBuilder<TApp>['guild'] = (options = {}) =>
    brandGuard(
      ({ interaction }) =>
        interaction.guildID !== null &&
        interaction.member != null &&
        interaction.memberPermissions != null
          ? allowDecision
          : deny(options.message, options),
      true
    )
  const role: GuardBuilder<TApp>['role'] = (roleID, options = {}) =>
    brandGuard(
      ({ interaction }) =>
        interaction.guildID !== null &&
        interaction.member != null &&
        interaction.memberPermissions != null &&
        interaction.member.roles.includes(roleID)
          ? allowDecision
          : deny(options.message, options),
      true
    )
  const userPermissions: GuardBuilder<TApp>['userPermissions'] = (permissions, options = {}) => {
    const required = typeof permissions === 'string' ? [permissions] : [...permissions]
    return brandGuard(({ interaction }) => {
      const { guildID, member, memberPermissions } = interaction
      return guildID !== null &&
        member != null &&
        memberPermissions != null &&
        required.every((permission) => memberPermissions.has(permission))
        ? allowDecision
        : deny(options.message, options)
    }, true)
  }
  return Object.assign((callback: GuardCallback<TApp>) => brandGuard(callback, false), {
    allow: () => allowDecision,
    deny,
    guild,
    role,
    userPermissions
  })
}

function brandGuard<TApp, const TGuild extends boolean>(
  callback: GuardCallback<TApp>,
  guild: TGuild
): Guard<TApp, TGuild> {
  return Object.freeze(
    Object.assign(callback, {
      [guardBrand]: true as const,
      [guildGuardEffect]: guild
    })
  )
}

export async function runGuards<TApp>(
  guards: readonly Guard<TApp, boolean>[] | undefined,
  context: GuardResponseContext<TApp>
): Promise<boolean> {
  for (const guard of guards ?? []) {
    if (guard[guardBrand] !== true) {
      throw new TypeError('A rosepack guard was not created by a rosepack guard builder.')
    }
    const decision = await guard(context)
    if (
      typeof decision !== 'object' ||
      decision === null ||
      !(guardDecisionBrand in decision) ||
      decision[guardDecisionBrand] !== true
    ) {
      throw new TypeError('A rosepack guard returned an unbranded decision.')
    }
    if (decision.allowed) continue
    const payload = normalizeResponseContent(
      decision.options.message ?? 'This action is not allowed.'
    )
    if (context.acknowledged || decision.options.ephemeral === false) {
      await context.editResponse(payload)
    } else {
      await context.editResponse({
        ...payload,
        flags: (payload.flags ?? 0) | MessageFlags.EPHEMERAL
      })
    }
    return false
  }
  return true
}
