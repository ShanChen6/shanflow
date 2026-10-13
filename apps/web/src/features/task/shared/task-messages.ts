import { AUTH_ERROR_CODES } from '@shanflow/contracts';

export interface TaskFailure {
  status: 'error';
  message: string;
  /** The task or the board changed under the user: reload the board so it shows the truth. */
  reload: boolean;
}

const MESSAGES: Record<string, { message: string; reload?: boolean }> = {
  [AUTH_ERROR_CODES.taskVersionConflict]: { message: 'Someone else changed this task. The board was reloaded with the latest version.', reload: true },
  [AUTH_ERROR_CODES.invalidPlacement]: { message: 'That spot is no longer available. The board was reloaded.', reload: true },
  [AUTH_ERROR_CODES.notFound]: { message: 'This task is no longer available. The board was reloaded.', reload: true },
  [AUTH_ERROR_CODES.invalidStatusTransition]: { message: 'A cancelled task has to be reopened as To do first.' },
  [AUTH_ERROR_CODES.projectArchived]: { message: 'This project is archived. Restore it before changing its tasks.' },
  [AUTH_ERROR_CODES.forbidden]: { message: 'You do not have permission to do that.' },
  [AUTH_ERROR_CODES.invalidAssignee]: { message: 'That person is not an active member of this workspace.' },
  [AUTH_ERROR_CODES.taskLimitReached]: { message: 'This workspace has reached its task limit.' },
  [AUTH_ERROR_CODES.positionCapacityExceeded]: { message: 'This list cannot be reordered any further.' },
  [AUTH_ERROR_CODES.tooManyRequests]: { message: 'Too many changes. Please wait a moment and try again.' },
  [AUTH_ERROR_CODES.validationFailed]: { message: 'Those details are not valid. Check the title, deadline and other fields.' },
};

const OFFLINE = 'Could not reach the server. Check your connection and try again.';

export function failureFor(code: string | undefined): TaskFailure {
  const known = code === undefined ? undefined : MESSAGES[code];
  return { status: 'error', message: known?.message ?? OFFLINE, reload: known?.reload ?? false };
}
