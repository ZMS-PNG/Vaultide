import type { SceneOutline } from '../lib/types/generation';
import type { Scene } from '../lib/types/stage';
import {
  assessCompleteScene,
  assessCourseQuality,
} from '../lib/generation/course-quality';

const BASE_URL = 'https://openmaic-eight-eosin.vercel.app';
const TARGET_IDS = ['qJIGeVBxk7', 'hTaje0ct-U'] as const;

interface RepairClassroomStage {
  name: string;
  description?: string;
  learningContext?: { goal?: string };
  [key: string]: unknown;
}

interface ClassroomSnapshot {
  id: string;
  stage: RepairClassroomStage;
  scenes: Array<{ order: number; [key: string]: unknown }>;
  generation?: {
    outlines?: SceneOutline[];
    generationComplete?: boolean;
    generationStatus?: string;
    failedOutlineIds?: string[];
  };
}

const repairs: Record<(typeof TARGET_IDS)[number], Array<Partial<SceneOutline>>> = {
  qJIGeVBxk7: [
    {
      type: 'slide',
      title: '项目导读：一次预约如何穿过全栈',
      description:
        '以家长创建预约为主线，追踪微信小程序、管理端、API 与 PostgreSQL 之间的数据流，并明确本课程需要掌握的一致性与可追溯目标。',
      keyPoints: [
        '用户操作如何跨越前端与 API 边界',
        '预约事实与库存流水必须保持一致',
        '用状态历史和事务证据验证系统行为',
      ],
    },
    {
      type: 'slide',
      title: '系统边界与模块职责',
      description: '从家长端、管理端、API 服务与 PostgreSQL 四层说明职责、依赖方向和信任边界。',
      keyPoints: ['家长端与管理端的职责差异', 'API 是业务规则与授权边界', 'PostgreSQL 承担事务一致性'],
    },
    {
      type: 'slide',
      title: '核心实体与数据关系',
      description: '沿预约、场次、容量、库存流水与状态历史建立核心数据模型，并解释约束来自哪里。',
      keyPoints: ['预约与场次的关联', '容量与库存流水的双重证据', '状态历史支持追溯'],
    },
    {
      type: 'quiz',
      title: '库存并发判断',
      description: '通过并发预约案例判断哪些写法会超卖，并解释原子条件更新与事务锁的作用。',
      keyPoints: ['条件更新必须包含剩余容量', '受影响行数是成功证据', '失败请求不能留下部分写入'],
      quizConfig: {
        questionCount: 3,
        difficulty: 'medium',
        questionTypes: ['single', 'text'],
      },
    },
    {
      type: 'slide',
      title: '改期的双库存事务',
      description: '逐步分析批准改期时占用目标容量、释放原容量与更新预约状态为何必须位于同一事务。',
      keyPoints: ['先验证并占用目标容量', '释放源容量与状态更新原子提交', '冲突时整体回滚'],
    },
    {
      type: 'slide',
      title: '对账、流水与可追溯性',
      description: '比较库存快照、预约事实与变更流水，说明如何发现漂移并形成可审计证据。',
      keyPoints: ['快照用于快速读取', '流水用于解释变化', '定期对账发现不一致'],
    },
    {
      type: 'slide',
      title: '运营 SLA 与核销流程',
      description:
        '沿确认、到期、核销和异常补偿梳理运营流程，说明 SLA 任务如何安全推动预约状态，同时保持库存与审计流水一致。',
      keyPoints: [
        'SLA 到期任务必须校验当前状态',
        '核销与容量释放遵守业务状态机',
        '异常补偿需要幂等键和审计记录',
      ],
    },
    {
      type: 'quiz',
      title: '运营决策与异常处理',
      description: '结合确认、改期、核销与 SLA 到期案例选择正确操作，并说明对状态和库存的影响。',
      keyPoints: ['运营动作必须受状态机约束', '核销与容量释放不可混淆', '异常处理需要审计记录'],
      quizConfig: {
        questionCount: 3,
        difficulty: 'medium',
        questionTypes: ['single', 'text'],
      },
    },
    {
      type: 'slide',
      title: '预约生命周期与事务边界',
      description: '串联浏览、创建、确认、改期、取消、核销和完成，标出每一步的事务与幂等边界。',
      keyPoints: ['状态迁移必须合法', '跨模块操作需要幂等键', '事务边界围绕一致性事实'],
    },
    {
      type: 'slide',
      title: '总结与迁移：画出完整数据流',
      description:
        '把浏览、创建、确认、改期、取消与核销串成端到端数据流，并用事务边界、幂等键和审计流水检查新的业务需求。',
      keyPoints: [
        '沿用户动作标注模块与数据实体',
        '沿写操作标注事务和幂等边界',
        '沿异常路径标注补偿与审计证据',
      ],
    },
  ],
  'hTaje0ct-U': [
    {},
    {
      type: 'slide',
      title: '从 Markdown 到 GitHub Actions',
      description: '解释 gh-aw 如何把自然语言工作流定义编译成可审查的 GitHub Actions，并区分源文件与生成物。',
      keyPoints: ['自然语言定义是输入', '编译器生成 Actions 工作流', '生成物需要审查和版本控制'],
    },
    {
      type: 'slide',
      title: '编译管线与运行时数据流',
      description: '沿解析、校验、编译、提交与执行梳理数据流，说明每个阶段能够阻止什么风险。',
      keyPoints: ['解析与 schema 校验', '编译时注入安全约束', '运行时仍受 GitHub 权限模型限制'],
    },
    {
      type: 'quiz',
      title: '安全边界判断',
      description: '通过不可信输入、仓库写权限和外部工具调用案例判断风险，并解释应放在哪一层拦截。',
      keyPoints: ['最小权限', '不可信内容不能成为指令', '高风险写操作需要明确审批'],
      quizConfig: {
        questionCount: 3,
        difficulty: 'medium',
        questionTypes: ['single', 'text'],
      },
    },
    {},
    {
      type: 'slide',
      title: 'Guardrails 与安全输出',
      description: '拆解工具白名单、权限收敛、safe outputs 与审批机制如何共同限制 Agent 的影响范围。',
      keyPoints: ['限制可调用工具', '限制 token 与仓库权限', '把高风险输出转成可审查提案'],
    },
    {},
    {
      type: 'slide',
      title: '加固一个不安全的工作流',
      description: '通过完整示例把过宽权限、未固定依赖与未经审批的写操作改造成可审查的安全工作流。',
      keyPoints: ['权限按任务最小化', '依赖固定版本', '写操作经过审批或安全输出层'],
    },
    {
      type: 'quiz',
      title: '适用场景与风险审计',
      description: '判断哪些自动化适合 gh-aw，并用权限、输入来源、工具和输出四个维度完成风险审计。',
      keyPoints: ['低风险读任务优先', '输入来源决定提示注入风险', '输出影响面决定审批强度'],
      quizConfig: {
        questionCount: 3,
        difficulty: 'medium',
        questionTypes: ['single', 'text'],
      },
    },
    {
      type: 'slide',
      title: '总结与迁移：设计可信的 Agentic 工作流',
      description:
        '把 Markdown 定义、编译产物、运行权限、输入信任和安全输出串成审计清单，并迁移到一个新的 GitHub 自动化任务。',
      keyPoints: [
        '区分源定义、编译产物与运行时责任',
        '按输入、工具、权限和输出四层审计风险',
        '用最小权限和可审查提案控制影响面',
      ],
    },
  ],
};

function removeForeignConfig(outline: SceneOutline): SceneOutline {
  const next = { ...outline };
  if (next.type !== 'interactive') {
    delete next.widgetType;
    delete next.widgetOutline;
    delete next.interactiveConfig;
  }
  if (next.type !== 'pbl') delete next.pblConfig;
  if (next.type !== 'quiz') delete next.quizConfig;
  return next;
}

async function jsonRequest<T>(
  pathname: string,
  cookie: string,
  init: RequestInit = {},
  timeoutMs = 290_000,
): Promise<T> {
  const response = await fetch(`${BASE_URL}${pathname}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      cookie,
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = (await response.json()) as T & {
    success?: boolean;
    error?: string;
    details?: string;
  };
  if (!response.ok || body.success === false) {
    throw new Error(`${pathname}: ${body.details || body.error || response.status}`);
  }
  return body;
}

async function generateScene(
  classroom: ClassroomSnapshot,
  outline: SceneOutline,
  allOutlines: SceneOutline[],
  cookie: string,
): Promise<{ order: number; [key: string]: unknown }> {
  const contentResult = await jsonRequest<{
    content: unknown;
    effectiveOutline?: SceneOutline;
  }>(
    '/api/generate/scene-content',
    cookie,
    {
      method: 'POST',
      body: JSON.stringify({
        outline,
        allOutlines,
        stageId: classroom.id,
        stageInfo: {
          name: classroom.stage.name || '',
          description: classroom.stage.description,
          style: classroom.stage.style,
        },
        languageDirective: classroom.stage.languageDirective,
        requirements: {
          requirement:
            classroom.stage.learningContext?.goal ||
            classroom.stage.description ||
            classroom.stage.name,
        },
      }),
    },
  );

  const effectiveOutline = contentResult.effectiveOutline || outline;
  const actionsResult = await jsonRequest<{ scene: { order: number; [key: string]: unknown } }>(
    '/api/generate/scene-actions',
    cookie,
    {
      method: 'POST',
      body: JSON.stringify({
        outline: effectiveOutline,
        allOutlines,
        content: contentResult.content,
        stageId: classroom.id,
        previousSpeeches: [],
        languageDirective: classroom.stage.languageDirective,
      }),
    },
  );
  return actionsResult.scene;
}

async function persist(classroom: ClassroomSnapshot, outlines: SceneOutline[], cookie: string) {
  const complete = classroom.scenes.length === outlines.length;
  await jsonRequest(
    '/api/classroom',
    cookie,
    {
      method: 'POST',
      body: JSON.stringify({
        stage: classroom.stage,
        scenes: classroom.scenes,
        generation: {
          outlines,
          generationComplete: complete,
          generationStatus: complete ? 'completed' : 'paused',
          failedOutlineIds: [],
        },
      }),
    },
    60_000,
  );
}

async function main() {
  const accessCode = process.env.ACCESS_CODE;
  if (!accessCode) throw new Error('ACCESS_CODE is not configured');
  const login = await fetch(`${BASE_URL}/api/access-code/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: accessCode }),
  });
  if (!login.ok) throw new Error(`Access-code login failed: ${login.status}`);
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];

  for (const id of TARGET_IDS) {
    const loaded = await jsonRequest<{ classroom: ClassroomSnapshot }>(
      `/api/classroom?id=${id}`,
      cookie,
    );
    const classroom = loaded.classroom;
    const originalOutlines = classroom.generation?.outlines || [];
    if (originalOutlines.length !== repairs[id].length) {
      throw new Error(`${id}: unexpected outline count ${originalOutlines.length}`);
    }

    const outlines = originalOutlines.map((outline, index) =>
      removeForeignConfig({
        ...outline,
        ...repairs[id][index],
        id: outline.id,
        order: index + 1,
        keyPoints: repairs[id][index].keyPoints || outline.keyPoints,
      }),
    );

    const scenesByOrder = new Map(
      classroom.scenes.map((scene) => [scene.order, scene as unknown as Scene]),
    );
    const repairQueue = outlines.filter((outline) => {
      const scene = scenesByOrder.get(outline.order);
      return !scene || !assessCompleteScene(outline, scene).passed;
    });
    console.log(
      `[repair] ${classroom.stage.name}: ${repairQueue.length} missing or low-quality scene(s)`,
    );

    for (let index = 0; index < repairQueue.length; index += 2) {
      const batch = repairQueue.slice(index, index + 2);
      const results = await Promise.allSettled(
        batch.map((outline) => generateScene(classroom, outline, outlines, cookie)),
      );
      results.forEach((result, resultIndex) => {
        const outline = batch[resultIndex];
        if (result.status === 'fulfilled') {
          classroom.scenes = classroom.scenes.filter((scene) => scene.order !== outline.order);
          classroom.scenes.push(result.value);
          console.log(`[repair] completed ${outline.order}/${outlines.length}: ${outline.title}`);
        } else {
          console.error(
            `[repair] failed ${outline.order}/${outlines.length}: ${outline.title} — ${result.reason}`,
          );
        }
      });
      classroom.scenes.sort((left, right) => left.order - right.order);
      await persist(classroom, outlines, cookie);
    }

    await persist(classroom, outlines, cookie);
    const verified = await jsonRequest<{ classroom: ClassroomSnapshot }>(
      `/api/classroom?id=${id}&verify=${Date.now()}`,
      cookie,
      {
        headers: {
          'cache-control': 'no-cache',
        },
      },
      60_000,
    );
    console.log(
      `[repair] ${classroom.stage.name}: ${verified.classroom.scenes.length}/${outlines.length} persisted`,
    );
    const finalQuality = assessCourseQuality(
      verified.classroom.generation?.outlines ?? [],
      verified.classroom.scenes as unknown as Scene[],
    );
    if (!finalQuality.passed) {
      const errors = finalQuality.issues
        .filter((qualityIssue) => qualityIssue.severity === 'error')
        .map(
          (qualityIssue) =>
            `${qualityIssue.code}${qualityIssue.sceneOrder ? `@${qualityIssue.sceneOrder}` : ''}`,
        )
        .join(', ');
      throw new Error(
        `${classroom.stage.name}: final quality gate failed (${finalQuality.score}): ${errors}`,
      );
    }
    console.log(
      `[repair] ${classroom.stage.name}: quality gate passed (${finalQuality.score}/100)`,
    );
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
