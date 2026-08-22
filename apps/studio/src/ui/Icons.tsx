interface IconProps {
  className?: string;
}

const base = {
  width: 22,
  height: 22,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export const PenIcon = ({ className }: IconProps) => (
  <svg {...base} className={className} aria-hidden="true">
    <path d="M4 20l4-1 10-10a2.5 2.5 0 0 0-3.5-3.5L4.5 15.5 4 20z" />
    <path d="M13.5 6.5l4 4" />
  </svg>
);

export const EraserIcon = ({ className }: IconProps) => (
  <svg {...base} className={className} aria-hidden="true">
    <path d="M8.5 19H19" />
    <path d="M15.5 5.5l3 3a1.8 1.8 0 0 1 0 2.5l-7 7H8l-3-3a1.8 1.8 0 0 1 0-2.5l7.5-7a1.8 1.8 0 0 1 3 0z" />
  </svg>
);

export const PlaneIcon = ({ className }: IconProps) => (
  <svg {...base} className={className} aria-hidden="true">
    <path d="M3 9l9-4 9 4-9 4-9-4z" />
    <path d="M12 13v6" />
  </svg>
);

export const UndoIcon = ({ className }: IconProps) => (
  <svg {...base} className={className} aria-hidden="true">
    <path d="M4 9h10a5 5 0 0 1 0 10h-4" />
    <path d="M7.5 5.5L4 9l3.5 3.5" />
  </svg>
);

export const RedoIcon = ({ className }: IconProps) => (
  <svg {...base} className={className} aria-hidden="true">
    <path d="M20 9H10a5 5 0 0 0 0 10h4" />
    <path d="M16.5 5.5L20 9l-3.5 3.5" />
  </svg>
);

export const FrameIcon = ({ className }: IconProps) => (
  <svg {...base} className={className} aria-hidden="true">
    <path d="M4 9V6a2 2 0 0 1 2-2h3" />
    <path d="M15 4h3a2 2 0 0 1 2 2v3" />
    <path d="M20 15v3a2 2 0 0 1-2 2h-3" />
    <path d="M9 20H6a2 2 0 0 1-2-2v-3" />
  </svg>
);

export const LayersIcon = ({ className }: IconProps) => (
  <svg {...base} className={className} aria-hidden="true">
    <path d="M12 3l9 5-9 5-9-5 9-5z" />
    <path d="M3 13l9 5 9-5" />
  </svg>
);

export const EyeIcon = ({ className }: IconProps) => (
  <svg {...base} className={className} width={18} height={18} aria-hidden="true">
    <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z" />
    <circle cx="12" cy="12" r="2.6" />
  </svg>
);

export const EyeOffIcon = ({ className }: IconProps) => (
  <svg {...base} className={className} width={18} height={18} aria-hidden="true">
    <path d="M4 4l16 16" />
    <path d="M9.5 5.6A9.8 9.8 0 0 1 12 5.4c6.5 0 10 6 10 6a17 17 0 0 1-3.3 3.9" />
    <path d="M6.3 7.9A17 17 0 0 0 2 11.4s3.5 6 10 6a9.7 9.7 0 0 0 3.9-.8" />
  </svg>
);

export const LockIcon = ({ className }: IconProps) => (
  <svg {...base} className={className} width={18} height={18} aria-hidden="true">
    <rect x="4.5" y="10.5" width="15" height="9" rx="2" />
    <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
  </svg>
);

export const UnlockIcon = ({ className }: IconProps) => (
  <svg {...base} className={className} width={18} height={18} aria-hidden="true">
    <rect x="4.5" y="10.5" width="15" height="9" rx="2" />
    <path d="M8 10.5V8a4 4 0 0 1 7.5-2" />
  </svg>
);

export const PlusIcon = ({ className }: IconProps) => (
  <svg {...base} className={className} width={18} height={18} aria-hidden="true">
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const TrashIcon = ({ className }: IconProps) => (
  <svg {...base} className={className} aria-hidden="true">
    <path d="M4 7h16" />
    <path d="M9 7V5h6v2" />
    <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
  </svg>
);
