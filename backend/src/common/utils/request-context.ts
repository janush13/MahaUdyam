import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContextStore {
  requestId: string;
}

/**
 * Request-scoped correlation context. Set once per request by
 * RequestIdMiddleware; read anywhere in that request's async call chain
 * (services, exception filters, future logging) without threading the
 * request ID through every function signature. No external state store —
 * this is entirely in-process, per Node's own AsyncLocalStorage.
 */
export const requestContextStorage =
  new AsyncLocalStorage<RequestContextStore>();

export function getRequestId(): string | undefined {
  return requestContextStorage.getStore()?.requestId;
}
