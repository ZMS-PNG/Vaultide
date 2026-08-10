export type GenerationFailureKind =
  | 'source'
  | 'external-evidence'
  | 'provider'
  | 'network'
  | 'quality'
  | 'system';

export interface GenerationFailureGuidance {
  kind: GenerationFailureKind;
  title: string;
  summary: string;
  recovery: string;
  canResume: boolean;
}

function includesAny(value: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => value.includes(pattern));
}

/**
 * Convert internal failure details into a stable learner-facing explanation.
 * The raw detail remains available in logs, while the UI always states what
 * was protected, what the system preserved, and the one useful next action.
 */
export function describeGenerationFailure(raw: string): GenerationFailureGuidance {
  const normalized = raw.trim();
  const lower = normalized.toLocaleLowerCase();

  if (
    includesAny(lower, [
      'source_context_lost',
      'source material is not deep enough',
      'source_material_too_shallow',
      '资料深度不足',
      '已审查的项目资料没有完整进入',
    ])
  ) {
    return {
      kind: 'source',
      title: '资料尚不足以生成高质量课堂',
      summary: '系统在调用后续模型前拦截了残缺或过浅的资料，未发布低质量课堂。',
      recovery: '返回来源审查，补充项目核心文件、论文原文或官方资料后重新确认。',
      canResume: false,
    };
  }

  if (
    includesAny(lower, [
      'external_evidence',
      'no primary or authoritative sources',
      'no qualifying sources',
      '外部权威证据',
      'web search',
      'tavily',
      'brave',
    ])
  ) {
    return {
      kind: 'external-evidence',
      title: '外部权威资料尚未取得',
      summary: '本次目标要求最新或外部证据，因此系统没有用普通网页或内部资料冒充最新结论。',
      recovery: '检查搜索服务配置或补充可信直达链接，然后从已保存进度继续。',
      canResume: true,
    };
  }

  if (
    includesAny(lower, [
      'api key',
      'invalid credentials',
      'missing_api_key',
      'provider disabled',
      'model is required',
    ])
  ) {
    return {
      kind: 'provider',
      title: '模型服务尚未配置完成',
      summary: '资料和生成进度已经保留，当前没有继续调用不可用的模型服务。',
      recovery: '在设置中检查模型、API Key 与 Base URL，再从已保存进度继续。',
      canResume: true,
    };
  }

  if (
    includesAny(lower, [
      'failed to fetch',
      'networkerror',
      'connection',
      'timeout',
      'econnreset',
      'fetch failed',
    ])
  ) {
    return {
      kind: 'network',
      title: '连接暂时中断',
      summary: '已经完成的规划、场景和质量记录仍保存在服务器，不需要从头生成。',
      recovery: '保持页面联网，点击“从已保存进度继续”。',
      canResume: true,
    };
  }

  if (
    includesAny(lower, [
      'quality_gate',
      'quality gate',
      'outline_quality',
      'outline quality',
      'release gate',
      'final scene',
      'source-grounded',
      '课程未通过',
    ])
  ) {
    return {
      kind: 'quality',
      title: '课堂尚未达到发布标准',
      summary: '低质量结果没有被当作完成；已通过的内容和失败证据均已保留。',
      recovery: '点击“从已保存进度继续”，系统只修复未达标部分并重新验证。',
      canResume: true,
    };
  }

  return {
    kind: 'system',
    title: '生成流程遇到内部异常',
    summary: '当前结果没有发布，已完成的持久化检查点仍然保留。',
    recovery: '先从已保存进度继续；若仍失败，再返回调整资料。',
    canResume: true,
  };
}
