import { SystemClock } from './clock.js';

describe('SystemClock', () => {
  it('returns the current time', () => {
    const before = Date.now();
    const now = new SystemClock().now().getTime();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });
});
