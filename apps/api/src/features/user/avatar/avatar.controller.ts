import {
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Put,
  Req,
  Res,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle, Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AVATAR_MAX_BYTES } from '@shanflow/contracts';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { CurrentPrincipal } from '../../auth/shared/current-principal.decorator.js';
import { JwtAuthGuard } from '../../auth/shared/jwt-auth.guard.js';
import type {
  AuthenticatedRequest,
  Principal,
} from '../../auth/shared/principal.js';
import { ProblemDetailsFilter } from '../../../shared/http/problem-details.filter.js';
import { readBodyWithLimit } from '../../../shared/http/read-body.js';
import { AvatarHandler } from './avatar.handler.js';
import { NotFoundError, PayloadTooLargeError } from '../shared/user.errors.js';

const perUser = (name: string) => (request: Record<string, unknown>) =>
  `${name}|${(request as unknown as AuthenticatedRequest).principal?.userId ?? String(request.ip)}`;

@Controller('users')
@UseFilters(ProblemDetailsFilter)
// Every named throttler applies unless skipped; these routes use only 'default'.
@SkipThrottle({ 'login-email': true })
export class AvatarController {
  constructor(private readonly handler: AvatarHandler) {}

  /**
   * Upload as the raw image bytes (not multipart): `Content-Type: image/png|jpeg|webp`, at most 2 MiB.
   * The file is re-encoded server side; the stored image is never the client's bytes.
   */
  @Put('me/avatar')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, ThrottlerGuard)
  @Throttle({
    default: {
      limit: 10,
      ttl: 10 * 60_000,
      getTracker: perUser('avatar-upload'),
    },
  })
  async upload(
    @CurrentPrincipal() principal: Principal,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'private, no-store');
    const bytes = await readBodyWithLimit(request, AVATAR_MAX_BYTES);
    if (!bytes) throw new PayloadTooLargeError();
    return this.handler.upload(
      principal,
      request.headers['content-type'],
      bytes,
    );
  }

  @Delete('me/avatar')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, ThrottlerGuard)
  @Throttle({
    default: {
      limit: 10,
      ttl: 10 * 60_000,
      getTracker: perUser('avatar-remove'),
    },
  })
  async remove(
    @CurrentPrincipal() principal: Principal,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'private, no-store');
    return this.handler.remove(principal);
  }

  /**
   * Public, so an <img> tag can load it (it cannot send a Bearer token). The URL contains the user's random id
   * and is only ever shown to that user. The response cannot be sniffed, scripted or framed.
   */
  @Get(':id/avatar')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async read(
    @Param('id') id: string,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    if (!z.uuid().safeParse(id).success) throw new NotFoundError();
    const file = await this.handler.read(id);
    const etag = `"${file.version}"`;
    response.setHeader('Content-Type', 'image/webp');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Disposition', 'inline; filename="avatar.webp"');
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; sandbox",
    );
    // Helmet's default blocks other origins; the web app is a different origin on the same site.
    response.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    response.setHeader('ETag', etag);
    // The profile URL carries ?v=<version>, so a given URL never changes: cache it hard. Without it, always revalidate.
    response.setHeader(
      'Cache-Control',
      response.req.query.v
        ? 'public, max-age=31536000, immutable'
        : 'public, no-cache',
    );
    if (ifNoneMatch === etag) {
      response.status(304).end();
      return;
    }
    response.status(200).send(file.bytes);
  }
}
