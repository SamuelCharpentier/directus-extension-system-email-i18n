import type { EmailOptions } from '@directus/types';
import type { EmailTemplateTranslationRow, RecipientUser, TranslationStrings } from './types';

const EMAIL_ADDRESS_PATTERN = /<([^>]+)>$/;

export function extractRecipientEmail(to: EmailOptions['to']): string | null {
	if (typeof to === 'string') return to;
	if (Array.isArray(to)) {
		const first = to[0];
		const address = typeof first === 'string' ? first : ((first as any)?.address ?? null);
		return address || null;
	}
	const address = (to as any)?.address ?? null;
	return address || null;
}

function extractAddressFromEnv(emailFrom: string): string {
	const match = EMAIL_ADDRESS_PATTERN.exec(emailFrom);
	return match ? match[1]! : emailFrom.trim();
}

export type ApplyTranslationInput = {
	translation: EmailTemplateTranslationRow | null;
	baseStrings: TranslationStrings | null;
	fallbackFromName: string | null;
	fromEnv: string;
	recipientUser: RecipientUser | null;
};

/**
 * Mutate the outgoing EmailOptions with the resolved translation:
 *   - override subject if provided
 *   - override from-name if provided (or fallback)
 *   - inject `i18n` + `i18n.base` into template.data
 *   - inject `user` into template.data when hydrated
 */
export function applyTranslationsToEmail(email: EmailOptions, input: ApplyTranslationInput): void {
	const { translation, baseStrings, fallbackFromName, fromEnv, recipientUser } = input;
	const strings = translation?.strings ?? {};

	if (translation?.subject) {
		email.subject = translation.subject;
	}

	const fromName = translation?.from_name || fallbackFromName;
	if (fromName && fromEnv) {
		const address = extractAddressFromEnv(fromEnv);
		// Cast: EmailOptions types `from` as string, but nodemailer accepts
		// the Address object form for proper RFC 5322 encoding.
		(email as any).from = { name: fromName, address };
	}

	if (!email.template) return;
	const existing = (email.template.data ?? {}) as Record<string, unknown>;
	const i18n: Record<string, unknown> = { ...strings };
	if (baseStrings) i18n['base'] = baseStrings;
	email.template.data = {
		...existing,
		i18n,
		...(recipientUser ? { user: recipientUser } : {}),
	};
}
