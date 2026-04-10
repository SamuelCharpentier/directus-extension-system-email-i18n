import type { EmailOptions } from '@directus/types';
import type { TemplateTrans } from './types';

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

function buildSenderWithName(name: string, address: string): string {
	return `${name} <${address}>`;
}

export function applyTranslationsToEmail(
	email: EmailOptions,
	trans: TemplateTrans,
	fromEnv: string,
): void {
	if (trans.subject) {
		email.subject = trans.subject;
	}

	if (trans.from_name) {
		const address = extractAddressFromEnv(fromEnv);
		email.from = buildSenderWithName(trans.from_name, address);
	}

	if (email.template) {
		const i18n = Object.fromEntries(
			Object.entries(trans)
				.filter(([key, value]) => key !== 'subject' && key !== 'from_name' && typeof value === 'string'),
		);
		email.template.data = { ...email.template.data, i18n };
	}
}
