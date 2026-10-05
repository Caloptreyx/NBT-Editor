import { basename, dirname } from 'pathe';
import { getHttpStatus } from '@/api/axios.ts';
import { listDirectory, readFile, writeFile } from '../api.ts';
import type { FileIo } from '../lib/session.ts';

/** FileIo over the extension API; `exists` answers from directory listings cached for the lifetime of the instance. */
export function createFileIo(serverUuid: string): FileIo {
  const listings = new Map<string, Promise<Set<string>>>();

  return {
    async read(path) {
      try {
        return await readFile(serverUuid, path);
      } catch (error) {
        if (getHttpStatus(error) === 404) return null;
        throw error;
      }
    },
    write: (path, bytes, expectedHash, force) => writeFile(serverUuid, path, bytes, expectedHash, force),
    async exists(path) {
      const directory = dirname(path);
      let names = listings.get(directory);
      if (!names) {
        names = listDirectory(serverUuid, directory).then(
          (listing) => new Set(listing.entries.filter((entry) => !entry.directory).map((entry) => entry.name)),
          (error) => {
            if (getHttpStatus(error) === 404) return new Set<string>();
            listings.delete(directory);
            throw error;
          },
        );
        listings.set(directory, names);
      }
      return (await names).has(basename(path));
    },
  };
}
