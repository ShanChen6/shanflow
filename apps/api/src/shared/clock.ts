import { Injectable } from '@nestjs/common';

/** Injectable time source so expiry and rotation logic can be tested deterministically. */
export abstract class Clock {
  abstract now(): Date;
}

@Injectable()
export class SystemClock extends Clock {
  now(): Date {
    return new Date();
  }
}
