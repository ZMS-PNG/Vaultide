export interface KnowledgeGraphV2Flags {
  enabled: boolean;
  semanticEdgesEnabled: boolean;
  webglEnabled: boolean;
}

function enabledUnlessFalse(value: string | undefined): boolean {
  return value?.trim().toLowerCase() !== 'false';
}

export function knowledgeGraphV2Flags(): KnowledgeGraphV2Flags {
  return {
    enabled: enabledUnlessFalse(process.env.KNOWLEDGE_GRAPH_V2_ENABLED),
    semanticEdgesEnabled: process.env.KNOWLEDGE_GRAPH_SEMANTIC_EDGES_ENABLED === 'true',
    webglEnabled: process.env.KNOWLEDGE_GRAPH_WEBGL_ENABLED === 'true',
  };
}
