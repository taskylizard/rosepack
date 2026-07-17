import { ComponentTypes, TextInputStyles } from 'oceanic.js'
import type { ModalData } from 'oceanic.js'
import type { RosepackTypeError } from './errors.ts'
import type { ModalContext } from './interaction-context.ts'
import { ModalRouteError } from './errors.ts'

export type ModalTextStyle = 'paragraph' | 'short'

export interface ModalTextFieldDefinition {
  readonly description?: string
  readonly kind: 'text'
  readonly label: string
  readonly maxLength?: number
  readonly minLength?: number
  readonly placeholder?: string
  readonly required?: boolean
  readonly style?: ModalTextStyle
}

export interface ModalFieldRecord {
  readonly [name: string]: ModalTextFieldDefinition
}

type RequiredModalFieldNames<TFields extends ModalFieldRecord> = {
  [Name in keyof TFields]-?: TFields[Name] extends { required: true } ? Name : never
}[keyof TFields]

type OptionalModalFieldNames<TFields extends ModalFieldRecord> = Exclude<
  keyof TFields,
  RequiredModalFieldNames<TFields>
>

type Simplify<T> = { [Key in keyof T]: T[Key] }

export type ModalFieldValues<TFields extends ModalFieldRecord> = Simplify<
  {
    -readonly [Name in RequiredModalFieldNames<TFields>]: string
  } & {
    -readonly [Name in OptionalModalFieldNames<TFields>]?: string
  }
>

type RouteParameterSegment<TSegment extends string> = TSegment extends `:${infer Name}`
  ? Name extends ''
    ? never
    : Name
  : never

type RouteParameterNames<TRoute extends string> = TRoute extends `${infer Head}/${infer Tail}`
  ? RouteParameterSegment<Head> | RouteParameterNames<Tail>
  : RouteParameterSegment<TRoute>

export type ModalRouteParams<TRoute extends string> = [RouteParameterNames<TRoute>] extends [never]
  ? {}
  : { [Name in RouteParameterNames<TRoute>]: string }

type ValidateModalRouteSegments<
  TRoute extends string,
  TSeen extends string = never
> = TRoute extends `${infer Head}/${infer Tail}`
  ? Head extends ''
    ? RosepackTypeError<'Modal routes cannot contain empty path segments.'>
    : Head extends `:${infer Name}`
      ? Name extends ''
        ? RosepackTypeError<'Modal route parameters must have a name.'>
        : Name extends TSeen
          ? RosepackTypeError<'Modal route parameter names must be unique.'>
          : ValidateModalRouteSegments<Tail, TSeen | Name>
      : ValidateModalRouteSegments<Tail, TSeen>
  : TRoute extends ''
    ? RosepackTypeError<'Modal routes cannot contain empty path segments.'>
    : TRoute extends `:${infer Name}`
      ? Name extends ''
        ? RosepackTypeError<'Modal route parameters must have a name.'>
        : Name extends TSeen
          ? RosepackTypeError<'Modal route parameter names must be unique.'>
          : true
      : true

export type ValidateModalRoute<TRoute extends string> = ValidateModalRouteSegments<TRoute>

type ModalParamsOption<TRoute extends string> = keyof ModalRouteParams<TRoute> extends never
  ? { readonly params?: never }
  : { readonly params: ModalRouteParams<TRoute> }

export type ModalBuildOptions<
  TRoute extends string,
  TFields extends ModalFieldRecord
> = ModalParamsOption<TRoute> & {
  readonly values?: Partial<ModalFieldValues<TFields>>
}

export interface ModalDefinition<
  TApp = unknown,
  TRoute extends string = string,
  TFields extends ModalFieldRecord = ModalFieldRecord
> {
  readonly customID: TRoute
  readonly fields: TFields
  readonly title: string
  beforeExecute?(context: ModalContext<TApp, TRoute, TFields>): void | Promise<void>
  build(options: ModalBuildOptions<TRoute, TFields>): ModalData
  execute(context: ModalContext<TApp, TRoute, TFields>): Promise<void>
  onError?(context: ModalContext<TApp, TRoute, TFields>, error: unknown): void | Promise<void>
}

export interface ModalInput<TApp, TRoute extends string, TFields extends ModalFieldRecord> {
  readonly customID: TRoute
  readonly fields: TFields
  readonly title: string
  beforeExecute?(context: ModalContext<TApp, TRoute, TFields>): void | Promise<void>
  execute(context: ModalContext<TApp, TRoute, TFields>): Promise<void>
  onError?(context: ModalContext<TApp, TRoute, TFields>, error: unknown): void | Promise<void>
}

export interface ModalBuilder<TApp> {
  <const TRoute extends string, const TFields extends ModalFieldRecord>(
    definition: ModalInput<TApp, TRoute, TFields> &
      (ValidateModalRoute<TRoute> extends true ? unknown : ValidateModalRoute<TRoute>)
  ): ModalDefinition<TApp, TRoute, TFields>
}

export interface RosepackGeneratedModalCatalog {}

export type AnyModalDefinition<TApp = unknown> = ModalDefinition<TApp, any, any>

export type ModalDefinitionRoute<TModal> =
  TModal extends ModalDefinition<unknown, infer TRoute, ModalFieldRecord> ? TRoute : never

export type ModalDefinitionFields<TModal> =
  TModal extends ModalDefinition<unknown, string, infer TFields> ? TFields : never

export type ModalDefinitionBuildOptions<TModal> =
  TModal extends ModalDefinition<unknown, infer TRoute, infer TFields>
    ? ModalBuildOptions<TRoute, TFields>
    : never

export function createModalDefinition<
  TApp,
  const TRoute extends string,
  const TFields extends ModalFieldRecord
>(definition: ModalInput<TApp, TRoute, TFields>): ModalDefinition<TApp, TRoute, TFields> {
  return {
    ...definition,
    build(options) {
      return buildModalData(definition, options)
    }
  }
}

export function buildModalData<TRoute extends string, TFields extends ModalFieldRecord>(
  definition: Pick<ModalDefinition<unknown, TRoute, TFields>, 'customID' | 'fields' | 'title'>,
  options: ModalBuildOptions<TRoute, TFields>
): ModalData {
  const initialValues = options.values as Readonly<Record<string, string | undefined>> | undefined
  const customID = interpolateModalRoute(
    definition.customID,
    ('params' in options ? options.params : undefined) as ModalRouteParams<TRoute> | undefined
  )
  if (customID.length > 100) {
    throw new ModalRouteError(
      'custom-id-length',
      `Modal custom ID exceeds Discord's 100-character limit (${customID.length}).`
    )
  }
  return {
    customID,
    title: definition.title,
    components: Object.entries(definition.fields).map(([name, field]) => ({
      component: {
        customID: name,
        maxLength: field.maxLength,
        minLength: field.minLength,
        placeholder: field.placeholder,
        required: field.required,
        style: field.style === 'paragraph' ? TextInputStyles.PARAGRAPH : TextInputStyles.SHORT,
        type: ComponentTypes.TEXT_INPUT,
        value: initialValues?.[name]
      },
      description: field.description,
      label: field.label,
      type: ComponentTypes.LABEL
    }))
  }
}

export function interpolateModalRoute<TRoute extends string>(
  route: TRoute,
  params: ModalRouteParams<TRoute> | undefined
): string {
  return route
    .split('/')
    .map((segment) => {
      if (!segment.startsWith(':')) return segment
      const name = segment.slice(1) as keyof ModalRouteParams<TRoute>
      const value = params?.[name]
      if (typeof value !== 'string') {
        throw new ModalRouteError(
          'missing-parameter',
          `Modal route parameter "${String(name)}" is required.`
        )
      }
      return encodeURIComponent(value)
    })
    .join('/')
}
