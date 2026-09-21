import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LoginDto } from './login.dto';
import { MfaConfirmDto } from './mfa-confirm.dto';
import { MfaVerifyDto } from './mfa-verify.dto';
import { RegisterDto } from './register.dto';

describe('RegisterDto', () => {
  const valid = {
    name: 'Asha Patil',
    email: 'asha@example.com',
    mobile: '9876543210',
    password: 'Str0ngPassword',
  };

  it('accepts a fully valid payload', async () => {
    const errors = await validate(plainToInstance(RegisterDto, valid));
    expect(errors).toHaveLength(0);
  });

  it('rejects an invalid email', async () => {
    const errors = await validate(
      plainToInstance(RegisterDto, { ...valid, email: 'not-an-email' }),
    );
    expect(errors.some((e) => e.property === 'email')).toBe(true);
  });

  it('rejects a mobile number with letters', async () => {
    const errors = await validate(
      plainToInstance(RegisterDto, { ...valid, mobile: '98abc43210' }),
    );
    expect(errors.some((e) => e.property === 'mobile')).toBe(true);
  });

  it('rejects a password shorter than 10 characters', async () => {
    const errors = await validate(
      plainToInstance(RegisterDto, { ...valid, password: 'Sh0rt' }),
    );
    expect(errors.some((e) => e.property === 'password')).toBe(true);
  });

  it('rejects a password with no digit', async () => {
    const errors = await validate(
      plainToInstance(RegisterDto, { ...valid, password: 'NoDigitsHere' }),
    );
    expect(errors.some((e) => e.property === 'password')).toBe(true);
  });

  it('rejects a password with no uppercase letter', async () => {
    const errors = await validate(
      plainToInstance(RegisterDto, { ...valid, password: 'alllowercase1' }),
    );
    expect(errors.some((e) => e.property === 'password')).toBe(true);
  });
});

describe('LoginDto', () => {
  it('accepts a valid payload', async () => {
    const errors = await validate(
      plainToInstance(LoginDto, {
        emailOrMobile: 'asha@example.com',
        password: 'anything',
      }),
    );
    expect(errors).toHaveLength(0);
  });

  it('rejects an empty password', async () => {
    const errors = await validate(
      plainToInstance(LoginDto, {
        emailOrMobile: 'asha@example.com',
        password: '',
      }),
    );
    expect(errors.some((e) => e.property === 'password')).toBe(true);
  });
});

describe('MfaVerifyDto', () => {
  it('accepts a valid 6-digit code', async () => {
    const errors = await validate(
      plainToInstance(MfaVerifyDto, { challengeToken: 'x', code: '123456' }),
    );
    expect(errors).toHaveLength(0);
  });

  it('rejects a non-6-digit code', async () => {
    const errors = await validate(
      plainToInstance(MfaVerifyDto, { challengeToken: 'x', code: '12345' }),
    );
    expect(errors.some((e) => e.property === 'code')).toBe(true);
  });

  it('rejects a non-numeric code', async () => {
    const errors = await validate(
      plainToInstance(MfaVerifyDto, { challengeToken: 'x', code: 'abcdef' }),
    );
    expect(errors.some((e) => e.property === 'code')).toBe(true);
  });
});

describe('MfaConfirmDto', () => {
  it('accepts a valid 6-digit code', async () => {
    const errors = await validate(
      plainToInstance(MfaConfirmDto, { code: '654321' }),
    );
    expect(errors).toHaveLength(0);
  });

  it('rejects a malformed code', async () => {
    const errors = await validate(
      plainToInstance(MfaConfirmDto, { code: '12' }),
    );
    expect(errors.some((e) => e.property === 'code')).toBe(true);
  });
});
