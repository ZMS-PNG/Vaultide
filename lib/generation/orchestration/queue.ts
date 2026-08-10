import { Client, Receiver } from '@upstash/qstash';

export interface CourseQueuePublishResult {
  mode: 'qstash' | 'client-resume';
  messageId?: string;
}

function qstashToken(): string | undefined {
  return process.env.QSTASH_TOKEN?.trim() || undefined;
}

export function courseQueueConfigured(): boolean {
  return Boolean(
    qstashToken() &&
      process.env.QSTASH_CURRENT_SIGNING_KEY?.trim() &&
      process.env.QSTASH_NEXT_SIGNING_KEY?.trim(),
  );
}

export async function publishCourseGenerationStep(input: {
  jobId: string;
  baseUrl: string;
  delaySeconds?: number;
  deduplicationId?: string;
  recovery?: {
    sceneOrder: number;
    phase: 'content' | 'actions' | 'release';
    attemptCount: number;
  };
}): Promise<CourseQueuePublishResult> {
  const token = qstashToken();
  if (!token || !courseQueueConfigured()) return { mode: 'client-resume' };

  const url = new URL('/api/internal/course-generation/worker', input.baseUrl).toString();
  const result = await new Client({ token, enableTelemetry: false }).publishJSON({
    url,
    body: {
      jobId: input.jobId,
      ...(input.recovery ? { recovery: input.recovery } : {}),
    },
    retries: 3,
    timeout: 300,
    ...(input.delaySeconds ? { delay: input.delaySeconds } : {}),
    ...(input.deduplicationId ? { deduplicationId: input.deduplicationId } : {}),
    headers: {
      'X-Vaultide-Worker-Version': '1',
    },
  });
  return { mode: 'qstash', messageId: result.messageId };
}

export async function verifyCourseQueueRequest(input: {
  signature: string | null;
  body: string;
  url: string;
}): Promise<boolean> {
  const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY?.trim();
  const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY?.trim();
  if (!currentSigningKey || !nextSigningKey || !input.signature) return false;
  try {
    return await new Receiver({
      currentSigningKey,
      nextSigningKey,
    }).verify({
      signature: input.signature,
      body: input.body,
      url: input.url,
    });
  } catch {
    return false;
  }
}
