import { describe, expect, it } from 'vitest';
import { assessSourceReadiness } from '@/lib/generation/course-quality';
import { resolveExternalEvidenceMode } from '@/lib/generation/external-evidence-policy';
import { buildSearchQuery } from '@/lib/server/search-query-builder';

describe('learning run release scenario matrix', () => {
  it('keeps an external GitHub repository authority-first and release-blocking', async () => {
    const requirement = '学习 https://github.com/openai/codex 的核心架构、任务执行流程与验证机制。';
    const query = await buildSearchQuery(requirement, undefined);
    const mode = resolveExternalEvidenceMode({
      webSearch: true,
      learningProject: { sourceMode: 'external' },
    });
    const readiness = assessSourceReadiness({
      webSearchEnabled: true,
      researchContext: `${'- [S1] GitHub README architecture and execution evidence. '.repeat(
        35,
      )}\n${'- [S2] Official documentation verification evidence. '.repeat(35)}`,
    });

    expect(query.query).toContain('openai/codex GitHub repository official README');
    expect(mode).toBe('required');
    expect(readiness.passed).toBe(true);
  });

  it('keeps a deep Obsidian project authoritative when a supplement is unavailable', async () => {
    const source = `# 智慧农业平台
React 19 TypeScript Vite 6 Capacitor FastAPI
${'内部架构、数据流、无人机任务和天气监测验收证据。'.repeat(1_000)}`;
    const query = await buildSearchQuery('快速了解该项目', source);
    const mode = resolveExternalEvidenceMode({
      webSearch: true,
      learningProject: { sourceMode: 'hybrid' },
    });
    const readiness = assessSourceReadiness({
      webSearchEnabled: true,
      pdfText: source,
      researchContext: '',
    });

    expect(query.query).toContain('React');
    expect(query.query).toContain('FastAPI');
    expect(mode).toBe('supplemental');
    expect(readiness.passed).toBe(true);
    expect(readiness.metrics.sourceBasis).toBe('supplied-canonical-source');
  });

  it('requires inspectable external evidence for a current paper or research article', () => {
    const mode = resolveExternalEvidenceMode({
      webSearch: true,
      learningProject: { sourceMode: 'external' },
    });
    const shallow = assessSourceReadiness({
      webSearchEnabled: true,
      researchContext: '- [S1] abstract only',
    });

    expect(mode).toBe('required');
    expect(shallow.passed).toBe(false);
    expect(shallow.issues.map((issue) => issue.code)).toContain('source_external_too_shallow');
  });

  it('allows an internal article to remain completely offline and source-grounded', () => {
    const mode = resolveExternalEvidenceMode({
      webSearch: false,
      learningProject: { sourceMode: 'obsidian' },
    });
    const readiness = assessSourceReadiness({
      webSearchEnabled: false,
      pdfText: `# 内部技术文章\n${'机制、例子、决策依据和验证步骤。'.repeat(120)}`,
    });

    expect(mode).toBe('off');
    expect(readiness.passed).toBe(true);
    expect(readiness.metrics.sourceBasis).toBe('supplied-internal-source');
  });
});
