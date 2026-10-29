import { useCallback, useEffect, useRef, useState } from 'react';
import { User, InboundWsMessage } from '@/types';
import useWebSocketConnection from './useWebSocketConnection';
import usePeerConnection from './usePeerConnection';
import useCall from './useCall';
import useMeeting from './useMeeting';
import useMeetingRecorder from './useMeetingRecorder';
import useChatMessages from './useChatMessages';
import { Identity } from './useIdentity';

type ToastFn = (options: { description: string }) => void;

function useVideoCallApp(
  identity: Identity,
  toast: ToastFn,
  roomId: string,
) {
  const [connectedUsers, setConnectedUsers] = useState<User[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);

  // Always-current ref so the WS handler (which has a stale closure) can still
  // read the latest username without needing to be re-created on every render.
  const currentUserRef = useRef<User | null>(null);
  currentUserRef.current = currentUser;

  const {
    peerConnectionRef,
    remoteDescriptionSet,
    addBufferedCandidates,
    handleNewICECandidate,
    createPeerConnection,
    closePeerConnection,
  } = usePeerConnection();

  // Stable ref so the WS handler always calls the latest version of call callbacks
  // without requiring reconnection when those callbacks change.
  const onMessageRef = useRef<(event: MessageEvent) => void>(() => {});

  const { socketRef, connectionState } = useWebSocketConnection(identity, onMessageRef, roomId);

  const displayName = identity.mode === 'clerk' || identity.mode === 'guest' ? identity.displayName : '';

  const roomChat = useChatMessages(socketRef, currentUserRef, displayName);
  const { receivedMessages, handleChatWsMessage } = roomChat;

  // Separate chat that only reaches people in the group meeting.
  const meetingChat = useChatMessages(socketRef, currentUserRef, displayName, 'meeting');
  const { handleChatWsMessage: handleMeetingChatWsMessage, clearMessages: clearMeetingChat } = meetingChat;

  const {
    inCall,
    localStream,
    remoteStream,
    incomingCall,
    startCall,
    acceptCall,
    rejectCall,
    handleIncomingCall,
    handleCallAccepted,
    handleCallEnded,
    handleCallDeclined,
    handleIceRestartOffer,
    handleIceRestartAnswer,
    endCall,
  } = useCall(
    socketRef,
    { peerConnectionRef, remoteDescriptionSet, addBufferedCandidates, createPeerConnection, closePeerConnection },
    currentUserRef,
    toast,
  );

  const {
    inMeeting,
    inMeetingRef,
    localStream: meetingLocalStream,
    remoteStreams: meetingRemoteStreams,
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
  } = useMeeting(socketRef, currentUserRef, toast);

  const recorder = useMeetingRecorder({
    socketRef,
    inMeeting,
    localStream: meetingLocalStream,
    remoteStreams: meetingRemoteStreams,
    roomId,
    toast,
  });
  const { handleRecordingState, isRecordingRef } = recorder;

  // Meeting chat lasts only as long as you're in the meeting.
  useEffect(() => {
    if (!inMeeting) clearMeetingChat();
  }, [inMeeting, clearMeetingChat]);

  // Update the ref synchronously every render — WS handler always uses current callbacks.
  onMessageRef.current = useCallback((event: MessageEvent) => {
    const data = JSON.parse(event.data) as InboundWsMessage;
    switch (data.type) {
      case 'message':
      case 'typing':
      case 'reaction':
      case 'edit':
      case 'delete':
        handleChatWsMessage(data);
        handleMeetingChatWsMessage(data);
        break;
      case 'userList':
        setConnectedUsers(data.users.map(u => ({ ...u, imageUrl: u.imageUrl ?? null })));
        break;
      case 'userData':
        setCurrentUser(data.user);
        break;
      case 'videoCallOffer':
        // Can't take a 1:1 call while in the group meeting.
        if (inMeetingRef.current) {
          socketRef.current?.send(JSON.stringify({ type: 'callBusy', to: data.from }));
        } else {
          handleIncomingCall(data);
        }
        break;
      case 'videoCallAnswer':
        handleCallAccepted(data);
        break;
      case 'iceCandidate':
        handleNewICECandidate(data);
        break;
      case 'iceRestartOffer':
        handleIceRestartOffer(data);
        break;
      case 'iceRestartAnswer':
        handleIceRestartAnswer(data);
        break;
      case 'endCall':
        handleCallEnded();
        break;
      case 'callBusy':
        handleCallDeclined('busy');
        break;
      case 'callRejected':
        handleCallDeclined('rejected');
        break;
      case 'callFailed':
        handleCallDeclined('unavailable');
        break;
      case 'meetingState':
        handleMeetingState(data);
        break;
      case 'meetingJoined':
        handleMeetingJoined(data);
        break;
      case 'meetingFull':
        handleMeetingFull();
        break;
      case 'meetingOffer':
        handleMeetingOffer(data);
        break;
      case 'meetingAnswer':
        handleMeetingAnswer(data);
        break;
      case 'meetingIce':
        handleMeetingIce(data);
        break;
      case 'recordingState':
        handleRecordingState(data);
        break;
      case 'screenShareState':
        handleScreenShareState(data);
        break;
    }
  }, [handleChatWsMessage, handleMeetingChatWsMessage, handleIncomingCall, handleCallAccepted, handleCallEnded, handleCallDeclined, handleNewICECandidate, handleIceRestartOffer, handleIceRestartAnswer, inMeetingRef, socketRef, handleMeetingState, handleMeetingJoined, handleMeetingFull, handleMeetingOffer, handleMeetingAnswer, handleMeetingIce, handleRecordingState, handleScreenShareState]);

  // Notify the peer immediately if the tab is closed/refreshed mid-call,
  // instead of leaving them stuck on the call screen until their own
  // connection eventually times out.
  useEffect(() => {
    const handleUnload = () => {
      endCall();
      leaveMeeting();
    };
    // While recording, ask before leaving instead — the user may cancel, so
    // don't leave the meeting yet; pagehide handles it if they do go. What's
    // already recorded is kept and offered for download on the next visit.
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (isRecordingRef.current) {
        event.preventDefault();
        event.returnValue = '';
        return;
      }
      handleUnload();
    };
    window.addEventListener('pagehide', handleUnload);
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('pagehide', handleUnload);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [endCall, leaveMeeting, isRecordingRef]);

  return {
    connectedUsers,
    currentUser,
    receivedMessages,
    socketRef,
    connectionState,
    inCall,
    localStream,
    remoteStream,
    incomingCall,
    startCall,
    acceptCall,
    rejectCall,
    handleCallEnded,
    endCall,
    inMeeting,
    meetingLocalStream,
    meetingRemoteStreams,
    meetingParticipants,
    joinMeeting,
    leaveMeeting,
    screenShare: {
      isSupported: screenShareSupported,
      sharer: screenSharer,
      localStream: localScreenStream,
      remoteStreams: remoteScreenStreams,
      start: startScreenShare,
      stop: stopScreenShare,
    },
    recorder,
    roomChat,
    meetingChat,
  };
}

export default useVideoCallApp;
