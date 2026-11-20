import React from 'react';

interface RegionFlagProps {
  codeOrId: string;
  className?: string;
}

export const RegionFlag: React.FC<RegionFlagProps> = ({ codeOrId, className = 'w-5 h-3.5' }) => {
  const key = codeOrId.trim().toLowerCase();

  if (key === 'bd' || key === 'bn' || key === 'bangladesh') {
    return (
      <svg viewBox="0 0 24 16" className={`rounded-[3px] shrink-0 ${className}`} aria-hidden="true">
        <rect width="24" height="16" fill="#006A4E" />
        <circle cx="10.5" cy="8" r="4.5" fill="#F42A41" />
      </svg>
    );
  }
  if (key === 'in' || key === 'ind' || key === 'hi' || key === 'india') {
    return (
      <svg viewBox="0 0 24 16" className={`rounded-[3px] shrink-0 ${className}`} aria-hidden="true">
        <rect width="24" height="5.33" fill="#FF9933" />
        <rect y="5.33" width="24" height="5.34" fill="#FFFFFF" />
        <rect y="10.67" width="24" height="5.33" fill="#138808" />
        <circle cx="12" cy="8" r="1.8" fill="none" stroke="#000080" strokeWidth="0.8" />
      </svg>
    );
  }
  if (key === 'id' || key === 'indonesia') {
    return (
      <svg viewBox="0 0 24 16" className={`rounded-[3px] shrink-0 ${className}`} aria-hidden="true">
        <rect width="24" height="8" fill="#CE1126" />
        <rect y="8" width="24" height="8" fill="#FFFFFF" />
      </svg>
    );
  }
  if (key === 'pk' || key === 'ur' || key === 'pakistan') {
    return (
      <svg viewBox="0 0 24 16" className={`rounded-[3px] shrink-0 ${className}`} aria-hidden="true">
        <rect width="24" height="16" fill="#01411C" />
        <rect width="6" height="16" fill="#FFFFFF" />
        <circle cx="15.5" cy="8" r="3.6" fill="#FFFFFF" />
        <circle cx="16.7" cy="7.2" r="3" fill="#01411C" />
      </svg>
    );
  }
  if (key === 'sg' || key === 'singapore') {
    return (
      <svg viewBox="0 0 24 16" className={`rounded-[3px] shrink-0 ${className}`} aria-hidden="true">
        <rect width="24" height="8" fill="#EF3340" />
        <rect y="8" width="24" height="8" fill="#FFFFFF" />
        <circle cx="6.2" cy="4" r="2.2" fill="#FFFFFF" />
        <circle cx="7.1" cy="4" r="1.8" fill="#EF3340" />
      </svg>
    );
  }
  if (key === 'vn' || key === 'vi' || key === 'vietnam' || key === 'vietname') {
    return (
      <svg viewBox="0 0 24 16" className={`rounded-[3px] shrink-0 ${className}`} aria-hidden="true">
        <rect width="24" height="16" fill="#DA251D" />
        <polygon
          points="12,3.5 13.1,6.8 16.5,6.8 13.8,8.8 14.8,12.1 12,10.1 9.2,12.1 10.2,8.8 7.5,6.8 10.9,6.8"
          fill="#FFFF00"
        />
      </svg>
    );
  }
  if (key === 'eu' || key === 'europe') {
    return (
      <svg viewBox="0 0 24 16" className={`rounded-[3px] shrink-0 ${className}`} aria-hidden="true">
        <rect width="24" height="16" fill="#003399" />
        <circle cx="12" cy="8" r="4.2" fill="none" stroke="#FFCC00" strokeWidth="1.2" strokeDasharray="1.2 1.8" />
      </svg>
    );
  }
  if (key === 'me' || key === 'middle east' || key === 'ar') {
    return (
      <svg viewBox="0 0 24 16" className={`rounded-[3px] shrink-0 ${className}`} aria-hidden="true">
        <rect width="24" height="16" fill="#006C35" />
        <rect x="6" y="10.5" width="12" height="1.4" rx="0.7" fill="#FFFFFF" />
        <rect x="7" y="5.5" width="10" height="2.4" rx="1" fill="#FFFFFF" opacity="0.85" />
      </svg>
    );
  }
  if (key === 'us' || key === 'na' || key === 'north america' || key === 'united states (us)') {
    return (
      <svg viewBox="0 0 24 16" className={`rounded-[3px] shrink-0 ${className}`} aria-hidden="true">
        <rect width="24" height="16" fill="#B22234" />
        <rect y="2.3" width="24" height="2.3" fill="#FFFFFF" />
        <rect y="6.9" width="24" height="2.3" fill="#FFFFFF" />
        <rect y="11.5" width="24" height="2.3" fill="#FFFFFF" />
        <rect width="10.5" height="8.5" fill="#3C3B6E" />
      </svg>
    );
  }
  if (key === 'en' || key === 'gb' || key === 'uk') {
    return (
      <svg viewBox="0 0 24 16" className={`rounded-[3px] shrink-0 ${className}`} aria-hidden="true">
        <rect width="24" height="16" fill="#012169" />
        <path d="M0 0L24 16M24 0L0 16" stroke="#FFFFFF" strokeWidth="2.8" />
        <path d="M0 0L24 16M24 0L0 16" stroke="#C8102E" strokeWidth="1.4" />
        <path d="M12 0V16M0 8H24" stroke="#FFFFFF" strokeWidth="4.4" />
        <path d="M12 0V16M0 8H24" stroke="#C8102E" strokeWidth="2.4" />
      </svg>
    );
  }
  if (key === 'es' || key === 'spain') {
    return (
      <svg viewBox="0 0 24 16" className={`rounded-[3px] shrink-0 ${className}`} aria-hidden="true">
        <rect width="24" height="4" fill="#AA151B" />
        <rect y="4" width="24" height="8" fill="#F1BF00" />
        <rect y="12" width="24" height="4" fill="#AA151B" />
      </svg>
    );
  }
  if (key === 'pt' || key === 'br' || key === 'brazil') {
    return (
      <svg viewBox="0 0 24 16" className={`rounded-[3px] shrink-0 ${className}`} aria-hidden="true">
        <rect width="24" height="16" fill="#009B3A" />
        <polygon points="12,2 21,8 12,14 3,8" fill="#FFDF00" />
        <circle cx="12" cy="8" r="3" fill="#002776" />
      </svg>
    );
  }
  if (key === 'ru' || key === 'cis' || key === 'russia') {
    return (
      <svg viewBox="0 0 24 16" className={`rounded-[3px] shrink-0 ${className}`} aria-hidden="true">
        <rect width="24" height="5.33" fill="#FFFFFF" />
        <rect y="5.33" width="24" height="5.34" fill="#0039A6" />
        <rect y="10.67" width="24" height="5.33" fill="#D52B1E" />
      </svg>
    );
  }
  if (key === 'th' || key === 'thailand') {
    return (
      <svg viewBox="0 0 24 16" className={`rounded-[3px] shrink-0 ${className}`} aria-hidden="true">
        <rect width="24" height="16" fill="#A51931" />
        <rect y="2.6" width="24" height="10.8" fill="#F4F5F8" />
        <rect y="5.3" width="24" height="5.4" fill="#2D2A4A" />
      </svg>
    );
  }

  return (
    <span className={`inline-flex items-center justify-center rounded-[3px] bg-[#242429] text-[10px] font-mono text-[#DEC79B] px-1 ${className}`}>
      {codeOrId.slice(0, 2).toUpperCase()}
    </span>
  );
};
