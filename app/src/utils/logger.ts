/**
 * Minimal level-aware logger that honors the LOG_LEVEL env var
 * (error < warn < info < debug). Defaults to "info". Centralizing logging here
 * lets us silence debug noise in production and route output consistently.
 */
type Level = 'error' | 'warn' | 'info' | 'debug';

const ORDER: Record<Level, number> = { error: 0, warn: 1, info: 2, debug: 3 };

function threshold(): number {
  const lvl = (process.env.LOG_LEVEL ?? 'info').toLowerCase() as Level;
  return ORDER[lvl] ?? ORDER.info;
}

function emit(level: Level, args: unknown[]): void {
  if (ORDER[level] > threshold()) return;
  const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  sink(...args);
}

export const logger = {
  error: (...args: unknown[]): void => emit('error', args),
  warn: (...args: unknown[]): void => emit('warn', args),
  info: (...args: unknown[]): void => emit('info', args),
  debug: (...args: unknown[]): void => emit('debug', args),
};
