import { SENTRY_DSN } from "./config.js";

type AttrValue = string | number | boolean;

export interface TraceHandle {
  setAttribute(key: string, value: AttrValue): void;
  setAttributes(attrs: Record<string, AttrValue>): void;
}

const NOOP_HANDLE: TraceHandle = {
  setAttribute() {},
  setAttributes() {},
};

type SentryModule = typeof import("@sentry/node");
let sentry: SentryModule | null = null;

export async function initTracing(): Promise<void> {
  if (!SENTRY_DSN) return;
  try {
    const mod = await import("@sentry/node");
    mod.init({
      dsn: SENTRY_DSN,
      tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "1.0"),
      environment: process.env.SENTRY_ENVIRONMENT ?? "development",
    });
    sentry = mod;
  } catch (err) {
    console.error("[wanderlog] tracing disabled:", (err as Error).message);
  }
}

export async function trace<T>(
  opts: { name: string; op: string; attributes?: Record<string, AttrValue>; flush?: boolean },
  fn: (t: TraceHandle) => T | Promise<T>
): Promise<T> {
  const mod = sentry;
  if (!mod) return fn(NOOP_HANDLE);
  return mod.startSpan(
    { name: opts.name, op: opts.op, attributes: opts.attributes },
    async (span) => {
      const handle: TraceHandle = {
        setAttribute: (key, value) => span.setAttribute(key, value),
        setAttributes: (attrs) => span.setAttributes(attrs),
      };
      try {
        return await fn(handle);
      } catch (err) {
        span.setStatus({ code: 2, message: "internal_error" });
        mod.captureException(err);
        throw err;
      } finally {
        if (opts.flush) void mod.flush(2000);
      }
    }
  );
}

export async function flushTracing(timeoutMs = 2000): Promise<void> {
  if (sentry) await sentry.flush(timeoutMs);
}

export function tracingEnabled(): boolean {
  return sentry !== null;
}
