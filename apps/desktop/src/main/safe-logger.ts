import { z } from 'zod'

const logEvent = z.enum(['app.startup.failed', 'provider.request.failed'])
const safeContext = z.object({
  provider: z.enum(['openai', 'anthropic', 'google', 'xai', 'ollama']).optional(),
  operation: z.enum(['app.startup', 'provider.configure', 'provider.request']).optional(),
  outcome: z.enum(['success', 'failure']).optional(),
  errorCode: z.enum(['STARTUP_FAILURE', 'PROVIDER_UNAVAILABLE', 'IPC_FAILURE']).optional(),
  durationMs: z.number().finite().nonnegative().optional(),
  count: z.number().int().nonnegative().optional(),
  retryable: z.boolean().optional()
}).strict()

export type LogEvent = z.infer<typeof logEvent>
export type SafeLogContext = z.infer<typeof safeContext>

export interface SafeLogger {
  info: (event: LogEvent, context?: SafeLogContext) => void
  error: (event: LogEvent, context?: SafeLogContext) => void
}

export function createSafeLogger(write: (line: string) => void): SafeLogger {
  const emit = (level: 'info' | 'error', event: unknown, context?: unknown): void => {
    const validatedEvent = logEvent.parse(event)
    const validatedContext = safeContext.parse(context ?? {})
    write(JSON.stringify({ level, event: validatedEvent, context: validatedContext }))
  }
  return {
    info: (event, context) => emit('info', event, context),
    error: (event, context) => emit('error', event, context)
  }
}
