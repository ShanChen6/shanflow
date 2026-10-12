import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { UnauthenticatedError } from './auth.errors.js';
import type { AuthenticatedRequest, Principal } from './principal.js';

/** Injects the caller set by JwtAuthGuard. Fails closed if the guard was forgotten on the route. */
export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Principal => {
    const { principal } = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest>();
    if (!principal) throw new UnauthenticatedError();
    return principal;
  },
);
