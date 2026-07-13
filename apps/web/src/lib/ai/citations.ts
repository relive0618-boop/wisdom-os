import { ReportSchema, type Report, type RetrievalResult } from "@wisdom/shared";

export function validateCitationProvenance(report: Report, retrieved: RetrievalResult): Report | null {
  const knowledgeById = new Map(retrieved.knowledge.map((item) => [item.id, item]));
  const validCitations = report.citations.filter((citation) => {
    const source = knowledgeById.get(citation.id);
    return Boolean(
      source &&
        citation.chapter === source.chapter &&
        citation.title === source.title &&
        citation.source === source.source,
    );
  });

  if (validCitations.length < 2) return null;
  return ReportSchema.parse({ ...report, citations: validCitations });
}
