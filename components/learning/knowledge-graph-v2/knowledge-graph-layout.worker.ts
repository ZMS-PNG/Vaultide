/// <reference lib="webworker" />

import {
  layoutKnowledgeGraph,
  type KnowledgeGraphLayoutEdge,
  type KnowledgeGraphLayoutNode,
} from './knowledge-graph-layout';

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = (event: MessageEvent<{
  nodes: KnowledgeGraphLayoutNode[];
  edges: KnowledgeGraphLayoutEdge[];
}>) => {
  self.postMessage(layoutKnowledgeGraph(event.data.nodes, event.data.edges));
};

export {};
