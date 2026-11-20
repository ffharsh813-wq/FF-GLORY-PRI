import React, { useState } from 'react';

interface BrandMarkProps {
  logoUrl?: string;
  name?: string;
  size?: number;
  className?: string;
}

export const BrandMark: React.FC<BrandMarkProps> = ({
  logoUrl,
  name = 'KAKAROT GLORY PRO',
  size = 34,
  className = '',
}) => {
  const [imgFailed, setImgFailed] = useState(false);

  if (logoUrl && !imgFailed) {
    return (
      <img
        src={logoUrl}
        alt={name}
        width={size}
        height={size}
        referrerPolicy="no-referrer"
        onError={() => setImgFailed(true)}
        style={{ width: size, height: size }}
        className={`rounded-lg object-contain shrink-0 ${className}`}
      />
    );
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label={name}
      className={`shrink-0 ${className}`}
    >
      <defs>
        <linearGradient id="kakarotShieldGold" x1="6" y1="4" x2="34" y2="36" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#F0DCAC" />
          <stop offset="50%" stopColor="#C8A96A" />
          <stop offset="100%" stopColor="#8B6F3A" />
        </linearGradient>
        <linearGradient id="kakarotInnerDark" x1="20" y1="7" x2="20" y2="33" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#262118" />
          <stop offset="100%" stopColor="#12110E" />
        </linearGradient>
      </defs>
      {/* Golden winged crest shield matching screenshot emblem */}
      <path
        d="M20 3L34 8.5V19.5C34 28.2 27.9 34.4 20 37.5C12.1 34.4 6 28.2 6 19.5V8.5L20 3Z"
        fill="url(#kakarotShieldGold)"
      />
      <path
        d="M20 6.2L31 10.6V19.4C31 26.4 26.2 31.4 20 34.1C13.8 31.4 9 26.4 9 19.4V10.6L20 6.2Z"
        fill="url(#kakarotInnerDark)"
      />
      <path
        d="M21.8 10.5L13.8 21.2H19.4L17.8 29.8L26.2 18.8H20.4L21.8 10.5Z"
        fill="#F4E2B8"
        stroke="#DEC79B"
        strokeWidth="0.6"
        strokeLinejoin="round"
      />
    </svg>
  );
};
