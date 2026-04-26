import { describe, it, expect } from 'vitest';
import {
	isSystemTemplateKey,
	isProtectedTemplateKey,
	SYSTEM_TEMPLATE_KEYS,
	PROTECTED_TEMPLATE_KEYS,
	ADMIN_ERROR_KEY,
	BASE_LAYOUT_KEY,
	TEMPLATE_CATEGORIES,
} from '../src/constants';
import {
	ALL_COLLECTIONS,
	ALL_RELATIONS,
	LANGUAGES_COLLECTION_PAYLOAD,
	EMAIL_TEMPLATES_COLLECTION,
	EMAIL_TEMPLATE_TRANSLATIONS_COLLECTION,
	EMAIL_TEMPLATE_VARIABLES_COLLECTION,
	EMAIL_TEMPLATE_SYNC_AUDIT_COLLECTION,
} from '../src/schema';
import {
	SEED_TEMPLATES,
	SEED_TRANSLATIONS,
	SEED_VARIABLES,
	defaultBodyFor,
} from '../src/seeds';

describe('constants', () => {
	it('classifies system keys', () => {
		for (const k of SYSTEM_TEMPLATE_KEYS) expect(isSystemTemplateKey(k)).toBe(true);
		expect(isSystemTemplateKey('other')).toBe(false);
	});
	it('classifies protected keys including base and admin-error', () => {
		expect(isProtectedTemplateKey(ADMIN_ERROR_KEY)).toBe(true);
		expect(isProtectedTemplateKey(BASE_LAYOUT_KEY)).toBe(true);
		for (const k of PROTECTED_TEMPLATE_KEYS) expect(isProtectedTemplateKey(k)).toBe(true);
		expect(isProtectedTemplateKey('custom-thing')).toBe(false);
	});
	it('exposes known categories', () => {
		expect(TEMPLATE_CATEGORIES).toContain('layout');
		expect(TEMPLATE_CATEGORIES).toContain('system');
	});
});

describe('schema', () => {
	it('orders collections parents-first', () => {
		expect(ALL_COLLECTIONS[0]).toBe(LANGUAGES_COLLECTION_PAYLOAD);
		expect(ALL_COLLECTIONS[1]).toBe(EMAIL_TEMPLATES_COLLECTION);
		expect(ALL_COLLECTIONS[2]).toBe(EMAIL_TEMPLATE_TRANSLATIONS_COLLECTION);
		expect(ALL_COLLECTIONS).toContain(EMAIL_TEMPLATE_VARIABLES_COLLECTION);
		expect(ALL_COLLECTIONS).toContain(EMAIL_TEMPLATE_SYNC_AUDIT_COLLECTION);
	});
	it('languages collection has only `code` with system-language interface', () => {
		const fields = LANGUAGES_COLLECTION_PAYLOAD.fields;
		expect(fields.map((f) => f.field)).toEqual(['code']);
		const codeField = fields[0]!;
		expect((codeField.meta as any)?.interface).toBe('system-language');
		expect((codeField.schema as any)?.is_primary_key).toBe(true);
	});
	it('defines body + translations alias on email_templates', () => {
		const fields = EMAIL_TEMPLATES_COLLECTION.fields;
		expect(fields.some((f) => f.field === 'body' && f.type === 'text')).toBe(true);
		const alias = fields.find((f) => f.field === 'translations');
		expect(alias?.type).toBe('alias');
		expect((alias?.meta as any)?.interface).toBe('translations');
		expect((alias?.meta as any)?.special).toContain('translations');
	});
	it('defines relations for translations', () => {
		const names = ALL_RELATIONS.map((r) => `${r.collection}.${r.field}`);
		expect(names).toContain('email_template_translations.email_templates_id');
		expect(names).toContain('email_template_translations.languages_code');
		const cascade = ALL_RELATIONS.find((r) => r.field === 'email_templates_id');
		expect((cascade?.schema as any)?.on_delete).toBe('CASCADE');
		expect((cascade?.meta as any)?.one_field).toBe('translations');
	});
});

describe('seeds', () => {
	it('ships templates for every protected key', () => {
		const keys = SEED_TEMPLATES.map((t) => t.template_key).sort();
		expect(keys).toEqual(
			[
				'admin-error',
				'base',
				'password-reset',
				'user-invitation',
				'user-registration',
			].sort(),
		);
	});
	it('base is a layout', () => {
		const base = SEED_TEMPLATES.find((t) => t.template_key === 'base');
		expect(base?.category).toBe('layout');
	});
	it('ships only English (en-US) suggested translations — one per template', () => {
		const codes = new Set(SEED_TRANSLATIONS.map((t) => t.languages_code));
		expect([...codes]).toEqual(['en-US']);
		for (const t of SEED_TEMPLATES) {
			const found = SEED_TRANSLATIONS.find(
				(tr) => tr.template_key === t.template_key && tr.languages_code === 'en-US',
			);
			expect(found, `${t.template_key}/en-US`).toBeTruthy();
		}
	});
	it('exposes variable registry with required url/reason/context/timestamp', () => {
		const names = SEED_VARIABLES.map((v) => `${v.template_key}.${v.variable_name}`);
		expect(names).toContain('password-reset.url');
		expect(names).toContain('admin-error.reason');
		expect(names).toContain('admin-error.context');
		expect(names).toContain('admin-error.timestamp');
	});
	it('defaultBodyFor returns body or null', () => {
		expect(defaultBodyFor('base')).toContain('<html');
		expect(defaultBodyFor('password-reset')).toContain('{% layout');
		expect(defaultBodyFor('unknown-template')).toBeNull();
	});
});
