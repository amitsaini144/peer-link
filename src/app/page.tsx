"use client"
import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { SignInButton } from '@clerk/nextjs';
import { motion } from 'framer-motion';
import { Video, ArrowRight, UserRound } from 'lucide-react';
import Navbar from '@/components/layout/Navbar';
import LoadingScreen from '@/components/layout/LoadingScreen';
import MovingCloudsBackground from '@/components/background/MovingCloudsBackground';
import { generateRoomId, normalizeRoomInput } from '@/lib/room';
import { getOrCreateGuestIdentity } from '@/lib/guest';
import useIdentity from '@/hooks/useIdentity';

export default function Home() {
  const identity = useIdentity();
  const router = useRouter();
  const [joinCode, setJoinCode] = useState('');
  // Room the visitor was trying to open before being asked to pick an identity.
  const [pendingRoom, setPendingRoom] = useState<string | null>(null);

  useEffect(() => {
    const room = normalizeRoomInput(new URLSearchParams(window.location.search).get('room') ?? '');
    if (room) setPendingRoom(room);
  }, []);

  useEffect(() => {
    if (pendingRoom && (identity.mode === 'guest' || identity.mode === 'clerk')) {
      router.replace(`/room/${encodeURIComponent(pendingRoom)}`);
    }
  }, [pendingRoom, identity.mode, router]);

  const handleNewRoom = useCallback(() => {
    router.push(`/room/${generateRoomId()}`);
  }, [router]);

  const handleJoinRoom = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const roomId = normalizeRoomInput(joinCode);
    if (!roomId) return;
    router.push(`/room/${roomId}`);
  }, [joinCode, router]);

  const handleContinueAsGuest = useCallback(() => {
    getOrCreateGuestIdentity();
    if (identity.mode === 'anonymous') identity.refresh();
  }, [identity]);

  if (identity.mode === 'loading' || (pendingRoom && identity.mode !== 'anonymous')) {
    return (
      <div className='relative flex flex-col h-dvh overflow-hidden bg-gradient-to-bl from-sky-700 via-sky-500 to-sky-300'>
        <MovingCloudsBackground />
        <LoadingScreen message={pendingRoom ? 'Joining room...' : 'Loading...'} />
      </div>
    );
  }

  if (identity.mode === 'anonymous') {
    return (
      <div className='relative flex flex-col h-dvh overflow-hidden bg-gradient-to-bl from-sky-700 via-sky-500 to-sky-300'>
        <MovingCloudsBackground />
        <div className='relative z-10 flex flex-grow flex-col items-center justify-center px-4'>
          <motion.div
            className='w-full max-w-md flex flex-col items-center gap-6 text-white'
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, ease: 'easeInOut' }}
          >
            <div className='bg-white/20 p-4 rounded-2xl'>
              <Video className='h-10 w-10 text-white' />
            </div>
            <div className='text-center'>
              <p className='text-2xl font-semibold'>{pendingRoom ? "You've been invited to a room" : 'Welcome to PeerLink'}</p>
              <p className='text-white/60 text-sm mt-1'>
                {pendingRoom
                  ? 'Sign in or continue as a guest to join'
                  : 'Sign in for a saved identity, or jump straight in as a guest'}
              </p>
            </div>

            <SignInButton mode='modal'>
              <button className='w-full flex items-center justify-center gap-2 bg-white text-sky-700 font-semibold px-5 py-3 rounded-xl hover:bg-white/90 transition-colors'>
                Continue with Google
              </button>
            </SignInButton>

            <div className='w-full flex items-center gap-3 text-white/50 text-xs uppercase tracking-widest'>
              <div className='flex-grow h-px bg-white/20' />
              or
              <div className='flex-grow h-px bg-white/20' />
            </div>

            <button
              onClick={handleContinueAsGuest}
              className='w-full flex items-center justify-center gap-2 bg-white/20 hover:bg-white/30 transition-colors text-white font-semibold px-5 py-3 rounded-xl'
            >
              <UserRound className='h-5 w-5' />
              Continue as Guest
            </button>
          </motion.div>
        </div>
      </div>
    );
  }

  return (
    <div className='relative flex flex-col h-dvh overflow-hidden bg-gradient-to-bl from-sky-700 via-sky-500 to-sky-300'>
      <MovingCloudsBackground />
      <div className='relative z-10 flex flex-col h-dvh overflow-hidden bg-white/10 backdrop-blur-[2px]'>
        <Navbar userName={identity.displayName} isGuest={identity.mode === 'guest'} />

        <div className='flex flex-grow items-center justify-center pt-16 px-4'>
          <motion.div
            className='w-full max-w-md flex flex-col items-center gap-6 text-white'
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, ease: 'easeInOut' }}
          >
            <div className='bg-white/20 p-4 rounded-2xl'>
              <Video className='h-10 w-10 text-white' />
            </div>
            <div className='text-center'>
              <p className='text-2xl font-semibold'>Start a room</p>
              <p className='text-white/60 text-sm mt-1'>Create a private room and share the link to invite others</p>
            </div>

            <button
              onClick={handleNewRoom}
              className='w-full flex items-center justify-center gap-2 bg-white text-sky-700 font-semibold px-5 py-3 rounded-xl hover:bg-white/90 transition-colors'
            >
              <Video className='h-5 w-5' />
              New Room
            </button>

            <div className='w-full flex items-center gap-3 text-white/50 text-xs uppercase tracking-widest'>
              <div className='flex-grow h-px bg-white/20' />
              or
              <div className='flex-grow h-px bg-white/20' />
            </div>

            <form onSubmit={handleJoinRoom} className='w-full flex gap-2'>
              <input
                type='text'
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                placeholder='Enter a code or link'
                className='flex-grow bg-white/15 border border-white/25 placeholder:text-white/50 text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-white/40'
              />
              <button
                type='submit'
                disabled={!joinCode.trim()}
                className='flex items-center justify-center bg-white/20 hover:bg-white/30 disabled:opacity-40 disabled:hover:bg-white/20 transition-colors rounded-xl px-4'
              >
                <ArrowRight className='h-5 w-5' />
              </button>
            </form>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
