import {
  Body,
  Controller,
  HttpCode,
  Post,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { ProblemDetailsFilter } from '../../../shared/http/problem-details.filter.js';
import { ZodValidationPipe } from '../../../shared/http/zod-validation.pipe.js';
import { ForgotPasswordHandler } from './forgot-password.handler.js';
import {
  forgotPasswordRequestSchema,
  type ForgotPasswordRequest,
} from './forgot-password.schema.js';

const HOUR_MS = 60 * 60 * 1000;

@Controller('auth/password')
@UseFilters(ProblemDetailsFilter)
export class ForgotPasswordController {
  constructor(private readonly handler: ForgotPasswordHandler) {}

  @Post('forgot')
  @HttpCode(202)
  @UseGuards(ThrottlerGuard)
  // 20 per hour per IP, and 3 per hour per IP + address ('login-email' tracker) so one address cannot be mail-bombed.
  @Throttle({
    default: { limit: 20, ttl: HOUR_MS },
    'login-email': { limit: 3, ttl: HOUR_MS },
  })
  async forgot(
    @Body(new ZodValidationPipe(forgotPasswordRequestSchema))
    body: ForgotPasswordRequest,
  ): Promise<void> {
    await this.handler.execute(body);
  }
}
