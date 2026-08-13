import { randomBytes } from 'crypto';

export function generatePublicId(): string {
  return randomBytes(6).toString('hex');
}
