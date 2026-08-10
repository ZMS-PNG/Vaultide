import type { LearningProtocolVersion } from './version.js';
import { LEARNING_PROTOCOL_VERSION, SOURCE_BUNDLE_SCHEMA_VERSION } from './version.js';

export const SOURCE_ORIGINS = ['obsidian', 'web', 'pdf', 'github', 'arxiv', 'manual'] as const;

export type SourceOrigin = (typeof SOURCE_ORIGINS)[number];

export type ExternalSearchPolicy = 'disabled' | 'official-only' | 'allow-general';

export interface SourcePolicy {
  externalSearch: ExternalSearchPolicy;
  allowedDomains?: string[];
  recencyAfter?: string;
}

export interface HeadingAnchor {
  level: number;
  text: string;
  line?: number;
}

export interface CitationAnchor {
  id: string;
  snapshotId: string;
  anchorType: 'heading' | 'block' | 'line-range' | 'page' | 'timestamp';
  headingPath?: string[];
  blockId?: string;
  startLine?: number;
  endLine?: number;
  page?: number;
  timestampSeconds?: number;
  quotedHash: string;
  contextHash: string;
}

export interface ObsidianLocator {
  kind: 'obsidian';
  vaultBindingId: string;
  relativePath: string;
  /**
   * Local-first stable identity assigned by the connector. It survives a
   * rename or move and lets Vaultide keep the same learning companion.
   */
  sourceId?: string;
  noteId?: string;
  sourceMtime?: string;
}

export interface WebLocator {
  kind: 'web';
  canonicalUrl: string;
  retrievedAt: string;
  publishedAt?: string;
  author?: string;
}

export interface PdfLocator {
  kind: 'pdf';
  fileName: string;
  documentHash: string;
  pageCount?: number;
  canonicalUrl?: string;
}

export interface GithubLocator {
  kind: 'github';
  repositoryUrl: string;
  commit: string;
  path: string;
  startLine?: number;
  endLine?: number;
}

export interface ArxivLocator {
  kind: 'arxiv';
  arxivId: string;
  version?: number;
  canonicalUrl: string;
}

export interface ManualLocator {
  kind: 'manual';
  label: string;
}

export type SourceLocator =
  | ObsidianLocator
  | WebLocator
  | PdfLocator
  | GithubLocator
  | ArxivLocator
  | ManualLocator;

interface SourceSnapshotBase {
  id: string;
  title: string;
  contentHash: string;
  mimeType: string;
  byteSize: number;
  headings?: HeadingAnchor[];
  tags?: string[];
  outboundLinks?: string[];
  citationAnchors?: CitationAnchor[];
}

export type SourceSnapshot =
  | (SourceSnapshotBase & { origin: 'obsidian'; locator: ObsidianLocator })
  | (SourceSnapshotBase & { origin: 'web'; locator: WebLocator })
  | (SourceSnapshotBase & { origin: 'pdf'; locator: PdfLocator })
  | (SourceSnapshotBase & { origin: 'github'; locator: GithubLocator })
  | (SourceSnapshotBase & { origin: 'arxiv'; locator: ArxivLocator })
  | (SourceSnapshotBase & { origin: 'manual'; locator: ManualLocator });

export interface SourceBundle {
  protocolVersion: LearningProtocolVersion;
  schemaVersion: typeof SOURCE_BUNDLE_SCHEMA_VERSION;
  id: string;
  ownerId: string;
  revision: number;
  manifestHash: string;
  byteSize: number;
  itemCount: number;
  selectionReason: string;
  sourcePolicy: SourcePolicy;
  snapshots: SourceSnapshot[];
  retentionUntil: string;
  createdAt: string;
}

/** Stable JSON used when independently verifying SourceBundle.manifestHash. */
export function canonicalSourceManifest(bundle: SourceBundle): string {
  return canonicalize({
    ownerId: bundle.ownerId,
    revision: bundle.revision,
    selectionReason: bundle.selectionReason,
    snapshots: bundle.snapshots,
    createdAt: bundle.createdAt,
  });
}

function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'null';
  if (typeof value !== 'object') {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
      throw new TypeError(`Unsupported canonical JSON value: ${typeof value}`);
    }
    return serialized;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    // JSON transport omits undefined object properties. The manifest must be
    // identical before and after upload serialization.
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`);
  return `{${entries.join(',')}}`;
}

/** Apply the only supported protocol/schema stamps to a newly built bundle. */
export function stampSourceBundle(
  bundle: Omit<SourceBundle, 'protocolVersion' | 'schemaVersion'>,
): SourceBundle {
  return {
    ...bundle,
    protocolVersion: LEARNING_PROTOCOL_VERSION,
    schemaVersion: SOURCE_BUNDLE_SCHEMA_VERSION,
  };
}
