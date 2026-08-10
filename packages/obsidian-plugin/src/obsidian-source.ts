import { getAllTags, type App, type TFile } from 'obsidian';
import type { SelectedNoteInput } from './source-bundle';

export async function readSelectedNote(
  app: App,
  file: TFile,
  sourceId?: string,
): Promise<SelectedNoteInput> {
  if (file.extension.toLowerCase() !== 'md') throw new Error('Only Markdown notes are supported.');
  const beforeMtime = file.stat.mtime;
  const content = await app.vault.read(file);
  const currentFile = app.vault.getFileByPath(file.path);
  if (!currentFile || currentFile.stat.mtime !== beforeMtime) {
    throw new Error('The note changed while it was being packaged. Please retry.');
  }
  const cache = app.metadataCache.getFileCache(file);
  const noteId = cache?.frontmatter?.maic_note_id;
  return {
    relativePath: file.path,
    title: file.basename,
    content,
    sourceMtime: new Date(beforeMtime).toISOString(),
    sourceId,
    noteId: typeof noteId === 'string' ? noteId : undefined,
    headings: cache?.headings?.map((heading) => ({
      level: heading.level,
      text: heading.heading,
      line: heading.position.start.line,
    })),
    tags: cache ? (getAllTags(cache) ?? undefined) : undefined,
    outboundLinks: cache?.links?.map((link) => link.link),
  };
}
