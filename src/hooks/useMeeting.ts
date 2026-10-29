import { useCallback, useRef, useState } from 'react';
import { User, OutboundWsMessage } from '@/types';
import { getRtcConfiguration } from '@/lib/webrtc/rtcConfig';
import { logger } from '@/lib/logger';

type ToastFn = (options: { description: string }) => void;

const ICE_RESTART_MIN_INTERVAL_MS = 5000;

interface MeetingPeer {
  pc: RTCPeerConnection;
  // True if we sent the first offer to this peer — only that side
  // re-offers on ICE restart so both never renegotiate at once.
  isInitiator: boolean;
  remoteDescriptionSet: boolean;
  pendingCandidates: RTCIceCandidateInit[];
  lastIceRestart: number;
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

  const inMeetingRef = useRef(false);
  const joiningRef = useRef(false);
  // Set once the server confirms our join — before that, a meetingState
  // that doesn't list us yet is expected and must not kick us out.
  const joinConfirmedRef = useRef(false);
  const localStreamRef = useRef<MediaStream | null>(null);
  const rtcConfigRef = useRef<RTCConfiguration | null>(null);
  const peersRef = useRef<Map<string, MeetingPeer>>(new Map());

  const send = useCallback((message: OutboundWsMessage) => {
    socketRef.current?.send(JSON.stringify(message));
  }, [socketRef]);

  const closePeer = useCallback((peerId: string) => {
    const peer = peersRef.current.get(peerId);
    if (!peer) return;
    peer.pc.close();
    peersRef.current.delete(peerId);
    setRemoteStreams(prev => {
      if (!(peerId in prev)) return prev;
      const next = { ...prev };
      delete next[peerId];
      return next;
    });
  }, []);

  const cleanupLocal = useCallback(() => {
    peersRef.current.forEach(peer => peer.pc.close());
    peersRef.current.clear();
    localStreamRef.current?.getTracks().forEach(track => track.stop());
    localStreamRef.current = null;
    inMeetingRef.current = false;
    joinConfirmedRef.current = false;
    setLocalStream(null);
    setRemoteStreams({});
    setInMeeting(false);
  }, []);

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
    };
    peersRef.current.set(peerId, peer);

    const stream = localStreamRef.current;
    stream?.getTracks().forEach(track => pc.addTrack(track, stream));

    pc.ontrack = (event) => {
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
  };
}

export default useMeeting;
