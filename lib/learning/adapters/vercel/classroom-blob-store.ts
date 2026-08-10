import { get, put } from '@vercel/blob';

export const MAX_CLASSROOM_SNAPSHOT_BYTES = 16 * 1024 * 1024;

export interface StoredClassroomBlob {
  pathname: string;
  url: string;
  byteSize: number;
}

export interface ClassroomBlobStore {
  write(pathname: string, content: string): Promise<StoredClassroomBlob>;
  read(pathname: string): Promise<string | null>;
}

export class VercelClassroomBlobStore implements ClassroomBlobStore {
  async write(pathname: string, content: string): Promise<StoredClassroomBlob> {
    const byteSize = Buffer.byteLength(content, 'utf8');
    if (byteSize > MAX_CLASSROOM_SNAPSHOT_BYTES) {
      throw new Error('classroom_snapshot_too_large');
    }
    const blob = await put(pathname, content, {
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 60,
      contentType: 'application/json; charset=utf-8',
    });
    return { pathname: blob.pathname, url: blob.url, byteSize };
  }

  async read(pathname: string): Promise<string | null> {
    const result = await get(pathname, { access: 'private', useCache: false });
    if (!result || result.statusCode !== 200) return null;
    if (result.blob.size > MAX_CLASSROOM_SNAPSHOT_BYTES) {
      throw new Error('classroom_snapshot_too_large');
    }
    return new Response(result.stream).text();
  }
}
