import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Marks a route as not requiring authentication. JwtAuthGuard is
 * registered globally (see AuthModule) — every route requires a valid
 * access token by default unless explicitly marked @Public(), so a future
 * business endpoint can never be accidentally left unguarded. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
