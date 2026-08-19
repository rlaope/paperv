import { invoke } from '@tauri-apps/api/core'
import { z } from 'zod'

export const generationProviderSchema = z.enum(['claude_code', 'codex_cli'])
export const generationLevelSchema = z.enum(['translate_structure', 'explain_simply', 'technical_deep_dive', 'technical_polish'])
export const outputLanguageSchema = z.enum(['english', 'korean'])
export const generationSourceKindSchema = z.enum(['abstract', 'document', 'document_selection'])
export const generationErrorCodeSchema = z.enum([
  'invalid_request', 'paper_not_found', 'source_unavailable', 'source_conflict', 'source_empty', 'input_too_large',
  'provider_not_installed', 'provider_executable_rejected', 'provider_version_unsupported', 'provider_auth_required',
  'provider_auth_probe_failed', 'provider_capability_unsupported', 'provider_isolation_unsupported', 'provider_busy',
  'provider_spawn_failed', 'provider_stdin_failed', 'provider_output_limit', 'provider_timeout',
  'provider_termination_failed', 'provider_exit_nonzero', 'provider_protocol_invalid', 'provider_policy_violation',
  'result_empty', 'result_too_large', 'result_preservation_failed', 'run_not_found', 'internal_unavailable'
])

const timestampSchema = z.string().datetime({ offset: true })
const arxivIdSchema = z.string().regex(/^(?:\d{4}\.\d{4,5}|[a-z0-9-]+(?:\.[A-Z]{2})?\/\d{7})$/u)
const runIdSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+(?:-[A-Za-z0-9_-]+)*$/u)
const documentIdSchema = z.string().min(1).max(128).refine((value) => value.trim() === value)
export const providerVersionSchema = z.string().min(1).max(128).refine((value) => (
  !value.includes('/')
  && !value.includes('\\')
  && [...value].every((character) => {
    const code = character.charCodeAt(0)
    return code >= 32 && code !== 127
  })
)).nullable()

const installationSchema = z.enum(['missing', 'rejected', 'installed'])
const capabilitySchema = z.enum(['supported', 'unsupported'])
const overallSchema = z.enum(['ready', 'blocked'])
const claudeReadinessBlockerSchema = z.enum([
  'provider_not_installed',
  'provider_executable_rejected',
  'provider_version_unsupported',
  'provider_auth_required',
  'provider_auth_probe_failed'
])

const claudeReadinessSchema = z.object({
  provider: z.literal('claude_code'),
  displayName: z.literal('Claude Code'),
  integration: z.literal('generation'),
  installation: installationSchema,
  authentication: z.enum(['authenticated', 'unauthenticated', 'indeterminate']),
  capability: capabilitySchema,
  overall: overallSchema,
  blocker: claudeReadinessBlockerSchema.nullable(),
  version: providerVersionSchema
}).strict().superRefine((row, context) => {
  const impossible = (message: string) => context.addIssue({ code: 'custom', message })
  if (row.overall === 'ready' && (
    row.installation !== 'installed'
    || row.authentication !== 'authenticated'
    || row.capability !== 'supported'
    || row.blocker !== null
    || row.version === null
  )) impossible('Ready Claude Code must satisfy every readiness dimension')
  if (row.overall === 'blocked' && row.blocker === null) impossible('Blocked Claude Code must name a closed blocker')
  if (row.installation !== 'installed' && (
    row.authentication === 'authenticated'
    || row.capability === 'supported'
    || row.version !== null
  )) impossible('Unavailable Claude Code cannot be authenticated, capable, or versioned')
  if (row.capability === 'supported' && (row.installation !== 'installed' || row.version === null)) {
    impossible('Supported Claude Code must be installed with a bounded version')
  }
  if (row.blocker === 'provider_not_installed' && row.installation !== 'missing') {
    impossible('Missing-provider blocker requires a missing installation')
  }
  if (row.blocker === 'provider_executable_rejected' && row.installation !== 'rejected') {
    impossible('Rejected-executable blocker requires a rejected installation')
  }
  if (row.blocker === 'provider_version_unsupported' && (
    row.installation !== 'installed'
    || row.authentication !== 'indeterminate'
    || row.capability !== 'unsupported'
  )) impossible('Version blocker requires an installed but unsupported provider')
  if (row.blocker === 'provider_auth_required' && (
    row.installation !== 'installed'
    || row.authentication !== 'unauthenticated'
    || row.capability !== 'supported'
    || row.version === null
  )) impossible('Authentication blocker requires a supported signed-out provider')
  if (row.blocker === 'provider_auth_probe_failed' && (
    row.installation !== 'installed'
    || row.authentication !== 'indeterminate'
    || row.capability !== 'supported'
    || row.version === null
  )) impossible('Authentication probe blocker requires a supported provider')
})

const codexReadinessSchema = z.object({
  provider: z.literal('codex_cli'),
  displayName: z.literal('Codex CLI'),
  integration: z.literal('discovery_only'),
  installation: installationSchema,
  authentication: z.literal('not_checked'),
  capability: z.literal('unsupported'),
  overall: z.literal('blocked'),
  blocker: generationErrorCodeSchema,
  version: z.null()
}).strict().superRefine((row, context) => {
  const expectedBlocker = row.installation === 'missing'
    ? 'provider_not_installed'
    : row.installation === 'rejected'
      ? 'provider_executable_rejected'
      : 'provider_capability_unsupported'
  if (row.blocker !== expectedBlocker) {
    context.addIssue({ code: 'custom', message: 'Codex discovery blocker must match installation state' })
  }
})

export const generationReadinessSchema = z.object({
  checkedAt: timestampSchema,
  providers: z.tuple([claudeReadinessSchema, codexReadinessSchema])
}).strict()

const sourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('abstract') }).strict(),
  z.object({ kind: z.literal('document'), documentId: documentIdSchema, expectedRevision: z.number().int().min(1) }).strict(),
  z.object({
    kind: z.literal('document_selection'), documentId: documentIdSchema, expectedRevision: z.number().int().min(1),
    startUtf8: z.number().int().nonnegative(), endUtf8: z.number().int().positive()
  }).strict().refine((source) => source.endUtf8 > source.startUtf8, 'Selection must be non-empty')
])

const requestSchema = z.string()
  .transform((value) => value.trim())
  .refine((value) => value.length > 0, 'Request must not be empty')
  .refine((value) => new TextEncoder().encode(value).byteLength <= 4_096, 'Request is too large')
  .refine((value) => [...value].every((character) => {
    const code = character.charCodeAt(0)
    return (code >= 32 && code !== 127) || character === '\n' || character === '\r' || character === '\t'
  }), 'Request contains a control character')

export const generationInputSchema = z.object({
  paperId: arxivIdSchema,
  provider: generationProviderSchema,
  request: requestSchema,
  source: sourceSchema
}).strict()

const successCommon = {
  status: z.literal('succeeded'),
  markdown: z.string().min(1).refine((value) => new TextEncoder().encode(value).byteLength <= 131_072),
  paperId: arxivIdSchema,
  provider: generationProviderSchema,
  providerVersion: providerVersionSchema.unwrap(),
  level: generationLevelSchema,
  outputLanguage: outputLanguageSchema,
  generatedAt: timestampSchema
}
const successSchema = z.discriminatedUnion('sourceKind', [
  z.object({ ...successCommon, sourceKind: z.literal('abstract'), sourceDocumentId: z.null(), sourceRevision: z.null(), selectionStartUtf8: z.null(), selectionEndUtf8: z.null() }).strict(),
  z.object({ ...successCommon, sourceKind: z.literal('document'), sourceDocumentId: documentIdSchema, sourceRevision: z.number().int().min(1), selectionStartUtf8: z.null(), selectionEndUtf8: z.null() }).strict(),
  z.object({ ...successCommon, sourceKind: z.literal('document_selection'), sourceDocumentId: documentIdSchema, sourceRevision: z.number().int().min(1), selectionStartUtf8: z.number().int().nonnegative(), selectionEndUtf8: z.number().int().positive() }).strict().refine((value) => value.selectionEndUtf8 > value.selectionStartUtf8, 'Selection must be non-empty')
]).superRefine((result, context) => {
  if (result.level === 'technical_polish' && result.sourceKind === 'abstract') {
    context.addIssue({ code: 'custom', path: ['sourceKind'], message: 'Technical polish cannot use abstract provenance' })
  }
})
export const generationRunSchema = z.union([
  z.object({ status: z.literal('running') }).strict(),
  successSchema,
  z.object({ status: z.literal('failed'), errorCode: generationErrorCodeSchema }).strict(),
  z.object({ status: z.literal('cancelled') }).strict()
])
const cancelSchema = z.object({ status: z.enum(['cancel_requested', 'already_terminal', 'run_not_found']) }).strict()

export type GenerationProvider = z.infer<typeof generationProviderSchema>
export type GenerationLevel = z.infer<typeof generationLevelSchema>
export type OutputLanguage = z.infer<typeof outputLanguageSchema>
export type GenerationErrorCode = z.infer<typeof generationErrorCodeSchema>
export type GenerationReadiness = z.infer<typeof generationReadinessSchema>
export type GenerationInput = z.infer<typeof generationInputSchema>
export type GenerationRun = z.infer<typeof generationRunSchema>
export type GenerationSuccess = z.infer<typeof successSchema>

export class GenerationApiError extends Error {
  constructor(public readonly code: GenerationErrorCode) {
    super(code)
    this.name = 'GenerationApiError'
  }
}

function closedError(error: unknown): GenerationApiError {
  const candidate = typeof error === 'string'
    ? error
    : error && typeof error === 'object' && 'code' in error ? (error as { code: unknown }).code : undefined
  const parsed = generationErrorCodeSchema.safeParse(candidate)
  return new GenerationApiError(parsed.success ? parsed.data : 'internal_unavailable')
}

async function invokeParsed<T>(command: string, payload: Record<string, unknown> | undefined, schema: z.ZodType<T>): Promise<T> {
  try {
    const output = payload === undefined ? await invoke(command) : await invoke(command, payload)
    return schema.parse(output)
  } catch (error) {
    throw error instanceof GenerationApiError ? error : closedError(error)
  }
}

export function generationGetReadiness(): Promise<GenerationReadiness> {
  return invokeParsed('generation_get_readiness', undefined, generationReadinessSchema)
}

export async function generationStart(input: GenerationInput): Promise<{ runId: string }> {
  if (typeof input?.request === 'string' && new TextEncoder().encode(input.request.trim()).byteLength > 4_096) {
    throw new GenerationApiError('input_too_large')
  }
  let parsed: GenerationInput
  try {
    parsed = generationInputSchema.parse(input)
  } catch {
    throw new GenerationApiError('invalid_request')
  }
  try {
    return z.object({ runId: runIdSchema }).strict().parse(await invoke('generation_start', { input: parsed }))
  } catch (error) { throw closedError(error) }
}

export function generationGetRun(runId: string): Promise<GenerationRun> {
  return invokeParsed('generation_get_run', { runId: runIdSchema.parse(runId) }, generationRunSchema)
}

export function generationCancel(runId: string): Promise<z.infer<typeof cancelSchema>> {
  return invokeParsed('generation_cancel', { runId: runIdSchema.parse(runId) }, cancelSchema)
}
