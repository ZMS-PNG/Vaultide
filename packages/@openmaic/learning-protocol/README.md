# @openmaic/learning-protocol

Dependency-free contracts shared by the OpenMAIC web application, the Obsidian plugin, and future source connectors.

The first protocol line defines three security-critical aggregates:

- `SourceBundle`: immutable, explicitly approved source snapshots from Obsidian or external knowledge;
- `LearningEvent`: append-only evidence of diagnosis, retrieval, practice, transfer, writeback, and review;
- `WritebackCommand`: a small allowlist of deterministic Vault mutations that always require local confirmation.

The additive v0.5 contracts keep those three aggregates unchanged:

- `ProjectBindingContract` (`project-binding/1`) registers a client-stable project id against the authenticated Vault;
- `SourceUploadIntent` (`source-upload-intent/1`) signs project revision, coverage, and stable source references outside `SourceBundle/1`;
- the upload-intent validator continues to accept only the exact five-field legacy 0.4 payload or the strict v0.5 payload.

The TypeScript API includes structural validators. Build-time JSON Schemas are emitted under `dist/schema` for non-TypeScript consumers. The package intentionally has no runtime dependencies and must never import Next.js, Vercel, React, Obsidian, database, or model SDKs.

```bash
pnpm --filter @openmaic/learning-protocol test
pnpm --filter @openmaic/learning-protocol build
```

Current protocol version: `2026-07-draft-1`. Unknown writeback operations are rejected by default.
