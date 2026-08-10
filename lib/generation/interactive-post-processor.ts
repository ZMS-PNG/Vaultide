/**
 * Interactive HTML Post-Processor
 *
 * Ported from Python's PostProcessor class (learn-your-way/concept_to_html.py:287-385)
 *
 * Handles:
 * - LaTeX delimiter conversion ($$...$$ -> \[...\], $...$ -> \(...\))
 * - KaTeX CSS/JS injection with auto-render and MutationObserver
 * - Script tag protection during LaTeX conversion
 */

/**
 * Main entry point: post-process generated interactive HTML
 * Converts LaTeX delimiters and injects KaTeX rendering resources.
 */
export function postProcessInteractiveHtml(html: string): string {
  // Convert LaTeX delimiters while protecting script tags
  let processed = convertLatexDelimiters(html);

  // Inject KaTeX resources if not already present
  if (!processed.toLowerCase().includes('katex')) {
    processed = injectKatex(processed);
  }

  return processed;
}

export interface InteractiveLearningShellOptions {
  title: string;
  description?: string;
  keyPoints?: readonly string[];
}

/**
 * Adds a deterministic teaching shell around model-generated widgets.
 *
 * Generated diagrams can be visually rich while omitting the learner-facing
 * explanation, persistent feedback, or replay control required by the course
 * quality contract. This shell preserves the generated interaction and adds
 * the missing teaching and recovery affordances.
 */
export function ensureInteractiveLearningShell(
  html: string,
  options: InteractiveLearningShellOptions,
): string {
  if (!html || html.includes('data-vaultide-learning-shell="true"')) return html;

  const title = escapeHtml(options.title || '交互学习');
  const description = escapeHtml(
    options.description?.trim() ||
      '通过逐步操作场景中的控件、对象、节点或步骤，观察输入如何改变状态和输出，并判断每个环节承担的职责。',
  );
  const keyPoints = (options.keyPoints ?? [])
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 5);
  const keyPointItems =
    keyPoints.length > 0
      ? keyPoints.map((entry) => `<li>${escapeHtml(entry)}</li>`).join('')
      : '<li>识别输入、处理机制、状态变化、输出结果与可能的失败位置。</li>';

  const shell = `
<aside id="vaultide-learning-shell" data-vaultide-learning-shell="true" aria-label="交互学习指南">
  <details open>
    <summary>学习任务：${title}</summary>
    <div class="vaultide-learning-shell__body">
      <p><strong>机制说明：</strong>${description}</p>
      <p><strong>操作方法：</strong>先观察初始状态，再使用场景中的按钮、滑杆、对象、节点或步骤控件逐段推进。每次操作后，对照“操作反馈”确认当前状态、刚刚发生的变化，以及这一步为什么会影响后续结果。</p>
      <div><strong>需要掌握的关键点：</strong><ul>${keyPointItems}</ul></div>
      <p><strong>学习者任务：</strong>完成一次从初始状态到目标状态的完整操作；随后闭卷解释输入经过了哪些处理、每个动作改变了什么状态，并指出一个可能导致结果异常的失败点及其可观察证据。</p>
      <p id="vaultide-learning-status" role="status" aria-live="polite"><strong>操作反馈：</strong>尚未开始。请选择场景中的控件或可操作对象，并观察数值、路径、高亮、说明和状态的变化。</p>
      <p><strong>完成标准：</strong>你能够不看提示复述输入、机制、状态与输出之间的关系，解释至少两个关键机制，判断一个失败条件，并用场景中的状态或结果验证自己的判断。</p>
      <button id="vaultide-learning-reset" type="button" data-action="reset-and-replay">重置并重放</button>
    </div>
  </details>
</aside>`;

  const style = `
<style id="vaultide-learning-shell-style">
#vaultide-learning-shell{position:fixed;top:12px;right:12px;z-index:2147483000;width:min(360px,calc(100vw - 24px));max-height:46vh;overflow:auto;color:#f8fafc;background:rgba(15,23,42,.94);border:1px solid rgba(148,163,184,.35);border-radius:14px;box-shadow:0 18px 48px rgba(2,6,23,.34);font:14px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;backdrop-filter:blur(12px)}
#vaultide-learning-shell summary{cursor:pointer;padding:12px 14px;font-weight:700;letter-spacing:.01em}
.vaultide-learning-shell__body{padding:0 14px 14px}
.vaultide-learning-shell__body p{margin:8px 0}
.vaultide-learning-shell__body ul{margin:6px 0 8px;padding-left:20px}
#vaultide-learning-status{padding:9px 10px;border-radius:10px;background:rgba(14,165,233,.13);border:1px solid rgba(56,189,248,.28)}
#vaultide-learning-reset{appearance:none;border:0;border-radius:10px;padding:9px 12px;background:linear-gradient(135deg,#7c3aed,#0ea5e9);color:white;font-weight:700;cursor:pointer}
#vaultide-learning-reset:focus-visible{outline:3px solid rgba(125,211,252,.85);outline-offset:2px}
@media(max-width:720px){#vaultide-learning-shell{top:auto;bottom:10px;max-height:42vh}}
</style>`;

  const script = `
<script id="vaultide-learning-shell-script">
(function(){
  var shell=document.getElementById('vaultide-learning-shell');
  var status=document.getElementById('vaultide-learning-status');
  var reset=document.getElementById('vaultide-learning-reset');
  if(!shell||!status||!reset)return;
  function labelFor(target){
    return (target.getAttribute('aria-label')||target.getAttribute('title')||target.textContent||target.id||target.tagName).trim().replace(/\\s+/g,' ').slice(0,80);
  }
  function report(prefix,target){
    status.innerHTML='<strong>操作反馈：</strong>'+prefix+'“'+labelFor(target)+'”。请观察数值、对象、路径、高亮或说明区的变化，并判断该变化如何影响下一状态或结果。';
  }
  document.addEventListener('click',function(event){
    var target=event.target&&event.target.closest?event.target.closest('button,[role="button"],[data-node],svg g[id]'):null;
    if(!target||shell.contains(target))return;
    window.setTimeout(function(){report('已执行 ',target);},0);
  },true);
  document.addEventListener('input',function(event){
    var target=event.target;
    if(!target||shell.contains(target))return;
    report('已调整 ',target);
  },true);
  reset.addEventListener('click',function(){
    status.innerHTML='<strong>操作反馈：</strong>正在恢复初始对象、数值、路径、选择和步骤状态，随后可以从头重放。';
    window.dispatchEvent(new CustomEvent('vaultide:reset-interactive'));
    window.setTimeout(function(){window.location.reload();},120);
  });
})();
</script>`;

  let output = injectBeforeClosingTag(html, '</head>', style);
  output = injectAfterOpeningBody(output, shell);
  output = injectBeforeClosingTag(output, '</body>', script);
  return output;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function injectBeforeClosingTag(html: string, closingTag: string, content: string): string {
  const index = html.toLocaleLowerCase().lastIndexOf(closingTag);
  if (index < 0) return `${html}\n${content}`;
  return `${html.slice(0, index)}${content}\n${html.slice(index)}`;
}

function injectAfterOpeningBody(html: string, content: string): string {
  const match = /<body\b[^>]*>/iu.exec(html);
  if (!match || match.index === undefined) return `${content}\n${html}`;
  const index = match.index + match[0].length;
  return `${html.slice(0, index)}\n${content}${html.slice(index)}`;
}

/**
 * Convert LaTeX delimiters while protecting <script> tags.
 *
 * - Protects script blocks from modification
 * - Converts $$...$$ to \[...\] (display math)
 * - Converts $...$ to \(...\) (inline math)
 * - Restores script blocks after conversion
 */
function convertLatexDelimiters(html: string): string {
  const scriptBlocks: string[] = [];

  // Protect script tags by replacing them with placeholders
  let processed = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, (match) => {
    scriptBlocks.push(match);
    return `__SCRIPT_BLOCK_${scriptBlocks.length - 1}__`;
  });

  // Convert display math: $$...$$ -> \[...\]
  processed = processed.replace(/\$\$([^$]+)\$\$/g, '\\[$1\\]');

  // Convert inline math: $...$ -> \(...\)
  // Use non-greedy match and exclude newlines to avoid false positives
  processed = processed.replace(/\$([^$\n]+?)\$/g, '\\($1\\)');

  // Restore script blocks in a single pass. A replacer FUNCTION (not a string)
  // is safe even when script content contains `$` — a function's return value
  // is inserted literally, with no `$&`/`$1` substitution. The previous
  // indexOf+substring loop rebuilt the entire string once per block, i.e.
  // O(blocks × length), which balloons memory and blocks the event loop when
  // the generated widget HTML contains many <script> tags.
  processed = processed.replace(
    /__SCRIPT_BLOCK_(\d+)__/g,
    (whole, index) => scriptBlocks[Number(index)] ?? whole,
  );

  return processed;
}

/**
 * Inject KaTeX CSS, JS, auto-render, and MutationObserver before </head>.
 * Falls back to appending at end if </head> is not found.
 */
function injectKatex(html: string): string {
  const katexInjection = `
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js"></script>
<script>
document.addEventListener("DOMContentLoaded", function() {
    const katexOptions = {
        delimiters: [
            {left: '\\\\[', right: '\\\\]', display: true},
            {left: '\\\\(', right: '\\\\)', display: false},
            {left: '$$', right: '$$', display: true},
            {left: '$', right: '$', display: false}
        ],
        throwOnError: false,
        strict: false,
        trust: true
    };

    let renderTimeout;
    function safeRender() {
        if (renderTimeout) clearTimeout(renderTimeout);
        renderTimeout = setTimeout(() => {
            renderMathInElement(document.body, katexOptions);
        }, 100);
    }

    renderMathInElement(document.body, katexOptions);

    const observer = new MutationObserver((mutations) => {
        let shouldRender = false;
        mutations.forEach((mutation) => {
            if (mutation.target &&
                mutation.target.className &&
                typeof mutation.target.className === 'string' &&
                mutation.target.className.includes('katex')) {
                return;
            }
            shouldRender = true;
        });

        if (shouldRender) {
            safeRender();
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true
    });

    setInterval(() => {
        const text = document.body.innerText;
        if (text.includes('\\\\(') || text.includes('$$')) {
            safeRender();
        }
    }, 2000);
});
</script>`;

  // Use indexOf + substring instead of String.replace() because the
  // katexInjection string contains '$' characters that .replace() would
  // interpret as special substitution patterns ($$ → $, $' → post-match text).
  const headCloseIdx = html.indexOf('</head>');
  if (headCloseIdx !== -1) {
    return (
      html.substring(0, headCloseIdx) +
      katexInjection +
      '\n</head>' +
      html.substring(headCloseIdx + 7)
    );
  }

  // Fallback: inject before </body> if </head> is missing
  const bodyCloseIdx = html.indexOf('</body>');
  if (bodyCloseIdx !== -1) {
    return (
      html.substring(0, bodyCloseIdx) +
      katexInjection +
      '\n</body>' +
      html.substring(bodyCloseIdx + 7)
    );
  }

  // Last resort: append at end
  return html + katexInjection;
}
