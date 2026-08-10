import { describe, expect, it } from 'vitest';
import { buildStudyFrameElements, upsertStudyNoteElements } from '@/lib/whiteboard/study-board';

describe('learning whiteboard study board', () => {
  it('builds a stable three-part learning frame and escapes source text', () => {
    const elements = buildStudyFrameElements({
      title: '<异步任务>',
      coreExcerpt: 'Worker & queue',
      labels: {
        core: '核心概念',
        explain: '我的解释',
        explainHint: '用自己的话解释',
        question: '待解决问题',
        questionHint: '哪一步还不确定？',
      },
    });

    expect(elements).toHaveLength(7);
    expect(elements.map((element) => element.id)).toContain('learner-frame-title');
    expect(JSON.stringify(elements)).toContain('&lt;异步任务&gt;');
    expect(JSON.stringify(elements)).toContain('Worker &amp; queue');
  });

  it('appends notes into a stable semantic lane instead of creating duplicates', () => {
    const first = upsertStudyNoteElements([], {
      kind: 'question',
      label: '我的疑问',
      note: '失败后如何保证幂等？',
    });
    const second = upsertStudyNoteElements(first, {
      kind: 'question',
      label: '我的疑问',
      note: '重试上限在哪里设置？',
    });

    expect(first).toHaveLength(2);
    expect(second).toHaveLength(2);
    expect(JSON.stringify(second)).toContain('失败后如何保证幂等？');
    expect(JSON.stringify(second)).toContain('重试上限在哪里设置？');
  });
});
