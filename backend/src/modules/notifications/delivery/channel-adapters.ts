import { Injectable, Logger } from '@nestjs/common';

/** Blueprint 25.1: one adapter interface per integration type; a provider is a
 * class implementing it. `send` resolves on success and throws on failure. */
export interface EmailAdapter {
  send(to: string, subject: string, body: string): Promise<void>;
}
export interface SmsAdapter {
  send(mobile: string, message: string): Promise<void>;
}

export const EMAIL_ADAPTER = Symbol('EMAIL_ADAPTER');
export const SMS_ADAPTER = Symbol('SMS_ADAPTER');

/**
 * Blueprint 24 / 25.2: with no provider configured the adapter says so in the
 * log, clearly prefixed, and returns - it never claims a real delivery. Unlike
 * the blueprint's sketch it logs neither the address nor the message: those are
 * personal data and the platform's log policy keeps them out of logs.
 */
@Injectable()
export class MockEmailProvider implements EmailAdapter {
  private readonly logger = new Logger('NotificationEmail');
  send(to: string, subject: string, body: string): Promise<void> {
    this.logger.log(
      `[SIMULATED EMAIL] not sent to a real provider (recipient and content withheld; subject length ${subject.length}, body length ${body.length}, address length ${to.length})`,
    );
    return Promise.resolve();
  }
}

@Injectable()
export class MockSmsProvider implements SmsAdapter {
  private readonly logger = new Logger('NotificationSms');
  send(mobile: string, message: string): Promise<void> {
    this.logger.log(
      `[SIMULATED SMS] not sent to a real provider (recipient and content withheld; message length ${message.length}, number length ${mobile.length})`,
    );
    return Promise.resolve();
  }
}
