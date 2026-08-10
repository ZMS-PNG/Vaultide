import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const pptxgen = require('pptxgenjs');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(ROOT, 'output', 'manual');
const SHOTS = path.join(ROOT, 'output', 'playwright', 'ux-optimized');

const pptx = new pptxgen();
pptx.layout = 'LAYOUT_WIDE';
pptx.author = '知洄 Vaultide';
pptx.company = 'Vaultide';
pptx.subject = '宣传与使用手册';
pptx.title = '知洄 Vaultide 宣传与使用手册';
pptx.lang = 'zh-CN';
pptx.theme = {
  headFontFace: 'Microsoft YaHei',
  bodyFontFace: 'Microsoft YaHei',
  lang: 'zh-CN',
};
pptx.defineSlideMaster({
  title: 'MASTER',
  background: { color: 'F7F8FF' },
  objects: [
    {
      text: {
        text: '知洄 Vaultide',
        options: {
          x: 0.48,
          y: 0.18,
          w: 3.0,
          h: 0.24,
          fontFace: 'Microsoft YaHei',
          fontSize: 9,
          bold: true,
          color: '6D28D9',
          margin: 0,
        },
      },
    },
    {
      text: {
        text: 'openmaic-eight-eosin.vercel.app',
        options: {
          x: 9.65,
          y: 6.92,
          w: 3.18,
          h: 0.18,
          fontFace: 'Microsoft YaHei',
          fontSize: 8,
          color: '667085',
          align: 'right',
          margin: 0,
        },
      },
    },
  ],
  slideNumber: {
    x: 0.48,
    y: 6.9,
    w: 0.4,
    h: 0.2,
    color: '98A2B3',
    fontFace: 'Microsoft YaHei',
    fontSize: 8,
  },
});

const C = {
  ink: '15213D',
  muted: '62708C',
  paper: 'FFFFFF',
  line: 'DDE3F1',
  violet: '7C3AED',
  violetDark: '5B21B6',
  violetSoft: 'F0E9FF',
  blue: '2563EB',
  blueSoft: 'EAF2FF',
  cyan: '0891B2',
  cyanSoft: 'E6F9FC',
  green: '059669',
  greenSoft: 'E8FAF3',
  amber: 'D97706',
  amberSoft: 'FFF5D9',
  red: 'DC2626',
  redSoft: 'FEEBEC',
};
const URL = 'https://openmaic-eight-eosin.vercel.app';
const CMD_PREVIEW = 'Preview active note as a SourceBundle';
const CMD_WRITEBACK = 'Check and apply Vaultide writebacks';

function addText(slide, text, x, y, w, h, opts = {}) {
  slide.addText(text, {
    x,
    y,
    w,
    h,
    fontFace: 'Microsoft YaHei',
    fontSize: 16,
    color: C.ink,
    margin: 0,
    breakLine: false,
    valign: 'mid',
    fit: 'shrink',
    ...opts,
  });
}

function roundRect(slide, x, y, w, h, fill = C.paper, line = C.line, radius = 0.12) {
  slide.addShape(pptx.ShapeType.roundRect, {
    x,
    y,
    w,
    h,
    rectRadius: radius,
    fill: { color: fill },
    line: { color: line, width: 1 },
    shadow: {
      type: 'outer',
      color: '6B7280',
      opacity: 0.12,
      blur: 1,
      angle: 45,
      distance: 1,
    },
  });
}

function pill(slide, text, x, y, w, fill, color) {
  slide.addShape(pptx.ShapeType.roundRect, {
    x,
    y,
    w,
    h: 0.3,
    rectRadius: 0.15,
    fill: { color: fill },
    line: { color: fill },
  });
  addText(slide, text, x, y, w, 0.3, {
    fontSize: 9.5,
    bold: true,
    color,
    align: 'center',
  });
}

function title(slide, kicker, heading, subheading) {
  pill(slide, kicker, 0.48, 0.52, 1.72, C.violetSoft, C.violetDark);
  addText(slide, heading, 0.48, 0.92, 11.8, 0.52, {
    fontSize: 26,
    bold: true,
  });
  if (subheading) {
    addText(slide, subheading, 0.48, 1.46, 11.9, 0.4, {
      fontSize: 12,
      color: C.muted,
    });
  }
}

function screenshot(slide, filename, x, y, w, h, caption) {
  roundRect(slide, x, y, w, h, C.paper, C.line);
  const pad = 0.08;
  slide.addImage({
    path: path.join(SHOTS, filename),
    x: x + pad,
    y: y + pad,
    w: w - pad * 2,
    h: h - pad * 2,
  });
  if (caption) {
    slide.addShape(pptx.ShapeType.roundRect, {
      x: x + 0.2,
      y: y + h - 0.5,
      w: Math.min(w - 0.4, 3.8),
      h: 0.3,
      rectRadius: 0.15,
      fill: { color: '111827', transparency: 12 },
      line: { color: '111827', transparency: 100 },
    });
    addText(slide, caption, x + 0.3, y + h - 0.48, Math.min(w - 0.6, 3.6), 0.25, {
      fontSize: 9,
      color: C.paper,
      bold: true,
    });
  }
}

function numberBadge(slide, n, x, y, color = C.violet) {
  slide.addShape(pptx.ShapeType.ellipse, {
    x,
    y,
    w: 0.36,
    h: 0.36,
    fill: { color },
    line: { color },
  });
  addText(slide, String(n).padStart(2, '0'), x, y, 0.36, 0.36, {
    fontSize: 8.5,
    bold: true,
    color: C.paper,
    align: 'center',
  });
}

function card(slide, x, y, w, h, accent, soft, label, heading, body) {
  roundRect(slide, x, y, w, h, C.paper, C.line);
  slide.addShape(pptx.ShapeType.roundRect, {
    x: x + 0.22,
    y: y + 0.24,
    w: 0.44,
    h: 0.44,
    rectRadius: 0.14,
    fill: { color: soft },
    line: { color: soft },
  });
  addText(slide, label, x + 0.22, y + 0.24, 0.44, 0.44, {
    fontSize: 10,
    bold: true,
    color: accent,
    align: 'center',
  });
  addText(slide, heading, x + 0.78, y + 0.2, w - 1.0, 0.35, {
    fontSize: 16,
    bold: true,
  });
  addText(slide, body, x + 0.78, y + 0.6, w - 1.0, h - 0.78, {
    fontSize: 10.5,
    color: C.muted,
    valign: 'top',
    breakLine: true,
  });
}

function commandBox(slide, command, x, y, w) {
  slide.addShape(pptx.ShapeType.roundRect, {
    x,
    y,
    w,
    h: 0.5,
    rectRadius: 0.1,
    fill: { color: '111827' },
    line: { color: '111827' },
  });
  addText(slide, command, x + 0.18, y, w - 0.36, 0.5, {
    fontFace: 'Consolas',
    fontSize: 11,
    color: 'F9FAFB',
  });
}

function addNotes(slide, lines) {
  if (typeof slide.addNotes === 'function') {
    slide.addNotes(lines);
  }
}

// 01 — Cover
{
  const s = pptx.addSlide('MASTER');
  s.background = { color: 'F6F7FF' };
  s.addShape(pptx.ShapeType.ellipse, {
    x: 8.8,
    y: -1.5,
    w: 5.8,
    h: 5.8,
    fill: { color: C.violetSoft, transparency: 10 },
    line: { color: C.violetSoft, transparency: 100 },
  });
  pill(s, '个人知识学习系统', 0.55, 0.72, 1.8, C.violetSoft, C.violetDark);
  addText(s, '把外部知识、\nObsidian 与课堂学习\n连成一个闭环', 0.55, 1.3, 5.05, 2.0, {
    fontSize: 28,
    bold: true,
    breakLine: true,
    valign: 'top',
  });
  addText(s, '把搜索、讲解、练习、沉淀、进度回写与归纳连成闭环。', 0.55, 3.48, 4.9, 0.7, {
    fontSize: 14,
    color: C.muted,
    breakLine: true,
    valign: 'top',
  });
  screenshot(s, '01-home-optimized.png', 5.55, 0.84, 7.25, 4.12, '已部署的真实首页');
  roundRect(s, 0.55, 4.65, 4.55, 1.32, C.paper, C.line);
  s.addImage({ path: path.join(OUT, 'qr-vaultide.png'), x: 0.77, y: 4.84, w: 0.94, h: 0.94 });
  addText(s, '扫码进入正式站点', 1.95, 4.88, 2.8, 0.3, { fontSize: 13, bold: true });
  addText(s, URL, 1.95, 5.28, 2.8, 0.38, {
    fontSize: 9.5,
    color: C.violetDark,
    bold: true,
  });
  ['外部知识学习', 'Obsidian 笔记学习', '跨时间 / 板块归纳'].forEach((t, i) =>
    pill(
      s,
      t,
      5.58 + i * 2.35,
      5.35,
      2.13,
      i === 0 ? C.blueSoft : i === 1 ? C.greenSoft : C.amberSoft,
      i === 0 ? C.blue : i === 1 ? C.green : C.amber,
    ),
  );
  addText(s, '宣传与使用手册 · 2026', 0.55, 6.45, 4.0, 0.34, {
    fontSize: 11,
    color: C.muted,
  });
  addNotes(s, ['本页用于说明产品价值：一个面向个人学习的闭环系统。']);
}

// 02 — Three modes
{
  const s = pptx.addSlide('MASTER');
  title(
    s,
    '01 · 学习模式',
    '三个入口，对应三种真实学习需求',
    '选择与你当下任务最接近的入口，不需要先整理完整知识库。',
  );
  card(
    s,
    0.48,
    2.05,
    3.9,
    1.45,
    C.blue,
    C.blueSoft,
    'A',
    '学习外部新知识',
    '提出主题 → 联网检索\n生成课堂 → 沉淀到 Obsidian',
  );
  card(
    s,
    0.48,
    3.72,
    3.9,
    1.45,
    C.green,
    C.greenSoft,
    'B',
    '学习已有笔记',
    '预览当前笔记 → 生成课堂\n记录掌握度 → 安全回写',
  );
  card(
    s,
    0.48,
    5.39,
    3.9,
    1.45,
    C.amber,
    C.amberSoft,
    'C',
    '归纳时间线 / 板块',
    '按时间或主题聚合\n形成归纳笔记 → 查看三维关系',
  );
  screenshot(
    s,
    '01-home-optimized.png',
    4.72,
    2.05,
    8.08,
    4.55,
    '首页入口：外部学习 / Obsidian 学习 / 知识归纳',
  );
  addNotes(s, ['三种模式覆盖从未知知识、已有笔记到长期复盘。']);
}

// 03 — External learning
{
  const s = pptx.addSlide('MASTER');
  title(
    s,
    '02 · 外部知识学习',
    '把“搜索结果”变成能听、能练、能沉淀的课堂',
    '适合第一次接触一个概念、领域或项目时使用。',
  );
  const steps = [
    ['提出问题', '限定主题、目标和现有基础'],
    ['检索来源', '选择可靠、可追溯来源'],
    ['进入课堂', '听讲解、看板书、主动回答'],
    ['课后沉淀', '批准后写入 Obsidian'],
  ];
  steps.forEach((it, i) => {
    const x = 0.48 + i * 3.08;
    roundRect(s, x, 2.0, 2.78, 1.0, i === 2 ? C.violetSoft : C.paper, C.line);
    numberBadge(
      s,
      i + 1,
      x + 0.18,
      2.18,
      i === 0 ? C.blue : i === 1 ? C.cyan : i === 2 ? C.violet : C.green,
    );
    addText(s, it[0], x + 0.68, 2.1, 1.8, 0.3, { fontSize: 13, bold: true });
    addText(s, it[1], x + 0.68, 2.45, 1.87, 0.34, {
      fontSize: 9.5,
      color: C.muted,
      breakLine: true,
      valign: 'top',
    });
    if (i < steps.length - 1) {
      s.addShape(pptx.ShapeType.chevron, {
        x: x + 2.82,
        y: 2.36,
        w: 0.22,
        h: 0.24,
        fill: { color: C.line },
        line: { color: C.line },
      });
    }
  });
  screenshot(
    s,
    '03-classroom-optimized.png',
    0.48,
    3.35,
    8.05,
    3.35,
    '网页课堂：主要学习与看课界面',
  );
  roundRect(s, 8.82, 3.35, 3.98, 3.35, C.paper, C.line);
  pill(s, '课堂建议', 9.1, 3.63, 1.2, C.violetSoft, C.violetDark);
  const tips = [
    '每次只设一个明确学习问题',
    '先回答，再查看老师解释',
    '重要结论必须保留来源',
    '结束后立即批准沉淀',
  ];
  tips.forEach((t, i) => {
    numberBadge(s, i + 1, 9.12, 4.2 + i * 0.56, i === 3 ? C.green : C.violet);
    addText(s, t, 9.62, 4.16 + i * 0.56, 2.75, 0.42, {
      fontSize: 10.5,
      bold: i === 3,
      color: i === 3 ? C.green : C.ink,
    });
  });
  addNotes(s, ['建议将网页作为主要看课界面。']);
}

// 04 — Obsidian learning
{
  const s = pptx.addSlide('MASTER');
  title(
    s,
    '03 · Obsidian 学习',
    '从当前笔记创建课堂，再把新的学习进度写回去',
    '适合复习项目资料、读书笔记、课程笔记和长期专题。',
  );
  roundRect(s, 0.48, 2.03, 7.35, 4.12, C.paper, C.line);
  s.addImage({ path: path.join(OUT, 'guide-dialog.png'), x: 1.43, y: 2.08, w: 5.45, h: 4.02 });
  pill(s, 'Obsidian 学习接入指南', 0.75, 2.28, 1.82, C.violetSoft, C.violetDark);
  roundRect(s, 8.14, 2.03, 4.66, 4.12, C.paper, C.line);
  const items = [
    ['打开笔记', '选择一份非敏感 Markdown 笔记'],
    ['发送预览', '在命令面板执行下方命令'],
    ['网页学习', '创建课堂并完成互动'],
    ['写回进度', '批准写回后在 Obsidian 应用'],
  ];
  items.forEach((it, i) => {
    numberBadge(s, i + 1, 8.44, 2.38 + i * 0.74, i < 2 ? C.violet : C.green);
    addText(s, it[0], 8.94, 2.3 + i * 0.74, 1.15, 0.3, { fontSize: 12.5, bold: true });
    addText(s, it[1], 10.08, 2.3 + i * 0.74, 2.27, 0.46, {
      fontSize: 9.5,
      color: C.muted,
      breakLine: true,
      valign: 'top',
    });
  });
  addText(s, 'Obsidian 命令', 8.44, 5.32, 1.4, 0.28, {
    fontSize: 10,
    bold: true,
    color: C.violetDark,
  });
  commandBox(s, CMD_PREVIEW, 8.44, 5.62, 4.0);
  addText(
    s,
    '若显示 SourceBundle not found：检查站点访问码、设备配对与上传状态。',
    0.48,
    6.35,
    12.0,
    0.34,
    {
      fontSize: 10,
      color: C.muted,
    },
  );
  addNotes(s, ['命令必须保持英文原文，便于用户在 Obsidian 命令面板中搜索。']);
}

// 05 — Writeback
{
  const s = pptx.addSlide('MASTER');
  title(
    s,
    '04 · 受控回写',
    '先看差异，再批准；网页不直接改你的笔记',
    '学习成果通过待处理命令回到 Obsidian，由你最终确认。',
  );
  const steps = [
    ['网页生成', '生成归纳、进度或补充内容'],
    ['用户批准', '检查目标文件、写入范围和内容'],
    ['Obsidian 应用', '插件执行安全校验并写入'],
  ];
  steps.forEach((it, i) => {
    const x = 0.48 + i * 4.1;
    roundRect(s, x, 2.0, 3.78, 0.92, i === 1 ? C.amberSoft : C.paper, C.line);
    numberBadge(s, i + 1, x + 0.2, 2.27, i === 1 ? C.amber : C.violet);
    addText(s, it[0], x + 0.72, 2.12, 1.2, 0.28, { fontSize: 12.5, bold: true });
    addText(s, it[1], x + 1.92, 2.09, 1.55, 0.48, {
      fontSize: 9.3,
      color: C.muted,
      breakLine: true,
      valign: 'top',
    });
  });
  roundRect(s, 0.48, 3.25, 7.75, 3.34, C.paper, C.line);
  s.addImage({ path: path.join(OUT, 'writeback-dialog.png'), x: 0.95, y: 3.28, w: 6.8, h: 3.31 });
  pill(s, '待批准写回界面', 0.72, 3.48, 1.48, C.violetSoft, C.violetDark);
  roundRect(s, 8.52, 3.25, 4.28, 3.34, C.paper, C.line);
  pill(s, '批准前检查', 8.82, 3.52, 1.35, C.amberSoft, C.amber);
  [
    '目标文件是否正确',
    '是否只追加到允许目录',
    '是否保留来源与学习时间',
    '是否避免覆盖原文',
  ].forEach((t, i) => {
    s.addShape(pptx.ShapeType.ellipse, {
      x: 8.84,
      y: 4.08 + i * 0.43,
      w: 0.17,
      h: 0.17,
      fill: { color: C.green },
      line: { color: C.green },
    });
    addText(s, t, 9.15, 4.0 + i * 0.43, 3.0, 0.34, { fontSize: 10.5 });
  });
  commandBox(s, CMD_WRITEBACK, 8.82, 5.82, 3.7);
  addText(
    s,
    '若提示 safety contract：不要强行写入，先核对允许目录、路径和命令格式。',
    0.48,
    6.72,
    12.0,
    0.24,
    {
      fontSize: 10,
      color: C.red,
      bold: true,
    },
  );
  addNotes(s, ['回写是用户控制的动作，强调安全与可审查。']);
}

// 06 — Synthesis
{
  const s = pptx.addSlide('MASTER');
  title(
    s,
    '05 · 知识归纳与三维关系',
    '按时间线、知识板块和掌握度重组长期知识',
    '把零散课堂变成可回顾、可关联、可继续学习的个人知识地图。',
  );
  card(
    s,
    0.48,
    2.03,
    3.25,
    1.25,
    C.blue,
    C.blueSoft,
    'X',
    '时间维',
    '首次学习 → 复习 → 更新 → 形成阶段总结',
  );
  card(
    s,
    0.48,
    3.48,
    3.25,
    1.25,
    C.violet,
    C.violetSoft,
    'Y',
    '板块维',
    '概念、方法、案例、项目与来源之间的主题关联',
  );
  card(
    s,
    0.48,
    4.93,
    3.25,
    1.25,
    C.green,
    C.greenSoft,
    'Z',
    '掌握维',
    '未知、理解、会用、能解释，以及当前复习优先级',
  );
  roundRect(s, 4.02, 2.03, 8.78, 4.94, C.paper, C.line);
  s.addImage({ path: path.join(OUT, 'knowledge-controls.png'), x: 4.16, y: 2.18, w: 8.5, h: 2.86 });
  pill(s, '真实筛选与归纳界面', 4.36, 2.4, 1.72, C.cyanSoft, C.cyan);
  roundRect(s, 4.16, 5.2, 8.5, 1.58, 'F9FAFF', C.line);
  addText(s, '三维关系示意', 4.42, 5.36, 1.5, 0.28, { fontSize: 11.5, bold: true });
  addText(s, 'X 时间 · Y 板块 · Z 掌握度', 5.95, 5.36, 2.4, 0.28, { fontSize: 9, color: C.muted });
  const nodes = [
    [4.65, 6.18, C.blue],
    [6.02, 5.82, C.cyan],
    [7.28, 6.34, C.violet],
    [8.66, 5.86, C.blue],
    [10.1, 6.28, C.cyan],
    [11.66, 5.76, C.violet],
  ];
  const edges = [
    [0, 1],
    [0, 2],
    [1, 2],
    [1, 3],
    [2, 3],
    [2, 4],
    [3, 4],
    [3, 5],
    [4, 5],
  ];
  edges.forEach(([a, b]) => {
    const x1 = nodes[a][0];
    const y1 = nodes[a][1];
    const x2 = nodes[b][0];
    const y2 = nodes[b][1];
    s.addShape(pptx.ShapeType.line, {
      x: x1,
      y: Math.min(y1, y2),
      w: x2 - x1,
      h: Math.abs(y2 - y1),
      flipV: y2 < y1,
      line: { color: 'B8C4E3', width: 1.4 },
    });
  });
  nodes.forEach((n, i) => {
    s.addShape(pptx.ShapeType.ellipse, {
      x: n[0] - 0.13,
      y: n[1] - 0.13,
      w: 0.26,
      h: 0.26,
      fill: { color: n[2] },
      line: { color: n[2] },
    });
    addText(s, String(i + 1), n[0] - 0.13, n[1] - 0.13, 0.26, 0.26, {
      fontSize: 6.5,
      bold: true,
      color: C.paper,
      align: 'center',
    });
  });
  addNotes(s, ['三维关系用于帮助选择下一步学习，不是装饰性的图表。']);
}

// 07 — Quick start
{
  const s = pptx.addSlide('MASTER');
  title(
    s,
    '06 · 5 分钟开始',
    '第一次使用，只完成一轮最小学习闭环',
    '建议先用一份不敏感笔记测试，确认所有环节都能完成。',
  );
  const items = [
    ['打开站点', '进入正式部署网页'],
    ['配对设备', '网页生成六位码，填回 Obsidian 插件'],
    ['选笔记', '打开一份不敏感 Markdown 笔记'],
    ['发送预览', `执行 ${CMD_PREVIEW}`],
    ['学习并回写', '网页看课 → 批准 → Obsidian 应用写回'],
  ];
  items.forEach((it, i) => {
    const y = 2.05 + i * 0.86;
    numberBadge(s, i + 1, 0.55, y + 0.12, i === 4 ? C.green : C.violet);
    addText(s, it[0], 1.08, y, 1.45, 0.28, { fontSize: 12.5, bold: true });
    addText(s, it[1], 2.55, y, 3.45, 0.5, {
      fontSize: 9.8,
      color: C.muted,
      breakLine: true,
      valign: 'top',
    });
    if (i < items.length - 1) {
      s.addShape(pptx.ShapeType.line, {
        x: 0.73,
        y: y + 0.51,
        w: 0,
        h: 0.5,
        line: { color: C.line, width: 1.5 },
      });
    }
  });
  screenshot(s, '05-pairing-optimized.png', 6.28, 2.05, 6.52, 3.68, '设备配对界面');
  roundRect(s, 6.28, 5.88, 6.52, 0.98, C.paper, C.line);
  s.addImage({ path: path.join(OUT, 'qr-vaultide.png'), x: 6.43, y: 5.92, w: 0.9, h: 0.9 });
  addText(s, '扫码进入站点', 7.6, 6.05, 1.55, 0.23, { fontSize: 11.5, bold: true });
  addText(s, URL, 9.0, 6.04, 3.5, 0.25, { fontSize: 9.5, color: C.violetDark, bold: true });
  addNotes(s, ['首次测试建议使用不敏感笔记。']);
}

// 08 — Long-term loop & troubleshooting
{
  const s = pptx.addSlide('MASTER');
  title(
    s,
    '07 · 最佳实践',
    '让系统积累能力，而不只是生成更多内容',
    '每轮学习都保留来源、掌握度、下一步和时间信息。',
  );
  const loop = [
    ['学习', '一个明确问题'],
    ['练习', '先主动回答'],
    ['沉淀', '来源 + 结论 + 进度'],
    ['归纳', '按时间 / 板块复盘'],
  ];
  loop.forEach((it, i) => {
    const x = 0.48 + i * 3.08;
    roundRect(s, x, 2.05, 2.78, 1.02, i === 3 ? C.violetSoft : C.paper, C.line);
    numberBadge(s, i + 1, x + 0.18, 2.37, i === 3 ? C.violet : C.blue);
    addText(s, it[0], x + 0.7, 2.2, 1.1, 0.3, { fontSize: 13, bold: true });
    addText(s, it[1], x + 0.7, 2.55, 1.75, 0.28, { fontSize: 9.5, color: C.muted });
  });
  roundRect(s, 0.48, 3.38, 8.15, 2.92, C.paper, C.line);
  addText(s, '常见问题速查', 0.78, 3.65, 2.0, 0.35, { fontSize: 16, bold: true });
  const rows = [
    ['课堂一直加载', '确认课堂链接仍有效；旧临时课堂可能已失效'],
    ['搜索返回 429', '配置 Tavily / Brave API Key，或稍后重试'],
    ['听不到声音', '检查 TTS、系统音量、浏览器静音与自动播放权限'],
    ['回写没有出现', `网页批准后，在 Obsidian 执行 ${CMD_WRITEBACK}`],
  ];
  rows.forEach((r, i) => {
    const y = 4.18 + i * 0.48;
    addText(s, r[0], 0.8, y, 1.55, 0.28, { fontSize: 10.5, bold: true, color: C.violetDark });
    addText(s, r[1], 2.45, y, 5.72, 0.34, { fontSize: 9.5, color: C.muted });
    if (i < rows.length - 1) {
      s.addShape(pptx.ShapeType.line, {
        x: 0.78,
        y: y + 0.38,
        w: 7.48,
        h: 0,
        line: { color: C.line, width: 0.8 },
      });
    }
  });
  roundRect(s, 8.93, 3.38, 3.87, 2.92, C.violetDark, C.violetDark);
  addText(s, '现在开始第一轮', 9.25, 3.78, 3.2, 0.36, { fontSize: 17, bold: true, color: C.paper });
  addText(s, '选择一个真实问题，\n完成一次学习、回写与归纳闭环', 9.25, 4.28, 2.95, 0.92, {
    fontSize: 13,
    color: 'EDE9FE',
    breakLine: true,
    valign: 'top',
  });
  s.addImage({ path: path.join(OUT, 'qr-vaultide.png'), x: 9.25, y: 5.18, w: 0.92, h: 0.92 });
  addText(s, '正式站点', 10.4, 5.32, 1.8, 0.23, { fontSize: 10.5, bold: true, color: C.paper });
  addText(s, 'openmaic-eight-eosin.vercel.app', 10.4, 5.62, 2.1, 0.22, {
    fontSize: 9,
    color: 'DDD6FE',
  });
  addNotes(s, ['长期价值来自重复闭环和结构化沉淀。']);
}

for (const slide of pptx._slides) {
  slide.background = slide.background || { color: 'F7F8FF' };
}

await pptx.writeFile({ fileName: path.join(OUT, 'Vaultide-宣传使用手册.pptx') });
console.log(path.join(OUT, 'Vaultide-宣传使用手册.pptx'));
