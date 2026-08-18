const sensitiveKey = /api[-_]?key|authorization|token|secret|password/i
const sensitiveValue = /(bearer\s+|sk-[a-z0-9_-]{8,})/i

function redact(value: unknown, key = ''): unknown {
  if (sensitiveKey.test(key)) return '[REDACTED]'
  if (typeof value === 'string') return sensitiveValue.test(value) ? '[REDACTED]' : value
  if (Array.isArray(value)) return value.map((item) => redact(item))
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, redact(childValue, childKey)]))
  }
  return value
}

export interface SafeLogger {
  info: (message: string, context?: Record<string, unknown>) => void
  error: (message: string, context?: Record<string, unknown>) => void
}

export function createSafeLogger(write: (line: string) => void): SafeLogger {
  const emit = (level: 'info' | 'error', message: string, context?: Record<string, unknown>): void => {
    write(JSON.stringify({ level, message: redact(message), context: redact(context ?? {}) }))
  }
  return {
    info: (message, context) => emit('info', message, context),
    error: (message, context) => emit('error', message, context)
  }
}
