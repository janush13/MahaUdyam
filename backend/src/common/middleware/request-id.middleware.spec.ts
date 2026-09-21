import { Request, Response } from 'express';
import { getRequestId } from '../utils/request-context';
import { RequestIdMiddleware } from './request-id.middleware';

function buildRequest(headers: Record<string, string> = {}): Request {
  return {
    header: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;
}

function buildResponse(): Response & { headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  return {
    headers,
    setHeader: (name: string, value: string) => {
      headers[name] = value;
    },
  } as unknown as Response & { headers: Record<string, string> };
}

describe('RequestIdMiddleware', () => {
  const middleware = new RequestIdMiddleware();

  it('generates a request ID when none is supplied', (done) => {
    const req = buildRequest();
    const res = buildResponse();

    middleware.use(req, res, () => {
      const attached = (req as Request & { requestId: string }).requestId;
      expect(attached).toBeDefined();
      expect(res.headers['X-Request-Id']).toBe(attached);
      done();
    });
  });

  it('reuses a valid client-supplied X-Request-Id', (done) => {
    const req = buildRequest({ 'x-request-id': 'client-supplied-id-123' });
    const res = buildResponse();

    middleware.use(req, res, () => {
      expect((req as Request & { requestId: string }).requestId).toBe(
        'client-supplied-id-123',
      );
      expect(res.headers['X-Request-Id']).toBe('client-supplied-id-123');
      done();
    });
  });

  it('replaces an unsafe/malformed client-supplied request ID', (done) => {
    const req = buildRequest({ 'x-request-id': 'not valid! <script>' });
    const res = buildResponse();

    middleware.use(req, res, () => {
      const attached = (req as Request & { requestId: string }).requestId;
      expect(attached).not.toBe('not valid! <script>');
      expect(attached).toBeDefined();
      done();
    });
  });

  it('makes the request ID available via AsyncLocalStorage during the request', (done) => {
    const req = buildRequest();
    const res = buildResponse();

    middleware.use(req, res, () => {
      const attached = (req as Request & { requestId: string }).requestId;
      expect(getRequestId()).toBe(attached);
      done();
    });
  });
});
