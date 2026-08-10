import {
  canonicalSourceManifest,
  stampSourceArchive,
  stampSourceBundle,
  validateSourceBundle,
  type HeadingAnchor,
  type ProjectSourceReference,
  type SourceArchive,
  type SourceBundle,
  type SourceSnapshot,
} from '@openmaic/learning-protocol';
import { createEntityId, type LocalIdentity } from './identity';

export interface SelectedNoteInput {
  relativePath: string;
  title: string;
  content: string;
  sourceMtime: string;
  sourceId?: string;
  noteId?: string;
  headings?: HeadingAnchor[];
  tags?: string[];
  outboundLinks?: string[];
}

export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function snapshotFromNote(
  note: SelectedNoteInput,
  identity: LocalIdentity,
): Promise<SourceSnapshot> {
  const byteSize = new TextEncoder().encode(note.content).byteLength;
  return {
    id: createEntityId('snp'),
    origin: 'obsidian',
    title: note.title,
    contentHash: await sha256Hex(note.content),
    mimeType: 'text/markdown',
    byteSize,
    headings: note.headings,
    tags: note.tags,
    outboundLinks: note.outboundLinks,
    locator: {
      kind: 'obsidian',
      vaultBindingId: identity.vaultBindingId,
      relativePath: note.relativePath,
      sourceId: note.sourceId,
      noteId: note.noteId,
      sourceMtime: note.sourceMtime,
    },
  };
}

export async function buildSourceBundleFromNotes(options: {
  notes: SelectedNoteInput[];
  identity: LocalIdentity;
  selectionReason: string;
  retentionDays: number;
  now?: Date;
}): Promise<SourceBundle> {
  if (options.notes.length === 0) throw new Error('Select at least one Markdown note.');
  if (
    !Number.isInteger(options.retentionDays) ||
    options.retentionDays < 1 ||
    options.retentionDays > 365
  ) {
    throw new Error('Retention must be between 1 and 365 days.');
  }
  const createdAt = (options.now ?? new Date()).toISOString();
  const retentionUntil = new Date(
    Date.parse(createdAt) + options.retentionDays * 24 * 60 * 60 * 1000,
  ).toISOString();
  const snapshots = await Promise.all(
    options.notes.map((note) => snapshotFromNote(note, options.identity)),
  );
  const provisional = stampSourceBundle({
    id: createEntityId('src'),
    ownerId: options.identity.ownerId,
    revision: 1,
    manifestHash: '0'.repeat(64),
    byteSize: snapshots.reduce((total, snapshot) => total + snapshot.byteSize, 0),
    itemCount: snapshots.length,
    selectionReason: options.selectionReason,
    sourcePolicy: { externalSearch: 'disabled' },
    snapshots,
    retentionUntil,
    createdAt,
  });
  const manifestHash = await sha256Hex(canonicalSourceManifest(provisional));
  const bundle = stampSourceBundle({
    ...provisional,
    ownerId: options.identity.ownerId,
    manifestHash,
  });
  const result = validateSourceBundle(bundle);
  if (!result.valid) {
    throw new Error(
      `Generated SourceBundle failed validation: ${result.errors
        .map((error) => `${error.path} ${error.message}`)
        .join('; ')}`,
    );
  }
  return bundle;
}

export function buildSourceArchive(
  bundle: SourceBundle,
  notes: SelectedNoteInput[],
): SourceArchive {
  const contentByPath = new Map(notes.map((note) => [note.relativePath, note.content]));
  return stampSourceArchive({
    bundle,
    contents: bundle.snapshots.map((snapshot) => {
      if (snapshot.origin !== 'obsidian') {
        throw new Error('The Obsidian bridge can upload only Obsidian snapshots.');
      }
      const utf8Content = contentByPath.get(snapshot.locator.relativePath);
      if (utf8Content === undefined) {
        throw new Error(`Source content is missing for ${snapshot.locator.relativePath}.`);
      }
      return { snapshotId: snapshot.id, utf8Content };
    }),
  });
}

export function buildProjectSourceReferences(
  bundle: SourceBundle,
  sourceIdsByPath: Readonly<Record<string, string>>,
): ProjectSourceReference[] {
  return bundle.snapshots.map((snapshot) => {
    if (snapshot.origin !== 'obsidian') {
      throw new Error('A project upload can reference only Obsidian snapshots.');
    }
    const sourceId = sourceIdsByPath[snapshot.locator.relativePath];
    if (!sourceId || !/^sou_[a-f0-9]{32}$/.test(sourceId)) {
      throw new Error(`Stable source id is missing for ${snapshot.locator.relativePath}.`);
    }
    return { snapshotId: snapshot.id, sourceId };
  });
}
