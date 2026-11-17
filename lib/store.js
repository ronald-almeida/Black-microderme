import { get, put, BlobNotFoundError, BlobPreconditionFailedError, BlobPathnameMismatchError } from '@vercel/blob';

// Private objects + consistent reads + conditional writes; never local serverless disk.
export class BlobStore {
  async read(key) {
    try {
      const result = await get(`checkout/${key}.json`, { access: 'private', useCache: false });
      if (!result || result.statusCode !== 200) return null;
      return { value: await new Response(result.stream).json(), version: result.blob.etag };
    } catch (error) {
      if (error instanceof BlobNotFoundError) return null;
      throw error;
    }
  }
  async write(key, value, version = null) {
    try {
      const result = await put(`checkout/${key}.json`, JSON.stringify(value), {
        access: 'private', addRandomSuffix: false, contentType: 'application/json',
        allowOverwrite: version !== null, ...(version ? { ifMatch: version } : {}),
        ttlDays: key.startsWith('auth') || key.startsWith('limits/') ? 1 : 90,
      });
      return { value, version: result.etag };
    } catch (error) {
      if (error instanceof BlobPreconditionFailedError || error instanceof BlobPathnameMismatchError || /already exists/i.test(error.message)) return null;
      throw error;
    }
  }
}
