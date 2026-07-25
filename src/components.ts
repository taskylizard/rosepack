import { ComponentTypes } from 'oceanic.js'
import type { ComponentInteraction, SelectMenuTypes } from 'oceanic.js'
import type { RosepackTypeError } from './errors.ts'
import { ComponentRouteError } from './errors.ts'
import type { ComponentContext } from './interaction-context.ts'
import type { RosepackModuleCatalog } from './modules.ts'

export type ComponentKind =
  | 'button'
  | 'channelSelect'
  | 'mentionableSelect'
  | 'roleSelect'
  | 'stringSelect'
  | 'userSelect'

export const componentTypeByKind = {
  button: ComponentTypes.BUTTON,
  channelSelect: ComponentTypes.CHANNEL_SELECT,
  mentionableSelect: ComponentTypes.MENTIONABLE_SELECT,
  roleSelect: ComponentTypes.ROLE_SELECT,
  stringSelect: ComponentTypes.STRING_SELECT,
  userSelect: ComponentTypes.USER_SELECT
} as const satisfies Record<ComponentKind, ComponentTypes.BUTTON | SelectMenuTypes>

export type ComponentDiscordType<TKind extends ComponentKind> = (typeof componentTypeByKind)[TKind]

export type ComponentInteractionFor<TKind extends ComponentKind> = ComponentInteraction<
  ComponentDiscordType<TKind>
>

export type ComponentValues<TKind extends ComponentKind> = [Exclude<TKind, 'button'>] extends [
  never
]
  ? never
  : 'button' extends TKind
    ? readonly string[] | undefined
    : readonly string[]

type RouteParameterSegment<TSegment extends string> = TSegment extends `:${infer Name}`
  ? Name extends ''
    ? never
    : Name
  : never

type RouteParameterNames<TRoute extends string> = TRoute extends `${infer Head}/${infer Tail}`
  ? RouteParameterSegment<Head> | RouteParameterNames<Tail>
  : RouteParameterSegment<TRoute>

export type ComponentRouteParams<TRoute extends string> = [RouteParameterNames<TRoute>] extends [
  never
]
  ? {}
  : { [Name in RouteParameterNames<TRoute>]: string }

type ValidateComponentRouteSegments<
  TRoute extends string,
  TSeen extends string = never
> = TRoute extends `${infer Head}/${infer Tail}`
  ? Head extends ''
    ? RosepackTypeError<'Component routes cannot contain empty path segments.'>
    : Head extends `:${infer Name}`
      ? Name extends ''
        ? RosepackTypeError<'Component route parameters must have a name.'>
        : Name extends TSeen
          ? RosepackTypeError<'Component route parameter names must be unique.'>
          : ValidateComponentRouteSegments<Tail, TSeen | Name>
      : ValidateComponentRouteSegments<Tail, TSeen>
  : TRoute extends ''
    ? RosepackTypeError<'Component routes cannot contain empty path segments.'>
    : TRoute extends `:${infer Name}`
      ? Name extends ''
        ? RosepackTypeError<'Component route parameters must have a name.'>
        : Name extends TSeen
          ? RosepackTypeError<'Component route parameter names must be unique.'>
          : true
      : true

export type ValidateComponentRoute<TRoute extends string> = ValidateComponentRouteSegments<TRoute>

type ComponentParamsOption<TRoute extends string> = keyof ComponentRouteParams<TRoute> extends never
  ? { readonly params?: never }
  : { readonly params: ComponentRouteParams<TRoute> }

export type ComponentBuildOptions<TRoute extends string> = ComponentParamsOption<TRoute>

export type ComponentBuildArguments<TRoute extends string> =
  keyof ComponentRouteParams<TRoute> extends never
    ? [options?: ComponentBuildOptions<TRoute>]
    : [options: ComponentBuildOptions<TRoute>]

export interface ComponentDefinition<
  TApp = unknown,
  TRoute extends string = string,
  TKind extends ComponentKind = ComponentKind,
  TCatalog extends RosepackModuleCatalog = RosepackModuleCatalog
> {
  readonly componentType: TKind
  readonly customID: TRoute
  beforeExecute?(context: ComponentContext<TApp, TRoute, TKind, TCatalog>): void | Promise<void>
  buildID(...args: ComponentBuildArguments<TRoute>): string
  execute(context: ComponentContext<TApp, TRoute, TKind, TCatalog>): Promise<void>
  onError?(
    context: ComponentContext<TApp, TRoute, TKind, TCatalog>,
    error: unknown
  ): void | Promise<void>
}

export interface ComponentInput<
  TApp,
  TRoute extends string,
  TKind extends ComponentKind,
  TCatalog extends RosepackModuleCatalog = RosepackModuleCatalog
> {
  readonly componentType: TKind
  readonly customID: TRoute
  beforeExecute?(context: ComponentContext<TApp, TRoute, TKind, TCatalog>): void | Promise<void>
  execute(context: ComponentContext<TApp, TRoute, TKind, TCatalog>): Promise<void>
  onError?(
    context: ComponentContext<TApp, TRoute, TKind, TCatalog>,
    error: unknown
  ): void | Promise<void>
}

export interface ComponentBuilder<
  TApp,
  TCatalog extends RosepackModuleCatalog = RosepackModuleCatalog
> {
  <const TRoute extends string, const TKind extends ComponentKind>(
    definition: ComponentInput<TApp, TRoute, TKind, TCatalog> &
      (ValidateComponentRoute<TRoute> extends true ? unknown : ValidateComponentRoute<TRoute>)
  ): ComponentDefinition<TApp, TRoute, TKind, TCatalog>
}

export interface ButtonBuilder<
  TApp,
  TCatalog extends RosepackModuleCatalog = RosepackModuleCatalog
> {
  <const TRoute extends string>(
    definition: Omit<ComponentInput<TApp, TRoute, 'button', TCatalog>, 'componentType'> &
      (ValidateComponentRoute<TRoute> extends true ? unknown : ValidateComponentRoute<TRoute>)
  ): ComponentDefinition<TApp, TRoute, 'button', TCatalog>
}

export type AnyComponentDefinition<
  TApp = unknown,
  TCatalog extends RosepackModuleCatalog = RosepackModuleCatalog
> = {
  [TKind in ComponentKind]: ComponentDefinition<TApp, any, TKind, TCatalog>
}[ComponentKind]

export type ComponentDefinitionRoute<TComponent> =
  TComponent extends ComponentDefinition<unknown, infer TRoute, ComponentKind> ? TRoute : never

export type ComponentDefinitionKind<TComponent> =
  TComponent extends ComponentDefinition<unknown, string, infer TKind> ? TKind : never

export function createComponentDefinition<
  TApp,
  const TRoute extends string,
  const TKind extends ComponentKind,
  TCatalog extends RosepackModuleCatalog = RosepackModuleCatalog
>(
  definition: ComponentInput<TApp, TRoute, TKind, TCatalog>
): ComponentDefinition<TApp, TRoute, TKind, TCatalog> {
  return {
    ...definition,
    buildID(...args) {
      return buildComponentID(definition, ...args)
    }
  }
}

export function createButtonDefinition<
  TApp,
  const TRoute extends string,
  TCatalog extends RosepackModuleCatalog = RosepackModuleCatalog
>(
  definition: Omit<ComponentInput<TApp, TRoute, 'button', TCatalog>, 'componentType'>
): ComponentDefinition<TApp, TRoute, 'button', TCatalog> {
  return createComponentDefinition({ ...definition, componentType: 'button' })
}

export function buildComponentID<TRoute extends string>(
  definition: Pick<ComponentDefinition<unknown, TRoute>, 'customID'>,
  ...args: ComponentBuildArguments<TRoute>
): string {
  const options = args[0]
  const customID = interpolateComponentRoute(
    definition.customID,
    (options !== undefined && 'params' in options ? options.params : undefined) as
      | ComponentRouteParams<TRoute>
      | undefined
  )
  if (customID.length > 100) {
    throw new ComponentRouteError(
      'custom-id-length',
      `Component custom ID exceeds Discord's 100-character limit (${customID.length}).`
    )
  }
  return customID
}

export function interpolateComponentRoute<TRoute extends string>(
  route: TRoute,
  params: ComponentRouteParams<TRoute> | undefined
): string {
  return route
    .split('/')
    .map((segment) => {
      if (!segment.startsWith(':')) return segment
      const name = segment.slice(1) as keyof ComponentRouteParams<TRoute>
      const value = params?.[name]
      if (typeof value !== 'string') {
        throw new ComponentRouteError(
          'missing-parameter',
          `Component route parameter "${String(name)}" is required.`
        )
      }
      return encodeURIComponent(value)
    })
    .join('/')
}
