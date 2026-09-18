import { randomBytes } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { User } from '@prisma/client';
import { ErrorCodes } from '../../common/constants/error-codes.constant';
import { AppConfig } from '../../config/configuration';
import { AuditActions } from '../../infrastructure/audit/audit-actions.constant';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { UsersService } from '../users/users.service';
import { rolesRequireMfa } from './constants/mfa-required-roles.constant';
import {
  AuthenticatedUserDto,
  MfaEnrollResponseDto,
  RegisterResponseDto,
} from './dto/auth-response.dto';
import { LoginDto } from './dto/login.dto';
import { MfaVerifyDto } from './dto/mfa-verify.dto';
import { RegisterDto } from './dto/register.dto';
import { MfaService } from './mfa.service';
import { hashPassword, verifyPassword } from './password.util';

// Verified against when no account matches, so a nonexistent account costs
// the same Argon2 work as a wrong password (login timing must not reveal
// which identifiers are registered). Hash of a random throwaway string —
// never a real credential, computed once per process.
let dummyHashPromise: Promise<string> | undefined;
function getDummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword(randomBytes(16).toString('hex'));
  return dummyHashPromise;
}
import { IssuedRefreshToken, RequestMeta, TokenService } from './token.service';

export type LoginResult =
  | {
      status: 'AUTHENTICATED';
      accessToken: string;
      refreshToken: IssuedRefreshToken;
      user: AuthenticatedUserDto;
    }
  | { status: 'MFA_REQUIRED'; challengeToken: string }
  | { status: 'MFA_SETUP_REQUIRED'; challengeToken: string };

/**
 * Orchestrates registration/login/MFA/refresh/logout. Deliberately
 * transport-agnostic about cookies — returns tokens/data, and the
 * controller decides how to set/clear the refresh cookie, keeping this
 * service testable without a real HTTP response object.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly tokenService: TokenService,
    private readonly mfaService: MfaService,
    private readonly audit: AuditService,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  /**
   * FRD §9.2's registration step also requires mobile OTP verification
   * before the account leaves "Unverified" — NOT implemented here. That
   * requires a real SMS delivery channel, which doesn't exist yet (no
   * NotificationModule/SMS adapter has been built — building a fake one
   * was explicitly out of scope for this step). `isVerified` is tracked
   * accurately (stays false) but not yet enforced anywhere; login is not
   * blocked by it, to avoid a permanent dead-end account with no way to
   * ever become verified. See README.md.
   *
   * Always assigns exactly the APPLICANT role — RegisterDto has no role
   * field, so self-registration can never grant anything else.
   */
  async register(
    dto: RegisterDto,
    ipAddress: string,
  ): Promise<RegisterResponseDto> {
    const existingByEmail = await this.usersService.findByEmail(dto.email);
    if (existingByEmail) {
      throw new ConflictException({
        code: ErrorCodes.EMAIL_ALREADY_REGISTERED,
        message: 'This email is already registered. Try logging in instead.',
      });
    }

    const existingByMobile = await this.usersService.findByMobile(dto.mobile);
    if (existingByMobile) {
      throw new ConflictException({
        code: ErrorCodes.MOBILE_ALREADY_REGISTERED,
        message:
          'This mobile number is already registered. Try logging in instead.',
      });
    }

    const passwordHash = await hashPassword(dto.password);
    const user = await this.usersService.createApplicant({
      name: dto.name,
      email: dto.email,
      mobile: dto.mobile,
      passwordHash,
    });

    await this.audit.record({
      userId: user.id,
      action: AuditActions.USER_REGISTERED,
      entityType: 'User',
      entityId: user.id,
      ipAddress,
    });

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      mobile: user.mobile,
      isVerified: user.isVerified,
    };
  }

  async login(dto: LoginDto, meta: RequestMeta): Promise<LoginResult> {
    const user = await this.usersService.findByEmailOrMobile(dto.emailOrMobile);

    // Nonexistent account and wrong password are deliberately
    // indistinguishable to the caller — see ErrorCodes.INVALID_CREDENTIALS.
    if (!user) {
      await verifyPassword(await getDummyHash(), dto.password);
      throw new UnauthorizedException({
        code: ErrorCodes.INVALID_CREDENTIALS,
        message: 'Invalid credentials.',
      });
    }

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      throw new UnauthorizedException({
        code: ErrorCodes.ACCOUNT_LOCKED,
        message:
          'This account is temporarily locked after repeated failed login attempts. Please try again later.',
      });
    }

    if (!user.isActive) {
      throw new UnauthorizedException({
        code: ErrorCodes.ACCOUNT_DISABLED,
        message: 'This account has been disabled.',
      });
    }

    // Nullable because OTP-passwordless remains configurable/TBV (FRD
    // §9.2) — an account with no password hash simply can never pass
    // password login, mapped to the same unified error as a wrong
    // password rather than a special case.
    const passwordMatches = user.passwordHash
      ? await verifyPassword(user.passwordHash, dto.password)
      : false;

    if (!passwordMatches) {
      const { locked } = await this.usersService.recordFailedLogin(
        user.id,
        this.configService.get('authSecurity.maxFailedLoginAttempts', {
          infer: true,
        }),
        this.configService.get('authSecurity.lockoutDurationMinutes', {
          infer: true,
        }),
      );

      await this.audit.record({
        userId: user.id,
        action: AuditActions.LOGIN_FAILURE,
        entityType: 'User',
        entityId: user.id,
        ipAddress: meta.ipAddress,
      });

      if (locked) {
        await this.audit.record({
          userId: user.id,
          action: AuditActions.ACCOUNT_LOCKED,
          entityType: 'User',
          entityId: user.id,
          ipAddress: meta.ipAddress,
        });
      }

      throw new UnauthorizedException({
        code: ErrorCodes.INVALID_CREDENTIALS,
        message: 'Invalid credentials.',
      });
    }

    const roleCodes = await this.usersService.getRoleCodes(user.id);

    // Deliberately NOT reset here when a second factor is still pending: a
    // correct password must not refresh the failure budget, or someone who
    // knows the password could interleave logins with TOTP guesses and
    // never hit the lockout. The counter is cleared only once the login is
    // fully authenticated (below, or in verifyMfaChallenge).

    if (user.mfaEnabled) {
      const challengeToken = await this.tokenService.signMfaToken(
        user.id,
        'mfa_challenge',
      );
      return { status: 'MFA_REQUIRED', challengeToken };
    }

    if (rolesRequireMfa(roleCodes)) {
      const challengeToken = await this.tokenService.signMfaToken(
        user.id,
        'mfa_setup',
      );
      return { status: 'MFA_SETUP_REQUIRED', challengeToken };
    }

    await this.usersService.resetFailedLoginAttempts(user.id);

    await this.audit.record({
      userId: user.id,
      action: AuditActions.LOGIN_SUCCESS,
      entityType: 'User',
      entityId: user.id,
      ipAddress: meta.ipAddress,
    });

    return this.issueFullSession(user, roleCodes, meta);
  }

  async verifyMfaChallenge(
    dto: MfaVerifyDto,
    meta: RequestMeta,
  ): Promise<Extract<LoginResult, { status: 'AUTHENTICATED' }>> {
    const userId = await this.tokenService.verifyMfaToken(
      dto.challengeToken,
      'mfa_challenge',
    );

    // The challenge token proves the password step only, so the 6-digit
    // code is the sole remaining barrier — its guesses must be rate-limited
    // exactly like password guesses, or a stolen/observed challenge token
    // could be brute-forced within its lifetime. Shares the login lockout
    // counters deliberately: one budget of failed attempts per account.
    const account = await this.usersService.findById(userId);
    if (!account || !account.isActive) {
      throw new UnauthorizedException({
        code: ErrorCodes.INVALID_CREDENTIALS,
        message: 'Invalid credentials.',
      });
    }
    if (account.lockedUntil && account.lockedUntil.getTime() > Date.now()) {
      throw new UnauthorizedException({
        code: ErrorCodes.ACCOUNT_LOCKED,
        message:
          'This account is temporarily locked after repeated failed attempts. Please try again later.',
      });
    }

    const isValid = await this.mfaService.verifyLoginCode(userId, dto.code);

    if (!isValid) {
      const { locked } = await this.usersService.recordFailedLogin(
        userId,
        this.configService.get('authSecurity.maxFailedLoginAttempts', {
          infer: true,
        }),
        this.configService.get('authSecurity.lockoutDurationMinutes', {
          infer: true,
        }),
      );
      await this.audit.record({
        userId,
        action: AuditActions.MFA_VERIFY_FAILURE,
        entityType: 'User',
        entityId: userId,
        ipAddress: meta.ipAddress,
      });
      if (locked) {
        await this.audit.record({
          userId,
          action: AuditActions.ACCOUNT_LOCKED,
          entityType: 'User',
          entityId: userId,
          ipAddress: meta.ipAddress,
        });
      }
      throw new UnauthorizedException({
        code: ErrorCodes.INVALID_MFA_CODE,
        message: 'The MFA code is invalid.',
      });
    }

    await this.usersService.resetFailedLoginAttempts(userId);
    const roleCodes = await this.usersService.getRoleCodes(userId);

    await this.audit.record({
      userId,
      action: AuditActions.MFA_LOGIN_SUCCESS,
      entityType: 'User',
      entityId: userId,
      ipAddress: meta.ipAddress,
    });

    return this.issueFullSession(account, roleCodes, meta);
  }

  async refresh(
    rawToken: string | undefined,
    meta: RequestMeta,
  ): Promise<{ accessToken: string; refreshToken: IssuedRefreshToken }> {
    if (!rawToken) {
      throw new UnauthorizedException({
        code: ErrorCodes.REFRESH_TOKEN_INVALID,
        message: 'No refresh token was provided.',
      });
    }

    const outcome = await this.tokenService.rotate(rawToken, meta);

    switch (outcome.result) {
      case 'ROTATED':
        return {
          accessToken: outcome.accessToken,
          refreshToken: outcome.refreshToken,
        };
      case 'EXPIRED':
        throw new UnauthorizedException({
          code: ErrorCodes.REFRESH_TOKEN_EXPIRED,
          message: 'Your session has expired — please log in again.',
        });
      case 'REUSED':
        throw new UnauthorizedException({
          code: ErrorCodes.REFRESH_TOKEN_REUSED,
          message: 'This session is no longer valid — please log in again.',
        });
      case 'INVALID':
      default:
        throw new UnauthorizedException({
          code: ErrorCodes.REFRESH_TOKEN_INVALID,
          message: 'Invalid refresh token.',
        });
    }
  }

  /** Always succeeds, even with no/invalid cookie present — logout is
   * idempotent by design. Audited only when a live session was actually
   * revoked; the actor is the session's owner, resolved from the refresh
   * token itself (the logout route is deliberately Public — it must work
   * even when the access token has already expired). */
  async logout(rawToken: string | undefined, ipAddress: string): Promise<void> {
    const userId = rawToken
      ? await this.tokenService.revokeByRawToken(rawToken)
      : undefined;
    if (userId) {
      await this.audit.record({
        userId,
        action: AuditActions.LOGOUT,
        entityType: 'User',
        entityId: userId,
        ipAddress,
      });
    }
  }

  async me(userId: string): Promise<AuthenticatedUserDto> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new UnauthorizedException({
        code: ErrorCodes.UNAUTHENTICATED,
        message: 'Authentication required.',
      });
    }
    const roles = await this.usersService.getRoleCodes(userId);
    return this.toUserDto(user, roles);
  }

  async enrollMfa(
    userId: string,
    ipAddress: string,
  ): Promise<MfaEnrollResponseDto> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new UnauthorizedException({
        code: ErrorCodes.UNAUTHENTICATED,
        message: 'Authentication required.',
      });
    }
    return this.mfaService.enroll(userId, user.email, ipAddress);
  }

  async confirmMfa(
    userId: string,
    code: string,
    ipAddress: string,
  ): Promise<void> {
    await this.mfaService.confirm(userId, code, ipAddress);
  }

  private async issueFullSession(
    user: User,
    roleCodes: string[],
    meta: RequestMeta,
  ): Promise<Extract<LoginResult, { status: 'AUTHENTICATED' }>> {
    const accessToken = await this.tokenService.signAccessToken(
      user.id,
      roleCodes,
    );
    const refreshToken = await this.tokenService.issueRefreshSession(
      user.id,
      meta,
    );

    return {
      status: 'AUTHENTICATED',
      accessToken,
      refreshToken,
      user: this.toUserDto(user, roleCodes),
    };
  }

  private toUserDto(user: User, roles: string[]): AuthenticatedUserDto {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      mobile: user.mobile,
      isVerified: user.isVerified,
      mfaEnabled: user.mfaEnabled,
      roles,
    };
  }
}
