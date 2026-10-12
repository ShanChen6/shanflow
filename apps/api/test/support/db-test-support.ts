import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import type { INestApplication, ModuleMetadata } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { PrismaService } from '../../src/database/prisma.service.js';
import { Argon2PasswordHasher } from '../../src/shared/crypto/password-hasher.js';
import { InMemoryMailer, Mailer } from '../../src/shared/mail/mailer.js';
import { AppModule } from '../../src/app.module.js';

config({
  path: fileURLToPath(new URL('../../../../.env', import.meta.url)),
  quiet: true,
});

export const PASSWORD = 'correct horse battery staple';
export const ORIGIN = 'http://localhost:3000';
export const CSRF_HEADERS = { Origin: ORIGIN, 'X-Requested-With': 'shanflow' };

const hasher = new Argon2PasswordHasher();

export function assertLocalTestDatabase(): void {
  if (process.env.NODE_ENV === 'production')
    throw new Error('Database tests refuse NODE_ENV=production.');
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DATABASE_URL is required for database tests.');
  const url = new URL(raw);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const expectedPort = Number(process.env.POSTGRES_PORT || 5432);
  const actualPort = Number(url.port || 5432);
  const forbiddenOverrides = [
    'user',
    'username',
    'password',
    'database',
    'dbname',
    'host',
    'port',
  ];
  if (
    !['127.0.0.1', 'localhost', '::1'].includes(host) ||
    actualPort !== expectedPort ||
    decodeURIComponent(url.username) !== 'shanflow_app' ||
    decodeURIComponent(url.pathname.slice(1)) !== 'shanflow' ||
    (url.searchParams.get('schema') ?? 'public') !== 'public' ||
    forbiddenOverrides.some((key) => url.searchParams.has(key))
  ) {
    throw new Error(
      'Database tests require the verified local shanflow_app target.',
    );
  }
}

export function fixtureEmail(label: string): string {
  return `${label}.${randomUUID()}@example.invalid`;
}

export interface TestApp {
  app: INestApplication;
  mailer: InMemoryMailer;
}

/**
 * Boots the real application against the local test database. Throttling is bypassed unless a test is
 * about throttling; email goes to an in-memory outbox so tests can read one-time links.
 */
export async function createTestApp(
  options: { throttle?: boolean; imports?: ModuleMetadata['imports'] } = {},
): Promise<TestApp> {
  assertLocalTestDatabase();
  // Avatars of tests go to a throwaway directory, never to the developer's real one.
  process.env.AVATAR_STORAGE_DIR ||= mkdtempSync(
    join(tmpdir(), 'shanflow-avatars-'),
  );
  process.env.API_PUBLIC_URL = 'http://localhost:3001';
  const mailer = new InMemoryMailer();
  let builder = Test.createTestingModule({
    imports: [AppModule, ...(options.imports ?? [])],
  })
    .overrideProvider(Mailer)
    .useValue(mailer);
  if (!options.throttle) {
    builder = builder
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true });
  }
  const app = (await builder.compile()).createNestApplication();
  await app.init();
  return { app, mailer };
}

export interface TestUser {
  id: string;
  email: string;
}

export async function createUser(
  prisma: PrismaService,
  ids: string[],
  options: {
    label?: string;
    password?: string | null;
    status?: 'ACTIVE' | 'SUSPENDED';
    verified?: boolean;
  } = {},
): Promise<TestUser> {
  const email = fixtureEmail(options.label ?? 'user');
  const password = options.password === undefined ? PASSWORD : options.password;
  const user = await prisma.user.create({
    data: {
      email,
      displayName: 'Test User',
      accountStatus: options.status ?? 'ACTIVE',
      emailVerifiedAt: options.verified ? new Date() : null,
      ...(password === null
        ? {}
        : {
            passwordCredential: {
              create: { passwordHash: await hasher.hash(password) },
            },
          }),
    },
  });
  ids.push(user.id);
  return { id: user.id, email };
}

/** Removes everything the auth tests can create for the given users. */
export async function deleteUsers(
  prisma: PrismaService,
  ids: string[],
): Promise<void> {
  const userIds = ids.splice(0);
  await prisma.refreshSession.updateMany({
    where: { userId: { in: userIds } },
    data: { replacedById: null },
  });
  await prisma.refreshSession.deleteMany({
    where: { userId: { in: userIds } },
  });
  await prisma.oneTimeToken.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.oAuthAccount.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.passwordCredential.deleteMany({
    where: { userId: { in: userIds } },
  });
  // Workspaces the users own (and every membership in them), then their memberships elsewhere.
  const owned = (
    await prisma.workspace.findMany({
      where: { ownerId: { in: userIds } },
      select: { id: true },
    })
  ).map((workspace) => workspace.id);
  await prisma.workspaceMember.deleteMany({
    where: {
      OR: [{ workspaceId: { in: owned } }, { userId: { in: userIds } }],
    },
  });
  await prisma.workspace.deleteMany({ where: { id: { in: owned } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

/** The 43-character token in an emailed link. */
export function tokenFromEmail(text: string | undefined): string {
  const token = /token=([A-Za-z0-9_-]{43})/.exec(text ?? '')?.[1];
  if (!token) throw new Error('No token link in the email.');
  return token;
}

export function cookiePairFrom(response: {
  headers: Record<string, unknown>;
}): string {
  const header = (response.headers['set-cookie'] as string[] | undefined)?.find(
    (cookie) => cookie.startsWith('shanflow_refresh='),
  );
  if (!header) throw new Error('Missing refresh cookie');
  return header.split(';')[0]!;
}
