export const formatBytes = (value: number): string => value < 1_000_000 ? `${Math.round(value / 1_000)} KB` : value < 1_000_000_000 ? `${(value / 1_000_000).toFixed(1)} MB` : `${(value / 1_000_000_000).toFixed(2)} GB`;
export const formatDuration = (value?: number): string => { if (!value || !Number.isFinite(value)) return '—'; const minutes = Math.floor(value / 60); const seconds = Math.round(value % 60); return `${minutes}:${String(seconds).padStart(2, '0')}`; };
export const titleCase = (value: string): string => value.replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
