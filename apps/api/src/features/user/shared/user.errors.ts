import { DomainError } from '../../../shared/errors/domain-error.js';

export class PayloadTooLargeError extends DomainError {
  constructor() {
    super('PAYLOAD_TOO_LARGE', 413, 'The file is too large.');
  }
}

export class UnsupportedMediaTypeError extends DomainError {
  constructor() {
    super(
      'UNSUPPORTED_MEDIA_TYPE',
      415,
      'Only PNG, JPEG and WebP images are accepted.',
    );
  }
}

export class InvalidImageError extends DomainError {
  constructor() {
    super('INVALID_IMAGE', 400, 'The file is not a valid image.');
  }
}

export class NotFoundError extends DomainError {
  constructor() {
    super('NOT_FOUND', 404, 'Not found.');
  }
}
