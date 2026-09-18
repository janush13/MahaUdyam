import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, TokenExpiredError } from '@nestjs/jwt';
import { ErrorCodes } from '../../common/constants/error-codes.constant';
import { parseDurationToMs } from '../../common/utils/duration.util';
import { AppConfig } from '../../config/configuration';
import { AuditActions } from '../../infrastructure/audit/audit-actions.constant';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  AccessTokenPayload,
  MfaChallengePayload,
  RefreshTokenPayload,
  TokenType,
} from './interfaces/jwt-payload.interface';

const MFA_CHALLENGE_EXPIRES_IN = '5m';

export interface RequestMeta {
  ipAddress: string;
  userAgent?: string;
}

export interface IssuedRefreshToken {
  token: string;
  expiresAt: Date;
}

export type RefreshOutcome =
  | {
      result: 'ROTATED';
      userId: string;
      accessToken: string;
      refreshToken: IssuedRefreshToken;
    }
  | { result: 'INVALID' }
  | { result: 'EXPIRED' }
  | { result: 'REUSED' };

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * All JWT signing and refresh-session persistence/rotation lives here —
 * kept out of AuthService so login/register/MFA orchestration stays
 * readable. See prisma/schema.prisma's RefreshSession model comment for
 * the rotation/reuse-detection design.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly configService: ConfigService<AppConfig, true>,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async signAccessToken(userId: string, roles: string[]): Promise<string> {
    const payload: AccessTokenPayload = { sub: userId, type: 'access', roles };
    return this.jwt.signAsync(payload, {
      secret: this.configService.get('jwt.accessSecret', { infer: true }),
      expiresIn: this.configService.get('jwt.accessExpiresIn', { infer: true }),
    });
  }

  /** mfa_challenge (code required, already enrolled) or mfa_setup (role
   * requires MFA, not yet enrolled) — both short-lived, both narrower than
   * a full access token. */
  async signMfaToken(
    userId: string,
    type: Extract<TokenType, 'mfa_challenge' | 'mfa_setup'>,
  ): Promise<string> {
    const payload: MfaChallengePayload = { sub: userId, type };
    return this.jwt.signAsync(payload, {
      secret: this.configService.get('jwt.accessSecret', { infer: true }),
      expiresIn: MFA_CHALLENGE_EXPIRES_IN,
    });
  }

  async verifyMfaToken(
    token: string,
    expectedType: Extract<TokenType, 'mfa_challenge' | 'mfa_setup'>,
  ): Promise<string> {
    let payload: MfaChallengePayload;
    try {
      payload = await this.jwt.verifyAsync<MfaChallengePayload>(token, {
        secret: this.configService.get('jwt.accessSecret', { infer: true }),
      });
    } catch {
      throw new UnauthorizedException({
        code: ErrorCodes.UNAUTHENTICATED,
        message:
          'The MFA challenge has expired or is invalid — please log in again.',
      });
    }

    if (payload.type !== expectedType) {
      throw new UnauthorizedException({
        code: ErrorCodes.INVALID_TOKEN_TYPE,
        message: 'This challenge cannot be used for this action.',
      });
    }

    return payload.sub;
  }

  /** Issues a brand-new refresh session (new family) — used at login. */
  async issueRefreshSession(
    userId: string,
    meta: RequestMeta,
  ): Promise<IssuedRefreshToken> {
    const { token, expiresAt } = await this.createSession(
      userId,
      randomUUID(),
      meta,
    );
    return { token, expiresAt };
  }

  /**
   * Verifies + rotates a refresh token presented via the cookie. On reuse
   * (a hash whose row is already revoked being presented again), the
   * entire family is revoked and REUSED is returned — the caller treats
   * this as a security event, not an ordinary invalid-token error.
   */
  async rotate(rawToken: string, meta: RequestMeta): Promise<RefreshOutcome> {
    let payload: RefreshTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<RefreshTokenPayload>(rawToken, {
        secret: this.configService.get('jwt.refreshSecret', { infer: true }),
      });
    } catch (error) {
      return {
        result: error instanceof TokenExpiredError ? 'EXPIRED' : 'INVALID',
      };
    }

    const tokenHash = sha256(rawToken);
    const session = await this.prisma.refreshSession.findUnique({
      where: { tokenHash },
    });

    if (!session) {
      return { result: 'INVALID' };
    }

    if (session.revokedAt) {
      return this.handleReuse(session, meta);
    }

    if (session.expiresAt.getTime() < Date.now()) {
      return { result: 'EXPIRED' };
    }

    // A disabled account must not be able to keep minting access tokens
    // from a still-valid refresh cookie. Revoke the whole family so the
    // cookie is dead for good, not merely rejected this once.
    const owner = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { isActive: true },
    });
    if (!owner || !owner.isActive) {
      await this.revokeFamily(session.familyId);
      return { result: 'INVALID' };
    }

    // Claim the session atomically: only one concurrent request can flip
    // revokedAt from NULL, so two simultaneous refreshes with the same
    // token cannot both succeed and fork the family. The loser is
    // indistinguishable from a replay and is handled as one.
    const claimed = await this.prisma.refreshSession.updateMany({
      where: { id: session.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (claimed.count === 0) {
      return this.handleReuse(session, meta);
    }

    const newSession = await this.createSession(
      payload.sub,
      session.familyId,
      meta,
    );

    await this.prisma.refreshSession.update({
      where: { id: session.id },
      data: { replacedById: newSession.sessionId },
    });

    const roles = await this.currentRoleCodes(payload.sub);
    const accessToken = await this.signAccessToken(payload.sub, roles);

    await this.audit.record({
      userId: payload.sub,
      action: AuditActions.REFRESH_TOKEN_ROTATED,
      entityType: 'RefreshSession',
      entityId: session.id,
      ipAddress: meta.ipAddress,
    });

    return {
      result: 'ROTATED',
      userId: payload.sub,
      accessToken,
      refreshToken: {
        token: newSession.token,
        expiresAt: newSession.expiresAt,
      },
    };
  }

  /** A revoked (or concurrently-claimed) token was presented again: treat
   * as a possible theft, kill the whole family, and leave an audit trail. */
  private async handleReuse(
    session: { id: string; userId: string; familyId: string },
    meta: RequestMeta,
  ): Promise<RefreshOutcome> {
    await this.revokeFamily(session.familyId);
    await this.audit.record({
      userId: session.userId,
      action: AuditActions.REFRESH_TOKEN_REUSE_DETECTED,
      entityType: 'RefreshSession',
      entityId: session.id,
      ipAddress: meta.ipAddress,
    });
    return { result: 'REUSED' };
  }

  /** Revokes just the one session matching this raw token — used at
   * logout. Silently no-ops if the token doesn't match any live session
   * (already logged out, or never had one), so logout is always
   * idempotent. Returns the owning user's id only when a live session was
   * actually revoked, so the caller can audit a real logout and nothing
   * else. */
  async revokeByRawToken(rawToken: string): Promise<string | undefined> {
    const tokenHash = sha256(rawToken);
    const session = await this.prisma.refreshSession.findUnique({
      where: { tokenHash },
      select: { id: true, userId: true, revokedAt: true },
    });
    if (!session || session.revokedAt) {
      return undefined;
    }
    const revoked = await this.prisma.refreshSession.updateMany({
      where: { id: session.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return revoked.count === 1 ? session.userId : undefined;
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshSession.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async createSession(
    userId: string,
    familyId: string,
    meta: RequestMeta,
  ): Promise<IssuedRefreshToken & { sessionId: string }> {
    const refreshExpiresIn = this.configService.get('jwt.refreshExpiresIn', {
      infer: true,
    });
    const jti = randomUUID();

    const payload: RefreshTokenPayload = { sub: userId, type: 'refresh', jti };
    const token = await this.jwt.signAsync(payload, {
      secret: this.configService.get('jwt.refreshSecret', { infer: true }),
      expiresIn: refreshExpiresIn,
    });

    const expiresAt = new Date(
      Date.now() + parseDurationToMs(refreshExpiresIn),
    );

    const created = await this.prisma.refreshSession.create({
      data: {
        userId,
        tokenHash: sha256(token),
        familyId,
        expiresAt,
        userAgent: meta.userAgent,
        ipAddress: meta.ipAddress,
      },
      select: { id: true },
    });

    return { token, expiresAt, sessionId: created.id };
  }

  private async currentRoleCodes(userId: string): Promise<string[]> {
    const rows = await this.prisma.userRole.findMany({
      where: { userId },
      include: { role: true },
    });
    return rows.map((row) => row.role.code);
  }
}
