import { randomUUID } from 'node:crypto';

export const newObjectKey = (ownerId: string, kind: 'source' | 'rendered', extension: string): string => {
  const safeExtension = extension.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'bin';
  return `${ownerId}/${kind}/${randomUUID()}.${safeExtension}`;
};
