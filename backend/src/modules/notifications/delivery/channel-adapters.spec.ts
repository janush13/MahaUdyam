import { Logger } from '@nestjs/common';
import { MockEmailProvider, MockSmsProvider } from './channel-adapters';

describe('mock channel providers (Blueprint 25.2)', () => {
  let log: jest.SpyInstance;
  beforeEach(() => {
    log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
  });
  afterEach(() => log.mockRestore());

  it('the email provider says it is simulated and never logs the address, subject or body', async () => {
    await new MockEmailProvider().send(
      'someone@example.test',
      'A private subject',
      'A private body',
    );
    const line = String(log.mock.calls[0][0]);
    expect(line).toContain('[SIMULATED EMAIL]');
    expect(line).not.toContain('someone@example.test');
    expect(line).not.toContain('A private');
  });

  it('the SMS provider says it is simulated and never logs the number or the message', async () => {
    await new MockSmsProvider().send('+910000000000', 'A private message');
    const line = String(log.mock.calls[0][0]);
    expect(line).toContain('[SIMULATED SMS]');
    expect(line).not.toContain('+910000000000');
    expect(line).not.toContain('A private');
  });

  it('never claims a real delivery', async () => {
    await new MockEmailProvider().send('a@example.test', 's', 'b');
    expect(String(log.mock.calls[0][0])).toMatch(/not sent to a real provider/);
  });
});
