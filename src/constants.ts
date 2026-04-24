export const TEMPLATES_COLLECTION = 'email_templates';
export const VARIABLES_COLLECTION = 'email_template_variables';
export const SYNC_AUDIT_COLLECTION = 'email_template_sync_audit';

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

export const DEFAULT_SUPPORTED_LANGUAGES = ['fr', 'en'] as const;
export const DEFAULT_BASE_LAYOUT = 'base';
export const DEFAULT_FALLBACK_LANG = 'en';

export const TEMPLATE_CATEGORIES = ['system', 'transactional', 'marketing', 'custom'] as const;

export type SystemTemplateKey = (typeof SYSTEM_TEMPLATE_KEYS)[number];
export type ProtectedTemplateKey = (typeof PROTECTED_TEMPLATE_KEYS)[number];
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];
