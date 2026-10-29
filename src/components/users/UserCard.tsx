'use client'

import React, { useState } from 'react';
import UserAvatar from '@/components/users/UserAvatar';
import { Button } from '@/components/ui/button';
import { motion } from 'framer-motion';
import { Video } from 'lucide-react';

interface UserCardProps {
  userName: string;
  imageUrl?: string | null;
  onClick: () => void;
  // True when the local user is already in a call or has an incoming call
  // pending — blocks starting another call regardless of which card is
  // clicked, preventing overlapping call attempts.
  disabled?: boolean;
}

export default function UserCard({ userName, imageUrl, onClick, disabled = false }: Readonly<UserCardProps>) {
  const [isCalling, setIsCalling] = useState(false);
  const isDisabled = disabled || isCalling;

  const handleClick = () => {
    if (isDisabled) return;
    setIsCalling(true);
    onClick();
    setTimeout(() => setIsCalling(false), 5000);
  };

  return (
    <motion.div
      className="flex items-center gap-3 p-3 rounded-xl bg-white shadow-md w-full"
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.4 }}
    >
      <div className="relative flex-shrink-0">
        <UserAvatar
          name={userName}
          imageUrl={imageUrl}
          size={40}
          className="bg-brand"
          fallbackClassName="text-white text-sm"
        />
        <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-400 border-2 border-white rounded-full" />
      </div>

      <div className="flex-grow min-w-0">
        <p className="text-gray-800 font-semibold text-sm truncate">{userName}</p>
        <p className="text-gray-400 text-xs">Online</p>
      </div>

      <motion.div whileHover={{ scale: 1.05 }} transition={{ duration: 0.1 }}>
        <Button
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-white text-xs font-medium h-auto ${
            isDisabled
              ? 'bg-gray-300 cursor-not-allowed hover:bg-gray-300'
              : 'bg-brand hover:bg-brand/80'
          }`}
          onClick={handleClick}
          disabled={isDisabled}
        >
          <Video className="h-3.5 w-3.5" />
          {isCalling ? 'Calling...' : 'Call'}
        </Button>
      </motion.div>
    </motion.div>
  );
}
