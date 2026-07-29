import { expectTypeOf, test } from 'vite-plus/test'
import { createRosepack, slashGroup, type Guard } from '../../src/index.ts'

interface TestApp {
  readonly kind: 'test'
}

const { button, guard, modal, slash, slashSub, userMenu } = createRosepack<TestApp>()

test('locally refines built-in guild guards without refining custom guards', () => {
  slash({
    name: 'guild',
    description: 'Guild',
    guards: [guard.guild()],
    async execute(context) {
      expectTypeOf(context.interaction.guildID).toEqualTypeOf<string>()
      expectTypeOf(context.interaction.memberPermissions).toHaveProperty('has')
      expectTypeOf(context.interaction.member.roles).toEqualTypeOf<string[]>()
    }
  })

  slash({
    name: 'plain',
    description: 'Plain',
    async execute(context) {
      expectTypeOf(context.interaction.guildID).toEqualTypeOf<string | null>()
    }
  })

  const custom: Guard<TestApp> = guard(() => guard.allow())
  slash({
    name: 'custom',
    description: 'Custom',
    guards: [custom],
    async execute(context) {
      expectTypeOf(context.interaction.guildID).toEqualTypeOf<string | null>()
    }
  })

  const inheritedOnly = slashSub({
    description: 'Inherited only',
    async execute(context) {
      expectTypeOf(context.interaction.guildID).toEqualTypeOf<string | null>()
    }
  })
  slash({
    name: 'parent-guard',
    description: 'Parent guard',
    guards: [guard.guild()],
    subcommands: { inheritedOnly }
  })
})

test('refines slash leaves and other interaction handlers', () => {
  const leaf = slashSub({
    description: 'Guild leaf',
    guards: [guard.role('staff')],
    async execute(context) {
      expectTypeOf(context.interaction.guildID).toEqualTypeOf<string>()
      expectTypeOf(context.interaction.memberPermissions).toHaveProperty('has')
    }
  })
  expectTypeOf<
    Parameters<typeof leaf.execute>[0]['interaction']['guildID']
  >().toEqualTypeOf<string>()

  button({
    customID: 'guild-button',
    guards: [guard.guild()],
    async execute(context) {
      expectTypeOf(context.interaction.guildID).toEqualTypeOf<string>()
    }
  })

  modal({
    customID: 'guild-modal',
    title: 'Guild modal',
    fields: { value: { kind: 'text', label: 'Value' } },
    guards: [guard.userPermissions('MANAGE_GUILD')],
    async execute(context) {
      expectTypeOf(context.interaction.member.roles).toEqualTypeOf<string[]>()
    }
  })

  userMenu({
    name: 'Guild user',
    guards: [guard.guild()],
    async execute(context) {
      expectTypeOf(context.interaction.guildID).toEqualTypeOf<string>()
    }
  })
})

test('preserves shared tuples and guarded invocation targets', () => {
  const shared = [guard.guild(), guard.userPermissions('MANAGE_GUILD')] as const
  const target = slashSub({
    description: 'Target',
    guards: shared,
    async execute(context) {
      expectTypeOf(context.interaction.guildID).toEqualTypeOf<string>()
    }
  })

  slash({
    name: 'source',
    description: 'Source',
    async execute(context) {
      await context.invoke(target, {})
    }
  })

  slashGroup({ description: 'Guarded group', guards: [guard.guild()] })
})

test('types custom guards and rejects incompatible builders and decisions', () => {
  guard(({ app, interaction }) => {
    expectTypeOf(app).toEqualTypeOf<TestApp>()
    expectTypeOf(interaction.user.id).toBeString()
    return guard.allow()
  })

  // @ts-expect-error custom guards must return a branded decision
  guard(() => true)

  const otherGuard = createRosepack<{ readonly kind: 'other' }>().guard.guild()
  slash({
    name: 'wrong-app',
    description: 'Wrong app',
    guards: [
      // @ts-expect-error guards are bound to their rosepack app context
      otherGuard
    ],
    async execute() {}
  })
})

test('accepts only Oceanic permission names', () => {
  guard.userPermissions(['MANAGE_GUILD', 'KICK_MEMBERS'])
  // @ts-expect-error unknown Discord permission name
  guard.userPermissions('NOT_A_PERMISSION')
})
