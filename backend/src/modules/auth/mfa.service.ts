import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { authenticator } from 'otplib';
import { ErrorCodes } from '../../common/constants/error-codes.constant';
import { AppConfig } from '../../config/configuration';
import { AuditActions } from '../../infrastructure/audit/audit-actions.constant';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  decryptSecret,
  deriveKeyFromConfig,
  encryptSecret,
} from './mfa-secret-crypto.util';

const ISSUER = 'MahaUdyam One';

@Injectable()
export class MfaService {
  private readonly encryptionKey: Buffer;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    configService: ConfigService<AppConfig, true>,
  ) {
    this.encryptionKey = deriveKeyFromConfig(
      configService.get('authSecurity.mfaEncryptionKey', { infer: true }),
    );
  }

  /**
   * Generates a new TOTP secret and stores it ENCRYPTED, with MFA left
   * disabled (mfa_credentials.enabled_at stays null, users.mfa_enabled
   * stays false) until POST /auth/mfa/confirm succeeds — never enabled
   * automatically. Returns the otpauth:// provisioning URI, which embeds
   * the raw secret: this is the one moment the plaintext secret exists
   * outside the encrypted column, transmitted once over TLS directly to
   * the authenticated owner. It must never be logged, cached, or returned
   * by any other endpoint.
   */
  async enroll(
    userId: string,
    email: string,
    ipAddress: string,
  ): Promise<{ provisioningUri: string }> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });

    if (user.mfaEnabled) {
      throw new ConflictException({
        code: ErrorCodes.MFA_ALREADY_ENABLED,
        message: 'MFA is already enabled on this account.',
      });
    }

    const secret = authenticator.generateSecret();
    const encrypted = encryptSecret(secret, this.encryptionKey);

    await this.prisma.mfaCredential.upsert({
      where: { userId },
      create: { userId, totpSecret: encrypted, enabledAt: null },
      update: { totpSecret: encrypted, enabledAt: null },
    });

    await this.audit.record({
      userId,
      action: AuditActions.MFA_ENROLLED,
      entityType: 'User',
      entityId: userId,
      ipAddress,
    });

    return { provisioningUri: authenticator.keyuri(email, ISSUER, secret) };
  }

  /** Confirms enrollment: verifies the submitted code against the pending
   * secret, and only then flips both enabled_at and users.mfa_enabled in
   * one transaction. */
  async confirm(
    userId: string,
    code: string,
    ipAddress: string,
  ): Promise<void> {
    const credential = await this.prisma.mfaCredential.findUnique({
      where: { userId },
    });

    if (!credential) {
      throw new BadRequestException({
        code: ErrorCodes.MFA_NOT_ENROLLED,
        message:
          'No pending MFA enrollment found — call /auth/mfa/enroll first.',
      });
    }

    const secret = decryptSecret(credential.totpSecret, this.encryptionKey);
    const isValid = authenticator.check(code, secret);

    if (!isValid) {
      await this.audit.record({
        userId,
        action: AuditActions.MFA_VERIFY_FAILURE,
        entityType: 'User',
        entityId: userId,
        ipAddress,
      });
      throw new BadRequestException({
        code: ErrorCodes.INVALID_MFA_CODE,
        message: 'The MFA code is invalid.',
      });
    }

    await this.prisma.$transaction([
      this.prisma.mfaCredential.update({
        where: { userId },
        data: { enabledAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: { mfaEnabled: true },
      }),
    ]);

    await this.audit.record({
      userId,
      action: AuditActions.MFA_ENABLED,
      entityType: 'User',
      entityId: userId,
      ipAddress,
    });
  }

  /** Used by the login flow once a user with MFA already enabled submits
   * their challenge code. Never throws on a wrong code — returns false,
   * letting the caller decide the response/audit shape. */
  async verifyLoginCode(userId: string, code: string): Promise<boolean> {
    const credential = await this.prisma.mfaCredential.findUnique({
      where: { userId },
    });
    if (!credential || !credential.enabledAt) {
      return false;
    }

    const secret = decryptSecret(credential.totpSecret, this.encryptionKey);
    return authenticator.check(code, secret);
  }
}
