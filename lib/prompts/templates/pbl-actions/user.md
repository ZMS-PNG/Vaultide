## PBL Scene Information

**Title**: {{title}}
**Project Topic**: {{projectTopic}}
**Project Description**: {{projectDescription}}
**Key Points**: {{keyPoints}}
**Description**: {{description}}
{{courseContext}}
{{agents}}

**Language Directive**: {{languageDirective}}

Please generate the complete five-beat teaching sequence for this PBL scene:
four substantive speech items totaling at least 180 characters, followed by one
discussion action. Cover objective, roles, mechanism/evidence, staged work,
risks, acceptance criteria, learner choice, and verification. Explicitly ask
the learner to compare, decide, explain, or verify.

Output as a JSON array directly (no explanation, no code fences):
[{"type":"text","content":"Project orientation"},{"type":"text","content":"Mechanism and evidence"},{"type":"text","content":"Stages, risks, and acceptance criteria"},{"type":"text","content":"Learner choice and verification"},{"type":"action","name":"discussion","params":{"topic":"Decision review","prompt":"State the decision, evidence, observable result, and verification method."}}]
