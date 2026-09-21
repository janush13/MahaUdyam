import { Logger } from '@nestjs/common';
import { NotificationRetryJob } from './notification-retry.job';

function build(enabled: boolean, retry: jest.Mock = jest.fn()) {
  const delivery = {
    settings: { retryEnabled: enabled },
    retryDue: retry,
  };
  return { job: new NotificationRetryJob(delivery as never), retry };
}

describe('NotificationRetryJob (the scheduled retry, Blueprint 24)', () => {
  it('runs the delivery retry when the schedule is on', async () => {
    const { job, retry } = build(
      true,
      jest.fn().mockResolvedValue({ attempted: 0 }),
    );
    await job.scheduled();
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the schedule is switched off (tests drive retryDue themselves)', async () => {
    const { job, retry } = build(false);
    await job.scheduled();
    expect(retry).not.toHaveBeenCalled();
  });

  it('a failed run is logged by error class only and never thrown: the next minute retries', async () => {
    const error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const { job } = build(
      true,
      jest.fn().mockRejectedValue(
        Object.assign(new Error('secret SQL'), {
          name: 'PrismaClientKnownRequestError',
        }),
      ),
    );
    await expect(job.scheduled()).resolves.toBeUndefined();
    const logged = String(error.mock.calls[0][0]);
    expect(logged).toContain('PrismaClientKnownRequestError');
    expect(logged).not.toContain('secret SQL');
    error.mockRestore();
  });
});
