type LogLevel = 'info' | 'warn' | 'error';

type LogPayload = Record<string, unknown>;

function emit(level: LogLevel, message: string, payload?: LogPayload): void {
  const entry = {
    level,
    message,
    ts: new Date().toISOString(),
    ...payload,
  };
  if (level === 'error') {
    console.error(JSON.stringify(entry));
    return;
  }
  if (level === 'warn') {
    console.warn(JSON.stringify(entry));
    return;
  }
  console.log(JSON.stringify(entry));
}

export function logInfo(message: string, payload?: LogPayload): void {
  emit('info', message, payload);
}

export function logWarn(message: string, payload?: LogPayload): void {
  emit('warn', message, payload);
}

export function logError(message: string, payload?: LogPayload): void {
  emit('error', message, payload);
}
