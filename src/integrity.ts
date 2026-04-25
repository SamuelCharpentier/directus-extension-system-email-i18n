import { createHash } from 'node:crypto';

/**
 * Stable SHA-256 checksum over a template's Liquid body. Used to detect
 * drift between the DB-authoritative body and the filesystem cache
 * (`<EMAIL_TEMPLATES_PATH>/<template_key>.liquid`).
 */
export function computeChecksum(input: { body: string }): string {
	return createHash('sha256').update(input.body, 'utf-8').digest('hex');
}
