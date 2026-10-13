import { Injectable } from '@nestjs/common';
import { DEFAULT_SETTINGS, type UserSettings } from '@shanflow/contracts';
import type { ThemePreference } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { UnauthenticatedError } from '../../auth/shared/auth.errors.js';
import type { Principal } from '../../auth/shared/principal.js';
import type {
  SettingsResponse,
  UpdateSettingsRequest,
} from './settings.schema.js';

const THEME_TO_DB: Record<UserSettings['theme'], ThemePreference> = {
  system: 'SYSTEM',
  light: 'LIGHT',
  dark: 'DARK',
};
const THEME_FROM_DB: Record<ThemePreference, UserSettings['theme']> = {
  SYSTEM: 'system',
  LIGHT: 'light',
  DARK: 'dark',
};

@Injectable()
export class SettingsHandler {
  constructor(private readonly prisma: PrismaService) {}

  private async requireActive(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { accountStatus: true },
    });
    if (!user || user.accountStatus !== 'ACTIVE')
      throw new UnauthenticatedError();
  }

  /** A user who never changed anything has no row and gets the defaults. */
  async get(principal: Principal): Promise<SettingsResponse> {
    await this.requireActive(principal.userId);
    const row = await this.prisma.userSettings.findUnique({
      where: { userId: principal.userId },
    });
    return {
      settings: row
        ? {
            locale: row.locale as UserSettings['locale'],
            timeZone: row.timeZone,
            theme: THEME_FROM_DB[row.theme],
          }
        : { ...DEFAULT_SETTINGS },
    };
  }

  /** Changes only the supplied fields; the first change creates the row (upsert is atomic). */
  async update(
    principal: Principal,
    changes: UpdateSettingsRequest,
  ): Promise<SettingsResponse> {
    await this.requireActive(principal.userId);
    const data = {
      ...(changes.locale !== undefined && { locale: changes.locale }),
      ...(changes.timeZone !== undefined && { timeZone: changes.timeZone }),
      ...(changes.theme !== undefined && { theme: THEME_TO_DB[changes.theme] }),
    };
    await this.prisma.userSettings.upsert({
      where: { userId: principal.userId },
      create: { userId: principal.userId, ...data },
      update: data,
    });
    return this.get(principal);
  }
}
