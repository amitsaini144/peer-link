'use client'

import { useState } from 'react';
import Image from 'next/image';
import UserAvatar from '@/components/users/UserAvatar';
import { MessageSquare, SmilePlus, Reply, Pencil, Trash2, X, Languages } from 'lucide-react';
import { User, ChatMessage } from "@/types";
import { renderRichText, messageMentionsUser } from '@/lib/chat/richText';
import { TRANSCRIPT_LANGUAGES } from '@/lib/chat/transcriptLanguages';
import useVoiceTranscripts from '@/hooks/useVoiceTranscripts';
import VoiceMessagePlayer from './VoiceMessagePlayer';
import VoiceTranscript from './VoiceTranscript';
import ReactionPicker from './ReactionPicker';

interface MessageSectionProps {
  receivedMessages: ChatMessage[];
  messagesEndRef: React.RefObject<HTMLDivElement>;
  currentUser: User;
  typingUsers: Set<string>;
  mentionCandidates: string[];
  onReact: (messageId: string, emoji: string) => void;
  onReply: (message: ChatMessage) => void;
  onEdit: (message: ChatMessage) => void;
  onDelete: (messageId: string) => void;
}

function TypingIndicator({ typingUsers }: Readonly<{ typingUsers: Set<string> }>) {
  const names = Array.from(typingUsers);
  if (names.length === 0) return null;

  const label = names.length === 1 ? `${names[0]} is typing` : 'Several people are typing';

  return (
    <div className="flex items-center gap-1.5 px-2 py-1 text-xs text-gray-400 italic">
      <span>{label}</span>
      <span className="flex gap-0.5">
        <span className="h-1 w-1 rounded-full bg-gray-400 animate-bounce [animation-delay:-0.3s]" />
        <span className="h-1 w-1 rounded-full bg-gray-400 animate-bounce [animation-delay:-0.15s]" />
        <span className="h-1 w-1 rounded-full bg-gray-400 animate-bounce" />
      </span>
    </div>
  );
}

function ImageLightbox({ src, onClose }: Readonly<{ src: string; onClose: () => void }>) {
  return (
    <div
      role="button"
      tabIndex={0}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
      onKeyDown={(e) => (e.key === 'Escape' || e.key === 'Enter') && onClose()}
    >
      <button
        onClick={onClose}
        className="absolute top-4 right-4 p-2 rounded-full bg-white/10 text-white hover:bg-white/20"
      >
        <X className="h-5 w-5" />
      </button>
      <Image
        src={src}
        alt="Shared attachment"
        width={1024}
        height={1024}
        unoptimized
        className="max-w-full max-h-full w-auto h-auto rounded-lg object-contain"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

function DeletedBubble({ isOwn }: Readonly<{ isOwn: boolean }>) {
  return (
    <div className={`max-w-[70%] rounded-2xl px-4 py-2 text-sm italic text-gray-400 border border-dashed border-gray-200 ${isOwn ? 'rounded-br-sm' : 'rounded-bl-sm'}`}>
      This message was deleted
    </div>
  );
}

interface BubbleContentProps {
  message: ChatMessage;
  currentUsername: string | null;
  mentionCandidates: string[];
  isMentioned: boolean;
  onOpenImage: (src: string) => void;
  transcripts: ReturnType<typeof useVoiceTranscripts>;
}

function BubbleContent({ message, currentUsername, mentionCandidates, isMentioned, onOpenImage, transcripts }: Readonly<BubbleContentProps>) {
  const bubbleClass = message.isOwn
    ? 'bg-brand text-white rounded-br-sm'
    : `bg-gray-100 text-gray-800 rounded-bl-sm${isMentioned ? ' ring-2 ring-yellow-400' : ''}`;
  const isPlainImage = message.kind === 'image' && !!message.mediaData && !message.replyTo;
  const paddingClass = isPlainImage ? '' : 'px-4 py-2';

  return (
    <div className={`rounded-2xl overflow-hidden text-sm leading-relaxed ${paddingClass} ${bubbleClass}`}>
      {message.replyTo && (
        <div className={`mb-1.5 pl-2 border-l-2 text-xs opacity-80 ${message.isOwn ? 'border-white/50' : 'border-brand/40'}`}>
          <p className="font-semibold">{message.replyTo.sender}</p>
          <p className="truncate max-w-[180px]">{message.replyTo.preview}</p>
        </div>
      )}
      {message.kind === 'text' && message.content && (
        <span>{renderRichText(message.content, currentUsername, mentionCandidates)}</span>
      )}
      {message.kind === 'image' && message.mediaData && (
        <button type="button" onClick={() => onOpenImage(message.mediaData!)} className="block">
          <Image
            src={message.mediaData}
            alt="Shared attachment"
            width={200}
            height={200}
            unoptimized
            className="max-w-[200px] max-h-[200px] w-auto h-auto object-cover"
          />
        </button>
      )}
      {message.kind === 'voice' && message.mediaData && (
        <>
          <VoiceMessagePlayer src={message.mediaData} durationSec={message.durationSec} isOwn={message.isOwn} />
          <VoiceTranscript
            isOwn={message.isOwn}
            language={transcripts.language}
            status={transcripts.getEntry(message.id)?.status}
            text={transcripts.getEntry(message.id)?.text}
            onRequest={() => transcripts.requestTranscript(message.id, message.mediaData!)}
          />
        </>
      )}
      {message.edited && (
        <span className={`ml-1 text-[10px] italic ${message.isOwn ? 'text-white/70' : 'text-gray-400'}`}>(edited)</span>
      )}
    </div>
  );
}

interface BubbleActionsProps {
  message: ChatMessage;
  onReply: (message: ChatMessage) => void;
  onToggleReactionPicker: () => void;
  onEdit: (message: ChatMessage) => void;
  onDelete: (messageId: string) => void;
}

function BubbleActions({ message, onReply, onToggleReactionPicker, onEdit, onDelete }: Readonly<BubbleActionsProps>) {
  return (
    <div className={`absolute -top-9 z-20 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity ${
      message.isOwn ? 'right-0' : 'left-0'
    }`}>
      <button
        onClick={() => onReply(message)}
        className="p-1 rounded-full bg-white shadow border border-gray-100 text-gray-400 hover:text-gray-600"
      >
        <Reply className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={onToggleReactionPicker}
        className="p-1 rounded-full bg-white shadow border border-gray-100 text-gray-400 hover:text-gray-600"
      >
        <SmilePlus className="h-3.5 w-3.5" />
      </button>
      {message.isOwn && message.kind === 'text' && (
        <>
          <button
            onClick={() => onEdit(message)}
            className="p-1 rounded-full bg-white shadow border border-gray-100 text-gray-400 hover:text-gray-600"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => onDelete(message.id)}
            className="p-1 rounded-full bg-white shadow border border-gray-100 text-gray-400 hover:text-red-500"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </>
      )}
    </div>
  );
}

interface BubbleReactionsProps {
  message: ChatMessage;
  reactionEntries: [string, string[]][];
  onReact: (messageId: string, emoji: string) => void;
}

function BubbleReactions({ message, reactionEntries, onReact }: Readonly<BubbleReactionsProps>) {
  if (reactionEntries.length === 0) return null;

  return (
    <div className={`flex flex-wrap gap-1 mt-1 ${message.isOwn ? 'justify-end' : 'justify-start'}`}>
      {reactionEntries.map(([emoji, users]) => (
        <button
          key={emoji}
          onClick={() => onReact(message.id, emoji)}
          className="flex items-center gap-1 text-xs bg-gray-100 hover:bg-gray-200 rounded-full px-2 py-0.5 transition-colors"
        >
          <span>{emoji}</span>
          <span className="text-gray-500">{users.length}</span>
        </button>
      ))}
    </div>
  );
}

interface MessageBubbleProps {
  message: ChatMessage;
  currentUsername: string | null;
  mentionCandidates: string[];
  onReact: (messageId: string, emoji: string) => void;
  onReply: (message: ChatMessage) => void;
  onEdit: (message: ChatMessage) => void;
  onDelete: (messageId: string) => void;
  onOpenImage: (src: string) => void;
  transcripts: ReturnType<typeof useVoiceTranscripts>;
}

function MessageBubble({ message, currentUsername, mentionCandidates, onReact, onReply, onEdit, onDelete, onOpenImage, transcripts }: Readonly<MessageBubbleProps>) {
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const reactionEntries = Object.entries(message.reactions ?? {}).filter(([, users]) => users.length > 0);
  const isMentioned = !message.isOwn && messageMentionsUser(message.content, currentUsername);

  if (message.deleted) {
    return (
      <div className={`mb-3 flex items-end gap-2 ${message.isOwn ? 'justify-end' : 'justify-start'}`}>
        {!message.isOwn && <div className="w-7 h-7 flex-shrink-0" />}
        <DeletedBubble isOwn={message.isOwn} />
      </div>
    );
  }

  return (
    <div className={`mb-3 flex items-end gap-2 ${message.isOwn ? 'justify-end' : 'justify-start'}`}>
      {!message.isOwn && (
        <UserAvatar
          name={message.sender}
          imageUrl={message.senderImageUrl}
          size={28}
          className="bg-brand/20 mb-0.5"
          fallbackClassName="text-brand text-xs"
        />
      )}
      <div className={`max-w-[70%] flex flex-col ${message.isOwn ? 'items-end' : 'items-start'}`}>
        {!message.isOwn && (
          <p className="text-[10px] text-gray-400 font-medium mb-0.5 ml-1">{message.sender ?? 'Unknown'}</p>
        )}
        <div className="relative group z-0 hover:z-20 focus-within:z-20">
          <BubbleContent message={message} currentUsername={currentUsername} mentionCandidates={mentionCandidates} isMentioned={isMentioned} onOpenImage={onOpenImage} transcripts={transcripts} />
          <BubbleActions
            message={message}
            onReply={onReply}
            onToggleReactionPicker={() => setShowReactionPicker(prev => !prev)}
            onEdit={onEdit}
            onDelete={onDelete}
          />
          {showReactionPicker && (
            <ReactionPicker
              align={message.isOwn ? 'right' : 'left'}
              onSelect={(emoji) => {
                onReact(message.id, emoji);
                setShowReactionPicker(false);
              }}
              onClose={() => setShowReactionPicker(false)}
            />
          )}
        </div>
        <BubbleReactions message={message} reactionEntries={reactionEntries} onReact={onReact} />
      </div>
    </div>
  );
}

export default function MessageSection({ receivedMessages, messagesEndRef, currentUser, typingUsers, mentionCandidates, onReact, onReply, onEdit, onDelete }: Readonly<MessageSectionProps>) {
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const transcripts = useVoiceTranscripts();

  return (
    <div className="flex flex-col flex-grow min-h-0">
      <div className="flex items-center justify-end gap-1.5 px-1 mb-1.5">
        <Languages className="h-3.5 w-3.5 text-gray-400" />
        <select
          value={transcripts.language ?? ''}
          onChange={(e) => transcripts.setLanguage(e.target.value || null)}
          className="bg-transparent text-xs text-gray-500 focus:outline-none"
        >
          <option value="">Voice transcripts off</option>
          {TRANSCRIPT_LANGUAGES.map((option) => (
            <option key={option.code} value={option.code}>Transcribe voice to {option.label}</option>
          ))}
        </select>
      </div>
      <div className="flex-grow overflow-y-auto bg-white rounded-2xl p-4 pt-8 scrollbar-thin">
        {receivedMessages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-gray-400 py-12">
            <MessageSquare className="h-8 w-8 opacity-40" />
            <p className="text-sm font-medium">No messages yet. Say hello!</p>
          </div>
        ) : (
          receivedMessages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              currentUsername={currentUser.username}
              mentionCandidates={mentionCandidates}
              onReact={onReact}
              onReply={onReply}
              onEdit={onEdit}
              onDelete={onDelete}
              onOpenImage={setLightboxSrc}
              transcripts={transcripts}
            />
          ))
        )}
        <TypingIndicator typingUsers={typingUsers} />
        <div ref={messagesEndRef} />
      </div>
      {lightboxSrc && <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}
    </div>
  );
}
