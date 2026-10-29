import { useCallback, useEffect, useRef, useState } from 'react';
import { OutboundWsMessage } from '@/types';
import { logger } from '@/lib/logger';
import {
  PART_SUFFIX,
  RecordingWriter,
  downloadStoredRecording,
  deleteStoredRecording,
  formatBytes,
  getAvailableStorageBytes,
  isRecordingStorageSupported,
} from '@/lib/recording/storage';
import { createFixedSizeVideoTrack } from '@/lib/recording/fixedSizeVideo';

type ToastFn = (options: { description: string }) => void;

const TIMESLICE_MS = 3000;
const VIDEO_BITS_PER_SECOND = 5_000_000;
const AUDIO_BITS_PER_SECOND = 128_000;
// ~1.3 hours of 1080p at the bitrates above.
const LOW_STORAGE_BYTES = 3 * 1024 ** 3;
const TARGET_WIDTH = 1920;
const TARGET_HEIGHT = 1080;
const FRAME_RATE = 30;

// MP4 with AAC first — it plays in the most players. Whatever MediaRecorder
// writes is remuxed into a seekable file when recording stops.
const MIME_TYPES = [
  'video/mp4;codecs=avc1,mp4a.40.2',
  'video/mp4;codecs=avc1,opus',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

function pickMimeType(): string | null {
  return MIME_TYPES.find(type => MediaRecorder.isTypeSupported(type)) ?? null;
}

function detectSupport(): boolean {
  if (typeof MediaRecorder === 'undefined') return false;
  if (typeof navigator.mediaDevices?.getDisplayMedia !== 'function') return false;
  // Phone and tablet browsers can't capture the screen.
  if (/Android|iPhone|iPad|iPod|Mobi/i.test(navigator.userAgent)) return false;
  return isRecordingStorageSupported();
}

function buildFileName(roomId: string, extension: string): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  const safeRoom = roomId.replace(/[^a-zA-Z0-9-_]/g, '').slice(0, 40) || 'room';
  return `meeting-${safeRoom}-${stamp}.${extension}`;
}

interface MeetingRecorderOptions {
  socketRef: React.RefObject<WebSocket | null>;
  inMeeting: boolean;
  localStream: MediaStream | null;
  remoteStreams: Record<string, MediaStream>;
  roomId: string;
  toast: ToastFn;
}

// Records the meeting tab exactly as it looks (video tiles, chat, everything)
// plus a mix of everyone's audio, straight to this device. Nothing is
// uploaded — the server is only told so others see a recording notice.
function useMeetingRecorder({ socketRef, inMeeting, localStream, remoteStreams, roomId, toast }: MeetingRecorderOptions) {
  const [isSupported, setIsSupported] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [bytesWritten, setBytesWritten] = useState(0);
  // Everyone the server says is recording this room's meeting (including us).
  const [recorders, setRecorders] = useState<string[]>([]);

  const isRecordingRef = useRef(false);
  const startingRef = useRef(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const writerRef = useRef<RecordingWriter | null>(null);
  const writeChainRef = useRef<Promise<void>>(Promise.resolve());
  const writeFailedRef = useRef(false);
  const fileNameRef = useRef<string | null>(null);
  const displayStreamRef = useRef<MediaStream | null>(null);
  const stopFixedSizeVideoRef = useRef<(() => void) | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  // Audio track id -> its node in the mix.
  const audioSourcesRef = useRef<Map<string, MediaStreamAudioSourceNode>>(new Map());
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const localStreamRef = useRef(localStream);
  const remoteStreamsRef = useRef(remoteStreams);
  localStreamRef.current = localStream;
  remoteStreamsRef.current = remoteStreams;

  useEffect(() => {
    setIsSupported(detectSupport());
  }, []);

  const send = useCallback((message: OutboundWsMessage) => {
    socketRef.current?.send(JSON.stringify(message));
  }, [socketRef]);

  // Keeps the audio mix in step with who's in the meeting: our mic plus
  // every remote participant's audio, added and dropped as people come and go.
  const syncAudioSources = useCallback(() => {
    const context = audioContextRef.current;
    const destination = audioDestinationRef.current;
    if (!context || !destination) return;

    const streams = [localStreamRef.current, ...Object.values(remoteStreamsRef.current)];
    const wanted = new Map<string, MediaStreamTrack>();
    streams.forEach(stream => {
      stream?.getAudioTracks().forEach(track => {
        if (track.readyState === 'live') wanted.set(track.id, track);
      });
    });

    const sources = audioSourcesRef.current;
    sources.forEach((node, trackId) => {
      if (wanted.has(trackId)) return;
      node.disconnect();
      sources.delete(trackId);
    });
    wanted.forEach((track, trackId) => {
      if (sources.has(trackId)) return;
      const node = context.createMediaStreamSource(new MediaStream([track]));
      node.connect(destination);
      sources.set(trackId, node);
    });
  }, []);

  const releaseMedia = useCallback(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    stopFixedSizeVideoRef.current?.();
    stopFixedSizeVideoRef.current = null;
    displayStreamRef.current?.getTracks().forEach(track => track.stop());
    displayStreamRef.current = null;
    audioSourcesRef.current.forEach(node => node.disconnect());
    audioSourcesRef.current.clear();
    audioContextRef.current?.close().catch(() => {});
    audioContextRef.current = null;
    audioDestinationRef.current = null;
    recorderRef.current = null;
  }, []);

  const stopRecording = useCallback(() => {
    const recorder = recorderRef.current;
    // Fires a last dataavailable, then onstop, which saves the file.
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  }, []);

  const finishRecording = useCallback(async () => {
    releaseMedia();
    isRecordingRef.current = false;
    setIsRecording(false);
    send({ type: 'recordingStop' });

    const writer = writerRef.current;
    const name = fileNameRef.current;
    writerRef.current = null;
    fileNameRef.current = null;
    if (!writer || !name) return;

    let bytes = 0;
    try {
      await writeChainRef.current;
      bytes = await writer.close();
    } catch (error) {
      logger.error('Error closing recording file:', error);
    }

    if (bytes === 0) {
      deleteStoredRecording(name).catch(() => {});
      return;
    }
    try {
      toast({ description: 'Preparing your recording…' });
      await downloadStoredRecording(name);
      toast({ description: `Recording saved to your Downloads (${formatBytes(bytes)})` });
    } catch (error) {
      logger.error('Error downloading recording:', error);
      toast({ description: 'Download failed — the recording is kept in this browser. Reload the room to download it.' });
    }
  }, [releaseMedia, send, toast]);

  const startRecording = useCallback(async () => {
    if (isRecordingRef.current || startingRef.current) return;
    const mimeType = pickMimeType();
    if (!mimeType) {
      toast({ description: 'Recording is not supported in this browser' });
      return;
    }

    startingRef.current = true;
    setIsStarting(true);
    let displayStream: MediaStream | null = null;
    let writer: RecordingWriter | null = null;
    let fileName: string | null = null;

    try {
      // First thing after the click: Firefox and Safari only allow screen
      // capture while the click's user activation is still fresh.
      try {
        displayStream = await navigator.mediaDevices.getDisplayMedia({
          video: { width: { ideal: TARGET_WIDTH }, height: { ideal: TARGET_HEIGHT }, frameRate: { ideal: FRAME_RATE } },
          audio: false,
          // Chrome/Edge: offer this tab first, and don't offer whole screens.
          preferCurrentTab: true,
          selfBrowserSurface: 'include',
          surfaceSwitching: 'exclude',
          monitorTypeSurfaces: 'exclude',
        } as DisplayMediaStreamOptions);
      } catch (error) {
        // NotAllowedError = the user closed the share picker.
        if (!(error instanceof DOMException && error.name === 'NotAllowedError')) {
          logger.error('Error starting screen capture:', error);
          toast({ description: 'Could not start screen capture' });
        }
        return;
      }

      const available = await getAvailableStorageBytes();
      if (available !== null && available < LOW_STORAGE_BYTES) {
        toast({ description: `Low storage: about ${formatBytes(available)} free for recording` });
      }
      // Asks the browser not to evict the recording under storage pressure.
      navigator.storage.persist?.().catch(() => {});

      fileName = buildFileName(roomId, mimeType.startsWith('video/mp4') ? 'mp4' : 'webm') + PART_SUFFIX;
      writer = new RecordingWriter();
      await writer.open(fileName);

      const context = new AudioContext();
      await context.resume();
      audioContextRef.current = context;
      audioDestinationRef.current = context.createMediaStreamDestination();
      syncAudioSources();

      const [videoTrack] = displayStream.getVideoTracks();
      const fixedSizeVideo = createFixedSizeVideoTrack(displayStream, TARGET_WIDTH, TARGET_HEIGHT, FRAME_RATE);
      stopFixedSizeVideoRef.current = fixedSizeVideo.stop;
      const recordedStream = new MediaStream([fixedSizeVideo.track, ...audioDestinationRef.current.stream.getAudioTracks()]);
      const recorder = new MediaRecorder(recordedStream, {
        mimeType,
        videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
        audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
      });

      const activeWriter = writer;
      writeFailedRef.current = false;
      writeChainRef.current = Promise.resolve();
      recorder.ondataavailable = (event) => {
        if (event.data.size === 0) return;
        writeChainRef.current = writeChainRef.current
          .then(async () => {
            if (writeFailedRef.current) return;
            setBytesWritten(await activeWriter.write(await event.data.arrayBuffer()));
          })
          .catch(error => {
            if (writeFailedRef.current) return;
            writeFailedRef.current = true;
            logger.error('Error writing recording chunk:', error);
            toast({
              description: error?.name === 'QuotaExceededError'
                ? 'Out of storage space — recording stopped'
                : 'Could not save recording — recording stopped',
            });
            stopRecording();
          });
      };
      recorder.onstop = () => { finishRecording(); };
      // The browser's own "Stop sharing" button ends the capture track.
      videoTrack.addEventListener('ended', stopRecording);

      displayStreamRef.current = displayStream;
      recorderRef.current = recorder;
      writerRef.current = writer;
      fileNameRef.current = fileName;
      recorder.start(TIMESLICE_MS);

      const startedAt = Date.now();
      setElapsedSec(0);
      setBytesWritten(0);
      tickRef.current = setInterval(() => setElapsedSec(Math.floor((Date.now() - startedAt) / 1000)), 1000);
      isRecordingRef.current = true;
      setIsRecording(true);
      send({ type: 'recordingStart' });

      const { width, height } = videoTrack.getSettings();
      if (width && height && width < TARGET_WIDTH * 0.9) {
        toast({ description: `Your window is ${width}×${height}. Maximize it for a sharper 1080p recording.` });
      }
    } catch (error) {
      logger.error('Error starting recording:', error);
      toast({ description: 'Could not start recording' });
      releaseMedia();
      displayStream?.getTracks().forEach(track => track.stop());
      if (writer) await writer.close().catch(() => {});
      if (fileName) deleteStoredRecording(fileName).catch(() => {});
      writerRef.current = null;
      fileNameRef.current = null;
    } finally {
      startingRef.current = false;
      setIsStarting(false);
    }
  }, [roomId, toast, send, syncAudioSources, stopRecording, finishRecording, releaseMedia]);

  // Re-mix audio whenever participants (or their tracks) change.
  useEffect(() => {
    if (!isRecording) return;
    syncAudioSources();
    const streams = Object.values(remoteStreams);
    streams.forEach(stream => {
      stream.addEventListener('addtrack', syncAudioSources);
      stream.addEventListener('removetrack', syncAudioSources);
    });
    return () => {
      streams.forEach(stream => {
        stream.removeEventListener('addtrack', syncAudioSources);
        stream.removeEventListener('removetrack', syncAudioSources);
      });
    };
  }, [isRecording, localStream, remoteStreams, syncAudioSources]);

  // Leaving the meeting (or being dropped from it) ends the recording.
  useEffect(() => {
    if (!inMeeting) stopRecording();
  }, [inMeeting, stopRecording]);

  useEffect(() => stopRecording, [stopRecording]);

  const handleRecordingState = useCallback((data: { recorders: string[] }) => {
    setRecorders(data.recorders);
  }, []);

  return {
    isSupported,
    isStarting,
    isRecording,
    isRecordingRef,
    elapsedSec,
    bytesWritten,
    recorders,
    startRecording,
    stopRecording,
    handleRecordingState,
  };
}

export type MeetingRecorder = ReturnType<typeof useMeetingRecorder>;

export default useMeetingRecorder;
