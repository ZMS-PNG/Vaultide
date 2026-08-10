import type {
  KnowledgeEdgeOrigin,
  KnowledgeEdgeTypeV2,
  KnowledgeEdgeV2,
  KnowledgeRelationStatus,
} from './contracts';

const RELATION_LABEL: Record<KnowledgeEdgeTypeV2, string> = {
  'belongs-to': '属于',
  contains: '包含',
  cites: '引用',
  'derived-from': '来源于',
  'companion-of': '伴生笔记',
  precedes: '先于',
  prerequisite: '前置依赖',
  supports: '支持',
  contradicts: '存在矛盾',
  'applies-to': '应用于',
  'related-to': '相关',
  'review-of': '复习对象',
};

const STATUS_LABEL: Record<KnowledgeRelationStatus, string> = {
  active: '系统关系',
  candidate: '待核验',
  confirmed: '已确认',
  rejected: '已标记错误',
};

const ORIGIN_LABEL: Record<KnowledgeEdgeOrigin, string> = {
  deterministic: '结构化数据',
  lexical: '文本相似性',
  embedding: '语义相似性',
  llm: '模型推断',
  manual: '人工建立',
};

export interface KnowledgeRelationSemantics {
  typeLabel: string;
  statusLabel: string;
  originLabel: string;
  confidencePercent: number;
  evidenceCount: number;
  headline: string;
  caution: string;
}

export function describeKnowledgeRelation(edge: KnowledgeEdgeV2): KnowledgeRelationSemantics {
  const confidencePercent = Math.round(edge.confidence * 100);
  const evidenceCount = edge.evidenceRefs.length;
  let headline: string;

  if (edge.status === 'rejected') {
    headline = '这条连接已被标记为错误，不应作为学习依据';
  } else if (edge.status === 'confirmed') {
    headline = '这条连接已经人工确认';
  } else if (edge.status === 'candidate' || evidenceCount === 0) {
    headline = '这条连接仍需查看来源或人工核验';
  } else if (edge.origin === 'deterministic') {
    headline = '这条连接由项目、课堂或笔记结构直接建立';
  } else if (edge.confidence >= 0.85) {
    headline = '系统认为这条连接的依据较强';
  } else if (edge.confidence >= 0.6) {
    headline = '系统认为这条连接的依据中等';
  } else {
    headline = '系统认为这条连接的依据较弱，建议谨慎使用';
  }

  return {
    typeLabel: RELATION_LABEL[edge.type],
    statusLabel: STATUS_LABEL[edge.status],
    originLabel: ORIGIN_LABEL[edge.origin],
    confidencePercent,
    evidenceCount,
    headline,
    caution: '连接置信度只表示系统对“两个节点应这样连接”的把握，不代表节点内容本身的事实正确率。',
  };
}
