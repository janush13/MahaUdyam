import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  Get,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Request, Response } from 'express';
import { AppConfig } from '../../config/configuration';
import { AuthService } from './auth.service';
import {
  clearRefreshCookie,
  readRefreshCookie,
  RefreshCookieConfig,
  setRefreshCookie,
} from './cookie.util';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { RequireTokenType } from './decorators/token-type.decorator';
import {
  AuthenticatedUserDto,
  LoginResponseDto,
  MfaEnrollResponseDto,
  RegisterResponseDto,
  SimpleSuccessResponseDto,
} from './dto/auth-response.dto';
import { LoginDto } from './dto/login.dto';
import { MfaConfirmDto } from './dto/mfa-confirm.dto';
import { MfaVerifyDto } from './dto/mfa-verify.dto';
import { RegisterDto } from './dto/register.dto';
import { AuthenticatedUser } from './interfaces/jwt-payload.interface';
import { RequestMeta } from './token.service';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  private requestMeta(req: Request): RequestMeta {
    return {
      ipAddress: req.ip ?? 'unknown',
      userAgent: req.get('user-agent') ?? undefined,
    };
  }

  private cookieConfig(): RefreshCookieConfig {
    return {
      env: this.configService.get('env', { infer: true }),
      apiPrefix: this.configService.get('apiPrefix', { infer: true }),
      refreshCookieName: this.configService.get(
        'authSecurity.refreshCookieName',
        { infer: true },
      ),
    };
  }

  @Public()
  @Post('register')
  @ApiOperation({
    summary:
      'Register a new applicant account (always assigns the APPLICANT role only)',
  })
  @ApiOkResponse({ type: RegisterResponseDto })
  register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
  ): Promise<RegisterResponseDto> {
    return this.authService.register(dto, req.ip ?? 'unknown');
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Authenticate with email/mobile + password',
    description:
      'Returns status AUTHENTICATED (with accessToken + refresh cookie), MFA_REQUIRED (submit challengeToken + code to /auth/mfa/verify), or MFA_SETUP_REQUIRED (this role requires MFA; use the challengeToken as a Bearer token against /auth/mfa/enroll then /auth/mfa/confirm).',
  })
  @ApiOkResponse({ type: LoginResponseDto })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponseDto> {
    const result = await this.authService.login(dto, this.requestMeta(req));

    if (result.status === 'AUTHENTICATED') {
      setRefreshCookie(
        res,
        this.cookieConfig(),
        result.refreshToken.token,
        result.refreshToken.expiresAt,
      );
      return {
        status: result.status,
        accessToken: result.accessToken,
        user: result.user,
      };
    }

    return { status: result.status, challengeToken: result.challengeToken };
  }

  @Public()
  @Post('mfa/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Complete login by submitting a TOTP code against a login-issued challengeToken',
  })
  @ApiOkResponse({ type: LoginResponseDto })
  async verifyMfa(
    @Body() dto: MfaVerifyDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponseDto> {
    const result = await this.authService.verifyMfaChallenge(
      dto,
      this.requestMeta(req),
    );

    setRefreshCookie(
      res,
      this.cookieConfig(),
      result.refreshToken.token,
      result.refreshToken.expiresAt,
    );

    return {
      status: result.status,
      accessToken: result.accessToken,
      user: result.user,
    };
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Rotate the refresh session (reads the httpOnly cookie, never a request body)',
  })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ accessToken: string }> {
    const cookieConfig = this.cookieConfig();
    const rawToken = readRefreshCookie(req, cookieConfig);

    const { accessToken, refreshToken } = await this.authService.refresh(
      rawToken,
      this.requestMeta(req),
    );

    setRefreshCookie(
      res,
      cookieConfig,
      refreshToken.token,
      refreshToken.expiresAt,
    );

    return { accessToken };
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Invalidate the current refresh session and clear the cookie (idempotent)',
  })
  @ApiOkResponse({ type: SimpleSuccessResponseDto })
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SimpleSuccessResponseDto> {
    const cookieConfig = this.cookieConfig();
    const rawToken = readRefreshCookie(req, cookieConfig);

    await this.authService.logout(rawToken, req.ip ?? 'unknown');
    clearRefreshCookie(res, cookieConfig);

    return { success: true };
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Return the authenticated user's own profile and current roles",
  })
  @ApiOkResponse({ type: AuthenticatedUserDto })
  me(@CurrentUser() user: AuthenticatedUser): Promise<AuthenticatedUserDto> {
    return this.authService.me(user.userId);
  }

  @Post('mfa/enroll')
  @RequireTokenType('access', 'mfa_setup')
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Generate a new (unconfirmed) TOTP secret for the authenticated user',
  })
  @ApiOkResponse({ type: MfaEnrollResponseDto })
  enrollMfa(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<MfaEnrollResponseDto> {
    return this.authService.enrollMfa(user.userId, req.ip ?? 'unknown');
  }

  @Post('mfa/confirm')
  @RequireTokenType('access', 'mfa_setup')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Confirm MFA enrollment with a TOTP code — only this call actually enables MFA',
  })
  @ApiOkResponse({ type: SimpleSuccessResponseDto })
  async confirmMfa(
    @Body() dto: MfaConfirmDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<SimpleSuccessResponseDto> {
    await this.authService.confirmMfa(
      user.userId,
      dto.code,
      req.ip ?? 'unknown',
    );
    return { success: true };
  }
}
