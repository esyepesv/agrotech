import { describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { SupabaseConversationLog } from '../../src/infrastructure/persistence/supabase-conversation-log.js';
import { PgVectorRetriever } from '../../src/infrastructure/knowledge/pgvector-retriever.js';
import { LlmEmbedder } from '../../src/infrastructure/llm/llm-embedder.js';

const hasSupabaseCreds =
  Boolean(process.env.SUPABASE_URL) && Boolean(process.env.SUPABASE_SERVICE_KEY);

/**
 * Tests de integración real contra Supabase/pgvector. Se saltan si no hay
 * SUPABASE_URL/SUPABASE_SERVICE_KEY en el entorno, o si además se necesita
 * OPENAI_API_KEY para generar el embedding de consulta (sección 16).
 * Requieren que la migración 0001_knowledge_chunk.sql ya esté aplicada.
 */
describe.skipIf(!hasSupabaseCreds)('SupabaseConversationLog (integración real)', () => {
  it('registra un turno de conversación sin lanzar', async () => {
    const client = createClient(
      process.env.SUPABASE_URL ?? '',
      process.env.SUPABASE_SERVICE_KEY ?? '',
      { auth: { persistSession: false } },
    );
    const log = new SupabaseConversationLog(client);

    await expect(
      log.record({
        channel: 'telegram',
        channelUserId: 'integration-test-user',
        questionText: '¿cómo alimento una hembra lactante?',
        answerText: 'respuesta de prueba de integración',
        action: 'answer',
        latencyMs: 42,
        createdAt: new Date(),
      }),
    ).resolves.toBeUndefined();
  });
});

describe.skipIf(!hasSupabaseCreds || !process.env.OPENAI_API_KEY)(
  'PgVectorRetriever (integración real)',
  () => {
    it('consulta match_knowledge_chunks y devuelve un arreglo', async () => {
      const supabase = createClient(
        process.env.SUPABASE_URL ?? '',
        process.env.SUPABASE_SERVICE_KEY ?? '',
        { auth: { persistSession: false } },
      );
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const embedder = new LlmEmbedder(
        openai,
        process.env.EMBEDDINGS_MODEL ?? 'text-embedding-3-small',
      );
      const retriever = new PgVectorRetriever(supabase, embedder);

      const chunks = await retriever.retrieve('¿cómo alimento una hembra lactante?', 5);

      expect(Array.isArray(chunks)).toBe(true);
    });
  },
);
