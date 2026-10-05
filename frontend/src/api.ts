import type { AxiosResponseHeaders, RawAxiosResponseHeaders } from 'axios';
import { z } from 'zod';
import { axiosInstance } from '@/api/axios.ts';

export const nbtEditorBase = (serverUuid: string) => `/api/client/servers/${serverUuid}/nbt-editor`;

export const nbtEditorQueryKey = (serverUuid: string) => ['dev.caloptreyx.nbteditor', serverUuid] as const;

const directoryEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  directory: z.boolean(),
  size: z.number(),
  modified: z.coerce.date(),
});
export type DirectoryEntry = z.infer<typeof directoryEntrySchema>;

const directoryListingSchema = z.object({ directory: z.string(), entries: z.array(directoryEntrySchema) });
export type DirectoryListing = z.infer<typeof directoryListingSchema>;

const writeResultSchema = z.object({ hash: z.string(), revision_id: z.number().nullable() });

// File bodies travel as raw bytes. Axios' default request transform sends `view.buffer` for typed arrays (the whole
// backing buffer, ignoring the view's offset/length) and the instance defaults to a JSON content type, so both are
// replaced. Error responses still arrive as JSON; they are decoded here so `httpErrorToHuman` can show them.
function decodeBinaryResponse(data: unknown, headers: RawAxiosResponseHeaders | AxiosResponseHeaders) {
  if (!(data instanceof ArrayBuffer)) return data;
  if (!String(headers['content-type'] ?? '').includes('application/json')) return data;

  const text = new TextDecoder().decode(data);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function listDirectory(serverUuid: string, directory: string): Promise<DirectoryListing> {
  const { data } = await axiosInstance.get(`${nbtEditorBase(serverUuid)}/files`, { params: { directory } });
  return directoryListingSchema.parse(data);
}

export async function readFile(serverUuid: string, path: string): Promise<{ bytes: Uint8Array; hash: string }> {
  const response = await axiosInstance.get(`${nbtEditorBase(serverUuid)}/file`, {
    params: { path },
    responseType: 'arraybuffer',
    transformResponse: [decodeBinaryResponse],
  });

  const hash = response.headers['x-content-sha256'];
  if (!(response.data instanceof ArrayBuffer) || typeof hash !== 'string') {
    throw new Error(`Unexpected response while reading ${path}`);
  }

  return { bytes: new Uint8Array(response.data), hash };
}

export async function writeFile(
  serverUuid: string,
  path: string,
  bytes: Uint8Array,
  expectedHash: string | null,
  force = false,
): Promise<{ hash: string }> {
  const params: Record<string, string> = { path, force: String(force) };
  if (expectedHash !== null) params.expected_hash = expectedHash;

  const { data } = await axiosInstance.put(`${nbtEditorBase(serverUuid)}/file`, bytes, {
    params,
    headers: { 'Content-Type': 'application/octet-stream' },
    transformRequest: [(body: Uint8Array) => body],
  });

  return { hash: writeResultSchema.parse(data).hash };
}
