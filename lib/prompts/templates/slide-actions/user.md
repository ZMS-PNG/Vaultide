Elements: {{elements}}
Title: {{title}}
Key Points: {{keyPoints}}
Description: {{description}}
{{courseContext}}
{{agents}}
{{userProfile}}

**Language Directive**: {{languageDirective}}

Quality contract:
- Produce 5-10 items with at least three `text` speech items.
- The combined speech must contain at least 180 learner-visible characters.
- Include orientation, a causal mechanism explanation, a source example or
  evidence reference, and an explicit learner instruction to observe, compare,
  explain, decide, or verify.
- Use at least two action types and target only real element IDs.

Output as a JSON array directly (no explanation, no code fences, 5-10 segments):
[{"type":"action","name":"spotlight","params":{"elementId":"text_xxx"}},{"type":"text","content":"Opening speech content"}]
