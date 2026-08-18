import type { PaperDetail, PaperListItem, PaperNote } from '../../api/papers'

export type EvidenceBacklink = {
  evidenceId: 'evidence-abstract' | 'evidence-categories' | 'evidence-metadata'
  label: string
  snippet: string
}

export type WorkspacePapersApi = {
  listPapers: () => Promise<PaperListItem[]>
  getPaper: (arxivId: string) => Promise<PaperDetail>
  importArxivPaper: (reference: string) => Promise<PaperDetail>
  savePaperNote: (arxivId: string, markdown: string) => Promise<PaperNote>
}
