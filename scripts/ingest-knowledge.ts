import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import { loadEnv } from '../src/config/env.js';
import { createLogger } from '../src/shared/logger.js';
import { LlmEmbedder } from '../src/infrastructure/llm/llm-embedder.js';

/**
 * Pipeline OFFLINE de ingestión del corpus curado (sección 12): normaliza
 * los .md de knowledge/, los divide en chunks con solape, los embebe con el
 * mismo puerto Embedder que usa el runtime (consistencia de vectorización)
 * y hace upsert en pgvector. Idempotente: por cada fuente, borra los
 * chunks previos antes de insertar los nuevos, así se puede re-ejecutar
 * sin duplicar filas cada vez que cambia un documento.
 */

const KNOWLEDGE_DIR = path.resolve(import.meta.dirname, '../knowledge');
const TABLE = 'knowledge_chunk';
const DEFAULT_REGION = 'CO';

// Aproximación de tokens vía conteo de palabras: no se agrega una
// dependencia de tokenizador solo para el script de ingestión offline.
// ~400 palabras en español ronda los 300-500 tokens objetivo (sección 12).
const CHUNK_SIZE_WORDS = 400;
const CHUNK_OVERLAP_WORDS = 60;

interface DocumentFrontMatter {
  readonly topic?: string;
  readonly source?: string;
  readonly validatedBy?: string;
  readonly region?: string;
}

interface ParsedDocument {
  readonly frontMatter: DocumentFrontMatter;
  readonly body: string;
}

interface KnowledgeChunkRow {
  readonly content: string;
  readonly embedding: number[];
  readonly source: string;
  readonly topic: string | null;
  readonly validated_by: string | null;
  readonly region: string;
  readonly updated_at: string;
}

/**
 * Extrae el front matter YAML simple (`topic:`, `source:`, `validado_por:`,
 * `region:`) entre delimitadores `---`. No usa una librería YAML completa:
 * el formato de estos documentos semilla es deliberadamente plano.
 */
function parseFrontMatter(raw: string): ParsedDocument {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(raw);
  if (match === null) {
    return { frontMatter: {}, body: raw };
  }

  const fields: Record<string, string> = {};
  const frontMatterBlock = match[1] ?? '';
  for (const line of frontMatterBlock.split('\n')) {
    const separatorIndex = line.indexOf(':');
    if (separatorIndex === -1) {
      continue;
    }
    const key = line.slice(0, separatorIndex).trim();
    const value = line
      .slice(separatorIndex + 1)
      .trim()
      .replace(/^["'](.*)["']$/, '$1');
    fields[key] = value;
  }

  return {
    frontMatter: {
      topic: fields.topic,
      source: fields.source,
      validatedBy: fields.validado_por,
      region: fields.region,
    },
    body: raw.slice((match[0] ?? '').length),
  };
}

/** Chunking por palabras con solape (sección 12: ~300-500 tokens, con solape). */
function chunkText(text: string): string[] {
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) {
    return [];
  }
  if (words.length <= CHUNK_SIZE_WORDS) {
    return [words.join(' ')];
  }

  const chunks: string[] = [];
  let start = 0;
  while (start < words.length) {
    const end = Math.min(start + CHUNK_SIZE_WORDS, words.length);
    chunks.push(words.slice(start, end).join(' '));
    if (end === words.length) {
      break;
    }
    start = end - CHUNK_OVERLAP_WORDS;
  }
  return chunks;
}

async function listKnowledgeFiles(): Promise<string[]> {
  const entries = await readdir(KNOWLEDGE_DIR);
  return entries.filter((entry) => entry.endsWith('.md')).sort();
}

async function main(): Promise<void> {
  if (existsSync('.env')) {
    process.loadEnvFile('.env');
  }
  const env = loadEnv();
  const logger = createLogger(env.LOG_LEVEL);

  const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  const embedder = new LlmEmbedder(openai, env.EMBEDDINGS_MODEL);
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });

  const files = await listKnowledgeFiles();
  if (files.length === 0) {
    logger.warn({ dir: KNOWLEDGE_DIR }, 'no se encontraron documentos .md para ingerir');
    return;
  }

  for (const file of files) {
    const raw = await readFile(path.join(KNOWLEDGE_DIR, file), 'utf8');
    const { frontMatter, body } = parseFrontMatter(raw);
    const source = frontMatter.source ?? file;
    const chunks = chunkText(body);

    logger.info({ source, chunkCount: chunks.length }, 'ingiriendo documento');

    // Idempotencia: se reemplazan todos los chunks previos de esta fuente
    // antes de insertar los nuevos (evita duplicados en re-ejecuciones).
    const { error: deleteError } = await supabase.from(TABLE).delete().eq('source', source);
    if (deleteError !== null) {
      throw new Error(`fallo al borrar chunks previos de "${source}": ${deleteError.message}`);
    }

    const updatedAt = new Date().toISOString();
    const rows: KnowledgeChunkRow[] = [];
    for (const chunk of chunks) {
      const embedding = await embedder.embed(chunk);
      rows.push({
        content: chunk,
        embedding,
        source,
        topic: frontMatter.topic ?? null,
        validated_by: frontMatter.validatedBy ?? null,
        region: frontMatter.region ?? DEFAULT_REGION,
        updated_at: updatedAt,
      });
    }

    if (rows.length > 0) {
      const { error: insertError } = await supabase.from(TABLE).insert(rows);
      if (insertError !== null) {
        throw new Error(`fallo al insertar chunks de "${source}": ${insertError.message}`);
      }
    }

    logger.info({ source, inserted: rows.length }, 'documento ingerido');
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
