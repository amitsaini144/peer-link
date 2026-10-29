import React, { useEffect, useState, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Mic, MicOff, Video, VideoOff, Phone, MessageSquare, X, Link as LinkIcon } from 'lucide-react'
import { User } from '@/types'
import UserAvatar from '@/components/users/UserAvatar'

interface VideoTileProps {
  stream: MediaStream | null;
  name: string;
  imageUrl?: string | null;
  isLocal?: boolean;
}

function VideoTile({ stream, name, imageUrl, isLocal = false }: Readonly<VideoTileProps>) {
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null)
  const videoRef = useCallback((el: HTMLVideoElement | null) => setVideoEl(el), [])

  useEffect(() => {
    if (videoEl && stream) videoEl.srcObject = stream
  }, [videoEl, stream])

  return (
    <div className="relative bg-gray-900 rounded-2xl overflow-hidden min-h-0">
      {stream ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isLocal}
          className={`w-full h-full object-cover ${isLocal ? '-scale-x-100' : ''}`}
        />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
          <UserAvatar name={name} imageUrl={imageUrl} size={64} className="bg-brand" fallbackClassName="text-white text-2xl" />
          <p className="text-white/50 text-xs">Connecting...</p>
        </div>
      )}
      <div className="absolute bottom-2 left-2 bg-black/50 text-white text-xs font-medium px-2 py-0.5 rounded-md max-w-[80%] truncate">
        {isLocal ? `${name} (You)` : name}
      </div>
    </div>
  )
}

// Static class strings so Tailwind picks them up.
function gridClassFor(count: number): string {
  if (count <= 1) return 'grid-cols-1'
  if (count === 2) return 'grid-cols-1 md:grid-cols-2'
  if (count <= 4) return 'grid-cols-2'
  return 'grid-cols-2 md:grid-cols-3'
}

interface MeetingOverlayProps {
  inMeeting: boolean;
  currentUser: User;
  localStream: MediaStream | null;
  remoteStreams: Record<string, MediaStream>;
  participantIds: string[];
  users: User[];
  onLeave: () => void;
  onCopyInviteLink: () => void;
  // The room chat, rendered in a side panel (full screen on mobile).
  chat: React.ReactNode;
  // Number of messages received from others — drives the unread badge.
  incomingMessageCount: number;
}

export default function MeetingOverlay({
  inMeeting,
  currentUser,
  localStream,
  remoteStreams,
  participantIds,
  users,
  onLeave,
  onCopyInviteLink,
  chat,
  incomingMessageCount,
}: Readonly<MeetingOverlayProps>) {
  const [isMuted, setIsMuted] = useState(false)
  const [isVideoOff, setIsVideoOff] = useState(false)
  const [isChatOpen, setIsChatOpen] = useState(false)
  const seenMessageCountRef = useRef(incomingMessageCount)

  // Fresh tracks start enabled, so reset the toggles for each new meeting.
  useEffect(() => {
    if (localStream) {
      setIsMuted(false)
      setIsVideoOff(false)
      setIsChatOpen(false)
    }
  }, [localStream])

  // Meeting chat is cleared on leave, so the count can drop back to zero.
  if (incomingMessageCount < seenMessageCountRef.current) seenMessageCountRef.current = incomingMessageCount

  if (isChatOpen) seenMessageCountRef.current = incomingMessageCount
  const unreadCount = Math.max(0, incomingMessageCount - seenMessageCountRef.current)

  const toggleMute = () => {
    if (!localStream) return
    localStream.getAudioTracks().forEach(track => { track.enabled = !track.enabled })
    setIsMuted(prev => !prev)
  }

  const toggleVideo = () => {
    if (!localStream) return
    localStream.getVideoTracks().forEach(track => { track.enabled = !track.enabled })
    setIsVideoOff(prev => !prev)
  }

  const others = participantIds
    .filter(id => id !== currentUser.id)
    .map(id => ({ id, user: users.find(u => u.id === id) }))
  const tileCount = others.length + 1

  return (
    <AnimatePresence>
      {inMeeting && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="fixed inset-0 z-50 bg-gray-950 flex flex-col"
        >
          <div className="flex items-center justify-between px-4 pt-4">
            <div className="flex items-center gap-2 bg-white/10 text-white text-xs font-medium px-3 py-1.5 rounded-full">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>Meeting · {tileCount} {tileCount === 1 ? 'person' : 'people'}</span>
            </div>
            <button
              onClick={onCopyInviteLink}
              className="flex items-center gap-1.5 bg-white/10 hover:bg-white/20 text-white text-xs font-medium px-3 py-1.5 rounded-full transition-colors"
            >
              <LinkIcon className="h-3.5 w-3.5" />
              Invite
            </button>
          </div>

          <div className="flex flex-grow min-h-0">
            <div className="flex flex-col flex-grow min-w-0">
              <div className={`flex-grow min-h-0 grid auto-rows-fr gap-3 p-4 ${gridClassFor(tileCount)}`}>
                <VideoTile stream={localStream} name={currentUser.username ?? 'You'} imageUrl={currentUser.imageUrl} isLocal />
                {others.map(({ id, user }) => (
                  <VideoTile
                    key={id}
                    stream={remoteStreams[id] ?? null}
                    name={user?.username ?? 'Guest'}
                    imageUrl={user?.imageUrl}
                  />
                ))}
              </div>

              {others.length === 0 && (
                <p className="text-center text-white/50 text-sm -mt-2 mb-2">Waiting for others to join...</p>
              )}

              <div className="flex items-center justify-center gap-6 py-5" style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}>
                <button onClick={toggleMute} className="flex flex-col items-center gap-1">
                  <div className={`p-3.5 rounded-full transition-colors ${isMuted ? 'bg-white text-gray-900' : 'bg-white/20 hover:bg-white/30 text-white'}`}>
                    {isMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                  </div>
                  <span className="text-white/70 text-[10px] font-medium">{isMuted ? 'Unmute' : 'Mute'}</span>
                </button>

                <button onClick={toggleVideo} className="flex flex-col items-center gap-1">
                  <div className={`p-3.5 rounded-full transition-colors ${isVideoOff ? 'bg-white text-gray-900' : 'bg-white/20 hover:bg-white/30 text-white'}`}>
                    {isVideoOff ? <VideoOff className="h-5 w-5" /> : <Video className="h-5 w-5" />}
                  </div>
                  <span className="text-white/70 text-[10px] font-medium">{isVideoOff ? 'Show video' : 'Hide video'}</span>
                </button>

                <button onClick={() => setIsChatOpen(prev => !prev)} className="flex flex-col items-center gap-1">
                  <div className={`relative p-3.5 rounded-full transition-colors ${isChatOpen ? 'bg-white text-gray-900' : 'bg-white/20 hover:bg-white/30 text-white'}`}>
                    <MessageSquare className="h-5 w-5" />
                    {unreadCount > 0 && (
                      <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold">
                        {unreadCount > 9 ? '9+' : unreadCount}
                      </span>
                    )}
                  </div>
                  <span className="text-white/70 text-[10px] font-medium">Chat</span>
                </button>

                <button onClick={onLeave} className="flex flex-col items-center gap-1">
                  <div className="p-4 rounded-full bg-red-500 hover:bg-red-600 text-white transition-colors">
                    <Phone className="h-6 w-6 rotate-[135deg]" />
                  </div>
                  <span className="text-white/70 text-[10px] font-medium">Leave</span>
                </button>
              </div>
            </div>

            {isChatOpen && (
              <aside className="fixed inset-0 z-10 bg-gray-950 flex flex-col p-3 md:static md:inset-auto md:z-auto md:w-96 md:flex-shrink-0 md:p-4 md:pl-0">
                <div className="flex items-center justify-between mb-2 text-white">
                  <p className="text-sm font-semibold">Chat</p>
                  <button
                    onClick={() => setIsChatOpen(false)}
                    className="p-1.5 rounded-full text-white/60 hover:text-white hover:bg-white/10 transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                {chat}
              </aside>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
