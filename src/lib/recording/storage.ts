import { RECORDINGS_DIR, WriterRequest, WriterResponse } from './opfsProtocol';
import { logger } from '@/lib/logger';

// Downloads copy the file out of browser storage; keep the original around
// long enough for even a multi-GB copy to finish before deleting it. If the
// tab closes first, the file shows up as a saved recording on the next visit.
const DELETE_AFTER_DOWNLOAD_MS = 5 * 60 * 1000;

// Recordings this tab is still writing, remuxing or waiting to clear after
// download (by display name) — not leftovers, so they're never listed.
const busyRecordings = new Set<string>();

export interface StoredRecording {
  name: string;
  size: number;
  lastModified: number;
}

// Omit that keeps a union's variants apart.
type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;

// Thin promise wrapper around the OPFS writer worker. Writes are queued in
// order by the worker's message loop.
export class RecordingWriter {
  private worker: Worker;
  private nextId = 0;
  private pending = new Map<number, { resolve: (bytes: number) => void; reject: (error: Error) => void }>();

  constructor() {
    this.worker = new Worker(new URL('./opfsWriter.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<WriterResponse>) => {
      const response = event.data;
      const entry = this.pending.get(response.id);
      if (!entry) return;
      this.pending.delete(response.id);
      if (response.ok) {
        entry.resolve(response.bytes);
      } else {
        const error = new Error(response.message);
        error.name = response.error;
        entry.reject(error);
      }
    };
  }

  private call(request: WithoutId<WriterRequest>, transfer: Transferable[] = []): Promise<number> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...request, id }, transfer);
    });
  }

  open(name: string) {
    busyRecordings.add(displayNameFor(name));
    return this.call({ type: 'open', name });
  }

  write(data: ArrayBuffer) {
    return this.call({ type: 'write', data }, [data]);
  }

  async close() {
    try {
      return await this.call({ type: 'close' });
    } finally {
      this.worker.terminate();
    }
  }
}

export function isRecordingStorageSupported(): boolean {
  return typeof navigator !== 'undefined'
    && typeof navigator.storage?.getDirectory === 'function'
    && typeof Worker !== 'undefined';
}

async function getRecordingsDir() {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(RECORDINGS_DIR, { create: true });
}

// Raw MediaRecorder output is written as `<name>.part`. It plays in
// browsers and VLC but has no duration or seek index (Windows Media Player
// can't seek it), so it's remuxed into `<name>` before download.
export const PART_SUFFIX = '.part';

export function displayNameFor(name: string): string {
  return name.endsWith(PART_SUFFIX) ? name.slice(0, -PART_SUFFIX.length) : name;
}

export async function listStoredRecordings(): Promise<StoredRecording[]> {
  if (!isRecordingStorageSupported()) return [];
  const dir = await getRecordingsDir();
  const files: Array<{ name: string; file: File }> = [];
  // `values()` isn't in TS's DOM lib yet.
  for await (const entry of (dir as unknown as { values(): AsyncIterable<FileSystemHandle> }).values()) {
    if (entry.kind !== 'file') continue;
    try {
      files.push({ name: entry.name, file: await (entry as FileSystemFileHandle).getFile() });
    } catch (error) {
      // Locked by a recording still running in another tab.
      logger.warn('Skipping recording file', entry.name, error);
    }
  }

  const partNames = new Set(files.filter(f => f.name.endsWith(PART_SUFFIX)).map(f => f.name));
  const recordings: StoredRecording[] = [];
  for (const { name, file } of files) {
    if (busyRecordings.has(displayNameFor(name))) continue;
    // Empty: never got its first chunk. A final file next to its .part is a
    // remux that was cut short — the .part is still the real recording.
    if (file.size === 0 || partNames.has(name + PART_SUFFIX)) {
      await dir.removeEntry(name).catch(() => {});
      continue;
    }
    recordings.push({ name, size: file.size, lastModified: file.lastModified });
  }
  return recordings.sort((a, b) => b.lastModified - a.lastModified);
}

export async function deleteStoredRecording(name: string) {
  const dir = await getRecordingsDir();
  try {
    await dir.removeEntry(name);
  } finally {
    busyRecordings.delete(displayNameFor(name));
  }
}

// Copies the raw recording into a regular, seekable file — no re-encoding,
// so it's quick even for long meetings. Returns the final file's name.
async function remuxRecording(dir: FileSystemDirectoryHandle, partName: string): Promise<string> {
  const { Input, Output, Conversion, BlobSource, StreamTarget, Mp4OutputFormat, WebMOutputFormat, ALL_FORMATS } = await import('mediabunny');
  const finalName = displayNameFor(partName);
  const source = await (await dir.getFileHandle(partName)).getFile();
  const finalHandle = await dir.getFileHandle(finalName, { create: true });
  // Not available in older Safari; the caller falls back to the raw file.
  if (typeof finalHandle.createWritable !== 'function') throw new Error('createWritable is not supported');
  const writable = await finalHandle.createWritable();

  const input = new Input({ source: new BlobSource(source), formats: ALL_FORMATS });
  const output = new Output({
    format: finalName.endsWith('.webm') ? new WebMOutputFormat() : new Mp4OutputFormat({ fastStart: false }),
    target: new StreamTarget(writable as unknown as WritableStream<import('mediabunny').StreamTargetChunk>, { chunked: true }),
  });
  try {
    const conversion = await Conversion.init({ input, output, showWarnings: false });
    if (!conversion.isValid) throw new Error('Recording cannot be remuxed');
    await conversion.execute();
  } catch (error) {
    await output.cancel().catch(() => {});
    await writable.abort().catch(() => {});
    await dir.removeEntry(finalName).catch(() => {});
    throw error;
  } finally {
    input.dispose();
  }
  await dir.removeEntry(partName);
  return finalName;
}

// Saves the recording to the user's Downloads folder, then clears it from
// browser storage once the copy has had time to finish.
export async function downloadStoredRecording(name: string) {
  const dir = await getRecordingsDir();
  busyRecordings.add(displayNameFor(name));
  let storedName = name;
  if (name.endsWith(PART_SUFFIX)) {
    try {
      storedName = await remuxRecording(dir, name);
    } catch (error) {
      // Still worth having: it plays in browsers and VLC.
      logger.error('Error remuxing recording, downloading it as recorded:', error);
    }
  }

  const file = await (await dir.getFileHandle(storedName)).getFile();
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = displayNameFor(storedName);
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    deleteStoredRecording(storedName).catch(error => logger.warn('Failed to clear downloaded recording', error));
  }, DELETE_AFTER_DOWNLOAD_MS);
}

// Free space browser storage will still give us, or null if unknown.
export async function getAvailableStorageBytes(): Promise<number | null> {
  try {
    const { quota, usage } = await navigator.storage.estimate();
    if (quota === undefined || usage === undefined) return null;
    return quota - usage;
  } catch {
    return null;
  }
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
