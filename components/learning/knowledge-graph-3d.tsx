'use client';

import { RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { KnowledgeGraph, KnowledgeNode } from '@/lib/learning/domain/synthesis';

interface ProjectedNode {
  node: KnowledgeNode;
  x: number;
  y: number;
  depth: number;
  radius: number;
}

const NODE_COLOR: Record<KnowledgeNode['type'], string> = {
  project: '#ec4899',
  classroom: '#8b5cf6',
  concept: '#22d3ee',
  source: '#34d399',
  obsidian: '#f59e0b',
};

function masteryLabel(mastery: number | null): string {
  return mastery === null ? '掌握度未知' : `掌握度 ${Math.round(mastery * 100)}%`;
}

function rotateAndProject(
  x: number,
  y: number,
  z: number,
  rotationX: number,
  rotationY: number,
  zoom: number,
  width: number,
  height: number,
): { x: number; y: number; depth: number; scale: number } {
  const cosY = Math.cos(rotationY);
  const sinY = Math.sin(rotationY);
  const x1 = x * cosY - z * sinY;
  const z1 = x * sinY + z * cosY;
  const cosX = Math.cos(rotationX);
  const sinX = Math.sin(rotationX);
  const y1 = y * cosX - z1 * sinX;
  const z2 = y * sinX + z1 * cosX;
  const camera = 4.2;
  const perspective = camera / Math.max(1.8, camera - z2);
  const base = Math.min(width, height) * 0.34 * zoom;
  return {
    x: width / 2 + x1 * base * perspective,
    y: height / 2 - y1 * base * perspective,
    depth: z2,
    scale: perspective,
  };
}

export function KnowledgeGraph3D({
  graph,
  axisLabels,
}: {
  graph: KnowledgeGraph;
  axisLabels?: {
    x: { label: string };
    y: { label: string };
    z: { label: string };
  };
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const redrawRef = useRef<() => void>(() => undefined);
  const interactionRef = useRef({
    rotationX: -0.35,
    rotationY: 0.65,
    zoom: 1,
    dragging: false,
    pointerX: 0,
    pointerY: 0,
    pointerStartX: 0,
    pointerStartY: 0,
    hoverX: -10_000,
    hoverY: -10_000,
  });
  const projectedRef = useRef<ProjectedNode[]>([]);
  const [selected, setSelected] = useState<KnowledgeNode | null>(null);

  const selectAdjacentNode = (offset: number) => {
    if (graph.nodes.length === 0) return;
    const currentIndex = selected ? graph.nodes.findIndex((node) => node.id === selected.id) : -1;
    const nextIndex = (currentIndex + offset + graph.nodes.length) % graph.nodes.length;
    setSelected(graph.nodes[nextIndex]);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    let animationFrame = 0;
    let framePending = false;
    let width = 1;
    let height = 1;
    let pixelRatio = 1;

    const requestDraw = () => {
      if (framePending) return;
      framePending = true;
      animationFrame = requestAnimationFrame(() => {
        framePending = false;
        draw();
      });
    };
    const resize = () => {
      const rect = container.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      requestDraw();
    };
    const draw = () => {
      const state = interactionRef.current;
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.clearRect(0, 0, width, height);
      const dark = document.documentElement.classList.contains('dark');
      const foreground = dark ? '#e2e8f0' : '#334155';
      const muted = dark ? 'rgba(148,163,184,.34)' : 'rgba(100,116,139,.28)';
      const project = (x: number, y: number, z: number) =>
        rotateAndProject(x, y, z, state.rotationX, state.rotationY, state.zoom, width, height);

      const origin = project(0, 0, 0);
      const axes = [
        {
          point: project(1.25, 0, 0),
          color: '#f472b6',
          label: `X ${axisLabels?.x.label ?? '时间'}`,
        },
        {
          point: project(0, 1.25, 0),
          color: '#60a5fa',
          label: `Y ${axisLabels?.y.label ?? '知识板块'}`,
        },
        {
          point: project(0, 0, 1.25),
          color: '#a3e635',
          label: `Z ${axisLabels?.z.label ?? '掌握度'}`,
        },
      ];
      context.lineWidth = 1;
      context.font = '12px system-ui, sans-serif';
      for (const axis of axes) {
        context.strokeStyle = axis.color;
        context.beginPath();
        context.moveTo(origin.x, origin.y);
        context.lineTo(axis.point.x, axis.point.y);
        context.stroke();
        context.fillStyle = axis.color;
        context.fillText(axis.label, axis.point.x + 5, axis.point.y - 4);
      }

      const projected = graph.nodes.map((node) => {
        const point = project(node.x, node.y, node.z);
        return {
          node,
          x: point.x,
          y: point.y,
          depth: point.depth,
          radius:
            (node.type === 'project'
              ? 10
              : node.type === 'classroom'
                ? 8
                : node.type === 'concept'
                  ? 5.5
                  : 4.5) * point.scale,
        };
      });
      const byId = new Map(projected.map((item) => [item.node.id, item]));
      for (const edge of graph.edges) {
        const source = byId.get(edge.source);
        const target = byId.get(edge.target);
        if (!source || !target) continue;
        context.strokeStyle =
          edge.type === 'related'
            ? dark
              ? 'rgba(167,139,250,.42)'
              : 'rgba(109,40,217,.28)'
            : muted;
        context.lineWidth = edge.type === 'related' ? 0.7 + edge.weight * 1.4 : 0.7;
        context.beginPath();
        context.moveTo(source.x, source.y);
        context.lineTo(target.x, target.y);
        context.stroke();
      }

      projected.sort((left, right) => left.depth - right.depth);
      let hovered: ProjectedNode | undefined;
      for (const item of projected) {
        const distance = Math.hypot(state.hoverX - item.x, state.hoverY - item.y);
        if (distance <= Math.max(8, item.radius + 3)) hovered = item;
        context.globalAlpha = 0.72 + Math.max(-0.18, Math.min(0.18, item.depth * 0.12));
        context.fillStyle = NODE_COLOR[item.node.type];
        context.beginPath();
        context.arc(item.x, item.y, Math.max(2.8, item.radius), 0, Math.PI * 2);
        context.fill();
        if (item.node.id === selected?.id || distance <= Math.max(8, item.radius + 3)) {
          context.globalAlpha = 1;
          context.strokeStyle = foreground;
          context.lineWidth = 1.5;
          context.stroke();
          context.fillStyle = foreground;
          context.font = '12px system-ui, sans-serif';
          context.fillText(item.node.label.slice(0, 28), item.x + item.radius + 5, item.y - 5);
        }
      }
      context.globalAlpha = 1;
      canvas.style.cursor = state.dragging ? 'grabbing' : hovered ? 'pointer' : 'grab';
      projectedRef.current = projected;
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();
    redrawRef.current = requestDraw;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      interactionRef.current.zoom = Math.max(
        0.55,
        Math.min(2.4, interactionRef.current.zoom * (event.deltaY > 0 ? 0.92 : 1.08)),
      );
      requestDraw();
    };
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    const themeObserver = new MutationObserver(requestDraw);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    requestDraw();
    return () => {
      cancelAnimationFrame(animationFrame);
      observer.disconnect();
      themeObserver.disconnect();
      canvas.removeEventListener('wheel', handleWheel);
      redrawRef.current = () => undefined;
    };
  }, [axisLabels?.x.label, axisLabels?.y.label, axisLabels?.z.label, graph, selected?.id]);

  const pointerPosition = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  return (
    <div className="space-y-3">
      <div
        ref={containerRef}
        className="relative h-[58dvh] min-h-[420px] overflow-hidden rounded-2xl border border-slate-200 bg-[radial-gradient(circle_at_50%_35%,rgba(139,92,246,.16),transparent_58%)] dark:border-slate-700 dark:bg-slate-950"
      >
        <canvas
          ref={canvasRef}
          tabIndex={0}
          aria-label="可旋转的三维知识关系图"
          aria-describedby="knowledge-graph-controls"
          onKeyDown={(event) => {
            const state = interactionRef.current;
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
              event.preventDefault();
              state.rotationY += event.key === 'ArrowLeft' ? -0.12 : 0.12;
            } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
              event.preventDefault();
              state.rotationX = Math.max(
                -1.35,
                Math.min(1.35, state.rotationX + (event.key === 'ArrowUp' ? -0.12 : 0.12)),
              );
            } else if (event.key === '+' || event.key === '=') {
              event.preventDefault();
              state.zoom = Math.min(2.4, state.zoom * 1.08);
            } else if (event.key === '-' || event.key === '_') {
              event.preventDefault();
              state.zoom = Math.max(0.55, state.zoom * 0.92);
            } else if (event.key === 'Enter') {
              event.preventDefault();
              selectAdjacentNode(1);
            }
            redrawRef.current();
          }}
          onPointerDown={(event) => {
            const position = pointerPosition(event);
            interactionRef.current.dragging = true;
            interactionRef.current.pointerX = position.x;
            interactionRef.current.pointerY = position.y;
            interactionRef.current.pointerStartX = position.x;
            interactionRef.current.pointerStartY = position.y;
            event.currentTarget.setPointerCapture(event.pointerId);
            redrawRef.current();
          }}
          onPointerMove={(event) => {
            const position = pointerPosition(event);
            const state = interactionRef.current;
            state.hoverX = position.x;
            state.hoverY = position.y;
            if (state.dragging) {
              state.rotationY += (position.x - state.pointerX) * 0.008;
              state.rotationX = Math.max(
                -1.35,
                Math.min(1.35, state.rotationX + (position.y - state.pointerY) * 0.008),
              );
              state.pointerX = position.x;
              state.pointerY = position.y;
            }
            redrawRef.current();
          }}
          onPointerUp={(event) => {
            const state = interactionRef.current;
            const position = pointerPosition(event);
            const moved =
              Math.abs(position.x - state.pointerStartX) +
              Math.abs(position.y - state.pointerStartY);
            state.dragging = false;
            redrawRef.current();
            if (moved > 4) return;
            const hit = [...projectedRef.current]
              .reverse()
              .find(
                (item) =>
                  Math.hypot(position.x - item.x, position.y - item.y) <=
                  Math.max(9, item.radius + 4),
              );
            if (hit) setSelected(hit.node);
          }}
          onPointerLeave={() => {
            interactionRef.current.dragging = false;
            interactionRef.current.hoverX = -10_000;
            interactionRef.current.hoverY = -10_000;
            redrawRef.current();
          }}
          className="absolute inset-0 touch-none outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500"
        />
        <button
          type="button"
          onClick={() => {
            interactionRef.current.rotationX = -0.35;
            interactionRef.current.rotationY = 0.65;
            interactionRef.current.zoom = 1;
            redrawRef.current();
          }}
          className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white/90 px-2.5 py-1.5 text-xs text-slate-600 shadow-sm backdrop-blur hover:bg-white dark:border-slate-700 dark:bg-slate-900/90 dark:text-slate-300"
        >
          <RotateCcw className="h-3.5 w-3.5" /> 重置视角
        </button>
        {selected && (
          <div className="absolute bottom-3 left-3 max-w-sm rounded-xl border border-slate-200 bg-white/95 p-3 text-sm shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
            <div className="font-medium">{selected.label}</div>
            <div className="mt-1 text-xs leading-5 text-slate-500">
              {selected.domain} · {masteryLabel(selected.mastery)} ·{' '}
              {selected.timestamp.slice(0, 10)}
            </div>
            {selected.url && (
              <a
                href={selected.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 block truncate text-xs text-violet-600 hover:underline dark:text-violet-400"
              >
                打开引用来源
              </a>
            )}
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-slate-500">
        {Object.entries(NODE_COLOR).map(([type, color]) => (
          <span key={type} className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
            {type === 'project'
              ? '项目'
              : type === 'classroom'
                ? '课堂'
                : type === 'concept'
                  ? '知识点'
                  : type === 'source'
                    ? '外部引用'
                    : 'Obsidian 来源'}
          </span>
        ))}
        <span id="knowledge-graph-controls">
          拖动或方向键旋转 · 滚轮或 +/- 缩放 · 点击或 Enter 查看节点
        </span>
      </div>
      <details className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 text-sm dark:border-slate-700 dark:bg-slate-950/50">
        <summary className="cursor-pointer font-medium text-slate-700 dark:text-slate-200">
          节点列表（键盘与屏幕阅读器入口，共 {graph.nodes.length} 个）
        </summary>
        <div className="mt-3 grid max-h-64 gap-2 overflow-auto sm:grid-cols-2 lg:grid-cols-3">
          {graph.nodes.map((node) => (
            <button
              key={node.id}
              type="button"
              onClick={() => setSelected(node)}
              aria-pressed={selected?.id === node.id}
              className="min-w-0 rounded-lg border border-slate-200 bg-white p-2 text-left hover:border-violet-300 hover:bg-violet-50 aria-pressed:border-violet-500 aria-pressed:bg-violet-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-violet-950/30 dark:aria-pressed:bg-violet-950/40"
            >
              <span className="block truncate font-medium">{node.label}</span>
              <span className="mt-1 block truncate text-xs text-slate-500">
                {node.type} · {node.domain} · {masteryLabel(node.mastery)}
              </span>
            </button>
          ))}
        </div>
      </details>
    </div>
  );
}
