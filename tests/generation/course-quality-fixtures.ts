import type { SceneOutline } from '@/lib/types/generation';
import type { Scene } from '@/lib/types/stage';

const LESSONS = [
  {
    title: 'Problem context, prerequisites, and observable learning goal',
    description:
      'Establish the real problem, prerequisite concepts, source boundary, and observable completion evidence before any implementation decision is introduced.',
    keyPoints: [
      'Problem boundary and learner starting state',
      'Prerequisite concepts required for reasoning',
      'Observable evidence that proves completion',
    ],
  },
  {
    title: 'Core architecture and responsibility boundaries',
    description:
      'Explain the core architecture, module responsibilities, dependency direction, and the design reason behind each important system boundary.',
    keyPoints: [
      'Layered architecture and dependency direction',
      'Module responsibilities and trust boundaries',
      'Design trade-offs behind each boundary',
    ],
  },
  {
    title: 'Data flow and state-transition mechanism',
    description:
      'Trace one concrete request through inputs, state transitions, durable outputs, and failure propagation so the operating mechanism can be reconstructed.',
    keyPoints: [
      'Input contract and validation boundary',
      'State transitions across processing stages',
      'Failure propagation and durable recovery path',
    ],
  },
  {
    title: 'Evidence map and competing implementation choices',
    description:
      'Compare source-backed implementation choices, identify what each item of evidence supports, and explain when a competing design becomes preferable.',
    keyPoints: [
      'Primary evidence behind the preferred design',
      'Competing implementation and its trade-offs',
      'Decision criteria for selecting an approach',
    ],
  },
  {
    title: 'Worked application from input to verified output',
    description:
      'Apply the mechanism to a complete worked case, showing the input, each decision, the resulting artifact, and the evidence used to verify the output.',
    keyPoints: [
      'Worked-case input and operating constraints',
      'Decision sequence during practical application',
      'Verified output and inspection evidence',
    ],
  },
  {
    title: 'Retrieval, diagnosis, and new-context transfer check',
    description:
      'Test active recall, mechanism diagnosis, and transfer to a new context with explained answers that reveal misconceptions instead of rewarding guessing.',
    keyPoints: [
      'Active recall of the operating mechanism',
      'Diagnosis of a realistic failure condition',
      'Transfer decision in an unfamiliar context',
    ],
    type: 'quiz' as const,
  },
  {
    title: 'Limitations, security risks, and failure boundaries',
    description:
      'Analyze limitations, security boundaries, common failure modes, and engineering trade-offs so the learner can choose safeguards before deployment.',
    keyPoints: [
      'Security and trust boundary limitations',
      'Common failure modes and warning signals',
      'Safeguards and engineering trade-offs',
    ],
  },
  {
    title: 'Debugging practice and falsifiable verification',
    description:
      'Practice debugging a realistic fault by forming a hypothesis, collecting disconfirming evidence, and comparing the system before and after repair.',
    keyPoints: [
      'Fault localization from observable symptoms',
      'Falsifiable hypothesis and verification step',
      'Before-and-after evidence for the repair',
    ],
  },
  {
    title: 'Final synthesis and transfer to a new project',
    description:
      'Synthesize the architecture, mechanism, evidence, and risks, then transfer the method to a new project and submit an observable decision artifact.',
    keyPoints: [
      'Synthesis of architecture and mechanism',
      'Transfer plan for a new project context',
      'Observable decision artifact and evidence',
    ],
  },
] as const;

export function makeHighQualityOutlines(): SceneOutline[] {
  return LESSONS.map((lesson, index) => {
    const type = 'type' in lesson ? lesson.type : ('slide' as const);
    return {
      id: `outline-${index + 1}`,
      order: index + 1,
      type,
      title: lesson.title,
      description: lesson.description,
      keyPoints: [...lesson.keyPoints],
      ...(type === 'quiz'
        ? {
            quizConfig: {
              questionCount: 4,
              difficulty: 'hard' as const,
              questionTypes: ['single' as const, 'multiple' as const, 'text' as const],
            },
          }
        : {}),
    };
  });
}

function slideScene(outline: SceneOutline): Scene {
  const [first, second, third] = outline.keyPoints;
  const elements = [
    {
      id: `title-${outline.order}`,
      type: 'text',
      content: `<p>${outline.title}</p>`,
    },
    {
      id: `mechanism-${outline.order}`,
      type: 'text',
      content: `<p>${first}. This matters because the mechanism controls a distinct decision and therefore changes the observable system result.</p>`,
    },
    {
      id: `evidence-${outline.order}`,
      type: 'text',
      content: `<p>${second}. For example, a source-backed case exposes the relevant evidence, competing choice, and practical consequence.</p>`,
    },
    {
      id: `decision-${outline.order}`,
      type: 'text',
      content: `<p>${third}. Compare the alternatives, decide which boundary applies, and verify the result against a learner-visible criterion.</p>`,
    },
    {
      id: `case-${outline.order}`,
      type: 'text',
      content: `<p>Worked case ${outline.order}: trace the unique input, decision, constraint, and output for this instructional stage.</p>`,
    },
    {
      id: `risk-${outline.order}`,
      type: 'text',
      content: `<p>Failure check ${outline.order}: identify the limitation, disconfirm a weak assumption, and record the evidence that would change the decision.</p>`,
    },
    {
      id: `takeaway-${outline.order}`,
      type: 'text',
      content: `<p>Takeaway ${outline.order}: explain the mechanism in your own words and apply it to the next concrete learning decision.</p>`,
    },
    { id: `shape-${outline.order}`, type: 'shape' },
  ];
  const narration = [
    `First, observe ${first}. We will explain why this mechanism exists, what evidence supports it, and which decision changes when its boundary is crossed.`,
    `Now compare ${second} with the worked case. The example makes the causal chain inspectable and shows how a plausible alternative would fail under a different constraint.`,
    `Finally, use ${third} to decide what you would do next. Explain your choice, verify it against observable evidence, and note the limitation that could reverse the decision.`,
  ];
  return {
    id: `scene-${outline.order}`,
    stageId: 'quality-stage',
    outlineId: outline.id,
    order: outline.order,
    type: 'slide',
    title: outline.title,
    content: {
      type: 'slide',
      canvas: {
        elements,
        background: { type: 'solid', color: '#ffffff' },
      } as never,
    },
    actions: [
      { id: `speech-a-${outline.order}`, type: 'speech', text: narration[0] },
      { id: `spot-a-${outline.order}`, type: 'spotlight', elementId: `mechanism-${outline.order}` },
      { id: `speech-b-${outline.order}`, type: 'speech', text: narration[1] },
      { id: `spot-b-${outline.order}`, type: 'spotlight', elementId: `decision-${outline.order}` },
      { id: `speech-c-${outline.order}`, type: 'speech', text: narration[2] },
    ] as never,
  };
}

function quizScene(outline: SceneOutline): Scene {
  const [first, second, third] = outline.keyPoints;
  return {
    id: `scene-${outline.order}`,
    stageId: 'quality-stage',
    outlineId: outline.id,
    order: outline.order,
    type: 'quiz',
    title: outline.title,
    content: {
      type: 'quiz',
      questions: [
        {
          id: 'q1',
          type: 'single',
          question: `Which explanation best reconstructs ${first}?`,
          options: [
            { label: 'A complete causal explanation', value: 'A' },
            { label: 'An unsupported shortcut', value: 'B' },
          ],
          answer: ['A'],
          analysis:
            'The correct answer identifies the input, transition, and observable consequence; the shortcut merely repeats a label without explaining the mechanism.',
        },
        {
          id: 'q2',
          type: 'multiple',
          question: `Which evidence should be collected when performing ${second}?`,
          options: [
            { label: 'Observable state before the fault', value: 'A' },
            { label: 'Evidence after the tested change', value: 'B' },
            { label: 'An unrelated opinion', value: 'C' },
          ],
          answer: ['A', 'B'],
          analysis:
            'Before-and-after evidence can falsify the diagnosis and connect the intervention to the result; an unrelated opinion cannot validate the causal claim.',
        },
        {
          id: 'q3',
          type: 'short_answer',
          question: `Explain how you would carry out ${third} and verify the decision.`,
          analysis:
            'A strong response states the decision rule, applies it to the supplied constraints, and names the observable evidence that would confirm or disconfirm the choice.',
        },
        {
          id: 'q4',
          type: 'single',
          question:
            'In a new project context, how should this mechanism transfer when the trust boundary changes?',
          options: [
            { label: 'Re-evaluate the boundary and adapt the safeguard', value: 'A' },
            { label: 'Copy the old decision without inspection', value: 'B' },
          ],
          answer: ['A'],
          analysis:
            'Transfer requires preserving the reasoning method while adapting the concrete design to new constraints; copying the old answer ignores the changed boundary.',
        },
      ],
    },
    actions: [],
  };
}

export function makeHighQualityScenes(outlines = makeHighQualityOutlines()): Scene[] {
  return outlines.map((outline) =>
    outline.type === 'quiz' ? quizScene(outline) : slideScene(outline),
  );
}
