import { randomUUID } from 'node:crypto';
import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { requestContextStorage } from '../utils/request-context';

const REQUEST_ID_HEADER = 'x-request-id';
const RESPONSE_HEADER = 'X-Request-Id';
/** Conservative allow-list — long enough for a UUID, short enough to block
 * header-injection/log-injection attempts via an oversized or malformed
 * client-supplied ID. Anything not matching this is replaced, not rejected
 * outright, so a client sending a bad ID never breaks its own request. */
const VALID_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * Assigns every request a correlation ID: reuses a client-supplied
 * `X-Request-Id` if it looks safe, otherwise generates one. Always returned
 * on the response, and made available to the rest of the request's async
 * call chain (e.g. AllExceptionsFilter's logging) via AsyncLocalStorage —
 * no external state store involved.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.header(REQUEST_ID_HEADER);
    const requestId =
      incoming && VALID_REQUEST_ID.test(incoming) ? incoming : randomUUID();

    (req as Request & { requestId: string }).requestId = requestId;
    res.setHeader(RESPONSE_HEADER, requestId);

    requestContextStorage.run({ requestId }, () => next());
  }
}
