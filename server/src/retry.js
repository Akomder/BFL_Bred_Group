/**
 * Raised for failures that will fail again the same way: a rejected credential,
 * a malformed request, a mailbox that does not exist. Retrying those only makes
 * the customer wait longer at the counter, so `withRetry` gives up immediately.
 */
export class PermanentError extends Error {
  constructor(message, details = {}) {
    super(message)
    this.name = 'PermanentError'
    Object.assign(this, details)
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Runs `fn`, retrying transient failures with exponential backoff and jitter.
 * Jitter matters here: every branch tablet submits at roughly the same moments
 * of the working day, and a fixed backoff would line their retries up.
 *
 * An error carrying `retryAfterMs` (Graph sends `Retry-After` when throttling)
 * overrides the computed delay — the server knows better than we do.
 */
export const withRetry = async (fn, { attempts = 3, baseDelayMs = 400, onRetry } = {}) => {
  let lastError

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn(attempt)
    } catch (error) {
      lastError = error
      if (error instanceof PermanentError || attempt === attempts) break

      const backoff = baseDelayMs * 2 ** (attempt - 1)
      const delay = error.retryAfterMs ?? backoff + Math.random() * baseDelayMs
      onRetry?.(error, attempt, delay)
      await sleep(delay)
    }
  }

  throw lastError
}
