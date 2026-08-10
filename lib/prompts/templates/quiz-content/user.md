Title: {{title}}
Description: {{description}}
Test Points: {{keyPoints}}
Question Count: {{questionCount}}, Difficulty: {{difficulty}}, Question Types: {{questionTypes}}

The quiz must contain 3–5 questions across recall, application, and transfer.

Mandatory assessment structure:

- Use at least two different question types even when `Question Types` lists only one preferred type. Prefer: recall=`single`, application=`multiple`, transfer=`short_answer`.
- The final question must explicitly describe a **new context/new project** (use the equivalent explicit wording in the target language) and require the learner to select, adapt, or justify the learned mechanism. Its `analysis` must explain the transfer reasoning.
- Every objective question needs a substantive `analysis` explaining the correct reasoning and why a plausible alternative fails.
- Every short-answer question needs a detailed `commentPrompt` grading rubric and a substantive reference `analysis`.
- Test the supplied key points and source evidence, not generic trivia.

## Language Directive
{{languageDirective}}

Output JSON array directly (no explanation, no code blocks, no LaTeX). Follow the system schema exactly: objective options are `{ "label", "value" }` objects and correct choices use the `answer` array. Do not output `correctAnswer`.
