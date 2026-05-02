import { db, capabilitiesTable } from "@workspace/db";
import { sql } from "drizzle-orm";

const CAPABILITIES = [
  { slug: "data-extraction", name: "Data Extraction", category: "Data", description: "Extract structured data from unstructured sources like PDFs, HTML, or raw text." },
  { slug: "data-transformation", name: "Data Transformation", category: "Data", description: "Clean, normalize, and reshape datasets into desired formats." },
  { slug: "web-scraping", name: "Web Scraping", category: "Data", description: "Programmatically collect data from websites and APIs." },
  { slug: "code-generation", name: "Code Generation", category: "Engineering", description: "Write production-ready code in one or more programming languages." },
  { slug: "code-review", name: "Code Review", category: "Engineering", description: "Analyze codebases for bugs, security issues, and style violations." },
  { slug: "test-writing", name: "Test Writing", category: "Engineering", description: "Generate unit, integration, and end-to-end test suites." },
  { slug: "image-analysis", name: "Image Analysis", category: "Vision", description: "Classify, caption, and extract information from images." },
  { slug: "ocr", name: "OCR", category: "Vision", description: "Convert scanned documents and images into machine-readable text." },
  { slug: "document-summarization", name: "Document Summarization", category: "Language", description: "Produce concise, accurate summaries of long documents." },
  { slug: "translation", name: "Translation", category: "Language", description: "Translate text accurately between languages." },
  { slug: "content-writing", name: "Content Writing", category: "Language", description: "Produce high-quality written content for blogs, marketing, and documentation." },
  { slug: "customer-support", name: "Customer Support", category: "Operations", description: "Handle customer inquiries, triage issues, and draft responses." },
  { slug: "legal-research", name: "Legal Research", category: "Professional", description: "Research case law, statutes, and legal precedents." },
  { slug: "contract-analysis", name: "Contract Analysis", category: "Professional", description: "Review and summarize contract terms, risks, and obligations." },
  { slug: "financial-modeling", name: "Financial Modeling", category: "Finance", description: "Build and evaluate financial projections and valuation models." },
  { slug: "sentiment-analysis", name: "Sentiment Analysis", category: "Analytics", description: "Classify the sentiment and tone of text at scale." },
  { slug: "research-synthesis", name: "Research Synthesis", category: "Analytics", description: "Aggregate and synthesize findings from multiple research sources." },
  { slug: "sql-querying", name: "SQL Querying", category: "Data", description: "Write and optimize SQL queries against relational databases." },
  { slug: "api-integration", name: "API Integration", category: "Engineering", description: "Connect and orchestrate third-party REST or GraphQL APIs." },
  { slug: "workflow-automation", name: "Workflow Automation", category: "Operations", description: "Design and execute multi-step automated workflows." },
];

export async function seedCapabilities(): Promise<void> {
  const existing = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(capabilitiesTable);
  const count = existing[0]?.count ?? 0;
  if (count >= CAPABILITIES.length) return;

  await db
    .insert(capabilitiesTable)
    .values(CAPABILITIES)
    .onConflictDoNothing();
}
