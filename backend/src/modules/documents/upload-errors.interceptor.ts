import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  PayloadTooLargeException,
} from '@nestjs/common';
import { Observable, catchError, throwError } from 'rxjs';
import { ErrorCodes } from '../../common/constants/error-codes.constant';

/**
 * Sits OUTSIDE the multipart parser so the parser's "file too large" (thrown
 * as a bare 413) leaves the API as the same FILE_TOO_LARGE error the
 * requirement-level size check produces, in the standard envelope. Every other
 * parser error (unexpected field, too many parts…) is already a 400 from Nest
 * and passes through untouched.
 */
@Injectable()
export class UploadErrorsInterceptor implements NestInterceptor {
  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    return next.handle().pipe(
      catchError((error: unknown) =>
        error instanceof PayloadTooLargeException
          ? throwError(
              () =>
                new PayloadTooLargeException({
                  code: ErrorCodes.FILE_TOO_LARGE,
                  message: 'The file is larger than the allowed size limit.',
                }),
            )
          : throwError(() => error),
      ),
    );
  }
}
