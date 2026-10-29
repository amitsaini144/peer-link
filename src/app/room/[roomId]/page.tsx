"use client"
import { useEffect, useRef, useCallback, useState } from 'react'
import { useRouter } from 'next/navigation';
import { useToast } from "@/components/ui/use-toast"
import { motion } from 'framer-motion';
import { Video, Link as LinkIcon } from 'lucide-react';
import useVideoCallApp from '@/hooks/useVideoCallApp';
import useUnfocusedTabNotifications from '@/hooks/useUnfocusedTabNotifications';
import useIdentity from '@/hooks/useIdentity';
import { ChatMessage } from '@/types';
import Navbar from '@/components/layout/Navbar';
import LoadingScreen from '@/components/layout/LoadingScreen';
import MovingCloudsBackground from '@/components/background/MovingCloudsBackground';
import UserCard from '@/components/users/UserCard';
import MessageSection from '@/components/chat/MessageSection';
import MessageInput from '@/components/chat/MessageInput';
import VideoCallOverlay from '@/components/call/VideoCallOverlay';
import IncomingCallDialog from '@/components/call/IncomingCallDialog';

const ROOM_SOFT_CAP = 5;

export default function RoomPage({ params }: Readonly<{ params: { roomId: string } }>) {
  const { roomId } = params;
  const identity = useIdentity();
  const router = useRouter();
  const { toast } = useToast();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const hasWarnedFullRef = useRef(false);

  useEffect(() => {
    if (identity.mode === 'anonymous') router.replace(`/?room=${encodeURIComponent(roomId)}`);
  }, [identity.mode, router, roomId]);

  const {
    connectedUsers,
    currentUser,
    receivedMessages,
    startCall,
    endCall,
    localStream,
    remoteStream,
    inCall,
    incomingCall,
    acceptCall,
    rejectCall,
    sendMessage,
    sendImageMessage,
    sendVoiceMessage,
    sendReaction,
    sendEditMessage,
    sendDeleteMessage,
    sendTyping,
    typingUsers,
    connectionState,
  } = useVideoCallApp(identity, toast, roomId);

  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [receivedMessages, scrollToBottom]);

  useUnfocusedTabNotifications(receivedMessages);

  const handleReply = useCallback((message: ChatMessage) => {
    setEditingMessage(null);
    setReplyingTo(message);
  }, []);

  const handleEdit = useCallback((message: ChatMessage) => {
    setReplyingTo(null);
    setEditingMessage(message);
  }, []);

  const handleCopyInviteLink = useCallback(() => {
    navigator.clipboard.writeText(window.location.href);
    toast({ description: 'Room link copied to clipboard' });
  }, [toast]);

  const otherConnectedUsersCount = currentUser
    ? connectedUsers.filter(u => u.id !== currentUser.id).length
    : 0;

  useEffect(() => {
    if (otherConnectedUsersCount >= ROOM_SOFT_CAP && !hasWarnedFullRef.current) {
      hasWarnedFullRef.current = true;
      toast({ description: 'This room is getting full' });
    }
  }, [otherConnectedUsersCount, toast]);

  if (!currentUser || connectionState !== 'connected') {
    return (
      <div className='relative flex flex-col h-dvh overflow-hidden bg-gradient-to-bl from-sky-700 via-sky-500 to-sky-300'>
        <MovingCloudsBackground />
        <LoadingScreen
          message={currentUser ? 'Reconnecting to server...' : 'Joining room...'}
        />
      </div>
    );
  }

  const otherConnectedUsers = connectedUsers.filter(u => u.id !== currentUser.id);
  const mentionCandidates = otherConnectedUsers.map(u => u.username).filter((name): name is string => !!name);

  return (
    <div className='relative flex flex-col h-dvh overflow-hidden bg-gradient-to-bl from-sky-700 via-sky-500 to-sky-300'>
      <MovingCloudsBackground />
      <div className='relative z-10 flex flex-col h-dvh overflow-hidden bg-white/10 backdrop-blur-[2px]'>
        <Navbar
          userName={identity.mode === 'clerk' || identity.mode === 'guest' ? identity.displayName : ''}
          isGuest={identity.mode === 'guest'}
        />

        <div className='flex flex-col flex-grow min-h-0 pt-16'>
          {otherConnectedUsers.length === 0 ? (
            <div className='flex flex-grow items-center justify-center'>
              <motion.div
                className='flex flex-col items-center gap-3 text-white'
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.5, ease: 'easeInOut' }}
              >
                <div className='bg-white/20 p-4 rounded-2xl'>
                  <Video className='h-10 w-10 text-white' />
                </div>
                <p className='text-xl font-semibold'>You&apos;re the only one here</p>
                <p className='text-white/60 text-sm'>Share the link below to invite others</p>
                <button
                  onClick={handleCopyInviteLink}
                  className='mt-2 flex items-center gap-2 bg-white/20 hover:bg-white/30 transition-colors text-white text-sm font-medium px-4 py-2 rounded-xl'
                >
                  <LinkIcon className='h-4 w-4' />
                  Copy invite link
                </button>
              </motion.div>
            </div>
          ) : (
            <div className='flex flex-col md:flex-row flex-grow min-h-0 gap-4 p-4' style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
              <aside className='md:w-64 lg:w-72 flex-shrink-0'>
                <div className='bg-white/15 backdrop-blur-2xl rounded-2xl p-4 border border-white/25 h-full'>
                  <div className='flex items-center justify-between mb-3'>
                    <p className='text-white/60 text-xs font-semibold uppercase tracking-widest'>
                      Online — {otherConnectedUsers.length}
                    </p>
                    <button
                      onClick={handleCopyInviteLink}
                      title='Copy invite link'
                      className='text-white/60 hover:text-white transition-colors'
                    >
                      <LinkIcon className='h-4 w-4' />
                    </button>
                  </div>
                  <div className='flex flex-row md:flex-col gap-3 flex-wrap md:flex-nowrap'>
                    {otherConnectedUsers.map((u) => (
                      <UserCard
                        key={u.id}
                        userName={u.username || 'Unknown'}
                        imageUrl={u.imageUrl}
                        onClick={() => startCall(u)}
                        disabled={inCall || !!incomingCall}
                      />
                    ))}
                  </div>
                </div>
              </aside>

              <main className='flex flex-col flex-grow min-h-0'>
                <MessageSection
                  receivedMessages={receivedMessages}
                  messagesEndRef={messagesEndRef}
                  currentUser={currentUser}
                  typingUsers={typingUsers}
                  mentionCandidates={mentionCandidates}
                  onReact={sendReaction}
                  onReply={handleReply}
                  onEdit={handleEdit}
                  onDelete={sendDeleteMessage}
                />
                <MessageInput
                  onSend={sendMessage}
                  onSendImage={sendImageMessage}
                  onSendVoice={sendVoiceMessage}
                  onTyping={sendTyping}
                  mentionCandidates={mentionCandidates}
                  replyingTo={replyingTo}
                  onCancelReply={() => setReplyingTo(null)}
                  editingMessage={editingMessage}
                  onCancelEdit={() => setEditingMessage(null)}
                  onSaveEdit={sendEditMessage}
                />
              </main>
            </div>
          )}
        </div>
      </div>

      <VideoCallOverlay inCall={inCall} localStream={localStream} remoteStream={remoteStream} handleCallEnded={endCall} />
      {incomingCall && (
        <IncomingCallDialog
          callerName={incomingCall.fromUsername}
          onAccept={acceptCall}
          onReject={rejectCall}
        />
      )}
    </div>
  );
}
