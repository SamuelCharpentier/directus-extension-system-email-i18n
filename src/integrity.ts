import { createHash } from 'node:crypto';

/**
 * Stable SHA-256 checksum of the translation payload for a row, used to
 * detect drift between the DB-authoritative strings and the filesystem
 * cache (locales/{lang}.json).
 */
export function computeChecksum(input: {
	subject: string;
	from_name: string | null;
	strings: Record<string, string>;
}): string {
	const sortedStrings = Object.keys(input.strings)
		.sort()
		.reduce<Record<string, string>>((acc, key) => {
			acc[key] = input.strings[key]!;
			return acc;
		}, {});
	const payload = JSON.stringify({
		subject: input.subject,
		from_name: input.from_name,
		strings: sortedStrings,
	});
	return createHash('sha256').update(payload).digest('hex');
}

/**
 * Compare two checksums. Returns true when they match.
 */
export function checksumMatches(
	a: string | null | undefined,
	b: string | null | undefined,
): boolean {
	if (!a || !b) return false;
	return a === b;
}
