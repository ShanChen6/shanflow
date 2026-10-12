import {
  Body,
  Controller,
  HttpCode,
  Post,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle, Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { ProblemDetailsFilter } from '../../../shared/http/problem-details.filter.js';
import { ZodValidationPipe } from '../../../shared/http/zod-validation.pipe.js';
import { ResetPasswordHandler } from './reset-password.handler.js';
import {
  resetPasswordRequestSchema,
  type ResetPasswordRequest,
} from './reset-password.schema.js';

@Controller('auth/password')
@UseFilters(ProblemDetailsFilter)
@SkipThrottle({ 'login-email': true })
export class ResetPasswordController {
  constructor(private readonly handler: ResetPasswordHandler) {}

  @Post('reset')
  @HttpCode(204)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 15 * 60 * 1000 } })
  async reset(
    @Body(new ZodValidationPipe(resetPasswordRequestSchema))
    body: ResetPasswordRequest,
  ): Promise<void> {
    await this.handler.execute(body);
  }
}
