// Writes a meeting recording into the Origin Private File System, chunk by
// chunk. Runs in a worker because only workers get a sync access handle,
// which writes in place — whatever has been written survives a crashed or
// closed tab. (The main-thread createWritable() only commits on close.)

import { RECORDINGS_DIR, WriterRequest, WriterResponse } from './opfsProtocol';

interface SyncAccessHandle {
  write(buffer: ArrayBufferView, options?: { at?: number }): number;
  flush(): void;
  close(): void;
}

const FLUSH_EVERY_WRITES = 5;

let handle: SyncAccessHandle | null = null;
let offset = 0;
let writesSinceFlush = 0;

function reply(message: WriterResponse) {
  // TS types `self` as a Window here; in a worker it's the worker scope.
  (self as unknown as Worker).postMessage(message);
}

self.onmessage = async (event: MessageEvent<WriterRequest>) => {
  const request = event.data;
  try {
    switch (request.type) {
      case 'open': {
        const root = await navigator.storage.getDirectory();
        const dir = await root.getDirectoryHandle(RECORDINGS_DIR, { create: true });
        const file = await dir.getFileHandle(request.name, { create: true });
        handle = await (file as unknown as { createSyncAccessHandle(): Promise<SyncAccessHandle> }).createSyncAccessHandle();
        offset = 0;
        writesSinceFlush = 0;
        reply({ id: request.id, ok: true, bytes: 0 });
        break;
      }
      case 'write': {
        if (!handle) throw new Error('Recording file is not open');
        offset += handle.write(new Uint8Array(request.data), { at: offset });
        if (++writesSinceFlush >= FLUSH_EVERY_WRITES) {
          handle.flush();
          writesSinceFlush = 0;
        }
        reply({ id: request.id, ok: true, bytes: offset });
        break;
      }
      case 'close': {
        handle?.flush();
        handle?.close();
        handle = null;
        reply({ id: request.id, ok: true, bytes: offset });
        break;
      }
    }
  } catch (error) {
    const name = error instanceof DOMException ? error.name : 'Error';
    reply({ id: request.id, ok: false, error: name, message: String(error) });
  }
};
