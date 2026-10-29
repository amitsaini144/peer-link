'use client'

import { useState } from 'react';
import Image from 'next/image';

interface UserAvatarProps {
  name: string | null | undefined;
  imageUrl?: string | null;
  size: number;
  className?: string;
  fallbackClassName?: string;
}

export default function UserAvatar({ name, imageUrl, size, className = '', fallbackClassName = '' }: Readonly<UserAvatarProps>) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showImage = !!imageUrl && failedSrc !== imageUrl;

  return (
    <div
      className={`rounded-full flex items-center justify-center flex-shrink-0 overflow-hidden ${className}`}
      style={{ width: size, height: size }}
    >
      {showImage ? (
        // Guest avatars are Dicebear SVGs, which the Next image optimizer
        // rejects by default — serve them as-is. Empty alt because the name
        // is always rendered next to the avatar; this also keeps the alt
        // text from spilling out of the circle if the image fails.
        <Image
          src={imageUrl}
          alt=""
          width={size}
          height={size}
          unoptimized
          className="w-full h-full object-cover"
          onError={() => setFailedSrc(imageUrl)}
        />
      ) : (
        <span className={`font-semibold ${fallbackClassName}`}>
          {name?.charAt(0).toUpperCase() ?? '?'}
        </span>
      )}
    </div>
  );
}
