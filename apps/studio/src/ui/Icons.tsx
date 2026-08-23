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

export const FolderIcon = ({ className }: IconProps) => (
  <svg {...base} className={className} aria-hidden="true">
    <path d="M3 7a2 2 0 0 1 2-2h3.6a2 2 0 0 1 1.5.7l1 1.3H19a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </svg>
);

export const DownloadIcon = ({ className }: IconProps) => (
  <svg {...base} className={className} width={18} height={18} aria-hidden="true">
    <path d="M12 4v11" />
    <path d="M8 11.5l4 4 4-4" />
    <path d="M4 19h16" />
  </svg>
);

export const UploadIcon = ({ className }: IconProps) => (
  <svg {...base} className={className} width={18} height={18} aria-hidden="true">
    <path d="M12 15V4" />
    <path d="M8 7.5l4-4 4 4" />
    <path d="M4 19h16" />
  </svg>
);

export const CloseIcon = ({ className }: IconProps) => (
  <svg {...base} className={className} aria-hidden="true">
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

export const CursorIcon = ({ className }: IconProps) => (
  <svg {...base} className={className} aria-hidden="true">
    <path d="M5 3l14 7.5-6.2 1.8L10 19z" />
  </svg>
);

export const MergeDownIcon = ({ className }: IconProps) => (
  <svg {...base} className={className} width={18} height={18} aria-hidden="true">
    <path d="M12 3v10" />
    <path d="M8.5 9.5L12 13l3.5-3.5" />
    <path d="M4 18h16" />
  </svg>
);

export const ImageIcon = ({ className }: IconProps) => (
  <svg {...base} className={className} aria-hidden="true">
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <circle cx="8.5" cy="10" r="1.5" />
    <path d="M21 16l-5-5-6.5 8" />
  </svg>
);

export const SunIcon = ({ className }: IconProps) => (
  <svg {...base} className={className} width={18} height={18} aria-hidden="true">
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
);

export const MoonIcon = ({ className }: IconProps) => (
  <svg {...base} className={className} width={18} height={18} aria-hidden="true">
    <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />
  </svg>
);

export const MonitorIcon = ({ className }: IconProps) => (
  <svg {...base} className={className} width={18} height={18} aria-hidden="true">
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M8 20h8M12 16v4" />
  </svg>
);

export const SettingsIcon = ({ className }: IconProps) => (
  <svg {...base} className={className} aria-hidden="true">
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2.5l1.2 2.6 2.8-.5.4 2.8 2.6 1.2-1.6 2.4 1.6 2.4-2.6 1.2-.4 2.8-2.8-.5L12 21.5l-1.2-2.6-2.8.5-.4-2.8L5 15.4 6.6 13 5 10.6l2.6-1.2.4-2.8 2.8.5z" />
  </svg>
);

export const CopyIcon = ({ className }: IconProps) => (
  <svg {...base} className={className} width={18} height={18} aria-hidden="true">
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V6a2 2 0 0 1 2-2h9" />
  </svg>
);

export const RenameIcon = ({ className }: IconProps) => (
  <svg {...base} className={className} width={18} height={18} aria-hidden="true">
    <path d="M4 20h4l10-10a2.1 2.1 0 0 0-3-3L5 17z" />
    <path d="M14.5 6.5l3 3" />
  </svg>
);

export const ShapesIcon = ({ className }: IconProps) => (
  <svg {...base} className={className} aria-hidden="true">
    <rect x="3" y="12" width="9" height="9" rx="1" />
    <circle cx="16.5" cy="16.5" r="4.5" />
    <path d="M8.5 3l4.5 7H4z" />
  </svg>
);

export const TextIcon = ({ className }: IconProps) => (
  <svg {...base} className={className} aria-hidden="true">
    <path d="M5 6V4h14v2" />
    <path d="M12 4v16" />
    <path d="M9 20h6" />
  </svg>
);

export const ScissorsIcon = ({ className }: IconProps) => (
  <svg {...base} className={className} width={18} height={18} aria-hidden="true">
    <circle cx="6" cy="18" r="2.5" />
    <circle cx="6" cy="6" r="2.5" />
    <path d="M8 7.5L20 18M8 16.5L20 6" />
  </svg>
);

export const StackIcon = ({ className }: IconProps) => (
  <svg {...base} className={className} width={18} height={18} aria-hidden="true">
    <path d="M12 3l8 4.5-8 4.5-8-4.5z" />
    <path d="M4 12.5l8 4.5 8-4.5" />
  </svg>
);

export const DuplicateIcon = ({ className }: IconProps) => (
  <svg {...base} className={className} width={18} height={18} aria-hidden="true">
    <rect x="4" y="4" width="11" height="11" rx="2" />
    <path d="M9 19h9a2 2 0 0 0 2-2V9" />
  </svg>
);

export const TransformIcon = ({ className }: IconProps) => (
  <svg {...base} className={className} width={18} height={18} aria-hidden="true">
    <path d="M4.5 9.5A8 8 0 0 1 18 7.6" />
    <path d="M4 5v4.5h4.5" />
    <path d="M19.5 14.5A8 8 0 0 1 6 16.4" />
    <path d="M20 19v-4.5h-4.5" />
  </svg>
);

export const DimensionIcon = ({ className }: IconProps) => (
  <svg {...base} className={className} aria-hidden="true">
    <path d="M4 8v8M20 8v8" />
    <path d="M4 12h16" />
    <path d="M7 9.5L4.5 12 7 14.5M17 9.5l2.5 2.5-2.5 2.5" />
  </svg>
);

export const DropperIcon = ({ className }: IconProps) => (
  <svg {...base} className={className} width={18} height={18} aria-hidden="true">
    <path d="M14.5 4.5a2.1 2.1 0 0 1 3 3l-1.5 1.5 1 1-2 2-1-1-6 6H5v-3l6-6-1-1 2-2 1 1z" />
  </svg>
);

export const OutlinerIcon = ({ className }: IconProps) => (
  <svg {...base} className={className} aria-hidden="true">
    <path d="M4 6h4M4 12h4M4 18h4" />
    <path d="M11 6h9M11 12h9M11 18h9" />
  </svg>
);

export const ChevronUpIcon = ({ className }: IconProps) => (
  <svg {...base} className={className} width={16} height={16} aria-hidden="true">
    <path d="M6 14l6-6 6 6" />
  </svg>
);

export const ChevronDownIcon = ({ className }: IconProps) => (
  <svg {...base} className={className} width={16} height={16} aria-hidden="true">
    <path d="M6 10l6 6 6-6" />
  </svg>
);

export const TrashIcon = ({ className }: IconProps) => (
  <svg {...base} className={className} aria-hidden="true">
    <path d="M4 7h16" />
    <path d="M9 7V5h6v2" />
    <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
  </svg>
);
