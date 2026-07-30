/**
 * INTEGRATION RUNTIME — master prompt §11A.0.
 *
 * Every external system goes through this. The rules it enforces, so no caller
 * can skip them:
 *
 *  1. MANUAL-FIRST. `MANUAL` mode is not an error — it is a designed no-op that
 *     tells the UI "a person enters this". The platform is fully usable with
 *     zero connectors configured (AC#19).
 *  2. THREE IMPLEMENTATIONS per connector: Mock (deterministic), Manual (no-op),
 *     Live (throws NotConfiguredError until credentials exist).
 *  3. PROVENANCE on every result — MANUAL / API / MOCK — so nobody has to guess
 *     where a value came from (AC#20).
 *  4. EVERY CALL LOGGED with endpoint, request, response, status, latency and a
 *     correlation id, credentials redacted.
 *  5. RELIABILITY: idempotency keys, exponential-backoff retry, a circuit
 *     breaker, and graceful degradation that never blocks an order (AC#28).
 */

import { db } from '@/lib/db';
import type { ConnectorId, Provenance } from '@/lib/domain/enums';

export class NotConfiguredError extends Error {
  constructor(connectorId: string) {
    super(
      `${connectorId} has no credentials configured. Supply them in Settings → Integrations, or keep the connector in Manual mode and enter the data by hand.`,
    );
    this.name = 'NotConfiguredError';
  }
}

/** Thrown by mocks to exercise the retry path. */
export class TransientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransientError';
  }
}

export type AdapterOutcome<T> =
  | { ok: true; data: T; provenance: Extract<Provenance, 'MOCK' | 'API'>; mode: string; correlationId: string }
  /**
   * Not a failure — the connector is in Manual mode, so the operator supplies
   * the value. The UI shows the manual entry path instead of an error.
   */
  | { ok: false; manual: true; reason: string; mode: string }
  /** A real failure. The caller must degrade to manual, never block. */
  | {
      ok: false;
      manual: false;
      error: string;
      degraded: true;
      circuitOpen: boolean;
      attempts: number;
      mode: string;
      correlationId: string;
    };

export interface AdapterImpls<TArgs, TData> {
  /** Deterministic simulation. Never touches the network. */
  mock: (args: TArgs) => Promise<TData>;
  /** Real vendor call. Absent means "not implemented yet". */
  live?: (args: TArgs) => Promise<TData>;
}

interface InvokeOptions {
  connectorId: ConnectorId;
  operation: string;
  workOrderId?: string | null;
  /** Same key + same operation must not double-apply a write. */
  idempotencyKey?: string | null;
  /** Retry only where a retry could plausibly help. */
  retryable?: boolean;
  maxAttempts?: number;
}

const CIRCUIT_WINDOW_MS = 5 * 60_000;
const CIRCUIT_FAILURE_THRESHOLD = 5;
const BACKOFF_MS = [120, 360, 1080];

/** Deterministic pseudo-randomness so mocks and demos are reproducible. */
export function seedFrom(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

export function pick<T>(seed: number, options: T[]): T {
  return options[seed % options.length];
}

function redact(value: unknown): string {
  const json = JSON.stringify(value ?? null);
  return json.replace(
    /("(?:password|token|secret|apiKey|api_key|authorization|clientSecret)"\s*:\s*)"[^"]*"/gi,
    '$1"«redacted»"',
  );
}

let invocationCounter = 0;

/**
 * One id per INVOCATION, shared by that invocation's retry attempts.
 *
 * Deliberately not derived from the arguments: two separate calls with identical
 * arguments are different events, and tracing one of them through the log
 * requires telling them apart. The deterministic seed above is what keeps mock
 * DATA reproducible; correlation identity is a separate concern.
 */
function correlation(connectorId: string, operation: string): string {
  invocationCounter += 1;
  const stamp = Date.now().toString(36).slice(-6);
  const n = invocationCounter.toString(36);
  return `${connectorId.toLowerCase()}-${operation}-${stamp}${n}`;
}

/** Consecutive recent failures open the circuit, so we stop hammering a dead vendor. */
async function circuitIsOpen(connectorId: string): Promise<boolean> {
  const recent = await db.integrationCallLog.findMany({
    where: { connectorId, createdAt: { gte: new Date(Date.now() - CIRCUIT_WINDOW_MS) } },
    orderBy: { createdAt: 'desc' },
    take: CIRCUIT_FAILURE_THRESHOLD,
    select: { ok: true },
  });
  return (
    recent.length >= CIRCUIT_FAILURE_THRESHOLD && recent.every((r) => !r.ok)
  );
}

export async function invokeAdapter<TArgs, TData>(
  opts: InvokeOptions,
  impls: AdapterImpls<TArgs, TData>,
  args: TArgs,
): Promise<AdapterOutcome<TData>> {
  const connector = await db.integrationConnector.findUnique({ where: { id: opts.connectorId } });
  const mode = connector?.mode ?? 'NOT_CONFIGURED';
  const correlationId = correlation(opts.connectorId, opts.operation);

  // ── Manual mode: a designed no-op, not a failure ─────────────────────────
  if (mode === 'MANUAL') {
    return {
      ok: false,
      manual: true,
      mode,
      reason: `${opts.connectorId} is in Manual mode — enter this by hand. Nothing is automated.`,
    };
  }

  if (mode === 'NOT_CONFIGURED') {
    return {
      ok: false,
      manual: true,
      mode,
      reason: `${opts.connectorId} is not configured. Enter this by hand, or set the connector up in Settings → Integrations.`,
    };
  }

  // ── Idempotency: replay the stored response instead of re-applying a write ─
  if (opts.idempotencyKey) {
    const prior = await db.integrationCallLog.findFirst({
      where: {
        connectorId: opts.connectorId,
        operation: opts.operation,
        idempotencyKey: opts.idempotencyKey,
        ok: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (prior?.responseBody) {
      return {
        ok: true,
        data: JSON.parse(prior.responseBody) as TData,
        provenance: prior.mode === 'MOCK' ? 'MOCK' : 'API',
        mode,
        correlationId: prior.correlationId,
      };
    }
  }

  // ── Circuit breaker ──────────────────────────────────────────────────────
  if (await circuitIsOpen(opts.connectorId)) {
    await log({
      connectorId: opts.connectorId,
      operation: opts.operation,
      workOrderId: opts.workOrderId,
      ok: false,
      errorMessage: 'Circuit open — repeated failures, calls suspended',
      latencyMs: 0,
      attempt: 0,
      mode,
      correlationId,
      idempotencyKey: opts.idempotencyKey,
      request: args,
    });
    return {
      ok: false,
      manual: false,
      degraded: true,
      circuitOpen: true,
      attempts: 0,
      mode,
      correlationId,
      error: `${opts.connectorId} has failed repeatedly, so automatic calls are suspended for a few minutes. Enter this by hand in the meantime — nothing is blocked.`,
    };
  }

  const maxAttempts = opts.retryable === false ? 1 : (opts.maxAttempts ?? 3);
  let lastError = 'Unknown error';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const started = Date.now();
    try {
      // forceFailure drives the AC#28 resilience demonstration.
      if (connector?.forceFailure) {
        throw new TransientError(
          `Simulated outage: ${opts.connectorId} is set to fail in Settings → Integrations.`,
        );
      }

      const data =
        mode === 'MOCK'
          ? await impls.mock(args)
          : impls.live
            ? await impls.live(args)
            : (() => {
                throw new NotConfiguredError(opts.connectorId);
              })();

      const latencyMs = Date.now() - started;
      await log({
        connectorId: opts.connectorId,
        operation: opts.operation,
        workOrderId: opts.workOrderId,
        ok: true,
        statusCode: 200,
        latencyMs,
        attempt,
        mode,
        correlationId,
        idempotencyKey: opts.idempotencyKey,
        request: args,
        response: data,
      });
      await db.integrationConnector.update({
        where: { id: opts.connectorId },
        data: { lastSuccessAt: new Date(), lastFailureMsg: null },
      });

      return {
        ok: true,
        data,
        provenance: mode === 'MOCK' ? 'MOCK' : 'API',
        mode,
        correlationId,
      };
    } catch (err) {
      const latencyMs = Date.now() - started;
      lastError = err instanceof Error ? err.message : String(err);
      const retryable = err instanceof TransientError && attempt < maxAttempts;

      await log({
        connectorId: opts.connectorId,
        operation: opts.operation,
        workOrderId: opts.workOrderId,
        ok: false,
        statusCode: err instanceof NotConfiguredError ? 401 : 503,
        errorMessage: lastError,
        latencyMs,
        attempt,
        mode,
        correlationId,
        idempotencyKey: opts.idempotencyKey,
        request: args,
      });

      if (!retryable) break;
      await new Promise((r) => setTimeout(r, BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)]));
    }
  }

  await db.integrationConnector.update({
    where: { id: opts.connectorId },
    data: { lastFailureAt: new Date(), lastFailureMsg: lastError },
  });

  return {
    ok: false,
    manual: false,
    degraded: true,
    circuitOpen: false,
    attempts: maxAttempts,
    mode,
    correlationId,
    error: `${lastError} — enter this by hand instead; the order is not blocked.`,
  };
}

async function log(entry: {
  connectorId: string;
  operation: string;
  workOrderId?: string | null;
  ok: boolean;
  statusCode?: number;
  errorMessage?: string;
  latencyMs: number;
  attempt: number;
  mode: string;
  correlationId: string;
  idempotencyKey?: string | null;
  request?: unknown;
  response?: unknown;
}) {
  await db.integrationCallLog.create({
    data: {
      connectorId: entry.connectorId,
      operation: entry.operation,
      direction: 'OUTBOUND',
      // Coerce empty strings to null: a "" id would be treated as a real
      // foreign key and violate the constraint. Connection tests have no order.
      workOrderId: entry.workOrderId ? entry.workOrderId : null,
      requestBody: entry.request === undefined ? null : redact(entry.request),
      responseBody: entry.response === undefined ? null : redact(entry.response),
      statusCode: entry.statusCode ?? null,
      ok: entry.ok,
      errorMessage: entry.errorMessage ?? null,
      latencyMs: entry.latencyMs,
      attempt: entry.attempt,
      idempotencyKey: entry.idempotencyKey ?? null,
      correlationId: entry.correlationId,
      mode: entry.mode,
    },
  });
}

/**
 * Provenance to stamp on a record, given an outcome. Manual outcomes stamp
 * MANUAL because the operator is about to type the value themselves.
 */
export function provenanceOf(outcome: AdapterOutcome<unknown>): Provenance {
  return outcome.ok ? outcome.provenance : 'MANUAL';
}
