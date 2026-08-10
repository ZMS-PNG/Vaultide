Generate an Ultra Mode course outline based on the following requirements.

---

## User Requirements

{{requirement}}

---

{{userProfile}}

## Language Context

Infer the course language directive by applying the decision rules from the system prompt. Key reminders:
- Requirement language = teaching language (unless overridden by explicit request or learner context)
- Foreign language learning → teach in user's native language, not the target language
- PDF language does NOT override teaching language — translate/explain document content instead

---

## Reference Materials

### PDF Content Summary

{{pdfContent}}

### Available Images

{{availableImages}}

### Web Search Results

{{researchContext}}

When web search evidence is present, preserve exact citation labels such as `[S1]`
beside the scene descriptions or key points they support. Never invent a label,
and ground at least 35% of scenes in valid labels from the evidence above.

{{teacherContext}}

---

## Distribution Target

- **45-60% slide scenes** for concepts, evidence, architecture, worked examples, and synthesis
- **20-40% interactive scenes** only where manipulation or coding materially improves learning
- **10-20% quiz/application scenes** for active recall, explanation, and transfer
- For a 10-scene course, use no more than 4 interactive scenes and never more than 2 consecutively

## Widget Type Constraints

| Widget Type | Constraint |
|------------|-----------|
| simulation | Use only for real variable-driven systems; no minimum |
| game | Use only when the learning goal benefits from gameplay; no minimum |
| diagram | **Maximum 1 scene** |

Do not invent simulations or games to fill a quota. Technical projects and
research papers usually need source-grounded explanation, architecture,
mechanism, limitations, worked examples, and retrieval practice before widgets.

## Quality Gate

- Produce 9-12 scenes unless the user explicitly asks for a shorter course.
- Every scene must advance a distinct learning objective; no decorative filler.
- For source-based learning, tie claims and examples to the supplied material.
- Include prerequisites, core architecture or mechanism, a worked example,
  active recall or application, limitations or failure modes, and a final synthesis.
- If the sources are thin, state uncertainty instead of inventing details.

## CRITICAL: Required Fields for Interactive Scenes

Every interactive scene MUST include:
- `widgetType`: One of "simulation", "diagram", "code", or "game"
- `widgetOutline`: Object with widget-specific configuration

Interactive scenes without these fields are INVALID.

## Widget Selection Guide

Choose widgets based on the content:

| Content Type | Recommended Widget |
|--------------|-------------------|
| Physics/Chemistry/Biology processes | simulation |
| Systems, processes, hierarchies | diagram |
| Programming, algorithms | code |
| Practice, challenge, application | game (action preferred) |

## Widget Design Principles (IMPORTANT)

### Simulation Widget
- Mobile-friendly: Controls MUST NOT overlap canvas
- Reset button MUST work correctly
- Touch-friendly controls (44px min)

### Diagram Widget
- First node VISIBLE on load (no blank screen)
- HIGH CONTRAST colors
- Add ICONS to nodes
- Color-code node types

### Game Widget (CRITICAL - NO BORING QUIZZES!)
- **PREFER action/puzzle games over quizzes**
- Player MUST control something (not just click answers)
- If using simulation, make it INTERACTIVE gameplay
- Example GOOD game: "Control thrust to land safely"
- Example BAD game: "Click the correct answer"
- `gameType` should be "action", "puzzle", or "strategy", NOT just "quiz"

### Example: Good vs Bad Game Outline

❌ **BAD (boring quiz):**
```json
{
  "widgetType": "game",
  "widgetOutline": {
    "gameType": "quiz",
    "questionCount": 5
  }
}
```

✅ **GOOD (interactive game):**
```json
{
  "widgetType": "game",
  "widgetOutline": {
    "gameType": "action",
    "challenge": "控制推力使飞船安全着陆",
    "playerControls": ["thrust_slider"]
  }
}
```

**Final reminder**: your entire response must be a JSON **object** with exactly three top-level keys — `languageDirective` (string, inferred via the Language Inference rules in the system prompt), `courseTitle` (string, ≤30 chars, in the teaching language), and `outlines` (array of scene objects). Do not return a bare array. Do not wrap in prose or code fences.
