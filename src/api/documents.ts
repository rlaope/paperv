import { invoke } from '@tauri-apps/api/core'
import { z } from 'zod'

const timestamp = z.string().datetime({ offset: true })
const id = z.string().min(1).max(128).refine((value) => value.trim() === value)
const arxivId = z.string().regex(/^(?:\d{4}\.\d{4,5}|[a-z0-9-]+(?:\.[A-Z]{2})?\/\d{7})$/u)
const title = z.string().min(1).refine((value) => value.trim() === value && new TextEncoder().encode(value).byteLength <= 255)
const markdown = z.string().refine((value) => new TextEncoder().encode(value).byteLength <= 262_144)
const revision = z.number().int().min(1)
export const documentListItemSchema = z.object({ id, title, revision, updatedAt: timestamp }).strict()
export const documentSchema = documentListItemSchema.extend({ markdown, createdAt: timestamp }).strict()
export const documentPropertiesSchema = z.object({
  documentId: id,
  papers: z.array(z.object({ arxivId, title: z.string().min(1).max(4096), createdAt: timestamp }).strict()),
  artifacts: z.array(z.object({ artifactId: id, paperArxivId: arxivId, createdAt: timestamp }).strict())
}).strict()
const createInput = z.object({ title, markdown }).strict()
const updateInput = z.object({ documentId: id, expectedRevision: revision, title, markdown }).strict()
const documentInput = z.object({ documentId: id }).strict()
const paperLinkInput = z.object({ documentId: id, paperId: arxivId }).strict()
const artifactLinkInput = z.object({ documentId: id, artifactId: id }).strict()

export type MarkdownDocument = z.infer<typeof documentSchema>
export type DocumentListItem = z.infer<typeof documentListItemSchema>
export type DocumentProperties = z.infer<typeof documentPropertiesSchema>
export type DocumentCreateInput = z.infer<typeof createInput>
export type DocumentUpdateInput = z.infer<typeof updateInput>
export const documentsErrorCodeSchema = z.enum(['invalid_input','document_not_found','artifact_not_found','paper_not_found','document_conflict','duplicate_link','link_not_found','byte_limit','storage_unavailable','internal_unavailable'])
export class DocumentsApiError extends Error { constructor(public readonly code: z.infer<typeof documentsErrorCodeSchema>) { super(code); this.name = 'DocumentsApiError' } }
function close(error: unknown): DocumentsApiError { const value = typeof error === 'string' ? error : error && typeof error === 'object' && 'code' in error ? (error as { code: unknown }).code : undefined; const parsed = documentsErrorCodeSchema.safeParse(value); return new DocumentsApiError(parsed.success ? parsed.data : 'internal_unavailable') }
async function call<T>(command: string, payload: Record<string, unknown> | undefined, schema: z.ZodType<T>): Promise<T> { try { return schema.parse(payload ? await invoke(command, payload) : await invoke(command)) } catch (error) { throw error instanceof DocumentsApiError ? error : close(error) } }
export const documentList = () => call('document_list', undefined, z.array(documentListItemSchema))
export const documentGet = (documentId: string) => call('document_get', { documentId: id.parse(documentId) }, documentSchema)
export const documentCreate = async (input: DocumentCreateInput) => { try { return await call('document_create', { input: createInput.parse(input) }, documentSchema) } catch (error) { throw error instanceof DocumentsApiError ? error : new DocumentsApiError('invalid_input') } }
export const documentUpdate = async (input: DocumentUpdateInput) => {
  let parsed: DocumentUpdateInput
  try { parsed = updateInput.parse(input) } catch { throw new DocumentsApiError('invalid_input') }
  try { return documentSchema.parse(await invoke('document_update', { input: parsed })) } catch (error) { throw close(error) }
}
export const documentDelete = (input: { documentId: string }) => call('document_delete', { input: documentInput.parse(input) }, z.null())
export const documentGetProperties = (documentId: string) => call('document_get_properties', { documentId: id.parse(documentId) }, documentPropertiesSchema)
export const documentLinkPaper = (input: z.infer<typeof paperLinkInput>) => call('document_link_paper', { input: paperLinkInput.parse(input) }, z.null())
export const documentUnlinkPaper = (input: z.infer<typeof paperLinkInput>) => call('document_unlink_paper', { input: paperLinkInput.parse(input) }, z.null())
export const documentLinkArtifact = (input: z.infer<typeof artifactLinkInput>) => call('document_link_artifact', { input: artifactLinkInput.parse(input) }, z.null())
export const documentUnlinkArtifact = (input: z.infer<typeof artifactLinkInput>) => call('document_unlink_artifact', { input: artifactLinkInput.parse(input) }, z.null())
