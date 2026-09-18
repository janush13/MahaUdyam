/**
 * Platform-wide error response shape. Every error returned by this API,
 * regardless of module, conforms to this envelope.
 */
export interface ErrorResponseBody {
  code: string;
  message: string;
  fields?: Record<string, string[]>;
}

export interface ErrorResponseEnvelope {
  error: ErrorResponseBody;
}
