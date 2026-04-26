export const TEMPLATES_COLLECTION = 'email_templates';
export const TRANSLATIONS_COLLECTION = 'email_template_translations';
export const VARIABLES_COLLECTION = 'email_template_variables';
export const SYNC_AUDIT_COLLECTION = 'email_template_sync_audit';
export const LANGUAGES_COLLECTION = 'languages';

export const SYSTEM_TEMPLATE_KEYS = [
	'password-reset',
	'user-invitation',
	'user-registration',
] as const;

export const ADMIN_ERROR_KEY = 'admin-error';
export const BASE_LAYOUT_KEY = 'base';

export const PROTECTED_TEMPLATE_KEYS = [
	...SYSTEM_TEMPLATE_KEYS,
	ADMIN_ERROR_KEY,
	BASE_LAYOUT_KEY,
] as const;

export const DEFAULT_FALLBACK_LANG = 'en-US';

export const TEMPLATE_CATEGORIES = [
	'system',
	'layout',
	'transactional',
	'marketing',
	'custom',
] as const;

export type SystemTemplateKey = (typeof SYSTEM_TEMPLATE_KEYS)[number];
export type ProtectedTemplateKey = (typeof PROTECTED_TEMPLATE_KEYS)[number];
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

export function isSystemTemplateKey(key: string): boolean {
	return (SYSTEM_TEMPLATE_KEYS as readonly string[]).includes(key);
}

export function isProtectedTemplateKey(key: string): boolean {
	return (PROTECTED_TEMPLATE_KEYS as readonly string[]).includes(key);
}
