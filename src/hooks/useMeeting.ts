import { useCallback, useEffect, useRef, useState } from 'react';
import { User, OutboundWsMessage } from '@/types';
import { getRtcConfiguration } from '@/lib/webrtc/rtcConfig';
import { logger } from '@/lib/logger';

type ToastFn = (options: { description: string }) => void;

const ICE_RESTART_MIN_INTERVAL_MS = 5000;
// Per receiving peer — in a mesh the presenter uploads one copy to each.
const SCREEN_MAX_BITRATE = 1_500_000;

function isScreenShareSupported(): boolean {
  if (typeof navigator.mediaDevices?.getDisplayMedia !== 'function') return false;
  // Phone and tablet browsers can't capture the screen.
  return !/Android|iPhone|iPad|iPod|Mobi/i.test(navigator.userAgent);
}

// Screen tracks are sent on their own transceiver with no stream attached,
// so the receiver can tell them from the camera.
function isScreenTrackEvent(event: RTCTrackEvent): boolean {
  return event.track.kind === 'video' && event.streams.length === 0;
}

async function setScreenTrack(transceiver: RTCRtpTransceiver, track: MediaStreamTrack | null) {
  await transceiver.sender.replaceTrack(track);
  if (!track) return;
  const params = transceiver.sender.getParameters();
  if (!params.encodings?.length) return;
  params.encodings[0].maxBitrate = SCREEN_MAX_BITRATE;
  await transceiver.sender.setParameters(params).catch(e => logger.warn('Could not cap screen share bitrate', e));
}

interface MeetingPeer {
  pc: RTCPeerConnection;
  // True if we sent the first offer to this peer — only that side
  // re-offers on ICE restart so both never renegotiate at once.
  isInitiator: boolean;
  remoteDescriptionSet: boolean;
  pendingCandidates: RTCIceCandidateInit[];
  lastIceRestart: number;
  // Extra video slot negotiated up front, so presenting is just a
  // replaceTrack — no renegotiation. Found after the offer on the answering side.
  screenTransceiver: RTCRtpTransceiver | null;
}

// Group meeting over a full mesh: one RTCPeerConnection per other
// participant. Whoever joins sends offers to everyone already in the
// meeting; existing participants only answer.
function useMeeting(
  socketRef: React.RefObject<WebSocket | null>,
  currentUserRef: React.RefObject<User | null>,
  toast: ToastFn,
) {
  const [inMeeting, setInMeeting] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  // Everyone the server says is in this room's meeting (including us once joined).
  const [meetingParticipants, setMeetingParticipants] = useState<string[]>([]);
  const [screenShareSupported, setScreenShareSupported] = useState(false);
  // Who the server says is presenting (one at a time), and their screens.
  const [screenSharer, setScreenSharer] = useState<string | null>(null);
  const [localScreenStream, setLocalScreenStream] = useState<MediaStream | null>(null);
  const [remoteScreenStreams, setRemoteScreenStreams] = useState<Record<string, MediaStream>>({});

  const inMeetingRef = useRef(false);
  const joiningRef = useRef(false);
  // Set once the server confirms our join — before that, a meetingState
  // that doesn't list us yet is expected and must not kick us out.
  const joinConfirmedRef = useRef(false);
  const localStreamRef = useRef<MediaStream | null>(null);
  const rtcConfigRef = useRef<RTCConfiguration | null>(null);
  const peersRef = useRef<Map<string, MeetingPeer>>(new Map());
  const screenTrackRef = useRef<MediaStreamTrack | null>(null);
  const startingScreenShareRef = useRef(false);

  useEffect(() => {
    setScreenShareSupported(isScreenShareSupported());
  }, []);

  const send = useCallback((message: OutboundWsMessage) => {
    socketRef.current?.send(JSON.stringify(message));
  }, [socketRef]);

  const closePeer = useCallback((peerId: string) => {
    const peer = peersRef.current.get(peerId);
    if (!peer) return;
    peer.pc.close();
    peersRef.current.delete(peerId);
    const without = (prev: Record<string, MediaStream>) => {
      if (!(peerId in prev)) return prev;
      const next = { ...prev };
      delete next[peerId];
      return next;
    };
    setRemoteStreams(without);
    setRemoteScreenStreams(without);
  }, []);

  const releaseScreenTrack = useCallback(() => {
    screenTrackRef.current?.stop();
    screenTrackRef.current = null;
    setLocalScreenStream(null);
  }, []);

  const cleanupLocal = useCallback(() => {
    peersRef.current.forEach(peer => peer.pc.close());
    peersRef.current.clear();
    localStreamRef.current?.getTracks().forEach(track => track.stop());
    localStreamRef.current = null;
    releaseScreenTrack();
    inMeetingRef.current = false;
    joinConfirmedRef.current = false;
    setLocalStream(null);
    setRemoteStreams({});
    setRemoteScreenStreams({});
    setInMeeting(false);
  }, [releaseScreenTrack]);

  const flushCandidates = useCallback((peer: MeetingPeer) => {
    peer.pendingCandidates.forEach(candidate => {
      peer.pc.addIceCandidate(candidate).catch(e => logger.error('Error adding buffered meeting ICE candidate', e));
    });
    peer.pendingCandidates = [];
  }, []);

  const restartIce = useCallback(async (peerId: string) => {
    const peer = peersRef.current.get(peerId);
    if (!peer?.isInitiator) return;
    try {
      const offer = await peer.pc.createOffer({ iceRestart: true });
      await peer.pc.setLocalDescription(offer);
      send({ type: 'meetingOffer', offer: peer.pc.localDescription!, to: peerId });
    } catch (error) {
      logger.error('Error restarting meeting ICE:', error);
    }
  }, [send]);

  // Synchronous on purpose (RTC config is fetched up front in joinMeeting):
  // the peer must be registered before the next WS message for it —
  // typically its ICE candidates — is handled.
  const createPeer = useCallback((peerId: string, isInitiator: boolean): MeetingPeer => {
    const pc = new RTCPeerConnection(rtcConfigRef.current ?? undefined);
    const peer: MeetingPeer = {
      pc,
      isInitiator,
      remoteDescriptionSet: false,
      pendingCandidates: [],
      lastIceRestart: 0,
      screenTransceiver: null,
    };
    peersRef.current.set(peerId, peer);

    const stream = localStreamRef.current;
    stream?.getTracks().forEach(track => pc.addTrack(track, stream));
    // The offerer adds the screen slot; the answerer gets it from the offer.
    if (isInitiator) {
      peer.screenTransceiver = pc.addTransceiver(screenTrackRef.current ?? 'video', {
        direction: 'sendrecv',
        sendEncodings: [{ maxBitrate: SCREEN_MAX_BITRATE }],
      });
    }

    pc.ontrack = (event) => {
      if (isScreenTrackEvent(event)) {
        setRemoteScreenStreams(prev => ({ ...prev, [peerId]: new MediaStream([event.track]) }));
        return;
      }
      const [remoteStream] = event.streams;
      if (remoteStream) setRemoteStreams(prev => ({ ...prev, [peerId]: remoteStream }));
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) send({ type: 'meetingIce', candidate: event.candidate.toJSON(), to: peerId });
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState !== 'failed' && pc.iceConnectionState !== 'disconnected') return;
      const now = Date.now();
      if (now - peer.lastIceRestart > ICE_RESTART_MIN_INTERVAL_MS) {
        peer.lastIceRestart = now;
        restartIce(peerId);
      }
    };

    return peer;
  }, [send, restartIce]);

  const joinMeeting = useCallback(async () => {
    if (inMeetingRef.current || joiningRef.current) return;
    joiningRef.current = true;
    try {
      rtcConfigRef.current = await getRtcConfiguration();
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStreamRef.current = stream;
      inMeetingRef.current = true;
      joinConfirmedRef.current = false;
      setLocalStream(stream);
      setInMeeting(true);
      send({ type: 'meetingJoin' });
    } catch (error) {
      logger.error('Error joining meeting:', error);
      toast({ description: 'Failed to access camera/microphone' });
    } finally {
      joiningRef.current = false;
    }
  }, [send, toast]);

  const leaveMeeting = useCallback(() => {
    if (!inMeetingRef.current) return;
    send({ type: 'meetingLeave' });
    cleanupLocal();
  }, [send, cleanupLocal]);

  const handleMeetingJoined = useCallback(async (data: { participants: string[] }) => {
    if (!inMeetingRef.current) return;
    joinConfirmedRef.current = true;
    const myId = currentUserRef.current?.id;

    for (const peerId of data.participants) {
      if (peerId === myId) continue;
      closePeer(peerId);
      const peer = createPeer(peerId, true);
      try {
        const offer = await peer.pc.createOffer();
        await peer.pc.setLocalDescription(offer);
        send({ type: 'meetingOffer', offer: peer.pc.localDescription!, fresh: true, to: peerId });
      } catch (error) {
        logger.error('Error sending meeting offer:', error);
      }
    }
  }, [currentUserRef, closePeer, createPeer, send]);

  const handleMeetingOffer = useCallback(async (data: { offer: RTCSessionDescriptionInit; fresh?: boolean; from: string }) => {
    if (!inMeetingRef.current) return;
    // A fresh offer means the other side (re)joined — drop any connection
    // left over from before. Non-fresh offers are ICE restarts on the
    // existing connection.
    if (data.fresh) closePeer(data.from);
    const peer = peersRef.current.get(data.from) ?? createPeer(data.from, false);

    try {
      await peer.pc.setRemoteDescription(data.offer);
      peer.remoteDescriptionSet = true;
      flushCandidates(peer);
      if (!peer.screenTransceiver) {
        // The offer's extra video m-line: the one not carrying our camera.
        const cameraTrack = localStreamRef.current?.getVideoTracks()[0] ?? null;
        const screenTransceiver = peer.pc.getTransceivers().find(t =>
          t.receiver.track.kind === 'video' && t.sender.track !== cameraTrack);
        if (screenTransceiver) {
          screenTransceiver.direction = 'sendrecv';
          peer.screenTransceiver = screenTransceiver;
          if (screenTrackRef.current) await setScreenTrack(screenTransceiver, screenTrackRef.current);
        }
      }
      const answer = await peer.pc.createAnswer();
      await peer.pc.setLocalDescription(answer);
      send({ type: 'meetingAnswer', answer: peer.pc.localDescription!, to: data.from });
    } catch (error) {
      logger.error('Error answering meeting offer:', error);
    }
  }, [closePeer, createPeer, flushCandidates, send]);

  const handleMeetingAnswer = useCallback(async (data: { answer: RTCSessionDescriptionInit; from: string }) => {
    const peer = peersRef.current.get(data.from);
    if (!peer) return;
    try {
      await peer.pc.setRemoteDescription(data.answer);
      peer.remoteDescriptionSet = true;
      flushCandidates(peer);
    } catch (error) {
      logger.error('Error applying meeting answer:', error);
    }
  }, [flushCandidates]);

  const handleMeetingIce = useCallback((data: { candidate: RTCIceCandidateInit; from: string }) => {
    const peer = peersRef.current.get(data.from);
    if (!peer || !data.candidate) return;
    if (peer.remoteDescriptionSet) {
      peer.pc.addIceCandidate(data.candidate).catch(e => logger.error('Error adding meeting ICE candidate', e));
    } else {
      peer.pendingCandidates.push(data.candidate);
    }
  }, []);

  const handleMeetingState = useCallback((data: { participants: string[] }) => {
    setMeetingParticipants(data.participants);
    if (!inMeetingRef.current || !joinConfirmedRef.current) return;

    const myId = currentUserRef.current?.id;
    if (myId && !data.participants.includes(myId)) {
      // The server dropped us (e.g. our socket reconnected).
      cleanupLocal();
      toast({ description: 'Disconnected from the meeting' });
      return;
    }

    Array.from(peersRef.current.keys()).forEach(peerId => {
      if (!data.participants.includes(peerId)) closePeer(peerId);
    });
  }, [currentUserRef, cleanupLocal, closePeer, toast]);

  const handleMeetingFull = useCallback(() => {
    cleanupLocal();
    toast({ description: 'This meeting is full' });
  }, [cleanupLocal, toast]);

  const stopScreenShare = useCallback(() => {
    if (!screenTrackRef.current) return;
    releaseScreenTrack();
    peersRef.current.forEach(peer => {
      if (peer.screenTransceiver) setScreenTrack(peer.screenTransceiver, null).catch(e => logger.error('Error clearing screen share track', e));
    });
    send({ type: 'screenShareStop' });
  }, [releaseScreenTrack, send]);

  const startScreenShare = useCallback(async () => {
    if (!inMeetingRef.current || screenTrackRef.current || startingScreenShareRef.current) return;
    startingScreenShareRef.current = true;
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 15, max: 30 } },
        audio: false,
        // Sharing the meeting tab itself just shows an endless mirror.
        selfBrowserSurface: 'exclude',
        surfaceSwitching: 'include',
      } as DisplayMediaStreamOptions);
      const [track] = stream.getVideoTracks();
      // Left the meeting while the picker was open.
      if (!inMeetingRef.current) {
        track.stop();
        return;
      }
      // Favor sharp text over smooth motion.
      track.contentHint = 'detail';
      // The browser's own "Stop sharing" button.
      track.addEventListener('ended', stopScreenShare);
      screenTrackRef.current = track;
      setLocalScreenStream(stream);
      peersRef.current.forEach(peer => {
        if (peer.screenTransceiver) setScreenTrack(peer.screenTransceiver, track).catch(e => logger.error('Error sending screen share track', e));
      });
      send({ type: 'screenShareStart' });
    } catch (error) {
      // NotAllowedError = the user closed the share picker.
      if (!(error instanceof DOMException && error.name === 'NotAllowedError')) {
        logger.error('Error starting screen share:', error);
        toast({ description: 'Could not share your screen' });
      }
    } finally {
      startingScreenShareRef.current = false;
    }
  }, [send, stopScreenShare, toast]);

  const handleScreenShareState = useCallback((data: { sharer: string | null }) => {
    setScreenSharer(data.sharer);
    // Someone else started presenting — they take over from us.
    if (screenTrackRef.current && data.sharer !== currentUserRef.current?.id) stopScreenShare();
  }, [currentUserRef, stopScreenShare]);

  return {
    inMeeting,
    inMeetingRef,
    localStream,
    remoteStreams,
    meetingParticipants,
    joinMeeting,
    leaveMeeting,
    handleMeetingJoined,
    handleMeetingOffer,
    handleMeetingAnswer,
    handleMeetingIce,
    handleMeetingState,
    handleMeetingFull,
    screenShareSupported,
    screenSharer,
    localScreenStream,
    remoteScreenStreams,
    startScreenShare,
    stopScreenShare,
    handleScreenShareState,
  };
}

export default useMeeting;
