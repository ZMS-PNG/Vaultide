import { describe, expect, it } from 'vitest';
import { buildPrompt, PROMPT_IDS } from '@/lib/prompts';

function promptText(promptId: Parameters<typeof buildPrompt>[0]): string {
  const prompt = buildPrompt(promptId, {
    requirement: '理解项目架构并完成迁移练习',
    pdfContent: '[V1] 项目原始资料',
    availableImages: 'No images available',
    userProfile: '',
    researchContext: '[S1] 官方资料',
    teacherContext: '',
    hasSourceImages: false,
    imageEnabled: false,
    videoEnabled: false,
    mediaEnabled: false,
  });
  expect(prompt).not.toBeNull();
  return `${prompt!.system}\n${prompt!.user}`;
}

describe('outline first-pass quality contract', () => {
  it.each([PROMPT_IDS.REQUIREMENTS_TO_OUTLINES, PROMPT_IDS.INTERACTIVE_OUTLINES])(
    'aligns %s with the enforced evidence and final-transfer gates',
    (promptId) => {
      const text = promptText(promptId);

      expect(text).toContain('9-12');
      expect(text).toContain('80%');
      expect(text).toContain('75%');
      expect(text).toContain('60%');
      expect(text.toLocaleLowerCase()).toContain('observable completion');
      expect(text.toLocaleLowerCase()).toContain('learner artifact');
    },
  );
});
