import React, { useEffect, useState, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Mic, MicOff, Video, VideoOff, Phone, MessageSquare, X, Link as LinkIcon, Circle, Square, MonitorUp, MonitorX } from 'lucide-react'
import { User } from '@/types'
import UserAvatar from '@/components/users/UserAvatar'
import { MeetingRecorder } from '@/hooks/useMeetingRecorder'
import { formatBytes } from '@/lib/recording/storage'

function formatDuration(totalSec: number): string {
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  const mm = String(m).padStart(h > 0 ? 2 : 1, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

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

// The shared screen: shown whole (never cropped or mirrored) so text stays readable.
function ScreenStage({ stream, label }: Readonly<{ stream: MediaStream | null; label: string }>) {
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null)
  const videoRef = useCallback((el: HTMLVideoElement | null) => setVideoEl(el), [])

  useEffect(() => {
    if (videoEl && stream) videoEl.srcObject = stream
  }, [videoEl, stream])

  return (
    <div className="relative flex-grow min-h-0 min-w-0 bg-black rounded-2xl overflow-hidden">
      {stream ? (
        <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-contain" />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="text-white/50 text-sm">Connecting to presentation...</p>
        </div>
      )}
      <div className="absolute top-2 left-2 bg-black/60 text-white text-xs font-medium px-2 py-1 rounded-md">
        {label}
      </div>
    </div>
  )
}

export interface ScreenShareControls {
  isSupported: boolean;
  // Who is presenting (one at a time), if anyone.
  sharer: string | null;
  localStream: MediaStream | null;
  remoteStreams: Record<string, MediaStream>;
  start: () => void;
  stop: () => void;
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
  recorder: MeetingRecorder;
  screenShare: ScreenShareControls;
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
  recorder,
  screenShare,
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

  const handleLeave = () => {
    if (recorder.isRecording && !window.confirm('Leaving will stop your recording and save it to Downloads. Leave the meeting?')) return
    onLeave()
  }

  const nameFor = (id: string) => users.find(u => u.id === id)?.username ?? 'Guest'

  const isPresenting = !!screenShare.localStream
  const sharer = screenShare.sharer && screenShare.sharer !== currentUser.id && participantIds.includes(screenShare.sharer) ? screenShare.sharer : null
  const presentation = isPresenting
    ? { stream: screenShare.localStream, label: 'You are presenting' }
    : sharer
      ? { stream: screenShare.remoteStreams[sharer] ?? null, label: `${nameFor(sharer)} is presenting` }
      : null

  const togglePresenting = () => {
    if (isPresenting) {
      screenShare.stop()
      return
    }
    if (sharer && !window.confirm(`${nameFor(sharer)} is presenting. Share your screen instead?`)) return
    screenShare.start()
  }

  const recorderNames = recorder.recorders
    .filter(id => participantIds.includes(id))
    .map(id => id === currentUser.id ? 'You' : nameFor(id))

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
            {recorderNames.length > 0 && (
              <div className="flex items-center gap-2 bg-red-500/90 text-white text-xs font-medium px-3 py-1.5 rounded-full max-w-[50%] min-w-0">
                <span className="w-2 h-2 flex-shrink-0 rounded-full bg-white animate-pulse" />
                <span className="truncate">
                  Recording: {recorderNames.join(', ')}
                  {recorder.isRecording && ` · ${formatDuration(recorder.elapsedSec)} · ${formatBytes(recorder.bytesWritten)}`}
                </span>
              </div>
            )}
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
              {presentation ? (
                // Presentation layout: the screen big, cameras in a strip beside
                // it (below it on narrow screens).
                <div className="flex-grow min-h-0 flex flex-col md:flex-row gap-3 p-4">
                  <ScreenStage stream={presentation.stream} label={presentation.label} />
                  <div className="flex md:flex-col gap-3 h-28 md:h-auto md:w-56 flex-shrink-0 overflow-x-auto md:overflow-x-hidden md:overflow-y-auto">
                    <div className="flex-shrink-0 w-40 md:w-full aspect-video grid">
                      <VideoTile stream={localStream} name={currentUser.username ?? 'You'} imageUrl={currentUser.imageUrl} isLocal />
                    </div>
                    {others.map(({ id, user }) => (
                      <div key={id} className="flex-shrink-0 w-40 md:w-full aspect-video grid">
                        <VideoTile stream={remoteStreams[id] ?? null} name={user?.username ?? 'Guest'} imageUrl={user?.imageUrl} />
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
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
              )}

              {others.length === 0 && !presentation && (
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

                {screenShare.isSupported && (
                  <button onClick={togglePresenting} className="flex flex-col items-center gap-1">
                    <div className={`p-3.5 rounded-full transition-colors ${isPresenting ? 'bg-brand text-white' : 'bg-white/20 hover:bg-white/30 text-white'}`}>
                      {isPresenting ? <MonitorX className="h-5 w-5" /> : <MonitorUp className="h-5 w-5" />}
                    </div>
                    <span className="text-white/70 text-[10px] font-medium">{isPresenting ? 'Stop presenting' : 'Present'}</span>
                  </button>
                )}

                {recorder.isSupported && (
                  <button
                    onClick={recorder.isRecording ? recorder.stopRecording : recorder.startRecording}
                    disabled={recorder.isStarting}
                    className="flex flex-col items-center gap-1 disabled:opacity-50"
                  >
                    <div className={`p-3.5 rounded-full transition-colors ${recorder.isRecording ? 'bg-red-500 hover:bg-red-600 text-white' : 'bg-white/20 hover:bg-white/30 text-white'}`}>
                      {recorder.isRecording ? <Square className="h-5 w-5 fill-current" /> : <Circle className="h-5 w-5 fill-red-500 text-red-500" />}
                    </div>
                    <span className="text-white/70 text-[10px] font-medium">{recorder.isRecording ? 'Stop' : 'Record'}</span>
                  </button>
                )}

                <button onClick={handleLeave} className="flex flex-col items-center gap-1">
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
