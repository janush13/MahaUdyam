import { createHash, randomInt } from 'node:crypto';
import { ConsoleLogger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { authenticator } from 'otplib';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp, setupSwagger } from '../../src/app.setup';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { UsersService } from '../../src/modules/users/users.service';
import { AuthzTestModule } from './authz-test.module';

export const PASSWORD = 'E2eStr0ngPassw0rd';
export const API = '/api/v1';

export interface TestUser {
  id: string;
  email: string;
  mobile: string;
  password: string;
}

export interface Session {
  accessToken: string;
  refreshCookieValue: string;
}

export class E2eContext {
  readonly runId = `${Date.now().toString(36)}${randomInt(1000, 9999)}`;
  readonly userIds: string[] = [];
  readonly departmentIds: string[] = [];
  private counter = 0;

  constructor(
    readonly app: NestExpressApplication,
    readonly prisma: PrismaService,
    readonly users: UsersService,
    readonly config: ConfigService,
  ) {}

  get http() {
    return this.app.getHttpServer();
  }

  get cookieName(): string {
    return this.config.getOrThrow<string>('authSecurity.refreshCookieName');
  }

  get accessSecret(): string {
    return this.config.getOrThrow<string>('jwt.accessSecret');
  }

  get refreshSecret(): string {
    return this.config.getOrThrow<string>('jwt.refreshSecret');
  }

  get maxFailedAttempts(): number {
    return this.config.getOrThrow<number>(
      'authSecurity.maxFailedLoginAttempts',
    );
  }

  /** Every identifier is unique to this run, so tests never collide with
   * each other or with pre-existing development data. */
  newIdentity(tag: string): Omit<TestUser, 'id'> {
    this.counter += 1;
    return {
      email: `e2e-${this.runId}-${tag}-${this.counter}@example.test`,
      mobile: `9${String(randomInt(0, 1_000_000_000)).padStart(9, '0')}`,
      password: PASSWORD,
    };
  }

  async register(tag: string): Promise<TestUser> {
    const identity = this.newIdentity(tag);
    const res = await request(this.http)
      .post(`${API}/auth/register`)
      .send({ name: `E2E ${tag}`, ...identity })
      .expect(201);
    this.userIds.push(res.body.id);
    return { id: res.body.id, ...identity };
  }

  async registerWithRole(
    tag: string,
    roleCode: string,
    departmentId?: string,
  ): Promise<TestUser> {
    const user = await this.register(tag);
    await this.users.assignRole({
      userId: user.id,
      roleCode,
      departmentId: departmentId ?? null,
      assignedByUserId: null,
      ipAddress: '127.0.0.1',
    });
    return user;
  }

  login(user: Pick<TestUser, 'email' | 'password'>) {
    return request(this.http)
      .post(`${API}/auth/login`)
      .send({ emailOrMobile: user.email, password: user.password });
  }

  async applicantSession(tag: string): Promise<{ user: TestUser } & Session> {
    const user = await this.register(tag);
    const res = await this.login(user).expect(200);
    return {
      user,
      accessToken: res.body.accessToken,
      refreshCookieValue: cookieValue(res, this.cookieName)!,
    };
  }

  /** Drives the real flow end to end: password login -> mfa_setup token ->
   * enroll -> confirm -> password login again -> MFA challenge -> verified
   * session. Returns the TOTP secret so the test can keep generating
   * codes. Never logged. */
  async fullMfaSession(
    user: TestUser,
  ): Promise<Session & { secret: string; user: TestUser }> {
    const setup = await this.login(user).expect(200);
    expect(setup.body.status).toBe('MFA_SETUP_REQUIRED');
    const secret = await this.enrollAndConfirm(setup.body.challengeToken);
    return { ...(await this.mfaLogin(user, secret)), secret, user };
  }

  async enrollAndConfirm(bearer: string): Promise<string> {
    const enroll = await request(this.http)
      .post(`${API}/auth/mfa/enroll`)
      .set('Authorization', `Bearer ${bearer}`)
      .expect(201);
    const secret = extractSecret(enroll.body.provisioningUri);
    await request(this.http)
      .post(`${API}/auth/mfa/confirm`)
      .set('Authorization', `Bearer ${bearer}`)
      .send({ code: await freshTotp(secret) })
      .expect(200);
    return secret;
  }

  async mfaLogin(user: TestUser, secret: string): Promise<Session> {
    const challenge = await this.login(user).expect(200);
    expect(challenge.body.status).toBe('MFA_REQUIRED');
    const res = await request(this.http)
      .post(`${API}/auth/mfa/verify`)
      .send({
        challengeToken: challenge.body.challengeToken,
        code: await freshTotp(secret),
      })
      .expect(200);
    return {
      accessToken: res.body.accessToken,
      refreshCookieValue: cookieValue(res, this.cookieName)!,
    };
  }

  refresh(cookieVal?: string) {
    const req = request(this.http).post(`${API}/auth/refresh`);
    return cookieVal
      ? req.set('Cookie', `${this.cookieName}=${cookieVal}`)
      : req;
  }

  logout(cookieVal?: string) {
    const req = request(this.http).post(`${API}/auth/logout`);
    return cookieVal
      ? req.set('Cookie', `${this.cookieName}=${cookieVal}`)
      : req;
  }

  me(token: string) {
    return request(this.http)
      .get(`${API}/auth/me`)
      .set('Authorization', `Bearer ${token}`);
  }

  async cleanup(): Promise<void> {
    for (const id of this.userIds) {
      await this.prisma.auditLog.deleteMany({
        where: {
          OR: [
            { userId: id },
            { afterState: { path: ['userId'], equals: id } },
          ],
        },
      });
    }
    // refresh_sessions, mfa_credentials and user_roles cascade with the user.
    await this.prisma.user.deleteMany({ where: { id: { in: this.userIds } } });
    await this.prisma.department.deleteMany({
      where: { id: { in: this.departmentIds } },
    });
  }
}

export async function createE2eContext(
  options: { verboseLogs?: boolean } = {},
): Promise<E2eContext> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule, AuthzTestModule],
  }).compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>();
  if (options.verboseLogs) {
    // Nest's testing module logs only errors by default. Log-hygiene tests
    // need the real, production-verbosity logger or they would pass
    // vacuously.
    app.useLogger(new ConsoleLogger());
  }
  configureApp(app);
  setupSwagger(app);
  await app.init();

  return new E2eContext(
    app,
    app.get(PrismaService),
    app.get(UsersService),
    app.get(ConfigService),
  );
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function extractSecret(provisioningUri: string): string {
  const secret = new URL(provisioningUri).searchParams.get('secret');
  if (!secret) throw new Error('provisioning URI has no secret');
  return secret;
}

/** Generates a code guaranteed to still be valid by the time the server
 * checks it: if the current 30s TOTP step is about to roll over, wait for
 * the next one rather than racing it. */
export async function freshTotp(secret: string): Promise<string> {
  if (authenticator.timeRemaining() < 3) {
    await new Promise((r) =>
      setTimeout(r, (authenticator.timeRemaining() + 1) * 1000),
    );
  }
  return authenticator.generate(secret);
}

export function wrongTotp(secret: string): string {
  const valid = authenticator.generate(secret);
  return valid === '000000' ? '111111' : '000000';
}

export function setCookieHeaders(res: request.Response): string[] {
  const header = res.headers['set-cookie'] as unknown as string[] | undefined;
  return header ?? [];
}

export function cookieHeader(
  res: request.Response,
  name: string,
): string | undefined {
  return setCookieHeaders(res).find((h) => h.startsWith(`${name}=`));
}

export function cookieValue(
  res: request.Response,
  name: string,
): string | undefined {
  const header = cookieHeader(res, name);
  return header ? header.slice(name.length + 1).split(';')[0] : undefined;
}

export function base64url(input: object | string): string {
  const buffer = Buffer.from(
    typeof input === 'string' ? input : JSON.stringify(input),
  );
  return buffer.toString('base64url');
}

/** Captures everything the process writes to stdout/stderr (Nest's logger
 * included) so a test can assert no secret ever reaches a log line. */
export function captureOutput(): { stop: () => string } {
  const chunks: string[] = [];
  const capture = (chunk: unknown) => {
    chunks.push(
      typeof chunk === 'string'
        ? chunk
        : Buffer.from(chunk as Uint8Array).toString(),
    );
    return true;
  };
  const out = jest
    .spyOn(process.stdout, 'write')
    .mockImplementation(capture as never);
  const err = jest
    .spyOn(process.stderr, 'write')
    .mockImplementation(capture as never);
  return {
    stop: () => {
      out.mockRestore();
      err.mockRestore();
      return chunks.join('');
    },
  };
}
