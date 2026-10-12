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
import { RegisterHandler } from './register.handler.js';
import {
  registerRequestSchema,
  type RegisterRequest,
  type RegisterResponse,
} from './register.schema.js';

const ONE_HOUR_MS = 60 * 60 * 1000;

@Controller('auth')
@UseFilters(ProblemDetailsFilter)
export class RegisterController {
  constructor(private readonly handler: RegisterHandler) {}

  @Post('register')
  @HttpCode(201)
  @UseGuards(ThrottlerGuard)
  // Every named throttler in AuthModule applies unless skipped; register uses only 'default'.
  @SkipThrottle({ 'login-email': true })
  // 5 signups per hour per client IP (D12). Counted before validation so bad requests also consume budget.
  @Throttle({ default: { limit: 5, ttl: ONE_HOUR_MS } })
  register(
    @Body(new ZodValidationPipe(registerRequestSchema)) body: RegisterRequest,
  ): Promise<RegisterResponse> {
    return this.handler.execute(body);
  }
}
