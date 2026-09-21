/** The optional mirror channels (FRD 26.3, Blueprint 24). IN_APP is not listed:
 * it is always written (Blueprint 24: "the guaranteed channel"). */
export type ExtraChannel = 'EMAIL' | 'SMS';

export interface NotificationSettings {
  /** Channels mirrored IN ADDITION to the in-app row, for every recipient.
   * There is no per-user preference yet (the preferences screen is not part of
   * this step), so this is one platform-wide switch; the default is none. */
  extraChannels: ExtraChannel[];
  /** Blueprint 25.2: every integration resolves to its mock provider. Only
   * `mock` exists; anything else is refused at start-up rather than silently
   * pretending a real gateway is wired. */
  emailProvider: 'mock';
  smsProvider: 'mock';
  /** Blueprint 24: "exponential backoff, max 3 attempts". */
  maxAttempts: number;
  /** The first retry delay; each further one doubles it. The requirements give
   * no base delay, so it is configuration (an implementation tunable). */
  retryBaseSeconds: number;
  /** Whether the in-process retry job runs on its schedule (tests drive it). */
  retryEnabled: boolean;
}

export const DEFAULT_MAX_ATTEMPTS = 3;
export const DEFAULT_RETRY_BASE_SECONDS = 60;

function parseChannels(raw: string | undefined): ExtraChannel[] {
  if (raw === undefined || raw.trim() === '') {
    return [];
  }
  const wanted = [
    ...new Set(raw.split(',').map((c) => c.trim().toUpperCase())),
  ].filter((c) => c !== '');
  const bad = wanted.filter((c) => c !== 'EMAIL' && c !== 'SMS');
  if (bad.length > 0) {
    throw new Error(
      `NOTIFICATION_EXTRA_CHANNELS accepts EMAIL and / or SMS only (IN_APP is always on); got: ${bad.join(', ')}`,
    );
  }
  return wanted as ExtraChannel[];
}

function parseProvider(name: string, raw: string | undefined): 'mock' {
  const value = (raw ?? 'mock').trim().toLowerCase();
  if (value !== 'mock') {
    throw new Error(
      `${name} must be "mock": no real email / SMS provider is integrated in this build`,
    );
  }
  return 'mock';
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const value = raw === undefined ? NaN : Number(raw);
  return Number.isInteger(value) && value >= 1 ? value : fallback;
}

export const buildNotificationConfig = (): NotificationSettings => ({
  extraChannels: parseChannels(process.env.NOTIFICATION_EXTRA_CHANNELS),
  emailProvider: parseProvider(
    'NOTIFICATION_EMAIL_PROVIDER',
    process.env.NOTIFICATION_EMAIL_PROVIDER,
  ),
  smsProvider: parseProvider(
    'NOTIFICATION_SMS_PROVIDER',
    process.env.NOTIFICATION_SMS_PROVIDER,
  ),
  maxAttempts: parsePositiveInt(
    process.env.NOTIFICATION_MAX_ATTEMPTS,
    DEFAULT_MAX_ATTEMPTS,
  ),
  retryBaseSeconds: parsePositiveInt(
    process.env.NOTIFICATION_RETRY_BASE_SECONDS,
    DEFAULT_RETRY_BASE_SECONDS,
  ),
  retryEnabled: (process.env.NOTIFICATION_RETRY_ENABLED ?? 'true') !== 'false',
});
