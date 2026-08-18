const secretPatterns = [
  /\bsk-(?:ant-[a-z0-9_-]{12,}|proj-[a-z0-9_-]{12,}|[a-z0-9_-]{16,})\b/gi,
  /\bAIza[a-z0-9_-]{20,}\b/gi,
  /\bgh[pousr]_[a-z0-9_]{20,}\b/gi,
  /\bgithub_pat_[a-z0-9_]{20,}\b/gi,
  /\beyJ[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\b/gi,
  /\bBearer\s+[a-z0-9._~+/=-]{8,}/gi
]

const allowedStringKeys = new Set(['event', 'provider', 'operation', 'outcome', 'errorCode'])
const allowedNumberKeys = new Set(['durationMs', 'count'])
const allowedBooleanKeys = new Set(['retryable'])

function redactSecrets(value: string): string {
  return secretPatterns.reduce((redacted, pattern) => redacted.replace(pattern, '[REDACTED]'), value)
}

function serializeContext(context: Record<string, unknown>): Record<string, string | number | boolean> {
  const safe: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(context)) {
    if (allowedStringKeys.has(key) && typeof value === 'string') {
      safe[key] = redactSecrets(value).slice(0, 128)
    } else if (allowedNumberKeys.has(key) && typeof value === 'number' && Number.isFinite(value)) {
      safe[key] = value
    } else if (allowedBooleanKeys.has(key) && typeof value === 'boolean') {
      safe[key] = value
    }
  }
  return safe
}

export interface SafeLogger {
  info: (message: string, context?: Record<string, unknown>) => void
  error: (message: string, context?: Record<string, unknown>) => void
}

export function createSafeLogger(write: (line: string) => void): SafeLogger {
  const emit = (level: 'info' | 'error', message: string, context?: Record<string, unknown>): void => {
    write(JSON.stringify({
      level,
      message: redactSecrets(message).slice(0, 512),
      context: serializeContext(context ?? {})
    }))
  }
  return {
    info: (message, context) => emit('info', message, context),
    error: (message, context) => emit('error', message, context)
  }
}
