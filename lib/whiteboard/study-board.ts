import type { PPTElement } from '@openmaic/dsl';

export type StudyNoteKind = 'understanding' | 'question' | 'connection';

interface StudyFrameInput {
  title: string;
  coreExcerpt: string;
  labels: {
    core: string;
    explain: string;
    explainHint: string;
    question: string;
    questionHint: string;
  };
}

interface StudyNoteInput {
  kind: StudyNoteKind;
  label: string;
  note: string;
}

const RECTANGLE_PATH = 'M 0 0 L 1000 0 L 1000 1000 L 0 1000 Z';

const NOTE_LAYOUT: Record<StudyNoteKind, { left: number; fill: string }> = {
  understanding: { left: 55, fill: '#eef6ff' },
  question: { left: 360, fill: '#fff7e6' },
  connection: { left: 665, fill: '#f3efff' },
};

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function compact(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function rectangle(
  id: string,
  left: number,
  top: number,
  width: number,
  height: number,
  fill: string,
) {
  return {
    id,
    type: 'shape',
    viewBox: [1000, 1000] as [number, number],
    path: RECTANGLE_PATH,
    left,
    top,
    width,
    height,
    rotate: 0,
    fill,
    fixedRatio: false,
  } as PPTElement;
}

function text(
  id: string,
  content: string,
  left: number,
  top: number,
  width: number,
  height: number,
  color = '#26364d',
) {
  return {
    id,
    type: 'text',
    content,
    left,
    top,
    width,
    height,
    rotate: 0,
    defaultFontName: 'Microsoft YaHei',
    defaultColor: color,
  } as PPTElement;
}

export function buildStudyFrameElements(input: StudyFrameInput): PPTElement[] {
  const cards = [
    {
      id: 'core',
      label: input.labels.core,
      value: compact(input.coreExcerpt, 76),
      left: 55,
      fill: '#eaf3ff',
    },
    {
      id: 'explain',
      label: input.labels.explain,
      value: input.labels.explainHint,
      left: 360,
      fill: '#ecf9f0',
    },
    {
      id: 'question',
      label: input.labels.question,
      value: input.labels.questionHint,
      left: 665,
      fill: '#fff6df',
    },
  ];

  return [
    text(
      'learner-frame-title',
      `<p style="font-size: 28px; font-weight: 700; text-align: center;">${escapeHtml(compact(input.title, 70))}</p>`,
      70,
      38,
      860,
      60,
    ),
    ...cards.flatMap((card) => [
      rectangle(`learner-frame-${card.id}-bg`, card.left, 125, 280, 180, card.fill),
      text(
        `learner-frame-${card.id}`,
        `<p style="font-size: 20px; font-weight: 700;">${escapeHtml(card.label)}</p><p style="font-size: 16px; line-height: 1.55;">${escapeHtml(card.value)}</p>`,
        card.left + 24,
        150,
        232,
        132,
      ),
    ]),
  ];
}

export function upsertStudyNoteElements(
  elements: readonly PPTElement[],
  input: StudyNoteInput,
): PPTElement[] {
  const note = compact(input.note, 220);
  if (!note) return [...elements];

  const layout = NOTE_LAYOUT[input.kind];
  const noteId = `learner-note-${input.kind}`;
  const existingIndex = elements.findIndex((element) => element.id === noteId);
  const paragraph = `<p style="font-size: 15px; line-height: 1.45;">• ${escapeHtml(note)}</p>`;

  if (existingIndex >= 0 && elements[existingIndex].type === 'text') {
    const existing = elements[existingIndex] as PPTElement & { content?: string };
    const next = [...elements];
    next[existingIndex] = {
      ...existing,
      content: `${existing.content ?? ''}${paragraph}`,
    } as PPTElement;
    return next;
  }

  return [
    ...elements,
    rectangle(`learner-note-${input.kind}-bg`, layout.left, 340, 280, 170, layout.fill),
    text(
      noteId,
      `<p style="font-size: 18px; font-weight: 700;">${escapeHtml(input.label)}</p>${paragraph}`,
      layout.left + 22,
      360,
      236,
      130,
    ),
  ];
}
