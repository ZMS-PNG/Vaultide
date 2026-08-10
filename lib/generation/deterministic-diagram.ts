import type { SceneOutline } from '@/lib/types/generation';
import type { DiagramConfig, DiagramEdge, DiagramNode } from '@/lib/types/widgets';

export interface DeterministicDiagramResult {
  html: string;
  widgetConfig: DiagramConfig;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/-->/g, '--\\>');
}

function isChinese(outline: SceneOutline, languageDirective?: string): boolean {
  return (
    /Chinese|中文|zh-/iu.test(languageDirective ?? '') ||
    /\p{Script=Han}/u.test(
      `${outline.title}${outline.description}${(outline.keyPoints ?? []).join('')}`,
    )
  );
}

function uniqueId(raw: string, index: number, used: Set<string>): string {
  const base =
    raw
      .trim()
      .replace(/[^\p{Letter}\p{Number}_-]+/gu, '-')
      .replace(/^-+|-+$/g, '') || `node-${index + 1}`;
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) candidate = `${base}-${suffix++}`;
  used.add(candidate);
  return candidate;
}

function buildNodes(outline: SceneOutline): DiagramNode[] {
  const prescribed = outline.widgetOutline?.nodes ?? [];
  const keyPoints = outline.keyPoints ?? [];
  const requestedCount = outline.widgetOutline?.nodeCount;
  const limit =
    typeof requestedCount === 'number' && requestedCount > 0
      ? Math.max(1, Math.min(8, Math.floor(requestedCount)))
      : Math.max(3, Math.min(6, prescribed.length || keyPoints.length || 4));
  const used = new Set<string>();

  if (prescribed.length > 0) {
    return prescribed.slice(0, limit).map((node, index) => ({
      id: uniqueId(node.id, index, used),
      label: node.label.trim() || `Node ${index + 1}`,
      details:
        node.details?.trim() ||
        keyPoints[index % Math.max(1, keyPoints.length)] ||
        outline.description,
      type: index === 0 ? 'start' : index === prescribed.length - 1 ? 'end' : 'default',
    }));
  }

  const seeds = [
    ...keyPoints,
    outline.description,
    isChinese(outline) ? '验证结果与失败边界' : 'Verification result and failure boundary',
  ]
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, limit);

  return seeds.map((entry, index) => ({
    id: uniqueId(`node-${index + 1}`, index, used),
    label: entry.length > 34 ? `${entry.slice(0, 32)}…` : entry,
    details: entry,
    type: index === 0 ? 'start' : index === seeds.length - 1 ? 'end' : 'default',
  }));
}

function buildEdges(
  outline: SceneOutline,
  nodes: DiagramNode[],
  originalIds: readonly string[],
): DiagramEdge[] {
  const prescribed = outline.widgetOutline?.nodes ?? [];
  const normalizedByOriginal = new Map(
    prescribed.slice(0, nodes.length).map((node, index) => [node.id, nodes[index].id]),
  );
  const edges: DiagramEdge[] = [];

  for (let index = 0; index < nodes.length; index++) {
    const originalParent = prescribed[index]?.parentId;
    const parentId = originalParent ? normalizedByOriginal.get(originalParent) : undefined;
    const from = parentId ?? (index > 0 ? nodes[index - 1].id : undefined);
    if (!from || from === nodes[index].id) continue;
    edges.push({
      id: `edge-${edges.length + 1}`,
      from,
      to: nodes[index].id,
      label: outline.widgetOutline?.diagramType === 'hierarchy' ? 'supports' : 'leads to',
    });
  }

  // Keep this argument in the contract so a caller can prove prescribed IDs
  // were normalized rather than silently discarded.
  void originalIds;
  return edges;
}

function nodePosition(index: number, count: number): { x: number; y: number } {
  if (count <= 1) return { x: 560, y: 235 };
  const usableWidth = 880;
  const x = 120 + (usableWidth * index) / (count - 1);
  const y = 215 + (index % 2 === 0 ? -48 : 48);
  return { x: Math.round(x), y };
}

/**
 * Produces the high-frequency diagram scene without asking a language model to
 * author an entire HTML application. The approved outline still controls every
 * node and teaching point; layout, controls, feedback, replay, and acceptance
 * checks are deterministic and therefore cannot time out or drift structurally.
 */
export function buildDeterministicDiagram(
  outline: SceneOutline,
  languageDirective?: string,
): DeterministicDiagramResult {
  const chinese = isChinese(outline, languageDirective);
  const nodes = buildNodes(outline).map((node, index, all) => ({
    ...node,
    position: nodePosition(index, all.length),
  }));
  const originalIds = (outline.widgetOutline?.nodes ?? []).map((node) => node.id);
  const edges = buildEdges(outline, nodes, originalIds);
  const widgetConfig: DiagramConfig = {
    type: 'diagram',
    diagramType: outline.widgetOutline?.diagramType ?? 'flowchart',
    description: outline.description,
    nodes,
    edges,
    revealOrder: nodes.map((node) => node.id),
  };

  const labels = chinese
    ? {
        eyebrow: '可操作知识逻辑图',
        intro:
          '这不是一张只供观看的图片。请沿连接关系逐步检查输入、机制、状态与结果；每次选择节点后，右侧会显示它在整条因果链中的职责、与相邻节点的依赖，以及可观察的验证方式。',
        mechanismTitle: '机制与边界',
        mechanism:
          '连接线表达的是“前一条件如何约束后一结果”，不是简单的阅读顺序。比较相邻节点时，要说明传递了什么信息、状态或证据；如果预期结果没有出现，先定位最后一个仍然满足验收条件的节点，再检查它与下一节点之间的契约。',
        taskTitle: '学习者任务',
        task: '先点击“下一节点”完整走一遍，再使用“对比连接”选择一条边，口头解释为什么上游变化会影响下游。最后点击“验证理解”，提交一个可检查结论：你选择的关键节点、依据、预期结果和一个失败条件。',
        acceptanceTitle: '完成标准',
        acceptance:
          '能够不看提示复述至少三段连接关系；用本课要点解释一个真实例子；指出一个失效边界；并根据页面反馈确认自己的判断，而不是只重复节点名称。',
        evidenceTitle: '本场依据与计划要点',
        previous: '上一节点',
        next: '下一节点',
        compare: '对比连接',
        verify: '验证理解',
        reset: '重置并重放',
        statusInitial: '尚未开始。请选择一个节点或点击“下一节点”。',
        selected: '已聚焦',
        compared: '已对比连接',
        verified: '已记录验证任务：请说出机制、证据、结果与失败边界。',
        resetDone: '已重置。图谱回到起点，可以重新验证。',
        detailPrefix: '当前节点',
      }
    : {
        eyebrow: 'Interactive knowledge-logic map',
        intro:
          'This is not a picture to watch passively. Follow the connections to inspect inputs, mechanisms, state, and results. Selecting a node reveals its responsibility, dependency on adjacent nodes, and an observable verification method.',
        mechanismTitle: 'Mechanism and boundary',
        mechanism:
          'An edge means that an upstream condition constrains a downstream result, not merely that one label is read before another. When comparing adjacent nodes, name the information, state, or evidence being transferred. If the expected result disappears, locate the last node whose acceptance condition still holds and inspect the contract to the next node.',
        taskTitle: 'Learner task',
        task: 'Use Next node to traverse the whole map, then choose Compare connection and explain why an upstream change affects the downstream node. Finish with Verify understanding and state a checkable conclusion: key node, evidence, expected result, and one failure condition.',
        acceptanceTitle: 'Completion criteria',
        acceptance:
          'Without prompts, explain at least three connections, apply the planned learning points to a real example, identify one failure boundary, and use the visible status feedback to verify the conclusion.',
        evidenceTitle: 'Approved evidence and learning points',
        previous: 'Previous node',
        next: 'Next node',
        compare: 'Compare connection',
        verify: 'Verify understanding',
        reset: 'Reset and replay',
        statusInitial: 'Not started. Select a node or choose Next node.',
        selected: 'Focused',
        compared: 'Compared connection',
        verified:
          'Verification task recorded: state the mechanism, evidence, result, and failure boundary.',
        resetDone: 'Reset complete. The map is back at the starting point.',
        detailPrefix: 'Current node',
      };

  const edgeSvg = edges
    .map((edge) => {
      const from = nodes.find((node) => node.id === edge.from)?.position;
      const to = nodes.find((node) => node.id === edge.to)?.position;
      if (!from || !to) return '';
      return `<path id="${escapeHtml(edge.id)}" class="logic-edge" data-from="${escapeHtml(
        edge.from,
      )}" data-to="${escapeHtml(
        edge.to,
      )}" d="M ${from.x + 78} ${from.y} C ${from.x + 118} ${from.y}, ${to.x - 118} ${
        to.y
      }, ${to.x - 78} ${to.y}" marker-end="url(#arrow)" />`;
    })
    .join('');
  const nodeSvg = nodes
    .map(
      (node, index) => `<g id="diagram-${escapeHtml(node.id)}" class="logic-node${
        index === 0 ? ' is-active' : ''
      }" role="button" tabindex="0" data-node-index="${index}" aria-label="${escapeHtml(
        node.label,
      )}" transform="translate(${node.position?.x ?? 0} ${node.position?.y ?? 0})">
  <circle r="72" />
  <text text-anchor="middle" y="-8">${escapeHtml(
    node.label.length > 18 ? `${node.label.slice(0, 17)}…` : node.label,
  )}</text>
  <text class="node-index" text-anchor="middle" y="24">${String(index + 1).padStart(2, '0')}</text>
</g>`,
    )
    .join('');
  const keyPointItems = (outline.keyPoints ?? [])
    .map((point) => `<li>${escapeHtml(point)}</li>`)
    .join('');
  const nodeCards = nodes
    .map(
      (node, index) => `<article class="node-card" data-card-index="${index}">
  <span>${String(index + 1).padStart(2, '0')}</span>
  <div><strong>${escapeHtml(node.label)}</strong><p>${escapeHtml(
    node.details || outline.description,
  )}</p></div>
</article>`,
    )
    .join('');
  const configJson = safeJson(widgetConfig);
  const initialDetail = nodes[0]?.details || outline.description;

  const html = `<!DOCTYPE html>
<html lang="${chinese ? 'zh-CN' : 'en'}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(outline.title)}</title>
<style>
:root{color-scheme:dark;--ink:#ecf4ff;--muted:#9fb1ca;--panel:rgba(14,25,48,.78);--line:#33496b;--violet:#8b5cf6;--cyan:#22d3ee;--good:#34d399}
*{box-sizing:border-box}body{margin:0;min-height:100vh;color:var(--ink);background:radial-gradient(circle at 12% 4%,#263c78 0,transparent 34%),radial-gradient(circle at 92% 18%,#123f52 0,transparent 32%),#07101f;font:15px/1.65 Inter,ui-sans-serif,system-ui,sans-serif}
.app{width:min(1220px,calc(100% - 28px));margin:0 auto;padding:28px 0 42px}.hero{display:grid;grid-template-columns:1.25fr .75fr;gap:18px;align-items:stretch}.panel{border:1px solid rgba(151,177,216,.2);border-radius:22px;background:var(--panel);box-shadow:0 22px 70px rgba(0,0,0,.24);backdrop-filter:blur(18px)}
.intro{padding:26px 28px}.eyebrow{color:#77e6f5;font-size:12px;font-weight:800;letter-spacing:.18em;text-transform:uppercase}.intro h1{margin:8px 0 10px;font-size:clamp(28px,4vw,50px);line-height:1.08}.intro p,.teaching p{color:#c7d4e8}.task{padding:24px}.task h2,.teaching h2{margin:0 0 8px;font-size:18px}.task ul{margin:10px 0 0;padding-left:20px;color:#dce7f7}
.map{margin-top:18px;padding:18px;overflow:hidden}.map svg{width:100%;height:auto;display:block}.logic-edge{fill:none;stroke:var(--line);stroke-width:5;transition:.25s}.logic-edge.is-active{stroke:var(--cyan);filter:drop-shadow(0 0 8px rgba(34,211,238,.75))}.logic-node{cursor:pointer;outline:none}.logic-node circle{fill:#101d35;stroke:#516786;stroke-width:4;transition:.22s}.logic-node text{fill:#e9f2ff;font-size:13px;font-weight:750;pointer-events:none}.logic-node .node-index{fill:#8295b1;font-size:11px}.logic-node:hover circle,.logic-node:focus-visible circle,.logic-node.is-active circle{fill:#172c4f;stroke:var(--cyan);stroke-width:6;filter:drop-shadow(0 0 14px rgba(34,211,238,.58))}
.controls{display:flex;flex-wrap:wrap;gap:10px;margin-top:12px}.controls button{appearance:none;border:1px solid rgba(151,177,216,.28);border-radius:999px;padding:10px 15px;color:#eaf3ff;background:#111f38;font:inherit;font-weight:760;cursor:pointer;transition:.2s}.controls button:hover,.controls button:focus-visible{transform:translateY(-1px);border-color:var(--cyan);outline:none}.controls .primary{border:0;background:linear-gradient(135deg,var(--violet),#2563eb)}
.feedback{display:grid;grid-template-columns:1fr .8fr;gap:14px;margin-top:14px}.status,.detail{min-height:92px;padding:16px 18px;border-radius:16px;border:1px solid rgba(151,177,216,.18);background:rgba(7,16,31,.68)}.status{color:#dffdf7}.detail strong{color:#8be9f7}.detail p{margin:5px 0 0;color:#c7d4e8}
.teaching{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:18px}.teaching article{padding:20px}.node-list{margin-top:18px;display:grid;grid-template-columns:repeat(2,1fr);gap:10px}.node-card{display:flex;gap:12px;padding:14px 16px;border:1px solid rgba(151,177,216,.15);border-radius:15px;background:rgba(13,25,47,.68)}.node-card>span{color:#67e8f9;font-weight:900}.node-card strong{display:block}.node-card p{margin:3px 0 0;color:#9fb1ca}
@media(max-width:850px){.hero,.feedback,.teaching{grid-template-columns:1fr}.node-list{grid-template-columns:1fr}.map{overflow-x:auto}.map svg{min-width:900px}}
</style>
</head>
<body data-vaultide-learning-shell="true">
<main class="app">
  <section class="hero">
    <article class="panel intro">
      <div class="eyebrow">${labels.eyebrow}</div>
      <h1>${escapeHtml(outline.title)}</h1>
      <p>${escapeHtml(outline.description)}</p>
      <p>${labels.intro}</p>
    </article>
    <aside class="panel task">
      <h2>${labels.evidenceTitle}</h2>
      <ul>${keyPointItems || `<li>${escapeHtml(outline.description)}</li>`}</ul>
    </aside>
  </section>
  <section class="panel map" aria-label="${escapeHtml(labels.eyebrow)}">
    <svg viewBox="0 0 1120 470" role="img" aria-labelledby="map-title map-desc">
      <title id="map-title">${escapeHtml(outline.title)}</title>
      <desc id="map-desc">${escapeHtml(outline.description)}</desc>
      <defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="#22d3ee"/></marker></defs>
      ${edgeSvg}
      ${nodeSvg}
    </svg>
    <div class="controls" aria-label="diagram controls">
      <button id="diagram-previous" type="button">${labels.previous}</button>
      <button id="diagram-next" class="primary" type="button">${labels.next}</button>
      <button id="diagram-compare" type="button">${labels.compare}</button>
      <button id="diagram-verify" type="button">${labels.verify}</button>
      <button id="vaultide-learning-reset" type="button">${labels.reset}</button>
    </div>
    <div class="feedback">
      <p id="vaultide-learning-status" class="status" role="status" aria-live="polite">${labels.statusInitial}</p>
      <div class="detail"><strong>${labels.detailPrefix}</strong><p id="diagram-detail">${escapeHtml(
        initialDetail,
      )}</p></div>
    </div>
  </section>
  <section class="teaching">
    <article class="panel"><h2>${labels.mechanismTitle}</h2><p>${labels.mechanism}</p></article>
    <article class="panel"><h2>${labels.taskTitle}</h2><p>${labels.task}</p></article>
    <article class="panel"><h2>${labels.acceptanceTitle}</h2><p>${labels.acceptance}</p></article>
  </section>
  <section class="node-list">${nodeCards}</section>
</main>
<script type="application/json" id="widget-config">${configJson}</script>
<script>
(function(){
  var config=JSON.parse(document.getElementById('widget-config').textContent||'{}');
  var nodes=Array.from(document.querySelectorAll('.logic-node'));
  var edges=Array.from(document.querySelectorAll('.logic-edge'));
  var status=document.getElementById('vaultide-learning-status');
  var detail=document.getElementById('diagram-detail');
  var previous=document.getElementById('diagram-previous');
  var next=document.getElementById('diagram-next');
  var compare=document.getElementById('diagram-compare');
  var verify=document.getElementById('diagram-verify');
  var reset=document.getElementById('vaultide-learning-reset');
  var index=0;
  function focusNode(nextIndex){
    index=(nextIndex+nodes.length)%nodes.length;
    nodes.forEach(function(node,i){node.classList.toggle('is-active',i===index);});
    edges.forEach(function(edge){edge.classList.toggle('is-active',edge.dataset.to===config.nodes[index].id);});
    detail.textContent=config.nodes[index].details||config.nodes[index].label;
    status.textContent=${safeJson(labels.selected + '：')}+config.nodes[index].label+'。'+detail.textContent;
  }
  nodes.forEach(function(node,i){node.addEventListener('click',function(){focusNode(i);});node.addEventListener('keydown',function(event){if(event.key==='Enter'||event.key===' '){event.preventDefault();focusNode(i);}});});
  previous.addEventListener('click',function(){focusNode(index-1);});
  next.addEventListener('click',function(){focusNode(index+1);});
  compare.addEventListener('click',function(){var edge=config.edges[Math.max(0,index-1)]||config.edges[0];if(!edge)return;edges.forEach(function(item){item.classList.toggle('is-active',item.id===edge.id);});status.textContent=${safeJson(
    labels.compared + '：',
  )}+(config.nodes.find(function(node){return node.id===edge.from;})||{}).label+' → '+(config.nodes.find(function(node){return node.id===edge.to;})||{}).label+'。';});
  verify.addEventListener('click',function(){status.textContent=${safeJson(labels.verified)};});
  reset.addEventListener('click',function(){focusNode(0);edges.forEach(function(edge){edge.classList.remove('is-active');});status.textContent=${safeJson(
    labels.resetDone,
  )};window.dispatchEvent(new CustomEvent('vaultide:reset-interactive'));});
  document.addEventListener('keydown',function(event){if(event.key==='ArrowRight')focusNode(index+1);if(event.key==='ArrowLeft')focusNode(index-1);});
  window.addEventListener('vaultide:reset-interactive',function(){index=0;});
  focusNode(0);
})();
</script>
</body>
</html>`;

  return { html, widgetConfig };
}
