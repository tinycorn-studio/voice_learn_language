export type AppIconName =
  | 'voice'
  | 'review'
  | 'vocabulary'
  | 'mic'
  | 'stop'
  | 'send'
  | 'translate'
  | 'latest'
  | 'export'
  | 'edit'
  | 'delete'
  | 'save'
  | 'again'
  | 'hard'
  | 'good'
  | 'easy'
  | 'search'
  | 'clock'
  | 'warning'
  | 'spark'
  | 'speaker'
  | 'eye'
  | 'copy';

const ICON_PATHS: Record<AppIconName, string> = {
  voice: 'M3 10v4 M7 6v12 M11 3v18 M15 7v10 M19 5v14 M23 10v4',
  review: 'M8 4h12v16H8z M4 8H3v13h13v-1 M11 12l2 2 4-4',
  vocabulary: 'M4 5.5A2.5 2.5 0 0 1 6.5 3H20v17H6.5A2.5 2.5 0 0 0 4 22z M4 5.5V22 M8 7h8 M8 11h8',
  mic: 'M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3z M19 11a7 7 0 0 1-14 0 M12 18v4 M9 22h6',
  stop: 'M6 6h12v12H6z',
  send: 'M22 2 11 13 M22 2l-7 20-4-9-9-4z',
  translate:
    'M4 5h10 M9 3v2 M12 5c-.6 4.2-3.1 7.1-7 9 M6 8c1.2 2.4 3.1 4.2 5.5 5.4 M14 20l4-10 4 10 M15.5 17h5',
  latest: 'M12 22a10 10 0 1 0-9.8-12 M2 4v6h6 M12 7v5l3 2',
  export: 'M12 3v12 M7 10l5 5 5-5 M4 19v2h16v-2',
  edit: 'M12 20h9 M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z',
  delete: 'M4 7h16 M10 11v6 M14 11v6 M5 7l1 14h12l1-14 M9 7V4h6v3',
  save: 'M20 6 9 17l-5-5',
  again: 'M3 12a9 9 0 0 1 15.4-6.4L21 8 M21 3v5h-5 M21 12a9 9 0 0 1-15.4 6.4L3 16 M3 21v-5h5',
  hard: 'M4 19 9 14l3 3 8-9 M14 8h6v6',
  good: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M7 12l3 3 7-7',
  easy: 'm12 3 2.3 5 5.5.7-4 3.8 1 5.5-4.8-2.7-4.8 2.7 1-5.5-4-3.8 5.5-.7z M19 16l1.2 2.2L22 19l-1.8.8L19 22l-.8-2.2L16 19l2.2-.8z',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M21 21l-4.4-4.4',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 6v6l4 2',
  warning: 'M12 3 2.5 20h19z M12 9v5 M12 17.5v.1',
  spark:
    'm12 3 1.8 6.2L20 11l-6.2 1.8L12 19l-1.8-6.2L4 11l6.2-1.8z M19 14l1.1 2.9L23 18l-2.9 1.1L19 22l-1.1-2.9L15 18l2.9-1.1z',
  speaker: 'M4 10v4h4l5 4V6l-5 4z M16 9a5 5 0 0 1 0 6 M18 5a10 10 0 0 1 0 14',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  copy: 'M8 8V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4 M4 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z',
};

export function AppIcon({ name, size = 20 }: { name: AppIconName; size?: number }) {
  return (
    <svg
      className={`app-icon app-icon-${name}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}
