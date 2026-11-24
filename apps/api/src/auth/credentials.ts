import { argon2, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(argon2);
const parameters = { memory: 19456, passes: 2, parallelism: 1, tagLength: 32 };
const dummy = randomBytes(48);

export function digest(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export function randomToken(size = 32) {
  return randomBytes(size).toString('base64url');
}

export async function hashPassword(password: string) {
  const nonce = randomBytes(16);
  const hash = await derive('argon2id', { ...parameters, nonce, message: password });
  return Buffer.concat([nonce, hash]).toString('base64url');
}

export async function checkPassword(password: string, stored?: string | null) {
  const record = stored ? Buffer.from(stored, 'base64url') : dummy;
  const hash = await derive('argon2id', { ...parameters, nonce: record.subarray(0, 16), message: password });
  return timingSafeEqual(hash, record.subarray(16)) && !!stored;
}
