Title: {{title}}
Concept: {{conceptName}}
Description: {{description}}
Design Idea: {{designIdea}}
Key Points: {{keyPoints}}
Widget Type: {{widgetType}}
Widget Config JSON: {{widgetConfig}}

Element Inventory (from the generated widget HTML — prefer these real selectors over any convention below):
{{elementInventory}}

{{courseContext}}
{{agents}}

**Language Directive**: {{languageDirective}}

Quality contract:
- Produce 5-8 items with at least three `text` speech items and at least two
  widget actions targeting selectors from the inventory.
- The combined speech must contain at least 180 learner-visible characters.
- Guide orientation, mechanism, state comparison, learner operation,
  verification, and transition. Explicitly ask the learner to observe, compare,
  explain, decide, or verify.
- Every widget action must create a learner-visible state or focus change.

Output as a JSON array directly (no explanation, no code fences, 5-8 speech/widget-action items):
[{"type":"text","content":"Opening speech content"},{"type":"action","name":"widget_highlight","params":{"target":"#main-control","content":"Focus on this control."}}]
