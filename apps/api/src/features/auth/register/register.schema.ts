// The request/response contract is shared with the web app; the slice re-exports it.
export {
  registerRequestSchema,
  registerResponseSchema,
  type RegisterRequest,
  type RegisterResponse,
} from '@shanflow/contracts';
