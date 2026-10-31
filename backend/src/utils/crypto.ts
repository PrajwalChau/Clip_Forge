import crypto from 'node:crypto';

/**
 * Derives a 32-byte key from the provided secret using SHA-256
 */
const deriveKey = (secret: string): Buffer => {
  return crypto.createHash('sha256').update(secret).digest();
};

/**
 * Encrypts a sensitive string (such as an OAuth access/refresh token) using AES-256-GCM.
 * Output format: iv:authTag:encryptedHex
 */
export const encryptToken = (plainText: string, secretKey: string): string => {
  if (!plainText) return '';
  const key = deriveKey(secretKey);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(plainText, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
};

/**
 * Decrypts a token encrypted with AES-256-GCM.
 */
export const decryptToken = (cipherText: string, secretKey: string): string => {
  if (!cipherText) return '';
  const parts = cipherText.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted token format.');
  }

  const [ivHex, authTagHex, encryptedHex] = parts;
  const key = deriveKey(secretKey);
  const iv = Buffer.from(ivHex!, 'hex');
  const authTag = Buffer.from(authTagHex!, 'hex');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedHex!, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
};
