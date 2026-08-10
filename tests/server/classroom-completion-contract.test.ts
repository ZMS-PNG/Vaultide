import { beforeEach, describe, expect, test, vi } from 'vitest';

const storageMocks = vi.hoisted(() => ({
  persistClassroom: vi.fn(),
}));

vi.mock('@/lib/server/classroom-storage', () => ({
  buildRequestOrigin: () => 'https://example.test',
  isValidClassroomId: (value: string) => /^[A-Za-z0-9_-]{6,64}$/.test(value),
  persistClassroom: storageMocks.persistClassroom,
  readClassroom: vi.fn(),
}));

function outlines(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `scene_${index + 1}`,
    type: index === count - 2 ? 'quiz' : 'slide',
    title: `Scene ${index + 1}`,
    description: `Distinct scene ${index + 1}`,
    keyPoints: ['Mechanism', 'Evidence', 'Action'],
    order: index + 1,
  }));
}

function request(body: unknown) {
  return {
    json: async () => body,
  };
}

describe('classroom completion contract', () => {
  beforeEach(() => {
    storageMocks.persistClassroom.mockReset();
    storageMocks.persistClassroom.mockImplementation(async ({ id }) => ({
      id,
      url: `https://example.test/classroom/${id}`,
      revision: 1,
    }));
  });

  test('refuses to persist a one-scene standard classroom as complete', async () => {
    const { POST } = await import('@/lib/server/api-routes/classroom/handler');
    const response = await POST(
      request({
        stage: { id: 'course001', taskEngineMode: false },
        scenes: [{ id: 'scene-record-1', order: 1 }],
        generation: {
          outlines: outlines(1),
          generationComplete: true,
          generationStatus: 'completed',
        },
      }) as unknown as Parameters<typeof POST>[0],
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      success: false,
      errorCode: 'QUALITY_GATE_FAILED',
    });
    expect(storageMocks.persistClassroom).not.toHaveBeenCalled();
  });

  test('persists a complete ten-scene classroom', async () => {
    const { POST } = await import('@/lib/server/api-routes/classroom/handler');
    const response = await POST(
      request({
        stage: { id: 'course010', taskEngineMode: false },
        scenes: outlines(10).map((outline) => ({
          id: `record-${outline.id}`,
          order: outline.order,
        })),
        generation: {
          outlines: outlines(10),
          generationComplete: true,
          generationStatus: 'completed',
        },
      }) as unknown as Parameters<typeof POST>[0],
    );

    expect(response.status).toBe(201);
    expect(storageMocks.persistClassroom).toHaveBeenCalledOnce();
  });
});
