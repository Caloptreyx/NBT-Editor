import { basename } from 'pathe';
import { useState } from 'react';
import { getHttpStatus } from '@/api/axios.ts';
import { readFile, writeFile } from '../api.ts';
import type { NbtDocument } from '../lib/nbt.ts';
import { type NbtFileFormat, readNbtFile, writeNbtFile } from '../lib/nbtFile.ts';

export interface NbtFile {
  path: string;
  name: string;
  hash: string;
  doc: NbtDocument;
  format: NbtFileFormat;
  size: number;
}

export interface NbtFileSession {
  file: NbtFile | null;
  opening: string | null;
  saving: boolean;
  /** bumped on every in-place edit of `file.doc` */
  revision: number;
  dirty: boolean;
  open(path: string): Promise<void>;
  close(): void;
  reload(): Promise<void>;
  markChanged(): void;
  /** 'conflict' when the file changed on disk since it was loaded (and `force` is false) */
  save(force?: boolean): Promise<'saved' | 'conflict'>;
}

export default function useNbtFileSession(serverUuid: string): NbtFileSession {
  const [file, setFile] = useState<NbtFile | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [revision, setRevision] = useState(0);
  const [dirty, setDirty] = useState(false);

  const open = async (path: string) => {
    setOpening(path);
    try {
      const { bytes, hash } = await readFile(serverUuid, path);
      const { doc, format } = await readNbtFile(bytes);
      setFile({ path, name: basename(path), hash, doc, format, size: bytes.length });
      setDirty(false);
      setRevision((current) => current + 1);
    } finally {
      setOpening(null);
    }
  };

  const save = async (force = false): Promise<'saved' | 'conflict'> => {
    if (!file) throw new Error('no file open');
    setSaving(true);
    try {
      const bytes = await writeNbtFile(file.doc, file.format);
      const { hash } = await writeFile(serverUuid, file.path, bytes, file.hash, force);
      setFile({ ...file, hash, size: bytes.length });
      setDirty(false);
      return 'saved';
    } catch (error) {
      if (!force && getHttpStatus(error) === 409) return 'conflict';
      throw error;
    } finally {
      setSaving(false);
    }
  };

  return {
    file,
    opening,
    saving,
    revision,
    dirty,
    open,
    close: () => {
      setFile(null);
      setDirty(false);
    },
    reload: () => (file ? open(file.path) : Promise.resolve()),
    markChanged: () => {
      setDirty(true);
      setRevision((current) => current + 1);
    },
    save,
  };
}
