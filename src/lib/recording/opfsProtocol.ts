export const RECORDINGS_DIR = 'meeting-recordings';

export type WriterRequest =
  | { id: number; type: 'open'; name: string }
  | { id: number; type: 'write'; data: ArrayBuffer }
  | { id: number; type: 'close' };

export type WriterResponse =
  | { id: number; ok: true; bytes: number }
  | { id: number; ok: false; error: string; message: string };
