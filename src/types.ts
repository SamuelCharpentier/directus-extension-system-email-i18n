import type { TemplateCategory } from './constants';

/**
 * Minimal structural Logger shape matching the subset of pino's Logger
 * interface that Directus passes to hooks. Avoids a hard dependency on
 * `pino` just for the type.
 */
export type Logger = {
	info: (msg: string) => void;
	warn: (msg: string) => void;
	error: (msg: string) => void;
};

/** Flat key→string map injected into Liquid as `{{ i18n.* }}`. */
export type TranslationStrings = Record<string, string>;

export type EmailTemplateRow = {
	id?: string;
	template_key: string;
	category: TemplateCategory;
	body: string;
	description: string | null;
	is_active: boolean;
	is_protected: boolean;
	checksum: string;
	last_synced_at: string | null;
};

export type EmailTemplateTranslationRow = {
	id?: string;
	email_templates_id: string;
	languages_code: string;
	subject: string;
	from_name: string | null;
	strings: TranslationStrings;
};

export type EmailTemplateVariableRow = {
	id?: string;
	template_key: string;
	variable_name: string;
	is_required: boolean;
	is_protected: boolean;
	description: string | null;
	example_value: string | null;
};

export type LanguageRow = {
	code: string;
	name: string;
	direction: 'ltr' | 'rtl';
};

export type SeedTemplate = {
	template_key: string;
	category: TemplateCategory;
	body: string;
	description: string | null;
};

export type SeedTranslation = {
	template_key: string;
	languages_code: string;
	subject: string;
	from_name: string | null;
	strings: TranslationStrings;
};

export type SeedVariable = {
	template_key: string;
	variable_name: string;
	is_required: boolean;
	description: string | null;
	example_value: string | null;
};

export type SeedLanguage = {
	code: string;
	name: string;
	direction: 'ltr' | 'rtl';
};

/** Recipient user info auto-hydrated for protected system emails. */
export type RecipientUser = {
	id: string;
	first_name: string | null;
	last_name: string | null;
	email: string;
	language: string | null;
};
