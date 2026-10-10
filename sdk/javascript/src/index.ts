export interface Breadcrumb {
  message: string;
  data?: Record<string, unknown>;
  timestamp: string;
}

export interface ErrSightEventContext {
  timestamp: string;
  environment?: string;
  release?: string;
  userId?: string;
  url?: string;
  userAgent?: string;
  breadcrumbs: Breadcrumb[];
  [key: string]: unknown;
}

export interface ErrSightEvent {
  message: string;
  stack?: string;
  level: 'error' | 'warning' | 'info';
  context: ErrSightEventContext;
}

export interface ErrSightConfig {
  apiKey: string;
  /** Ingestion endpoint - defaults to the hosted ErrSight API. */
  endpoint?: string;
  environment?: string;
  release?: string;
  userId?: string;
  /** Mutate or drop (return null) an event before it's sent. */
  beforeSend?: (event: ErrSightEvent) => ErrSightEvent | null;
  /** How many recent breadcrumbs to keep. Defaults to 20. */
  maxBreadcrumbs?: number;
}

const DEFAULT_ENDPOINT = 'https://ingest.errsight.dev/api/ingest';
const DEFAULT_MAX_BREADCRUMBS = 20;

// Must match the caps in src/routes/ingest.ts's zod schema. Truncating
// here means an oversized message/stack gets delivered-but-shortened
// instead of the whole event being rejected with a 400 and silently lost.
const MAX_MESSAGE_LENGTH = 1000;
const MAX_STACK_LENGTH = 5000;
const MAX_BREADCRUMB_MESSAGE_LENGTH = 500;

function truncate(str: string, maxLength: number): string {
  return str.length > maxLength ? str.slice(0, maxLength) : str;
}

/**
 * There is exactly one ErrSight client per app - a singleton. Error
 * reporting is global infrastructure, not something you'd want multiple
 * independent, differently-configured instances of fighting over the same
 * window/process listeners.
 */
class ErrSightClient {
  private apiKey: string | null = null;
  private endpoint: string = DEFAULT_ENDPOINT;
  private environment?: string;
  private release?: string;
  private userId?: string;
  private beforeSend?: (event: ErrSightEvent) => ErrSightEvent | null;
  private breadcrumbs: Breadcrumb[] = [];
  private maxBreadcrumbs: number = DEFAULT_MAX_BREADCRUMBS;
  private initialized = false;

  init(config: ErrSightConfig): void {
    if (!config || typeof config.apiKey !== 'string' || config.apiKey.trim() === '') {
      throw new Error('[ErrSight] init() requires a valid apiKey');
    }

    if (this.initialized) {
      console.warn('[ErrSight] already initialized - ignoring duplicate init() call');
      return;
    }

    this.apiKey = config.apiKey;
    this.endpoint = config.endpoint ?? DEFAULT_ENDPOINT;
    this.environment = config.environment;
    this.release = config.release;
    this.userId = config.userId;
    this.beforeSend = config.beforeSend;
    this.maxBreadcrumbs = config.maxBreadcrumbs ?? DEFAULT_MAX_BREADCRUMBS;

    this.setupAutoCapture();
    this.initialized = true;
  }

  private setupAutoCapture(): void {
    const isBrowser = typeof window !== 'undefined' && typeof window.addEventListener === 'function';

    if (isBrowser) {
      window.addEventListener('error', (event: ErrorEvent) => {
        const error = event.error instanceof Error ? event.error : new Error(event.message);
        this.captureException(error);
      });

      window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
        const reason = event.reason instanceof Error ? event.reason : new Error(String(event.reason));
        this.captureException(reason);
      });
      return;
    }

    const isNode = typeof process !== 'undefined' && typeof process.on === 'function';
    if (isNode) {
      process.on('uncaughtException', (err: Error) => {
        this.captureException(err);
      });

      process.on('unhandledRejection', (reason: unknown) => {
        const err = reason instanceof Error ? reason : new Error(String(reason));
        this.captureException(err);
      });
    }
  }

  /**
   * Records a user action for later error context. Capped at
   * maxBreadcrumbs - oldest one drops off, like a rolling log.
   */
  addBreadcrumb(message: string, data?: Record<string, unknown>): void {
    this.breadcrumbs.push({
      message: truncate(message, MAX_BREADCRUMB_MESSAGE_LENGTH),
      data,
      timestamp: new Date().toISOString(),
    });

    if (this.breadcrumbs.length > this.maxBreadcrumbs) {
      this.breadcrumbs.shift();
    }
  }

  /**
   * Manually report an error. Never throws back into the caller - any
   * internal failure here is logged and swallowed, not propagated.
   */
  captureException(error: Error, context?: Record<string, unknown>): void {
    try {
      if (!this.apiKey) {
        console.warn('[ErrSight] captureException called before init() - dropping event');
        return;
      }

      let event: ErrSightEvent = {
        message: truncate(error?.message || String(error), MAX_MESSAGE_LENGTH),
        stack: error?.stack ? truncate(error.stack, MAX_STACK_LENGTH) : undefined,
        level: 'error',
        context: {
          timestamp: new Date().toISOString(),
          environment: this.environment,
          release: this.release,
          userId: this.userId,
          url: typeof window !== 'undefined' ? window.location.href : undefined,
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
          breadcrumbs: [...this.breadcrumbs],
          ...context,
        },
      };

      if (this.beforeSend) {
        const result = this.beforeSend(event);
        if (!result) return; // caller chose to drop this event
        event = result;
      }

      this.sendEvent(event);
    } catch (err) {
      console.error('[ErrSight] captureException failed internally:', err);
    }
  }

  /**
   * Fire-and-forget: intentionally not returned/awaited by callers.
   * Reporting an error should never make the host app wait on a network
   * call, and a failed report should never surface as an unhandled
   * rejection in the host app either - hence the .catch() here, not a
   * propagated throw.
   */
  private sendEvent(event: ErrSightEvent): void {
    try {
      const body = JSON.stringify(event);

      fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.apiKey as string,
        },
        body,
      }).catch((err) => {
        console.error('[ErrSight] failed to send event:', err);
      });
    } catch (err) {
      // e.g. JSON.stringify hit a circular reference in user-supplied context
      console.error('[ErrSight] failed to serialize event:', err);
    }
  }
}

export const ErrSight = new ErrSightClient();
export default ErrSight;
