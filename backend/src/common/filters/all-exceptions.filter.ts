import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ErrorCodes } from '../constants/error-codes.constant';
import {
  ErrorResponseEnvelope,
  ErrorResponseBody,
} from '../types/error-response.interface';
import { codeForStatus } from '../utils/http-status-code.util';
import { getRequestId } from '../utils/request-context';

/**
 * Single global exception filter enforcing the platform's error envelope:
 *   { "error": { "code": "...", "message": "...", "fields"?: {...} } }
 *
 * Every module relies on this instead of formatting its own error
 * responses — thrown HttpExceptions with an already-shaped payload (e.g.
 * from validationExceptionFactory) pass through as-is; everything else is
 * normalized. Unknown/unexpected errors never leak internal detail
 * (stack traces, SQL, file paths) to the client — only to the server log.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { status, body } = this.buildResponse(exception);
    const requestId = getRequestId();
    const prefix = requestId ? `[${requestId}] ` : '';

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${prefix}${request.method} ${request.url} -> ${status}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else {
      this.logger.warn(
        `${prefix}${request.method} ${request.url} -> ${status} (${body.error.code})`,
      );
    }

    response.status(status).json(body);
  }

  private buildResponse(exception: unknown): {
    status: number;
    body: ErrorResponseEnvelope;
  } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();

      if (this.isErrorEnvelopeShape(payload)) {
        return { status, body: { error: payload as ErrorResponseBody } };
      }

      if (typeof payload === 'object' && payload !== null) {
        const { message, error } = payload as Record<string, unknown>;
        return {
          status,
          body: {
            error: {
              code: codeForStatus(status),
              message: Array.isArray(message)
                ? message.join('; ')
                : ((message as string) ??
                  (error as string) ??
                  exception.message),
            },
          },
        };
      }

      return {
        status,
        body: {
          error: { code: codeForStatus(status), message: exception.message },
        },
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: {
        error: {
          code: ErrorCodes.INTERNAL_ERROR,
          message: 'An unexpected error occurred. Please try again later.',
        },
      },
    };
  }

  private isErrorEnvelopeShape(payload: unknown): payload is ErrorResponseBody {
    return (
      typeof payload === 'object' &&
      payload !== null &&
      'code' in (payload as Record<string, unknown>) &&
      'message' in (payload as Record<string, unknown>)
    );
  }
}
