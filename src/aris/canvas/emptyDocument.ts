/**
 * Working documents and models created from nothing — Plan Section 11.6
 * ("A user can author a complete EPC manually").
 *
 * ## Seam note: there is no `createModel` command
 *
 * The Phase 5 command system (`src/aris/model/commands.ts`) exposes 24 command
 * kinds, none of which creates or deletes a *model*. Model creation is
 * therefore a document-construction operation performed before the command
 * stack exists, not an undoable edit. That is deliberate here: the canvas boots
 * against a document that already contains its model(s), and everything the
 * user does afterwards flows through commands. If Phase 8 later needs undoable
 * model creation, the model lane has to add the command kind — this lane does
 * not mutate documents behind the command system's back.
 */

import type {
  ArisDatabase,
  ArisLayoutState,
  ArisLocalizedValue,
  ArisModel,
  ArisSourceIndexLike,
  ArisStyleCatalog,
  ArisSupportedModelType,
  ArisWorkingDocument
} from '../model/types'

/** Locale used when the caller does not specify one. */
export const DEFAULT_LOCALE_ID = 'en-US'

const EMPTY_MAP = Object.freeze(new Map())

/**
 * A source index describing "no imported source at all".
 *
 * Documents built here have never been imported, so every record collection is
 * empty. The shape still satisfies `ArisSourceIndexLike` so the working
 * document type is honoured exactly and the writer lane can tell an authored
 * document from an imported one by its empty index.
 */
export const EMPTY_ARIS_SOURCE_INDEX: ArisSourceIndexLike = Object.freeze({
  database: null,
  models: EMPTY_MAP,
  objectDefinitions: EMPTY_MAP,
  objectOccurrences: EMPTY_MAP,
  connectionDefinitions: EMPTY_MAP,
  connectionOccurrences: EMPTY_MAP,
  attributes: Object.freeze([]),
  attributeOccurrences: Object.freeze([]),
  lanes: EMPTY_MAP,
  freeText: EMPTY_MAP,
  freeTextOccurrences: Object.freeze([]),
  styles: Object.freeze({ fontStyleSheets: EMPTY_MAP }),
  unknownRecords: Object.freeze([]),
  routePoints: Object.freeze([])
})

export const EMPTY_ARIS_STYLE_CATALOG: ArisStyleCatalog = Object.freeze({ styles: EMPTY_MAP })

/** Default model layout state. Every number is integral (see `geometry.ts`). */
export const DEFAULT_LAYOUT_STATE: ArisLayoutState = Object.freeze({
  scale: 100,
  gridSize: 10,
  backColor: null,
  printScale: 100,
  curveRadius: null,
  arcRadius: null
})

export function localizedValue(text: string, localeId = DEFAULT_LOCALE_ID): ArisLocalizedValue {
  return Object.freeze({
    values: Object.freeze({ [localeId]: text }),
    fallback: text
  })
}

export const EMPTY_LOCALIZED_VALUE: ArisLocalizedValue = Object.freeze({
  values: Object.freeze({}),
  fallback: null
})

export interface CreateArisModelOptions {
  readonly id: string
  readonly type: ArisSupportedModelType
  readonly name?: string
  readonly localeId?: string
}

/** Build an empty model of a supported type. */
export function createEmptyArisModel(options: CreateArisModelOptions): ArisModel {
  return Object.freeze({
    id: options.id,
    type: options.type,
    names:
      options.name === undefined
        ? EMPTY_LOCALIZED_VALUE
        : localizedValue(options.name, options.localeId ?? DEFAULT_LOCALE_ID),
    attributes: Object.freeze([]),
    occurrences: Object.freeze([]),
    connectionOccurrences: Object.freeze([]),
    lanes: Object.freeze([]),
    freeText: Object.freeze([]),
    layout: DEFAULT_LAYOUT_STATE,
    unsupported: false,
    rawSourceRecord: null
  })
}

export interface CreateArisDocumentOptions {
  readonly models?: readonly ArisModel[]
  readonly databaseName?: string | null
}

/**
 * Build a working document that has no imported source behind it.
 *
 * `createDate`/`createTime`/`userName` are deliberately `null`: canonical
 * revision payloads must contain no timestamp or machine identity.
 */
export function createEmptyArisDocument(
  options: CreateArisDocumentOptions = {}
): ArisWorkingDocument {
  const database: ArisDatabase = Object.freeze({
    databaseName: options.databaseName ?? null,
    createDate: null,
    createTime: null,
    userName: null,
    arisExeVersion: null
  })
  const models = new Map<string, ArisModel>()
  for (const model of options.models ?? []) models.set(model.id, model)
  return Object.freeze({
    database,
    models: Object.freeze(models),
    objectDefinitions: EMPTY_MAP,
    connectionDefinitions: EMPTY_MAP,
    styleCatalog: EMPTY_ARIS_STYLE_CATALOG,
    sourceIndex: EMPTY_ARIS_SOURCE_INDEX,
    revision: 0
  })
}

/**
 * Convenience: a document holding exactly one empty model, ready to author.
 */
export function createEmptyArisCanvasDocument(
  options: {
    readonly modelId?: string
    readonly modelType?: ArisSupportedModelType
    readonly modelName?: string
    readonly databaseName?: string | null
  } = {}
): { readonly document: ArisWorkingDocument; readonly modelId: string } {
  const modelId = options.modelId ?? 'Model.1'
  const model = createEmptyArisModel({
    id: modelId,
    type: options.modelType ?? 'MT_EEPC',
    name: options.modelName
  })
  return Object.freeze({
    document: createEmptyArisDocument({
      models: [model],
      databaseName: options.databaseName ?? null
    }),
    modelId
  })
}

/**
 * Attach an additional model to a document.
 *
 * Document construction, not an edit — see the module header. Callers must do
 * this before the canvas takes ownership of the document.
 */
export function withAdditionalModel(
  document: ArisWorkingDocument,
  model: ArisModel
): ArisWorkingDocument {
  const models = new Map(document.models)
  models.set(model.id, model)
  return Object.freeze({ ...document, models: Object.freeze(models) })
}
