'use client'

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChatMessage, User } from '@/types';
import useChatMessages from '@/hooks/useChatMessages';
import MessageSection from './MessageSection';
import MessageInput from './MessageInput';

interface ChatPanelProps {
  chat: ReturnType<typeof useChatMessages>;
  currentUser: User;
  mentionCandidates: string[];
}

// A full chat (message list + composer) for one channel. Reply/edit state and
// scrolling live here so the room chat and meeting chat stay independent.
export default function ChatPanel({ chat, currentUser, mentionCandidates }: Readonly<ChatPanelProps>) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat.receivedMessages]);

  const handleReply = useCallback((message: ChatMessage) => {
    setEditingMessage(null);
    setReplyingTo(message);
  }, []);

  const handleEdit = useCallback((message: ChatMessage) => {
    setReplyingTo(null);
    setEditingMessage(message);
  }, []);

  return (
    <>
      <MessageSection
        receivedMessages={chat.receivedMessages}
        messagesEndRef={messagesEndRef}
        currentUser={currentUser}
        typingUsers={chat.typingUsers}
        mentionCandidates={mentionCandidates}
        onReact={chat.sendReaction}
        onReply={handleReply}
        onEdit={handleEdit}
        onDelete={chat.sendDeleteMessage}
      />
      <MessageInput
        onSend={chat.sendMessage}
        onSendImage={chat.sendImageMessage}
        onSendVoice={chat.sendVoiceMessage}
        onTyping={chat.sendTyping}
        mentionCandidates={mentionCandidates}
        replyingTo={replyingTo}
        onCancelReply={() => setReplyingTo(null)}
        editingMessage={editingMessage}
        onCancelEdit={() => setEditingMessage(null)}
        onSaveEdit={chat.sendEditMessage}
      />
    </>
  );
}
