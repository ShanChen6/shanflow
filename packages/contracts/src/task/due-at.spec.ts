import { describe, expect, it } from 'vitest';
import { dueAtSchema, DUE_AT_MAX, DUE_AT_MIN } from './task.js';

const parse = (value: string) => dueAtSchema.parse(value);

describe('dueAtSchema normalisation', () => {
  it('answers every instant in UTC with milliseconds and a Z, whatever offset it was sent with', () => {
    const instant = '2026-10-12T02:00:00.000Z';
    for (const input of [
      '2026-10-12T02:00:00Z',
      '2026-10-12T02:00:00.000Z',
      '2026-10-12T09:00:00+07:00',
      '2026-10-11T21:00:00-05:00',
      '2026-10-12T07:30:00+05:30',
      '2026-10-12T02:00:00+00:00',
      '2026-10-12T14:45:00+12:45',
    ]) {
      expect(parse(input)).toBe(instant);
    }
  });

  it('truncates finer-than-millisecond precision rather than rounding into the next instant', () => {
    expect(parse('2026-10-12T02:00:00.123456Z')).toBe('2026-10-12T02:00:00.123Z');
    expect(parse('2026-10-12T02:00:00.9999Z')).toBe('2026-10-12T02:00:00.999Z');
    expect(parse('2026-10-12T02:00:00.5Z')).toBe('2026-10-12T02:00:00.500Z');
  });

  it('handles daylight-saving offsets as plain offsets', () => {
    expect(parse('2026-03-29T03:30:00+02:00')).toBe('2026-03-29T01:30:00.000Z');
    expect(parse('2026-11-01T01:30:00-04:00')).toBe('2026-11-01T05:30:00.000Z');
  });

  it('keeps past deadlines: an overdue task is a normal state', () => {
    expect(parse('2020-01-01T00:00:00Z')).toBe('2020-01-01T00:00:00.000Z');
  });

  it('accepts exactly the supported range', () => {
    expect(parse(DUE_AT_MIN)).toBe(DUE_AT_MIN);
    expect(parse(DUE_AT_MAX)).toBe(DUE_AT_MAX);
  });
});

describe('dueAtSchema rejections', () => {
  it('needs an explicit offset: no bare dates, local times or lookalikes', () => {
    for (const bad of ['2026-10-12', '2026-10-12T09:00:00', '2026-10-12 09:00:00Z', '09:00:00Z', 'tomorrow', '', ' ', '1760000000', '2026-10-12T09:00Z+x']) {
      expect(dueAtSchema.safeParse(bad).success).toBe(false);
    }
    expect(dueAtSchema.safeParse(1760000000).success).toBe(false);
    expect(dueAtSchema.safeParse(null).success).toBe(false);
  });

  it('rejects dates that do not exist on the calendar, instead of failing later', () => {
    for (const bad of ['2026-02-30T00:00:00Z', '2026-02-29T00:00:00Z', '2026-13-01T00:00:00Z', '2026-04-31T00:00:00Z', '2026-10-12T24:00:00Z', '2026-10-12T23:59:60Z', '2026-10-12T09:60:00Z']) {
      expect(dueAtSchema.safeParse(bad).success).toBe(false);
    }
    expect(dueAtSchema.safeParse('2028-02-29T00:00:00Z').success).toBe(true); // a real leap day
  });

  it('rejects instants outside the supported range (the database has no year 0, and 5-digit years are not ISO here)', () => {
    for (const bad of ['0000-01-01T00:00:00Z', '0001-06-01T00:00:00Z', '1969-12-31T23:59:59Z', '10000-01-01T00:00:00Z', '-0001-01-01T00:00:00Z']) {
      expect(dueAtSchema.safeParse(bad).success).toBe(false);
    }
  });
});
