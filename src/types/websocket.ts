export type MessageKind = 'text' | 'image' | 'voice';

// 'room' is the room-wide chat; 'meeting' only reaches people in the group meeting.
export type ChatChannel = 'room' | 'meeting';

export interface ReplyToRef {
  id: string;
  sender: string;
  preview: string;
}

export type InboundWsMessage =
  | { type: 'userData';        user: { id: string; username: string; imageUrl: string | null } }
  | { type: 'userList';        users: Array<{ id: string; username: string; imageUrl?: string | null }> }
  | { type: 'message';         id: string; kind: MessageKind; content?: string; mediaData?: string; mediaMimeType?: string; durationSec?: number; replyTo?: ReplyToRef; sender: string; senderImageUrl?: string | null; channel?: ChatChannel }
  | { type: 'typing';          sender: string; isTyping: boolean; channel?: ChatChannel }
  | { type: 'reaction';        messageId: string; emoji: string; sender: string; remove?: boolean; channel?: ChatChannel }
  | { type: 'edit';            messageId: string; content: string; sender: string; channel?: ChatChannel }
  | { type: 'delete';          messageId: string; sender: string; channel?: ChatChannel }
  | { type: 'videoCallOffer';  offer: RTCSessionDescriptionInit; from: string; fromUsername: string }
  | { type: 'videoCallAnswer'; answer: RTCSessionDescriptionInit; from: string }
  | { type: 'iceCandidate';    candidate: RTCIceCandidateInit; from: string }
  | { type: 'iceRestartOffer'; offer: RTCSessionDescriptionInit; from: string }
  | { type: 'iceRestartAnswer'; answer: RTCSessionDescriptionInit; from: string }
  | { type: 'endCall';         from: string }
  | { type: 'callBusy';        from: string }
  | { type: 'callRejected';    from: string }
  | { type: 'callFailed' }
  | { type: 'meetingState';    participants: string[] }
  | { type: 'meetingJoined';   participants: string[] }
  | { type: 'meetingFull' }
  | { type: 'meetingOffer';    offer: RTCSessionDescriptionInit; fresh?: boolean; from: string }
  | { type: 'meetingAnswer';   answer: RTCSessionDescriptionInit; from: string }
  | { type: 'meetingIce';      candidate: RTCIceCandidateInit; from: string }
  | { type: 'recordingState';  recorders: string[] }
  | { type: 'screenShareState'; sharer: string | null }
  | { type: 'error';           content: string };

export type OutboundWsMessage =
  | { type: 'message';         id: string; kind: MessageKind; content?: string; mediaData?: string; mediaMimeType?: string; durationSec?: number; replyTo?: ReplyToRef; sender: string; channel?: ChatChannel }
  | { type: 'typing';          sender: string; isTyping: boolean; channel?: ChatChannel }
  | { type: 'reaction';        messageId: string; emoji: string; sender: string; remove?: boolean; channel?: ChatChannel }
  | { type: 'edit';            messageId: string; content: string; sender: string; channel?: ChatChannel }
  | { type: 'delete';          messageId: string; sender: string; channel?: ChatChannel }
  | { type: 'videoCallOffer';  offer: RTCSessionDescriptionInit; to: string }
  | { type: 'videoCallAnswer'; answer: RTCSessionDescriptionInit; to: string }
  | { type: 'iceCandidate';    candidate: RTCIceCandidateInit; to: string }
  | { type: 'iceRestartOffer'; offer: RTCSessionDescriptionInit; to: string }
  | { type: 'iceRestartAnswer'; answer: RTCSessionDescriptionInit; to: string }
  | { type: 'endCall';         to: string }
  | { type: 'callBusy';        to: string }
  | { type: 'callRejected';    to: string }
  | { type: 'meetingJoin' }
  | { type: 'meetingLeave' }
  | { type: 'meetingOffer';    offer: RTCSessionDescriptionInit; fresh?: boolean; to: string }
  | { type: 'meetingAnswer';   answer: RTCSessionDescriptionInit; to: string }
  | { type: 'meetingIce';      candidate: RTCIceCandidateInit; to: string }
  | { type: 'recordingStart' }
  | { type: 'recordingStop' }
  | { type: 'screenShareStart' }
  | { type: 'screenShareStop' };
