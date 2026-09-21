import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../../config/configuration';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;

  beforeEach(() => {
    const configService = {
      get: () => 'test-access-secret',
    } as unknown as ConfigService<AppConfig, true>;
    strategy = new JwtStrategy(configService);
  });

  it('maps an access token payload onto AuthenticatedUser', () => {
    const result = strategy.validate({
      sub: 'user-1',
      type: 'access',
      roles: ['APPLICANT'],
    });
    expect(result).toEqual({
      userId: 'user-1',
      type: 'access',
      roles: ['APPLICANT'],
    });
  });

  it('maps an mfa_setup payload with an empty roles array', () => {
    const result = strategy.validate({ sub: 'user-1', type: 'mfa_setup' });
    expect(result).toEqual({ userId: 'user-1', type: 'mfa_setup', roles: [] });
  });

  it('rejects a refresh-type payload outright', () => {
    expect(() =>
      strategy.validate({ sub: 'user-1', type: 'refresh', jti: 'x' }),
    ).toThrow();
  });
});
