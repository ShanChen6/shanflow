import { Injectable } from '@nestjs/common';
import argon2 from 'argon2';

/** Upper bound protects the hasher from oversized-input CPU/memory abuse. */
export const MAX_PASSWORD_LENGTH = 128;

export abstract class PasswordHasher {
  abstract hash(password: string): Promise<string>;
  /** False for a mismatch, a malformed hash or an over-long password; never throws on bad input. */
  abstract verify(hash: string, password: string): Promise<boolean>;
  abstract needsRehash(hash: string): boolean;
  /** Burns the same work as verify() so unknown accounts are not distinguishable by timing. */
  abstract verifyDummy(password: string): Promise<void>;
}

// OWASP minimum for argon2id: m >= 19 MiB, t >= 2, p = 1.
export const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

@Injectable()
export class Argon2PasswordHasher extends PasswordHasher {
  private dummyHash?: Promise<string>;

  async hash(password: string): Promise<string> {
    if (password.length === 0 || password.length > MAX_PASSWORD_LENGTH) {
      throw new RangeError('Password length is outside the supported range.');
    }
    return argon2.hash(password, ARGON2_OPTIONS);
  }

  async verify(hash: string, password: string): Promise<boolean> {
    if (password.length === 0 || password.length > MAX_PASSWORD_LENGTH)
      return false;
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }

  needsRehash(hash: string): boolean {
    return argon2.needsRehash(hash, ARGON2_OPTIONS);
  }

  async verifyDummy(password: string): Promise<void> {
    this.dummyHash ??= argon2.hash('shanflow-dummy-password', ARGON2_OPTIONS);
    await this.verify(
      await this.dummyHash,
      password.slice(0, MAX_PASSWORD_LENGTH) || 'x',
    );
  }
}
