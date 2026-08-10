Please generate scene outlines based on the following course requirements.

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

{{teacherContext}}

---

## Output Requirements

Please automatically infer the following from user requirements:

- Course topic and core content
- Target audience and difficulty level
- Course duration (default 15-30 minutes if not specified)
- Teaching style (formal/casual/interactive/academic)
- Visual style (minimal/colorful/professional/playful)

Then output your response as a single JSON object.

**Top-level shape — this is what you MUST return:**

```json
{
  "languageDirective": "2-5 sentence instruction describing the course language behavior",
  "courseTitle": "concise course name, ≤30 chars, in the teaching language",
  "outlines": [ /* array of scene objects, schema described below */ ]
}
```

Never return a bare array. Never omit `languageDirective` or `courseTitle`. All three keys are required.

**Each scene inside the `outlines` array has this minimum shape:**

```json
{
  "id": "scene_1",
  "type": "slide" | "quiz" | "interactive" | "pbl",
  "title": "Scene Title",
  "description": "Teaching purpose description",
  "keyPoints": ["Point 1", "Point 2", "Point 3"],
  "evidenceAnchor": "A 10-32 word verbatim source passage this scene teaches",
  "order": 1
}
```

### Special Notes

- **quiz scenes must include quizConfig**:
   ```json
   "quizConfig": {
     "questionCount": 3,
     "difficulty": "easy" | "medium" | "hard",
     "questionTypes": ["single", "multiple"]
   }
   ```
{{#if hasSourceImages}}
- **If source images are available**, add `suggestedImageIds` to relevant slide scenes. Only use image IDs listed under Available Images.
{{/if}}
- **Interactive scenes**: If a concept benefits from hands-on simulation/visualization, use `"type": "interactive"` with `widgetType` and `widgetOutline` fields. Limit to 1-2 per course.
   - Select widgetType based on concept: simulation (physics/chem), diagram (processes), code (programming), game (practice), visualization3d (3D models)
   - Provide appropriate widgetOutline for the widget type
- **Scene count**: Always create 9-12 distinct scenes for a standard course.
- **Learning arc**: Include context/prerequisites, mechanism/architecture, evidence and a worked example, application or retrieval, limitations/failure modes, and synthesis/transfer.
- **Quiz placement**: Include at least one source-grounded quiz with 3 or more questions spanning recall, application, and transfer.
- **Specificity**: Every description must name the mechanism, evidence/example, and learner action. Every scene must have 3-5 concrete, non-overlapping key points.
- **Language**: Infer from the user's requirement text and context, then output all content in the inferred language
- **If labeled source evidence is provided**, reference specific findings in scene descriptions and keyPoints. Preserve the exact citation labels (for example `[S1]` or `[V1]`) beside the claims they support; never invent a label. For **every scene**, set `evidenceAnchor` to a compact 10-32 word verbatim passage from the supplied source that specifically supports that scene. Keep `evidenceAnchor` in the source language even when teaching in another language; it is used for audit only. Never use a heading, table of contents, URL, navigation text, or your own proposal as this anchor. At least 80% of scenes and at least 75% of factual description/key-point claims must carry a valid supplied label. If only 1-2 labels exist, use all of them; otherwise use at least 60% of the frozen label set.
- **Final scene**: require the learner to synthesize the course and transfer it to a new project, decision, or problem. Name a concrete learner artifact (for example a decision record, architecture explanation, checklist, or worked solution) and an observable completion test. Preserve at least one valid supplied source label in this transfer task when labeled evidence exists.

**Final reminder**: your entire response must be a JSON **object** with exactly three top-level keys — `languageDirective` (string), `courseTitle` (string, ≤30 chars, in the teaching language), and `outlines` (array). Do not return a bare array. Do not wrap in prose or code fences.
