import { invoke } from '@tauri-apps/api/core'
import { z } from 'zod'

const rfc3339Schema = z.string().datetime({ offset: true })
const canonicalArxivIdSchema = z.string().regex(
  /^(?:\d{4}\.\d{4,5}|[a-z0-9-]+(?:\.[A-Z]{2})?\/\d{7})$/
)

export const paperNoteSchema = z.object({
  markdown: z.string().max(262_144),
  updatedAt: rfc3339Schema
}).strict()

export const paperListItemSchema = z.object({
  arxivId: canonicalArxivIdSchema,
  arxivVersion: z.number().int().min(1).max(999_999),
  title: z.string().min(1).max(4096),
  authors: z.array(z.string().min(1).max(512)).min(1).max(64),
  primaryCategory: z.string().min(1).max(512).nullable(),
  publishedAt: rfc3339Schema,
  metadataFetchedAt: rfc3339Schema
}).strict()

export const paperDetailSchema = paperListItemSchema.extend({
  summary: z.string().max(65_536),
  categories: z.array(z.string().min(1).max(512)).min(1).max(64),
  sourceUpdatedAt: rfc3339Schema,
  importedAt: rfc3339Schema,
  note: paperNoteSchema.nullable()
}).strict()

const importArxivPaperInputSchema = z.object({
  reference: z.string().min(1).max(64)
}).strict()
const savePaperNoteInputSchema = z.object({
  arxivId: canonicalArxivIdSchema,
  markdown: z.string().max(262_144)
}).strict()

export type PaperNote = z.infer<typeof paperNoteSchema>
export type PaperListItem = z.infer<typeof paperListItemSchema>
export type PaperDetail = z.infer<typeof paperDetailSchema>

export class PapersApiError extends Error {
  constructor(public readonly code: 'import_failed' | 'storage_failed') {
    super(code)
    this.name = 'PapersApiError'
  }
}

async function invokeAndParse<T>(
  command: string,
  payload: Record<string, unknown> | undefined,
  schema: z.ZodType<T>,
  errorCode: PapersApiError['code']
): Promise<T> {
  try {
    const result = payload === undefined
      ? await invoke(command)
      : await invoke(command, payload)
    return schema.parse(result)
  } catch {
    throw new PapersApiError(errorCode)
  }
}

export async function importArxivPaper(reference: string): Promise<PaperDetail> {
  const input = importArxivPaperInputSchema.parse({ reference })
  return invokeAndParse(
    'import_arxiv_paper',
    { input },
    paperDetailSchema,
    'import_failed'
  )
}

export async function listPapers(): Promise<PaperListItem[]> {
  return invokeAndParse('list_papers', undefined, z.array(paperListItemSchema), 'storage_failed')
}

export async function getPaper(arxivId: string): Promise<PaperDetail> {
  const input = canonicalArxivIdSchema.parse(arxivId)
  return invokeAndParse('get_paper', { arxivId: input }, paperDetailSchema, 'storage_failed')
}

export async function savePaperNote(arxivId: string, markdown: string): Promise<PaperNote> {
  const input = savePaperNoteInputSchema.parse({ arxivId, markdown })
  return invokeAndParse('save_paper_note', { input }, paperNoteSchema, 'storage_failed')
}
