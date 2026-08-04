/** Shared parser for opt-out environment flags used by client and server evidence. */
export function isDisabledEnvFlag(value: unknown): boolean {
  if (typeof value === 'boolean') return !value;
  if (typeof value !== 'string') return false;

  switch (value.trim().toLowerCase()) {
    case '0':
    case 'false':
    case 'no':
    case 'off':
      return true;
    default:
      return false;
  }
}
