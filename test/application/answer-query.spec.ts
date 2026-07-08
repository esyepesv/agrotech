import { describe, expect, it } from 'vitest';
import type { IncomingMessage } from '../../src/domain/message/incoming-message.js';
import { err, ok } from '../../src/domain/shared/result.js';
import {
  AnswerQuery,
  ANSWER_QUERY_MESSAGES,
  type AnswerQueryDeps,
} from '../../src/application/use-cases/answer-query.js';
import { FakeAnswerGenerator } from './fakes/fake-answer-generator.js';
import { FakeChannelGateway } from './fakes/fake-channel-gateway.js';
import { FakeConversationLog } from './fakes/fake-conversation-log.js';
import { FakeKnowledgeRetriever, sampleChunk } from './fakes/fake-knowledge-retriever.js';
import { FakeSafetyPolicy } from './fakes/fake-safety-policy.js';
import { FakeSpeechSynthesizer } from './fakes/fake-speech-synthesizer.js';
import { FakeTranscriber } from './fakes/fake-transcriber.js';

const MIN_RELEVANCE_SCORE = 0.35;

function textMessage(text: string): IncomingMessage {
  return {
    channel: 'telegram',
    channelUserId: 'user-1',
    messageId: 'msg-1',
    type: 'text',
    text,
    receivedAt: new Date(),
  };
}

function voiceMessage(): IncomingMessage {
  return {
    channel: 'telegram',
    channelUserId: 'user-1',
    messageId: 'msg-2',
    type: 'voice',
    audioRef: { channel: 'telegram', mediaId: 'file-abc' },
    receivedAt: new Date(),
  };
}

interface FakeDeps extends AnswerQueryDeps {
  readonly transcriber: FakeTranscriber;
  readonly synthesizer: FakeSpeechSynthesizer;
  readonly retriever: FakeKnowledgeRetriever;
  readonly generator: FakeAnswerGenerator;
  readonly safetyPolicy: FakeSafetyPolicy;
  readonly conversationLog: FakeConversationLog;
}

function buildDeps(overrides: Partial<FakeDeps> = {}): FakeDeps {
  return {
    transcriber: new FakeTranscriber(),
    synthesizer: new FakeSpeechSynthesizer(),
    retriever: new FakeKnowledgeRetriever(),
    generator: new FakeAnswerGenerator(),
    safetyPolicy: new FakeSafetyPolicy(['antibiótico', 'dosis']),
    conversationLog: new FakeConversationLog(),
    minRelevanceScore: MIN_RELEVANCE_SCORE,
    ...overrides,
  };
}

describe('AnswerQuery', () => {
  it('texto → texto: responde con la generación y registra el turno', async () => {
    const deps = buildDeps();
    const gateway = new FakeChannelGateway();

    await new AnswerQuery(deps).handle(textMessage('¿cómo alimento una hembra lactante?'), gateway);

    expect(gateway.sent).toHaveLength(1);
    expect(gateway.sent[0]).toMatchObject({
      type: 'text',
      text: 'Aliméntala a voluntad durante la lactancia, repartido en 2 o 3 comidas.',
    });
    expect(deps.retriever.queries).toEqual([
      { query: '¿cómo alimento una hembra lactante?', k: 5 },
    ]);
    expect(deps.conversationLog.turns).toHaveLength(1);
    expect(deps.conversationLog.turns[0]).toMatchObject({ action: 'answer' });
  });

  it('emite el indicador "escribiendo…" antes de responder', async () => {
    const deps = buildDeps();
    const gateway = new FakeChannelGateway();

    await new AnswerQuery(deps).handle(textMessage('¿cada cuánto se le da concentrado?'), gateway);

    // Al menos una señal al inicio; se refresca de nuevo antes de generar.
    expect(gateway.typingCalls).toBeGreaterThanOrEqual(1);
    expect(gateway.sent).toHaveLength(1);
  });

  it('voz → voz: transcribe, genera y responde con audio', async () => {
    const deps = buildDeps();
    const gateway = new FakeChannelGateway();

    await new AnswerQuery(deps).handle(voiceMessage(), gateway);

    expect(deps.transcriber.calls).toHaveLength(1);
    expect(gateway.sent).toHaveLength(1);
    expect(gateway.sent[0]?.type).toBe('voice');
    expect(gateway.sent[0]?.audio).toBeDefined();
    expect(deps.conversationLog.turns[0]).toMatchObject({ action: 'answer' });
  });

  it('tema sanitario → escalate_vet sin tocar RAG ni generador', async () => {
    const deps = buildDeps();
    const gateway = new FakeChannelGateway();

    await new AnswerQuery(deps).handle(
      textMessage('¿qué dosis de antibiótico le doy a mi cerda?'),
      gateway,
    );

    expect(gateway.sent[0]?.text).toBe(ANSWER_QUERY_MESSAGES.escalation);
    expect(deps.retriever.queries).toHaveLength(0);
    expect(deps.generator.inputs).toHaveLength(0);
    expect(deps.conversationLog.turns[0]).toMatchObject({ action: 'escalate_vet' });
  });

  it('RAG sin resultados → responde "no sé" sin llamar al generador', async () => {
    const deps = buildDeps({ retriever: new FakeKnowledgeRetriever([]) });
    const gateway = new FakeChannelGateway();

    await new AnswerQuery(deps).handle(
      textMessage('¿cuánto pesa un cerdo adulto en Marte?'),
      gateway,
    );

    expect(gateway.sent[0]?.text).toBe(ANSWER_QUERY_MESSAGES.noKnowledge);
    expect(deps.generator.inputs).toHaveLength(0);
    expect(deps.conversationLog.turns[0]).toMatchObject({ action: 'answer' });
  });

  it('TTS caído en input de voz → degrada a respuesta de texto', async () => {
    const deps = buildDeps({ synthesizer: new FakeSpeechSynthesizer(true) });
    const gateway = new FakeChannelGateway();

    await new AnswerQuery(deps).handle(voiceMessage(), gateway);

    expect(gateway.sent).toHaveLength(1);
    expect(gateway.sent[0]?.type).toBe('text');
    expect(gateway.sent[0]?.audio).toBeUndefined();
    expect(deps.conversationLog.turns).toHaveLength(1);
  });

  it('STT caído → pide reenviar el audio o escribir, y registra el turno', async () => {
    const deps = buildDeps({
      transcriber: new FakeTranscriber(err({ kind: 'provider_failure', message: 'whisper caído' })),
    });
    const gateway = new FakeChannelGateway();

    await new AnswerQuery(deps).handle(voiceMessage(), gateway);

    expect(gateway.sent[0]).toMatchObject({
      type: 'text',
      text: ANSWER_QUERY_MESSAGES.sttFailed,
    });
    expect(deps.conversationLog.turns[0]).toMatchObject({ action: 'refuse' });
  });

  it('generador falla → cae al mensaje "no sé" (grounding, sin alucinar)', async () => {
    const deps = buildDeps({
      generator: new FakeAnswerGenerator(err({ kind: 'provider_failure', message: 'llm caído' })),
    });
    const gateway = new FakeChannelGateway();

    await new AnswerQuery(deps).handle(textMessage('¿cada cuánto sirvo el concentrado?'), gateway);

    expect(gateway.sent[0]?.text).toBe(ANSWER_QUERY_MESSAGES.noKnowledge);
    expect(deps.conversationLog.turns).toHaveLength(1);
  });

  it('envío al canal falla → handle() rechaza, pero el turno queda registrado (no silencioso)', async () => {
    const deps = buildDeps();
    const gateway = new FakeChannelGateway(
      false,
      err({ kind: 'send_failed', message: 'token de WhatsApp expirado' }),
    );

    const promise = new AnswerQuery(deps).handle(
      textMessage('¿cómo alimento una hembra lactante?'),
      gateway,
    );

    await expect(promise).rejects.toMatchObject({
      channel: 'telegram',
      reason: 'token de WhatsApp expirado',
    });
    await expect(promise).rejects.toThrow('token de WhatsApp expirado');

    expect(deps.conversationLog.turns).toHaveLength(1);
    expect(deps.conversationLog.turns[0]).toMatchObject({ action: 'answer' });
  });

  it('chunk recuperado por debajo del umbral de relevancia → responde "no sé" sin llamar al generador (#3)', async () => {
    const deps = buildDeps({
      retriever: new FakeKnowledgeRetriever([sampleChunk({ score: 0.1 })]),
    });
    const gateway = new FakeChannelGateway();

    await new AnswerQuery(deps).handle(textMessage('¿cómo alimento una hembra lactante?'), gateway);

    expect(gateway.sent[0]?.text).toBe(ANSWER_QUERY_MESSAGES.noKnowledge);
    expect(deps.generator.inputs).toHaveLength(0);
    expect(deps.conversationLog.turns[0]).toMatchObject({ action: 'answer' });
  });

  it('reviewAnswer detecta contenido de medicación en el borrador → escala aunque la pregunta haya sido permitida (#4)', async () => {
    const deps = buildDeps({
      safetyPolicy: new FakeSafetyPolicy([], ['ivermectina']),
      generator: new FakeAnswerGenerator(
        ok({
          text: 'Puedes aplicarle 5 ml de ivermectina cada 8 horas.',
          usedSources: [{ id: 'chunk-1', source: 'alimentacion.md' }],
        }),
      ),
    });
    const gateway = new FakeChannelGateway();

    await new AnswerQuery(deps).handle(textMessage('¿cómo trato el cojeo de mi cerda?'), gateway);

    expect(gateway.sent[0]?.text).toBe(ANSWER_QUERY_MESSAGES.escalation);
    expect(deps.conversationLog.turns[0]).toMatchObject({ action: 'escalate_vet' });
  });
});
