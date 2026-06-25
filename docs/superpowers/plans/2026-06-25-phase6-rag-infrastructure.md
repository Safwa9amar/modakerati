# Phase 6: RAG Infrastructure — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the RAG infrastructure so AI chat has automatic access to relevant norms and source materials. Set up pgvector for semantic search, embed thesis sources on upload, retrieve relevant context per chat message, and inject it into the system prompt.

**Architecture:** Enable pgvector extension in Supabase. Add an embedding column to thesis_sources. Create a new `knowledge_chunks` table for norm exemplars. Build an embedding service using OpenRouter's embedding API. On each chat message, retrieve top-k relevant chunks and inject them into the system prompt before the tool loop runs.

**Tech Stack:** PostgreSQL pgvector, OpenRouter embeddings API, Drizzle ORM, Hono

**Working directory:** `~/modakerati-server`

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `src/db/index.ts` | Enable pgvector, add embedding columns, create knowledge_chunks table |
| Create | `src/db/knowledge.ts` | knowledge_chunks table definition |
| Create | `src/lib/embedding-service.ts` | Embed text via OpenRouter, similarity search |
| Create | `src/lib/rag-context.ts` | Build RAG context block for system prompt injection |
| Modify | `src/lib/source-service.ts` | Embed sources on upload |
| Modify | `src/routes/chat.ts` | Inject RAG context before tool loop |
| Modify | `src/lib/ai/types.ts` | Accept ragContext param in system prompt builder |
| Create | `src/lib/knowledge-seed.ts` | Seed knowledge chunks with Algerian thesis norms |
| Create | `src/__tests__/rag-context.test.ts` | Tests for context building |

---

### Task 1: Create knowledge_chunks table + enable pgvector

**Files:**
- Create: `src/db/knowledge.ts`
- Modify: `src/db/index.ts`

#### src/db/knowledge.ts:
```typescript
import { pgTable, uuid, text, integer, timestamp, index } from "drizzle-orm/pg-core";

// Knowledge chunks for RAG — norms, exemplar sections, guidelines.
// Each chunk is a self-contained piece of knowledge with an embedding
// for semantic similarity search.
export const knowledgeChunks = pgTable("knowledge_chunks", {
  id: uuid("id").primaryKey().defaultRandom(),
  category: text("category").notNull(),         // "norm" | "exemplar" | "guideline"
  language: text("language").notNull(),          // fr | ar | en
  discipline: text("discipline"),                // science | law-humanities | generic | null
  university: text("university"),                // specific university or null (generic)
  title: text("title").notNull(),                // short label for the chunk
  content: text("content").notNull(),            // the actual text content
  metadata: text("metadata"),                    // optional JSON string for extra context
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});
```

Note: The embedding column is added via raw SQL in ensureSchema since Drizzle doesn't have native pgvector support.

#### src/db/index.ts additions:

Add import and re-export:
```typescript
import { knowledgeChunks } from "./knowledge";
export * from "./knowledge";
```

Add to ensureSchema SQL:
```sql
    CREATE EXTENSION IF NOT EXISTS vector;

    CREATE TABLE IF NOT EXISTS knowledge_chunks (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      category text NOT NULL,
      language text NOT NULL,
      discipline text,
      university text,
      title text NOT NULL,
      content text NOT NULL,
      metadata text,
      embedding vector(1536),
      created_at timestamptz DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_knowledge_embedding
      ON knowledge_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 10);

    ALTER TABLE thesis_sources ADD COLUMN IF NOT EXISTS embedding vector(1536);
```

Commit: `git commit -m "feat: knowledge_chunks table + pgvector extension for RAG"`

---

### Task 2: Create embedding service

**Files:**
- Create: `src/lib/embedding-service.ts`

```typescript
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

const EMBEDDING_MODEL = "openai/text-embedding-3-small";

// Embed a single text string → vector
export async function embedText(text: string): Promise<number[]> {
  // Truncate to ~8000 tokens (~32000 chars) to stay within model limits
  const truncated = text.slice(0, 32000);
  const response = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input: truncated,
  });
  return response.data[0].embedding;
}

// Embed multiple texts in batch
export async function embedTexts(texts: string[]): Promise<number[][]> {
  const truncated = texts.map((t) => t.slice(0, 32000));
  const response = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input: truncated,
  });
  return response.data.map((d) => d.embedding);
}

// Find similar chunks by cosine similarity using pgvector
export async function findSimilarChunks(
  pool: any,
  queryEmbedding: number[],
  opts: {
    table: "knowledge_chunks" | "thesis_sources";
    thesisId?: string;       // filter for thesis_sources
    language?: string;
    discipline?: string;
    limit?: number;
  }
): Promise<Array<{ id: string; title: string; content: string; score: number }>> {
  const { table, thesisId, language, discipline, limit = 5 } = opts;
  const vec = `[${queryEmbedding.join(",")}]`;

  let query: string;
  const params: any[] = [vec, limit];

  if (table === "thesis_sources") {
    query = `
      SELECT id, title, extracted_text AS content,
             1 - (embedding <=> $1::vector) AS score
      FROM thesis_sources
      WHERE embedding IS NOT NULL
        ${thesisId ? `AND thesis_id = $${params.push(thesisId)}` : ""}
      ORDER BY embedding <=> $1::vector
      LIMIT $2
    `;
  } else {
    query = `
      SELECT id, title, content,
             1 - (embedding <=> $1::vector) AS score
      FROM knowledge_chunks
      WHERE embedding IS NOT NULL
        ${language ? `AND language = $${params.push(language)}` : ""}
        ${discipline ? `AND (discipline = $${params.push(discipline)} OR discipline IS NULL)` : ""}
      ORDER BY embedding <=> $1::vector
      LIMIT $2
    `;
  }

  const result = await pool.query(query, params);
  return result.rows;
}
```

Commit: `git commit -m "feat: embedding service — embed text + similarity search via pgvector"`

---

### Task 3: Create RAG context builder + tests

**Files:**
- Create: `src/lib/rag-context.ts`
- Create: `src/__tests__/rag-context.test.ts`

#### src/__tests__/rag-context.test.ts:
```typescript
import { describe, it, expect } from "vitest";
import { buildRagContextBlock } from "../lib/rag-context";

describe("buildRagContextBlock", () => {
  it("formats knowledge chunks into a context block", () => {
    const chunks = [
      { id: "1", title: "Font requirements", content: "Use Times New Roman 12pt", score: 0.92 },
      { id: "2", title: "Margin requirements", content: "Binding side 3.5cm", score: 0.87 },
    ];
    const sources = [
      { id: "3", title: "Reference paper", content: "This paper discusses...", score: 0.85 },
    ];
    const result = buildRagContextBlock(chunks, sources);
    expect(result).toContain("RELEVANT NORMS & GUIDELINES");
    expect(result).toContain("Times New Roman 12pt");
    expect(result).toContain("RELEVANT SOURCE MATERIALS");
    expect(result).toContain("Reference paper");
  });

  it("returns empty string when no chunks or sources", () => {
    const result = buildRagContextBlock([], []);
    expect(result).toBe("");
  });

  it("truncates long content", () => {
    const chunks = [
      { id: "1", title: "Long chunk", content: "A".repeat(2000), score: 0.9 },
    ];
    const result = buildRagContextBlock(chunks, []);
    expect(result.length).toBeLessThan(2000);
  });
});
```

#### src/lib/rag-context.ts:
```typescript
interface RagChunk {
  id: string;
  title: string;
  content: string;
  score: number;
}

const MAX_CHUNK_LENGTH = 800;
const MIN_SCORE = 0.7;

export function buildRagContextBlock(
  knowledgeChunks: RagChunk[],
  sourceChunks: RagChunk[]
): string {
  const relevantKnowledge = knowledgeChunks.filter((c) => c.score >= MIN_SCORE);
  const relevantSources = sourceChunks.filter((c) => c.score >= MIN_SCORE);

  if (relevantKnowledge.length === 0 && relevantSources.length === 0) return "";

  const parts: string[] = [];

  if (relevantKnowledge.length > 0) {
    parts.push("## RELEVANT NORMS & GUIDELINES\n");
    for (const chunk of relevantKnowledge) {
      const content = chunk.content.length > MAX_CHUNK_LENGTH
        ? chunk.content.slice(0, MAX_CHUNK_LENGTH) + "..."
        : chunk.content;
      parts.push(`### ${chunk.title}\n${content}\n`);
    }
  }

  if (relevantSources.length > 0) {
    parts.push("## RELEVANT SOURCE MATERIALS\n");
    for (const chunk of relevantSources) {
      const content = chunk.content.length > MAX_CHUNK_LENGTH
        ? chunk.content.slice(0, MAX_CHUNK_LENGTH) + "..."
        : chunk.content;
      parts.push(`### ${chunk.title}\n${content}\n`);
    }
  }

  return parts.join("\n");
}
```

Commit: `git commit -m "feat: RAG context builder with tests"`

---

### Task 4: Seed knowledge chunks with Algerian thesis norms

**Files:**
- Create: `src/lib/knowledge-seed.ts`
- Modify: `src/db/index.ts` (add seedKnowledge to startup)

Create norm knowledge chunks from the researched Algerian thesis norms. These are the "Norms + exemplars" from the pipeline diagram.

#### src/lib/knowledge-seed.ts:
```typescript
export interface KnowledgeChunkSeed {
  category: string;
  language: string;
  discipline: string | null;
  university: string | null;
  title: string;
  content: string;
}

export const KNOWLEDGE_SEEDS: KnowledgeChunkSeed[] = [
  // French thesis structure
  {
    category: "norm",
    language: "fr",
    discipline: null,
    university: null,
    title: "Structure d'un memoire (francais)",
    content: `Un memoire de master en francais doit suivre cette structure:
1. Page de garde (universite, faculte, departement, titre, encadreur, annee)
2. Dedicaces et remerciements
3. Resume en 3 langues (arabe obligatoire + francais + anglais, ~200 mots, 5-6 mots-cles)
4. Liste des abreviations
5. Liste des tableaux / Liste des figures
6. Table des matieres
7. Introduction generale
8. Corps du memoire (parties et chapitres)
9. Conclusion et perspectives
10. Bibliographie (style APA)
11. Annexes`,
  },
  {
    category: "norm",
    language: "fr",
    discipline: "science",
    university: null,
    title: "Structure IMRAD pour memoires scientifiques",
    content: `Les memoires scientifiques suivent la structure IMRAD:
- Partie I: Synthese Bibliographique (etat de l'art, revue de litterature)
- Partie II: Materiel et Methodes (protocole experimental, outils, methodologie)
- Partie III: Resultats et Discussion (presentation des donnees, analyse, interpretation)
Chaque partie contient des chapitres numerotes. Les figures et tableaux sont numerotes par chapitre.`,
  },
  {
    category: "norm",
    language: "fr",
    discipline: null,
    university: null,
    title: "Mise en page memoire francais",
    content: `Regles de mise en page pour un memoire en francais:
- Police: Times New Roman 12pt (certaines universites acceptent Calibri 12 ou Arial 11)
- Interligne: 1.5
- Marges: cote reliure 3-3.5cm, cote oppose 1.5-2.5cm, haut/bas 2-2.5cm
- Pagination: chiffres romains (avant-propos) puis chiffres arabes (a partir de l'introduction)
- Position des numeros: centre en bas de page
- Alignement: justifie
- Notes de bas de page: Times New Roman 10pt
- Chaque partie/chapitre commence sur une nouvelle page`,
  },
  // Arabic thesis structure
  {
    category: "norm",
    language: "ar",
    discipline: null,
    university: null,
    title: "هيكل مذكرة التخرج (عربي)",
    content: `هيكل مذكرة التخرج بالعربية:
1. صفحة الغلاف (الجامعة، الكلية، القسم، العنوان، المشرف، السنة)
2. الاهداء والشكر
3. الملخص بلغتين على الاقل (عربي اجباري + فرنسي/انجليزي، حوالي 15 سطرا)
4. قائمة المختصرات
5. قائمة الجداول / قائمة الاشكال
6. الفهرس
7. المقدمة العامة
8. الفصول (فصل اول، فصل ثاني...)
9. الخاتمة
10. قائمة المراجع
11. الملاحق`,
  },
  {
    category: "norm",
    language: "ar",
    discipline: null,
    university: null,
    title: "تنسيق المذكرة بالعربية",
    content: `قواعد تنسيق المذكرة بالعربية:
- الخط: Simplified Arabic حجم 16 (بعض الجامعات Traditional Arabic)
- عناوين الفصول: حجم 26 غامق
- عناوين المباحث: حجم 22 غامق
- العناوين الفرعية: حجم 18 غامق
- الهوامش: جهة التجليد (يمين) 3سم، يسار 1.5سم، اعلى واسفل 2سم
- حواشي الصفحة: Simplified Arabic حجم 12
- المسافة بين الاسطر: 1.5
- المحاذاة: ضبط (justify)`,
  },
  {
    category: "norm",
    language: "ar",
    discipline: "law-humanities",
    university: null,
    title: "هيكل مذكرة الحقوق والعلوم الانسانية",
    content: `هيكل مذكرة الحقوق والعلوم الانسانية:
- تنقسم المذكرة الى فصلين يسبقهما مقدمة ويليهما خاتمة
- كل فصل ينقسم الى مباحث (2-3 مباحث)
- كل مبحث ينقسم الى مطالب (2-3 مطالب)
- كل مطلب ينقسم الى فروع
- التوثيق يكون بالتهميش (حواشي الصفحة) وليس بنظام APA
- يستخدم: المرجع السابق، المرجع نفسه`,
  },
  // Bibliography norms
  {
    category: "norm",
    language: "fr",
    discipline: null,
    university: null,
    title: "Normes bibliographiques APA (francais)",
    content: `Style APA pour les references bibliographiques:
- Livre: Nom, P. (Annee). Titre en italique. Editeur.
- Article: Nom, P. (Annee). Titre de l'article. Nom de la revue en italique, volume(numero), pages.
- These: Nom, P. (Annee). Titre de la these [These de doctorat/memoire de master]. Universite.
- Site web: Nom, P. (Annee). Titre de la page. URL
- Dans le texte: (Nom, Annee) ou (Nom, Annee, p. X)
- References classees par ordre alphabetique`,
  },
  {
    category: "norm",
    language: "ar",
    discipline: null,
    university: null,
    title: "توثيق المراجع بالتهميش (عربي)",
    content: `نظام التهميش في المذكرات العربية:
- الكتاب: اسم المؤلف، عنوان الكتاب، الطبعة، دار النشر، مكان النشر، السنة، الصفحة
- المقال: اسم المؤلف، عنوان المقال، اسم المجلة، العدد، السنة، الصفحة
- عند تكرار المرجع مباشرة: المرجع نفسه، ص X
- عند تكرار المرجع لاحقا: اسم المؤلف، مرجع سابق، ص X
- الهوامش ترقم تسلسليا في كل صفحة`,
  },
  // University-specific norms
  {
    category: "norm",
    language: "fr",
    discipline: "science",
    university: "ENSTI Annaba",
    title: "Normes ENSTI Annaba — memoire science",
    content: `Normes specifiques ENSTI Annaba:
- Maximum 30 pages (introduction a references)
- 50% minimum de travail original
- Police: Times New Roman 12pt
- Interligne: 1.3 (pas 1.5)
- Marges: 2.5cm partout
- Figures: label en dessous "Fig.1 + Titre (gras)", police 10pt
- Tableaux: label au-dessus "Tab.1 + Titre (gras)", police 10pt
- Structure obligatoire: intro, entreprise, etat de l'art, solutions, evaluation, conclusion
- Resume en 3 langues (arabe, francais, anglais)`,
  },
  {
    category: "norm",
    language: "ar",
    discipline: "law-humanities",
    university: "Universite Mohamed Khider Biskra",
    title: "معايير جامعة بسكرة — حقوق (عربي)",
    content: `معايير قسم الحقوق بجامعة بسكرة:
- صفحة الغلاف: الجامعة والكلية والقسم والعنوان فقط
- الخط: Simplified Arabic حجم 16
- العناوين الرئيسية: حجم 18 غامق
- الهوامش: يمين 3سم، يسار 1.5سم، اعلى واسفل 2سم
- حواشي الصفحة: Simplified Arabic حجم 12
- الملخص: على ظهر الغلاف، 15 سطرا كحد اقصى
- تسليم 5 نسخ مطبوعة + قرص CD بصيغة PDF`,
  },
];
```

#### Modify src/db/index.ts:

Add `seedKnowledge` function and wire to startup:
```typescript
import { KNOWLEDGE_SEEDS } from "../lib/knowledge-seed";
import { knowledgeChunks } from "./knowledge";

export async function seedKnowledge() {
  const [{ count }] = (await db
    .select({ count: sql<number>`count(*)::int` })
    .from(knowledgeChunks)) as { count: number }[];
  if (count > 0) return;

  await db.insert(knowledgeChunks).values(
    KNOWLEDGE_SEEDS.map((k) => ({
      category: k.category,
      language: k.language,
      discipline: k.discipline,
      university: k.university,
      title: k.title,
      content: k.content,
    }))
  );
  console.log(`Seeded ${KNOWLEDGE_SEEDS.length} knowledge chunks`);
}
```

Add to startup chain: `.then(() => seedKnowledge())`

Note: Embeddings will be computed lazily on first chat query (not at seed time) to avoid requiring the API key at startup.

Commit: `git commit -m "feat: seed knowledge chunks with Algerian thesis norms"`

---

### Task 5: Wire RAG context into chat route

**Files:**
- Modify: `src/routes/chat.ts`
- Modify: `src/lib/ai/types.ts`

#### src/lib/ai/types.ts:

In `buildToolSystemPrompt` (or `buildLiveDocxSystemPrompt`), add support for an optional `ragContext` parameter:

```typescript
export function buildToolSystemPrompt(ctx: {
  thesisId?: string;
  docMode?: string;
  docBlockIndex?: number;
  focus?: { ... };
  ragContext?: string;  // ← NEW: injected RAG context
}): string
```

At the end of the prompt (before return), if `ragContext` is provided and non-empty, append:
```typescript
if (ctx.ragContext) {
  prompt += `\n\n---\n\nThe following contextual information has been retrieved to help you. Use it to ground your responses, cite norms when relevant, and reference source materials by title:\n\n${ctx.ragContext}`;
}
```

Do the same for `buildLiveDocxSystemPrompt` if it's a separate function.

#### src/routes/chat.ts:

In both the `/send` and `/stream` handlers, BEFORE calling `chatWithTools`/`streamChatWithTools`, add RAG retrieval:

```typescript
import { embedText, findSimilarChunks } from "../lib/embedding-service";
import { buildRagContextBlock } from "../lib/rag-context";
import pg from "pg";

// ... inside the handler, after building focusContext:

let ragContext = "";
try {
  const queryText = message; // the user's message
  const queryEmbedding = await embedText(queryText);
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });

  const [knowledgeResults, sourceResults] = await Promise.all([
    findSimilarChunks(pool, queryEmbedding, {
      table: "knowledge_chunks",
      language: thesis?.language,
      discipline: undefined, // match any discipline
      limit: 3,
    }),
    findSimilarChunks(pool, queryEmbedding, {
      table: "thesis_sources",
      thesisId,
      limit: 3,
    }),
  ]);

  ragContext = buildRagContextBlock(knowledgeResults, sourceResults);
  await pool.end();
} catch (e) {
  console.error("RAG context retrieval failed (non-fatal):", e);
}
```

Then pass `ragContext` to the tool loop opts so it reaches `buildToolSystemPrompt`:
```typescript
const result = await chatWithTools(provider, messages, {
  ...opts,
  ragContext,
});
```

The tool-loop already passes all opts through to `buildToolSystemPrompt` — just make sure `ragContext` is included.

IMPORTANT: RAG retrieval failure must NOT block the chat. Wrap in try/catch and continue with empty ragContext.

Commit: `git commit -m "feat: wire RAG context into chat — embed query, retrieve, inject into system prompt"`

---

### Task 6: Embed sources on upload

**Files:**
- Modify: `src/lib/source-service.ts`

In the `addSource` function, after extracting text and before returning, embed the extracted text:

```typescript
// After extractedText is available and status === "ready":
try {
  const { embedText } = await import("./embedding-service");
  const embedding = await embedText(extractedText);
  // Update the embedding column via raw SQL (pgvector)
  await pool.query(
    `UPDATE thesis_sources SET embedding = $1::vector WHERE id = $2`,
    [`[${embedding.join(",")}]`, sourceId]
  );
} catch (e) {
  console.error("Source embedding failed (non-fatal):", e);
}
```

Use the existing pg pool. Embedding failure must NOT block the upload — wrap in try/catch.

Commit: `git commit -m "feat: embed thesis sources on upload for RAG retrieval"`

---

### Task 7: Verify build + tests

```bash
cd ~/modakerati-server && npx tsc --noEmit 2>&1 | head -20
cd ~/modakerati-server && npx vitest run
```

Fix any errors and commit.

---

## Phase 6 Deliverables Checklist

- [ ] pgvector extension enabled
- [ ] `knowledge_chunks` table with embedding column
- [ ] `thesis_sources.embedding` column
- [ ] Embedding service (embed text + similarity search)
- [ ] RAG context builder (format chunks for system prompt)
- [ ] 10 knowledge chunks seeded (Algerian thesis norms, FR + AR)
- [ ] RAG context injected into chat system prompt
- [ ] Sources embedded on upload
- [ ] All tests pass, build compiles
