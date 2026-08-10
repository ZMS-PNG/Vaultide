import type { SceneOutline } from '@/lib/types/generation';

const SCENE_TYPES = new Set<SceneOutline['type']>(['slide', 'quiz', 'interactive', 'pbl']);

export class SceneOutlineContractError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'SceneOutlineContractError';
    this.code = code;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SceneOutlineContractError(
      'SCENE_OUTLINE_NOT_OBJECT',
      'Scene outline must be a JSON object.',
    );
  }
  return value as Record<string, unknown>;
}

function requiredText(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== 'string' || !value.trim()) {
    throw new SceneOutlineContractError(
      `SCENE_OUTLINE_${field.toUpperCase()}_REQUIRED`,
      `Scene outline requires a non-empty ${field}.`,
    );
  }
  return value.trim();
}

function optionalText(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeKeyPoints(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(/\r?\n|[;；]/u)
      .map((item) => item.replace(/^[-*•\d.)、\s]+/u, '').trim())
      .filter(Boolean);
  }
  return [];
}

/**
 * Converts untrusted serialized outline data into the single shape accepted by
 * content/action generation. It deliberately does not invent instructional
 * content: missing claims reach a quality gate as a clear contract defect,
 * while `keyPoints` is always an array so downstream code cannot crash on
 * `.join()`.
 */
export function normalizeSceneOutlineContract(
  value: unknown,
  options: { fallbackOrder?: number } = {},
): SceneOutline {
  const record = asRecord(value);
  const rawType = record.type;
  if (typeof rawType !== 'string' || !SCENE_TYPES.has(rawType as SceneOutline['type'])) {
    throw new SceneOutlineContractError(
      'SCENE_OUTLINE_TYPE_INVALID',
      'Scene outline type must be slide, quiz, interactive, or pbl.',
    );
  }

  const rawOrder = record.order;
  const order =
    typeof rawOrder === 'number' && Number.isInteger(rawOrder) && rawOrder > 0
      ? rawOrder
      : options.fallbackOrder;
  if (!order) {
    throw new SceneOutlineContractError(
      'SCENE_OUTLINE_ORDER_INVALID',
      'Scene outline order must be a positive integer.',
    );
  }

  return {
    // The contract below re-establishes every required SceneOutline field;
    // preserve permitted extension fields only after crossing the untrusted
    // JSON boundary explicitly.
    ...(record as unknown as SceneOutline),
    id: requiredText(record, 'id'),
    type: rawType as SceneOutline['type'],
    title: requiredText(record, 'title'),
    description: optionalText(record, 'description'),
    keyPoints: normalizeKeyPoints(record.keyPoints ?? record.key_points),
    order,
    ...(typeof record.generationRepairDirective === 'string' && record.generationRepairDirective.trim()
      ? { generationRepairDirective: record.generationRepairDirective.trim() }
      : {}),
  };
}

export function normalizeSceneOutlineListContract(value: unknown): SceneOutline[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new SceneOutlineContractError(
      'SCENE_OUTLINE_LIST_REQUIRED',
      'At least one scene outline is required.',
    );
  }

  const outlines = value.map((entry, index) =>
    normalizeSceneOutlineContract(entry, { fallbackOrder: index + 1 }),
  );
  const ids = new Set<string>();
  const orders = new Set<number>();
  for (const outline of outlines) {
    if (ids.has(outline.id) || orders.has(outline.order)) {
      throw new SceneOutlineContractError(
        'SCENE_OUTLINE_LIST_NOT_UNIQUE',
        'Scene outline ids and orders must be unique.',
      );
    }
    ids.add(outline.id);
    orders.add(outline.order);
  }
  return outlines;
}
