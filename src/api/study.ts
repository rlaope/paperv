import { invoke } from '@tauri-apps/api/core'
import { z } from 'zod'
import { generationLevelSchema, generationProviderSchema, outputLanguageSchema, providerVersionSchema } from './generation'
const timestamp = z.string().datetime({ offset: true })
const id = z.string().min(1).max(128).refine((value) => value.trim() === value)
const arxivId = z.string().regex(/^(?:\d{4}\.\d{4,5}|[a-z0-9-]+(?:\.[A-Z]{2})?\/\d{7})$/u)
const backlinkSchema = z.object({ documentId:id, title:z.string().min(1).max(255), createdAt:timestamp }).strict()
export const studySchema = z.object({ paperId:arxivId, createdAt:timestamp, updatedAt:timestamp, backlinks:z.array(backlinkSchema) }).strict()
const artifactCommon = {
  id, paperId:arxivId, provider:generationProviderSchema, providerVersion:providerVersionSchema,
  level:generationLevelSchema, outputLanguage:outputLanguageSchema,
  markdown:z.string().min(1).refine((value)=>new TextEncoder().encode(value).byteLength<=131_072),
  generatedAt:timestamp, savedAt:timestamp, backlinks:z.array(backlinkSchema)
}
export const studyArtifactSchema = z.discriminatedUnion('sourceKind', [
  z.object({ ...artifactCommon, sourceKind:z.literal('abstract'), sourceDocumentId:z.null(), sourceDocumentSnapshotId:z.null(), sourceRevision:z.null(), selectionStartUtf8:z.null(), selectionEndUtf8:z.null() }).strict(),
  z.object({ ...artifactCommon, sourceKind:z.literal('document'), sourceDocumentId:id.nullable(), sourceDocumentSnapshotId:id, sourceRevision:z.number().int().min(1), selectionStartUtf8:z.null(), selectionEndUtf8:z.null() }).strict(),
  z.object({ ...artifactCommon, sourceKind:z.literal('document_selection'), sourceDocumentId:id.nullable(), sourceDocumentSnapshotId:id, sourceRevision:z.number().int().min(1), selectionStartUtf8:z.number().int().nonnegative(), selectionEndUtf8:z.number().int().positive() }).strict().refine((value)=>value.selectionEndUtf8>value.selectionStartUtf8,'Selection must be non-empty')
]).superRefine((artifact, context) => {
  if (artifact.level === 'technical_polish' && artifact.sourceKind === 'abstract') {
    context.addIssue({ code: 'custom', path: ['sourceKind'], message: 'Technical polish cannot use abstract provenance' })
  }
})
export const artifactSaveInputSchema = z.object({ paperId:arxivId, runId:id }).strict()
export type StudyView = z.infer<typeof studySchema>
export type StudyArtifact = z.infer<typeof studyArtifactSchema>
export type StudyArtifactSaveInput = z.infer<typeof artifactSaveInputSchema>
export const studyErrorCodeSchema = z.enum(['invalid_input','paper_not_found','document_not_found','artifact_not_found','document_conflict','byte_limit','storage_unavailable','internal_unavailable'])
export class StudyApiError extends Error { constructor(public readonly code:z.infer<typeof studyErrorCodeSchema>){super(code);this.name='StudyApiError'} }
export function studyApiErrorFrom(error:unknown):StudyApiError{const candidate=typeof error==='string'?error:error&&typeof error==='object'&&'code' in error?(error as {code:unknown}).code:undefined;const parsed=studyErrorCodeSchema.safeParse(candidate);return new StudyApiError(parsed.success?parsed.data:'internal_unavailable')}
async function call<T>(command:string,payload:Record<string,unknown>,schema:z.ZodType<T>):Promise<T>{return Promise.resolve().then(()=>invoke(command,payload)).then((value)=>schema.parse(value)).catch((error:unknown)=>{throw studyApiErrorFrom(error)})}
function parseInput<T>(schema:z.ZodType<T>,value:unknown):T{try{return schema.parse(value)}catch{throw new StudyApiError('invalid_input')}}
export const studyGet=(paperId:string)=>call('study_get',{paperId:parseInput(arxivId,paperId)},studySchema)
export const studyListArtifacts=(paperId:string)=>call('study_list_artifacts',{paperId:parseInput(arxivId,paperId)},z.array(studyArtifactSchema))
export const studySaveArtifact=(input:StudyArtifactSaveInput)=>call('study_save_artifact',{input:parseInput(artifactSaveInputSchema,input)},studyArtifactSchema)
export const studyDeleteArtifact=(artifactId:string)=>call('study_delete_artifact',{artifactId:parseInput(id,artifactId)},z.null())
