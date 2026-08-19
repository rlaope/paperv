import type { DocumentCreateInput, DocumentListItem, DocumentProperties, DocumentUpdateInput, MarkdownDocument } from '../../api/documents'
import type { GenerationInput, GenerationReadiness, GenerationRun } from '../../api/generation'
import type { PaperDetail, PaperListItem } from '../../api/papers'
import type { StudyArtifact, StudyArtifactSaveInput } from '../../api/study'

export type WorkspacePapersApi = {
  listPapers: () => Promise<PaperListItem[]>
  getPaper: (arxivId: string) => Promise<PaperDetail>
  importArxivPaper: (reference: string) => Promise<PaperDetail>
}
export type WorkspaceDocumentsApi = {
  list: () => Promise<DocumentListItem[]>
  get: (documentId: string) => Promise<MarkdownDocument>
  create: (input: DocumentCreateInput) => Promise<MarkdownDocument>
  update: (input: DocumentUpdateInput) => Promise<MarkdownDocument>
  delete: (input: { documentId: string }) => Promise<null>
  getProperties: (documentId: string) => Promise<DocumentProperties>
  linkPaper: (input: { documentId: string; paperId: string }) => Promise<null>
  unlinkPaper: (input: { documentId: string; paperId: string }) => Promise<null>
  linkArtifact: (input: { documentId: string; artifactId: string }) => Promise<null>
  unlinkArtifact: (input: { documentId: string; artifactId: string }) => Promise<null>
}
export type WorkspaceStudyApi = {
  get: (paperId: string) => Promise<{ paperId: string; createdAt: string; updatedAt: string; backlinks: { documentId: string; title: string; createdAt: string }[] }>
  listArtifacts: (paperId: string) => Promise<StudyArtifact[]>
  saveArtifact: (input: StudyArtifactSaveInput) => Promise<StudyArtifact>
  deleteArtifact: (artifactId: string) => Promise<null>
}
export type WorkspaceGenerationApi = {
  getReadiness: () => Promise<GenerationReadiness>
  start: (input: GenerationInput) => Promise<{ runId: string }>
  getRun: (runId: string) => Promise<GenerationRun>
  cancel: (runId: string) => Promise<{ status: 'cancel_requested' | 'already_terminal' | 'run_not_found' }>
}
export type WorkspaceApis = { papers: WorkspacePapersApi; documents: WorkspaceDocumentsApi; study: WorkspaceStudyApi; generation: WorkspaceGenerationApi }
export type Activity = 'library' | 'vault'
export type OpenTab = { key: `study:${string}`; kind: 'study'; paperId: string } | { key: `document:${string}`; kind: 'document'; documentId: string }
