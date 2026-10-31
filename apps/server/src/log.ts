// Minimal structured logging: one JSON object per line, no personal data.
type Level = 'info' | 'warn' | 'error';

export function log(level: Level, event: string, data: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ t: new Date().toISOString(), level, event, ...data });
  if (level === 'error') console.error(line);
  else console.log(line);
}
