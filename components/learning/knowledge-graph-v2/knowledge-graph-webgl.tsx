'use client';

import { Canvas, type ThreeEvent, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  InstancedMesh,
  Matrix4,
  Object3D,
  Vector3,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type {
  KnowledgeEdgeV2,
  KnowledgeGraphV2,
  KnowledgeNodeTypeV2,
  KnowledgeNodeV2,
} from '@/lib/learning/domain/knowledge-graph-v2/contracts';
import type {
  KnowledgeSpaceAxis,
  KnowledgeSpaceCluster,
} from '@/lib/learning/domain/knowledge-graph-v2/knowledge-space';
import { type KnowledgeGraphLayoutPosition } from './knowledge-graph-layout';

const TYPE_COLORS: Record<KnowledgeNodeTypeV2, string> = {
  project: '#7c3aed',
  'original-note': '#64748b',
  'companion-note': '#10b981',
  'external-source': '#2563eb',
  classroom: '#0891b2',
  concept: '#f59e0b',
  claim: '#ec4899',
  skill: '#14b8a6',
  artifact: '#8b5cf6',
  review: '#ef4444',
};

const EDGE_COLORS: Record<KnowledgeEdgeV2['type'], string> = {
  'belongs-to': '#94a3b8',
  contains: '#64748b',
  cites: '#3b82f6',
  'derived-from': '#06b6d4',
  'companion-of': '#10b981',
  precedes: '#8b5cf6',
  prerequisite: '#f59e0b',
  supports: '#22c55e',
  contradicts: '#ef4444',
  'applies-to': '#14b8a6',
  'related-to': '#94a3b8',
  'review-of': '#f97316',
};

const CLUSTER_COLORS = ['#8b5cf6', '#06b6d4', '#f59e0b', '#10b981', '#ec4899', '#3b82f6'];

interface DisplayNode {
  node: KnowledgeNodeV2;
  position: [number, number, number];
}

function initialLayout(graph: KnowledgeGraphV2): KnowledgeGraphLayoutPosition[] {
  // The first paint is deliberately O(n). The relationship-aware relaxation
  // runs only in the Worker after this stable semantic-coordinate placeholder
  // is visible, so a 2,000-node graph never blocks the main thread on load.
  return graph.nodes.map((node) => ({
    id: node.id,
    x: node.coordinates.x * 5,
    y: node.coordinates.z * 3.2,
    z: node.coordinates.y * 4,
  }));
}

function useGraphLayout(graph: KnowledgeGraphV2): DisplayNode[] {
  const layoutKey = useMemo(
    () =>
      `${graph.projectionId}:${graph.layoutVersion}:${graph.nodes
        .map(
          (node) =>
            `${node.id}:${node.coordinates.x.toFixed(4)}:${node.coordinates.y.toFixed(4)}:${node.coordinates.z.toFixed(4)}`,
        )
        .join('\u0000')}`,
    [graph.layoutVersion, graph.nodes, graph.projectionId],
  );
  const fallbackPositions = useMemo(() => initialLayout(graph), [graph]);
  const [completedLayout, setCompletedLayout] = useState(() => ({
    key: layoutKey,
    positions: fallbackPositions,
  }));

  useEffect(() => {
    const nodes = graph.nodes.map((node) => ({ id: node.id, coordinates: node.coordinates }));
    const edges = graph.edges.map((edge) => ({ source: edge.source, target: edge.target }));
    if (typeof Worker === 'undefined') return undefined;
    let active = true;
    const worker = new Worker(new URL('./knowledge-graph-layout.worker.ts', import.meta.url));
    worker.onmessage = (event: MessageEvent<KnowledgeGraphLayoutPosition[]>) => {
      if (active) setCompletedLayout({ key: layoutKey, positions: event.data });
    };
    worker.postMessage({ nodes, edges });
    return () => {
      active = false;
      worker.terminate();
    };
  }, [graph, layoutKey]);

  const positions =
    completedLayout.key === layoutKey ? completedLayout.positions : fallbackPositions;

  return useMemo(() => {
    const positionById = new Map(positions.map((item) => [item.id, item]));
    return graph.nodes.map((node) => {
      const position = positionById.get(node.id);
      return {
        node,
        position: position ? [position.x, position.y, position.z] : [0, 0, 0],
      };
    });
  }, [graph.nodes, positions]);
}

function CameraControls({ nodes }: { nodes: DisplayNode[] }) {
  const { camera, gl, invalidate } = useThree();
  const framing = useMemo(() => {
    if (nodes.length === 0) {
      return {
        center: new Vector3(0, 0, 0),
        distance: 8,
      };
    }

    const minimum = new Vector3(
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
    );
    const maximum = new Vector3(
      Number.NEGATIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    );

    nodes.forEach(({ position }) => {
      minimum.min(new Vector3(...position));
      maximum.max(new Vector3(...position));
    });

    const center = minimum.clone().add(maximum).multiplyScalar(0.5);
    const radius = maximum.clone().sub(minimum).length() * 0.5;
    return {
      center,
      distance: Math.max(7.2, Math.min(24, radius * 2.4)),
    };
  }, [nodes]);

  useEffect(() => {
    const controls = new OrbitControls(camera, gl.domElement);
    controls.enableDamping = false;
    controls.target.copy(framing.center);
    controls.minDistance = Math.max(2.2, framing.distance * 0.32);
    controls.maxDistance = Math.max(24, framing.distance * 4);

    const viewDirection = new Vector3(0.78, 0.62, 1).normalize();
    camera.position.copy(framing.center).addScaledVector(viewDirection, framing.distance);
    camera.lookAt(framing.center);
    camera.updateProjectionMatrix();

    const handleChange = () => invalidate();
    controls.addEventListener('change', handleChange);
    controls.update();
    invalidate();
    return () => {
      controls.removeEventListener('change', handleChange);
      controls.dispose();
    };
  }, [camera, framing, gl, invalidate]);

  return null;
}

function GraphClusterIslands({
  clusters,
  nodes,
  activeClusterId,
}: {
  clusters: KnowledgeSpaceCluster[];
  nodes: DisplayNode[];
  activeClusterId: string | null;
}) {
  const islands = useMemo(() => {
    const positionsById = new Map(nodes.map((item) => [item.node.id, item.position]));
    return clusters
      .map((cluster, index) => {
        const positions = cluster.nodeIds
          .map((nodeId) => positionsById.get(nodeId))
          .filter((position): position is [number, number, number] => Boolean(position));
        if (positions.length === 0) return null;
        const centerX =
          positions.reduce((total, position) => total + position[0], 0) / positions.length;
        const centerZ =
          positions.reduce((total, position) => total + position[2], 0) / positions.length;
        const radius = Math.max(
          0.65,
          Math.min(
            3.2,
            Math.max(
              ...positions.map((position) =>
                Math.hypot(position[0] - centerX, position[2] - centerZ),
              ),
            ) + 0.46,
          ),
        );
        return {
          cluster,
          color: CLUSTER_COLORS[index % CLUSTER_COLORS.length],
          center: [centerX, -3.5, centerZ] as [number, number, number],
          radius,
        };
      })
      .filter(
        (
          island,
        ): island is {
          cluster: KnowledgeSpaceCluster;
          color: string;
          center: [number, number, number];
          radius: number;
        } => Boolean(island),
      );
  }, [clusters, nodes]);

  return (
    <group>
      {islands.map((island) => {
        const selected = island.cluster.id === activeClusterId;
        return (
          <group key={island.cluster.id} position={island.center} rotation={[-Math.PI / 2, 0, 0]}>
            <mesh>
              <circleGeometry args={[island.radius, 48]} />
              <meshBasicMaterial
                color={island.color}
                transparent
                opacity={selected ? 0.12 : 0.045}
                depthWrite={false}
                side={DoubleSide}
              />
            </mesh>
            <mesh position={[0, 0, 0.006]}>
              <ringGeometry args={[island.radius * 0.82, island.radius, 64]} />
              <meshBasicMaterial
                color={island.color}
                transparent
                opacity={selected ? 0.72 : 0.24}
                depthWrite={false}
                side={DoubleSide}
              />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

function GraphEdges({ graph, nodes }: { graph: KnowledgeGraphV2; nodes: DisplayNode[] }) {
  const geometry = useMemo(() => {
    const positions = new Float32Array(graph.edges.length * 6);
    const colors = new Float32Array(graph.edges.length * 6);
    const positionsById = new Map(nodes.map((item) => [item.node.id, item.position]));

    graph.edges.forEach((edge, index) => {
      const source = positionsById.get(edge.source);
      const target = positionsById.get(edge.target);
      if (!source || !target) return;
      positions.set([...source, ...target], index * 6);
      const color = new Color(EDGE_COLORS[edge.type]).multiplyScalar(
        0.45 + Math.max(0, Math.min(1, edge.confidence)) * 0.55,
      );
      colors.set([color.r, color.g, color.b, color.r, color.g, color.b], index * 6);
    });

    const result = new BufferGeometry();
    result.setAttribute('position', new BufferAttribute(positions, 3));
    result.setAttribute('color', new BufferAttribute(colors, 3));
    result.computeBoundingSphere();
    return result;
  }, [graph.edges, nodes]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial vertexColors transparent opacity={0.46} />
    </lineSegments>
  );
}

function GraphNodes({
  nodes,
  selectedNodeId,
  onNodeSelect,
}: {
  nodes: DisplayNode[];
  selectedNodeId?: string;
  onNodeSelect: (node: KnowledgeNodeV2) => void;
}) {
  const meshRef = useRef<InstancedMesh>(null);
  const { invalidate } = useThree();
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const matrix = new Matrix4();
    const object = new Object3D();
    const color = new Color();

    nodes.forEach(({ node, position }, index) => {
      const evidenceScale = 0.82 + Math.min(0.65, Math.log2(node.evidenceCount + 1) * 0.14);
      const selectedScale = node.id === selectedNodeId ? 1.55 : 1;
      object.position.set(...position);
      object.scale.setScalar(evidenceScale * selectedScale);
      object.updateMatrix();
      matrix.copy(object.matrix);
      mesh.setMatrixAt(index, matrix);

      color.set(TYPE_COLORS[node.type]);
      const confidence = Math.max(node.confidence, node.masteryConfidence);
      color.multiplyScalar(0.58 + confidence * 0.42);
      if (node.statusFlags.includes('source-updated')) color.lerp(new Color('#f97316'), 0.45);
      mesh.setColorAt(index, color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    invalidate();
  }, [invalidate, nodes, selectedNodeId]);

  useEffect(() => {
    document.body.style.cursor = hoveredIndex === null ? '' : 'pointer';
    return () => {
      document.body.style.cursor = '';
    };
  }, [hoveredIndex]);

  const select = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    if (event.instanceId === undefined) return;
    const selected = nodes[event.instanceId]?.node;
    if (selected) onNodeSelect(selected);
  };

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, Math.max(1, nodes.length)]}
      frustumCulled
      onClick={select}
      onPointerMove={(event) => {
        event.stopPropagation();
        setHoveredIndex(event.instanceId ?? null);
      }}
      onPointerOut={() => setHoveredIndex(null)}
    >
      <icosahedronGeometry args={[0.16, 1]} />
      <meshStandardMaterial roughness={0.48} metalness={0.08} />
    </instancedMesh>
  );
}

function Scene({
  graph,
  clusters,
  activeClusterId,
  selectedNodeId,
  onNodeSelect,
}: {
  graph: KnowledgeGraphV2;
  clusters: KnowledgeSpaceCluster[];
  activeClusterId: string | null;
  selectedNodeId?: string;
  onNodeSelect: (node: KnowledgeNodeV2) => void;
}) {
  const nodes = useGraphLayout(graph);
  return (
    <>
      <color attach="background" args={['#07111f']} />
      <fog attach="fog" args={['#07111f', 16, 32]} />
      <ambientLight intensity={1.1} />
      <directionalLight position={[5, 8, 6]} intensity={2.2} />
      <directionalLight position={[-6, -3, -5]} intensity={0.8} color="#8b5cf6" />
      <gridHelper args={[12, 12, '#334155', '#172033']} position={[0, -3.6, 0]} />
      <GraphClusterIslands clusters={clusters} nodes={nodes} activeClusterId={activeClusterId} />
      <GraphEdges graph={graph} nodes={nodes} />
      <GraphNodes nodes={nodes} selectedNodeId={selectedNodeId} onNodeSelect={onNodeSelect} />
      <CameraControls nodes={nodes} />
    </>
  );
}

export function KnowledgeGraphWebGL({
  graph,
  clusters,
  activeClusterId,
  axisLabels,
  selectedNodeId,
  onNodeSelect,
  onUnavailable,
}: {
  graph: KnowledgeGraphV2;
  clusters: KnowledgeSpaceCluster[];
  activeClusterId: string | null;
  axisLabels: { x: KnowledgeSpaceAxis; y: KnowledgeSpaceAxis; z: KnowledgeSpaceAxis };
  selectedNodeId?: string;
  onNodeSelect: (node: KnowledgeNodeV2) => void;
  onUnavailable: () => void;
}) {
  return (
    <div className="relative h-[520px] min-h-[420px] overflow-hidden rounded-xl border border-slate-700 bg-slate-950">
      <Canvas
        camera={{ position: [8, 6, 11], fov: 48, near: 0.1, far: 100 }}
        dpr={[1, 1.5]}
        frameloop="demand"
        gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
        fallback={
          <button
            type="button"
            onClick={onUnavailable}
            className="flex h-full w-full items-center justify-center p-6 text-sm text-slate-300"
          >
            当前设备无法创建 WebGL 上下文，切换到兼容视图
          </button>
        }
        onCreated={({ gl }) => {
          gl.setClearColor('#07111f');
        }}
      >
        <Scene
          graph={graph}
          clusters={clusters}
          activeClusterId={activeClusterId}
          selectedNodeId={selectedNodeId}
          onNodeSelect={onNodeSelect}
        />
      </Canvas>
      <div className="pointer-events-none absolute left-3 top-3 rounded-lg bg-slate-950/75 px-2.5 py-1.5 text-[11px] text-slate-300 backdrop-blur">
        鼠标拖动旋转 · 滚轮缩放 · 点击节点查看证据
      </div>
      <div className="pointer-events-none absolute right-3 top-3 grid gap-1 rounded-lg bg-slate-950/75 px-2.5 py-2 text-[10px] text-slate-300 backdrop-blur">
        <span>
          <strong className="text-pink-300">X</strong> {axisLabels.x.label}
        </span>
        <span>
          <strong className="text-blue-300">Y</strong> {axisLabels.y.label}
        </span>
        <span>
          <strong className="text-lime-300">Z</strong> {axisLabels.z.label}
        </span>
      </div>
      {selectedNodeId && (
        <div className="pointer-events-none absolute bottom-3 left-3 max-w-[70%] truncate rounded-lg bg-violet-600/90 px-2.5 py-1.5 text-[11px] text-white shadow-lg">
          {graph.nodes.find((node) => node.id === selectedNodeId)?.label}
        </div>
      )}
      {activeClusterId && (
        <div className="pointer-events-none absolute bottom-3 right-3 max-w-[45%] truncate rounded-lg border border-indigo-400/30 bg-indigo-950/85 px-2.5 py-1.5 text-[11px] text-indigo-100 shadow-lg">
          当前知识簇：{clusters.find((cluster) => cluster.id === activeClusterId)?.label}
        </div>
      )}
    </div>
  );
}
