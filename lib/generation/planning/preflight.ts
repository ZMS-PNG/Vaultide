import {
  assessSourceReadiness,
  describeQualityIssues,
  plainCourseText,
  type CourseQualityAssessment,
} from '@/lib/generation/course-quality';
import {
  resolveExternalEvidenceMode,
  type ExternalEvidenceMode,
  type ExternalEvidenceStatus,
} from '@/lib/generation/external-evidence-policy';
import type { UserRequirements } from '@/lib/types/generation';

export const COURSE_PLANNING_PREFLIGHT_VERSION = 'vaultide-planning-preflight-v1';

export type CoursePlanningPreflightIssueCode =
  | 'LEARNING_GOAL_REQUIRED'
  | 'SOURCE_CONTEXT_LOST'
  | 'SOURCE_MATERIAL_TOO_SHALLOW'
  | 'EXTERNAL_EVIDENCE_REQUIRED'
  | 'EXTERNAL_EVIDENCE_UNAVAILABLE';

export interface CoursePlanningPreflightIssue {
  code: CoursePlanningPreflightIssueCode;
  severity: 'blocker' | 'warning';
  title: string;
  detail: string;
  recovery: string;
}

export interface CoursePlanningPreflight {
  version: typeof COURSE_PLANNING_PREFLIGHT_VERSION;
  ready: boolean;
  externalEvidenceMode: ExternalEvidenceMode;
  externalEvidenceStatus: ExternalEvidenceStatus;
  sourceAssessment: CourseQualityAssessment;
  metrics: {
    documentChars: number;
    researchChars: number;
    suppliedChars: number;
    expectedChars: number;
  };
  issues: CoursePlanningPreflightIssue[];
}

export interface CoursePlanningPreflightInput {
  requirements: UserRequirements;
  documentText?: string;
  researchText?: string;
  sourceContextExpectedChars?: number;
}

function issue(
  code: CoursePlanningPreflightIssueCode,
  severity: CoursePlanningPreflightIssue['severity'],
  title: string,
  detail: string,
  recovery: string,
): CoursePlanningPreflightIssue {
  return { code, severity, title, detail, recovery };
}

/**
 * One deterministic trust boundary shared by the browser, planning API, and
 * outline worker.  It prevents a user from waiting for an LLM only to discover
 * that the reviewed source set was incomplete or that required external
 * evidence never arrived.
 */
export function assessCoursePlanningPreflight(
  input: CoursePlanningPreflightInput,
): CoursePlanningPreflight {
  const documentChars = plainCourseText(input.documentText).length;
  const researchChars = plainCourseText(input.researchText).length;
  const suppliedChars = documentChars + researchChars;
  const expectedChars =
    typeof input.sourceContextExpectedChars === 'number' &&
    Number.isFinite(input.sourceContextExpectedChars)
      ? Math.max(0, Math.floor(input.sourceContextExpectedChars))
      : 0;
  const externalEvidenceMode = resolveExternalEvidenceMode(input.requirements);
  const externalEvidenceStatus =
    input.requirements.externalEvidenceStatus ?? 'not-requested';
  const sourceAssessment = assessSourceReadiness({
    pdfText: input.documentText,
    researchContext: input.researchText,
    // Supplemental research may disappear without invalidating a deep private
    // source. Required research must independently satisfy the external lane.
    webSearchEnabled: externalEvidenceMode === 'required',
  });
  const issues: CoursePlanningPreflightIssue[] = [];

  if (!input.requirements.requirement?.trim()) {
    issues.push(
      issue(
        'LEARNING_GOAL_REQUIRED',
        'blocker',
        '学习目标尚未明确',
        '系统无法判断资料取舍、课程深度和完成标准。',
        '返回首页补充一个可验证的学习目标后再继续。',
      ),
    );
  }

  if (expectedChars >= 1_200 && documentChars < Math.min(1_200, expectedChars * 0.5)) {
    issues.push(
      issue(
        'SOURCE_CONTEXT_LOST',
        'blocker',
        '已审查资料未完整传入',
        `来源审查记录约 ${expectedChars.toLocaleString()} 个字符，但当前仅恢复 ${documentChars.toLocaleString()} 个有效字符。`,
        '返回来源审查页并重新确认同一批资料；系统不会用残缺内容生成课堂。',
      ),
    );
  }

  if (externalEvidenceMode === 'required' && externalEvidenceStatus === 'unavailable') {
    issues.push(
      issue(
        'EXTERNAL_EVIDENCE_UNAVAILABLE',
        'blocker',
        '本次学习要求外部权威证据，但检索未成功',
        input.requirements.externalEvidenceWarning ||
          '没有取得可审计的官方、原始或权威来源。',
        '检查 Tavily/Brave 配置，提供可信直达链接，或把外部证据改为“补充资料”。',
      ),
    );
  } else if (externalEvidenceMode === 'required' && externalEvidenceStatus !== 'ready') {
    issues.push(
      issue(
        'EXTERNAL_EVIDENCE_REQUIRED',
        'blocker',
        '还没有冻结外部权威证据',
        '当前目标要求最新外部资料，不能在检索完成前进入课程规划。',
        '先完成外部检索并审查来源，再生成大纲。',
      ),
    );
  } else if (externalEvidenceMode === 'supplemental' && externalEvidenceStatus === 'unavailable') {
    issues.push(
      issue(
        'EXTERNAL_EVIDENCE_UNAVAILABLE',
        'warning',
        '外部补充资料本轮不可用',
        input.requirements.externalEvidenceWarning ||
          '课堂将仅使用已经审查的内部原始资料，不会声称包含最新外部结论。',
        '可以继续；若必须覆盖最新进展，请重新检索或改为“外部证据必须取得”。',
      ),
    );
  }

  if (!sourceAssessment.passed) {
    issues.push(
      issue(
        'SOURCE_MATERIAL_TOO_SHALLOW',
        'blocker',
        '资料深度不足以生成高质量课堂',
        describeQualityIssues(sourceAssessment) || '有效资料不足，无法形成可审计的完整课程。',
        '补充原文、完整论文、官方文档或更多项目核心文件后重新审查来源。',
      ),
    );
  }

  return {
    version: COURSE_PLANNING_PREFLIGHT_VERSION,
    ready: !issues.some((entry) => entry.severity === 'blocker'),
    externalEvidenceMode,
    externalEvidenceStatus,
    sourceAssessment,
    metrics: { documentChars, researchChars, suppliedChars, expectedChars },
    issues,
  };
}
