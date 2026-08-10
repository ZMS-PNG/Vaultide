# Generation Requirements

## Scene Information

- **Title**: {{title}}
- **Description**: {{description}}
- **Key Points**:
  {{keyPoints}}

{{teacherContext}}

## Available Resources

{{#if mediaElementEnabled}}
- **Available Media**: {{assignedImages}}
{{/if}}
- **Canvas Size**: {{canvas_width}} × {{canvas_height}} px

## Teaching Substance Contract

- The visible slide must explicitly cover the planned key points; do not replace them with generic slogans.
- Use five visible teaching zones: title; named mechanism/causality; source-grounded example/evidence; learner decision/check; takeaway/boundary.
- Include a concrete mechanism or relationship, one source-grounded example/evidence item, one explicit learner comparison/decision/verification, and a takeaway, limitation, or decision rule.
- Use at least 8 purposeful visual elements and 5 visible text groups. At least 4 text groups must contain 24+ plain-text characters.
- Across all visible text groups, provide 260–420 plain-text characters and enough semantic detail to explain the page without narration. Keep individual bullets concise and distribute the explanation across a readable 2×2, flow, or comparison layout.
- Preserve source labels such as [S1] or [V1] when a factual claim depends on that evidence.

## Output Requirements

Based on the scene information above, generate a complete Canvas/PPT component for one page.

## Language Directive
{{languageDirective}}

**Must Follow**:

1. Output pure JSON directly, without any explanation or description
2. Do not wrap with ```json code blocks
3. Do not add any text before or after the JSON
4. Ensure the JSON format is correct and can be parsed directly
{{#if imageElementEnabled}}
- Use only the provided image IDs (for example, `img_1`) for source image `src` fields
{{/if}}
{{#if generatedVideoEnabled}}
- Use only the provided generated video media refs for video `mediaRef` fields
{{/if}}
5. All TextElement `height` values must be selected from the quick reference table in the system prompt

**Output Structure Example**:
{"background":{"type":"solid","color":"#ffffff"},"elements":[{"id":"title_001","type":"text","left":60,"top":50,"width":880,"height":76,"content":"<p style=\"font-size:32px;\"><strong>Title Content</strong></p>","defaultFontName":"","defaultColor":"#333333"},{"id":"content_001","type":"text","left":60,"top":150,"width":880,"height":130,"content":"<p style=\"font-size:18px;\">• Point One</p><p style=\"font-size:18px;\">• Point Two</p><p style=\"font-size:18px;\">• Point Three</p>","defaultFontName":"","defaultColor":"#333333"}]}
