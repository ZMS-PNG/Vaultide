import { del, get } from '@vercel/blob';
import { MAX_SOURCE_ARCHIVE_BYTES } from '../../domain/source-upload';

export interface PrivateBlobRead {
  url: string;
  pathname: string;
  contentType: string;
  size: number;
  text: string;
}

export interface PrivateBlobStore {
  read(pathname: string): Promise<PrivateBlobRead | null>;
  delete(urlOrPathname: string): Promise<void>;
}

export class VercelPrivateBlobStore implements PrivateBlobStore {
  async read(pathname: string): Promise<PrivateBlobRead | null> {
    const result = await get(pathname, { access: 'private', useCache: false });
    if (!result || result.statusCode !== 200) return null;
    if (result.blob.size > MAX_SOURCE_ARCHIVE_BYTES) {
      throw new Error('source_archive_too_large');
    }
    return {
      url: result.blob.url,
      pathname: result.blob.pathname,
      contentType: result.blob.contentType,
      size: result.blob.size,
      text: await new Response(result.stream).text(),
    };
  }

  async delete(urlOrPathname: string): Promise<void> {
    await del(urlOrPathname);
  }
}
