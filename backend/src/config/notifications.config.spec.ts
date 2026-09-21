import {
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_RETRY_BASE_SECONDS,
  buildNotificationConfig,
} from './notifications.config';

describe('buildNotificationConfig', () => {
  const original = process.env;
  beforeEach(() => {
    process.env = { ...original };
    for (const k of Object.keys(process.env)) {
      if (k.startsWith('NOTIFICATION_')) {
        delete process.env[k];
      }
    }
  });
  afterAll(() => {
    process.env = original;
  });

  it('defaults to in-app only, mock providers, 3 attempts and the retry job on', () => {
    expect(buildNotificationConfig()).toEqual({
      extraChannels: [],
      emailProvider: 'mock',
      smsProvider: 'mock',
      maxAttempts: DEFAULT_MAX_ATTEMPTS,
      retryBaseSeconds: DEFAULT_RETRY_BASE_SECONDS,
      retryEnabled: true,
    });
    expect(DEFAULT_MAX_ATTEMPTS).toBe(3);
  });

  it('parses the optional mirror channels, ignoring case, spaces and repeats', () => {
    process.env.NOTIFICATION_EXTRA_CHANNELS = ' email , SMS,email ';
    expect(buildNotificationConfig().extraChannels).toEqual(['EMAIL', 'SMS']);
    process.env.NOTIFICATION_EXTRA_CHANNELS = '';
    expect(buildNotificationConfig().extraChannels).toEqual([]);
  });

  it('refuses to configure IN_APP (always on), push or an unknown channel', () => {
    for (const bad of ['IN_APP', 'PUSH', 'EMAIL,FAX']) {
      process.env.NOTIFICATION_EXTRA_CHANNELS = bad;
      expect(() => buildNotificationConfig()).toThrow(
        /EMAIL and \/ or SMS only/,
      );
    }
  });

  it('refuses any provider but the mock: no real gateway is integrated', () => {
    process.env.NOTIFICATION_EMAIL_PROVIDER = 'smtp';
    expect(() => buildNotificationConfig()).toThrow(/must be "mock"/);
    process.env.NOTIFICATION_EMAIL_PROVIDER = 'MOCK';
    process.env.NOTIFICATION_SMS_PROVIDER = 'twilio';
    expect(() => buildNotificationConfig()).toThrow(
      /NOTIFICATION_SMS_PROVIDER/,
    );
  });

  it('falls back to the defaults for a nonsensical attempt count or delay', () => {
    process.env.NOTIFICATION_MAX_ATTEMPTS = '0';
    process.env.NOTIFICATION_RETRY_BASE_SECONDS = 'soon';
    expect(buildNotificationConfig()).toMatchObject({
      maxAttempts: DEFAULT_MAX_ATTEMPTS,
      retryBaseSeconds: DEFAULT_RETRY_BASE_SECONDS,
    });
    process.env.NOTIFICATION_MAX_ATTEMPTS = '5';
    process.env.NOTIFICATION_RETRY_BASE_SECONDS = '30';
    process.env.NOTIFICATION_RETRY_ENABLED = 'false';
    expect(buildNotificationConfig()).toMatchObject({
      maxAttempts: 5,
      retryBaseSeconds: 30,
      retryEnabled: false,
    });
  });
});
