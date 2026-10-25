export function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return '—:—';
  const totalSeconds = Math.floor(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

export function formatPosition(positionMs: number): string {
  return positionMs > 0 ? formatDuration(positionMs) : '0:00';
}

export function focusProps(id: string, row: number, column: number, disabled = false) {
  return { id, 'data-focus-id': id, 'data-focus-row': row, 'data-focus-column': column, disabled };
}
