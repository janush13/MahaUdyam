import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  PayloadTooLargeException,
} from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import { UploadErrorsInterceptor } from './upload-errors.interceptor';

const run = (handler: CallHandler) =>
  lastValueFrom(
    new UploadErrorsInterceptor().intercept({} as ExecutionContext, handler),
  );

describe('UploadErrorsInterceptor', () => {
  it('passes a successful result through untouched', async () => {
    await expect(run({ handle: () => of({ ok: 1 }) })).resolves.toEqual({
      ok: 1,
    });
  });

  it('turns the parser’s bare 413 into FILE_TOO_LARGE in the standard shape', async () => {
    const error = await run({
      handle: () =>
        throwError(() => new PayloadTooLargeException('File too large')),
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PayloadTooLargeException);
    expect((error as PayloadTooLargeException).getStatus()).toBe(413);
    expect((error as PayloadTooLargeException).getResponse()).toEqual({
      code: 'FILE_TOO_LARGE',
      message: 'The file is larger than the allowed size limit.',
    });
  });

  it('leaves every other error exactly as it was', async () => {
    const original = new BadRequestException('Unexpected field');
    const error = await run({
      handle: () => throwError(() => original),
    }).catch((e: unknown) => e);
    expect(error).toBe(original);
    const plain = new Error('boom');
    await expect(run({ handle: () => throwError(() => plain) })).rejects.toBe(
      plain,
    );
  });
});
