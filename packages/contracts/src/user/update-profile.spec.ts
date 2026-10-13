import { displayNameSchema, DISPLAY_NAME_MAX_LENGTH } from './display-name.js';
import { updateProfileRequestSchema } from './update-profile.js';

describe('displayNameSchema', () => {
  it('trims and normalises to NFC so equal-looking names are equal', () => {
    expect(displayNameSchema.parse('  Ann  ')).toBe('Ann');
    expect(displayNameSchema.parse('Café')).toBe('Café'); // e + combining acute → é
    expect(displayNameSchema.parse('Nguyễn Văn A')).toBe('Nguyễn Văn A'.normalize('NFC'));
  });

  it('accepts the maximum length and ordinary international names', () => {
    expect(displayNameSchema.safeParse('n'.repeat(DISPLAY_NAME_MAX_LENGTH)).success).toBe(true);
    for (const name of ['山田 太郎', 'Zoë', "O'Brien-Smith", 'A. B. C.']) {
      expect(displayNameSchema.safeParse(name).success).toBe(true);
    }
  });

  it.each([
    ['empty', ''],
    ['only spaces', '   '],
    ['too long', 'n'.repeat(DISPLAY_NAME_MAX_LENGTH + 1)],
    ['a newline', 'Ann\nBob'],
    ['a tab', 'Ann\tBob'],
    ['a NUL', 'Ann\u0000'],
    ['a zero-width space', 'Ann​Bob'],
    ['a right-to-left override', 'Ann‮txt.exe'],
    ['a line separator', 'Ann Bob'],
    ['a non-string', 42],
  ])('rejects %s', (_name, value) => {
    expect(displayNameSchema.safeParse(value).success).toBe(false);
  });
});

describe('updateProfileRequestSchema', () => {
  it('accepts exactly a display name', () => {
    expect(updateProfileRequestSchema.parse({ displayName: ' New Name ' })).toEqual({ displayName: 'New Name' });
  });

  it.each([
    ['an empty body', {}],
    ['a missing name', { displayName: undefined }],
    ['an email change', { displayName: 'Ann', email: 'other@example.invalid' }],
    ['an avatar change', { displayName: 'Ann', avatarUrl: 'https://x.example.invalid/a.png' }],
    ['an id', { displayName: 'Ann', id: '0b1f7a4e-3c1d-4a6e-9b6a-2f1c8d0e5a11' }],
  ])('rejects %s instead of silently ignoring it', (_name, body) => {
    expect(updateProfileRequestSchema.safeParse(body).success).toBe(false);
  });
});
