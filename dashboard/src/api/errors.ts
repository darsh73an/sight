import axios from 'axios';

/**
 * Every component that calls the API needs this same logic - pulled out
 * once instead of repeated (and previously, in most places, simply
 * missing entirely - see ErrorList/ErrorDetail/ProjectSelector, which
 * had no catch block at all before this fix).
 */
export function getErrorMessage(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    return err.response?.data?.message ?? fallback;
  }
  return fallback;
}
