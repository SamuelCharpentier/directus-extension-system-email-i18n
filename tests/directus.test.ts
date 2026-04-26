import { describe, it, expect } from 'vitest';
import { makeServices, makeSchema } from './helpers';
import {
	fetchDefaultLang,
	fetchUserLang,
	fetchProjectName,
	fetchTemplateRow,
	fetchAllTemplateRows,
	fetchTranslationRow,
	fetchTemplateWithTranslation,
	fetchTemplateVariables,
	fetchAdminEmails,
	fetchRecipientUser,
} from '../src/directus';

describe('fetchDefaultLang', () => {
	it('returns full BCP-47 tag from settings (no region stripping)', async () => {
		const s = makeServices({
			settings: { readSingleton: async () => ({ default_language: 'fr-CA' }) },
		});
		expect(await fetchDefaultLang(s as any, makeSchema(), {})).toBe('fr-CA');
	});
	it('uses env fallback when settings unset', async () => {
		const s = makeServices({
			settings: { readSingleton: async () => ({ default_language: null }) },
		});
		expect(
			await fetchDefaultLang(s as any, makeSchema(), { I18N_EMAIL_FALLBACK_LANG: 'de-DE' }),
		).toBe('de-DE');
	});
	it('falls back to en-US when neither settings nor env supply a value', async () => {
		const s = makeServices({
			settings: { readSingleton: async () => ({ default_language: '' }) },
		});
		expect(await fetchDefaultLang(s as any, makeSchema(), {})).toBe('en-US');
	});
});

describe('fetchUserLang', () => {
	it('returns the full BCP-47 tag stored on the user', async () => {
		const s = makeServices({
			items: { directus_users: { rows: [{ email: 'a@b.co', language: 'fr-CA' }] } },
		});
		expect(await fetchUserLang('a@b.co', s as any, makeSchema())).toBe('fr-CA');
	});
	it('returns null when user missing', async () => {
		const s = makeServices({ items: { directus_users: { rows: [] } } });
		expect(await fetchUserLang('x@y.co', s as any, makeSchema())).toBeNull();
	});
	it('returns null when language empty', async () => {
		const s = makeServices({
			items: { directus_users: { rows: [{ email: 'a@b.co', language: '' }] } },
		});
		expect(await fetchUserLang('a@b.co', s as any, makeSchema())).toBeNull();
	});
});

describe('fetchProjectName', () => {
	it('returns name', async () => {
		const s = makeServices({
			settings: { readSingleton: async () => ({ project_name: 'Acme' }) },
		});
		expect(await fetchProjectName(s as any, makeSchema())).toBe('Acme');
	});
	it('returns null when missing', async () => {
		const s = makeServices({ settings: { readSingleton: async () => ({ project_name: '' }) } });
		expect(await fetchProjectName(s as any, makeSchema())).toBeNull();
	});
});

describe('fetchTemplateRow', () => {
	it('filters by key + active', async () => {
		const s = makeServices({
			items: {
				email_templates: {
					rows: [
						{ id: '1', template_key: 'x', is_active: true },
						{ id: '2', template_key: 'y', is_active: true },
					],
				},
			},
		});
		const r = await fetchTemplateRow('x', s as any, makeSchema());
		expect(r?.id).toBe('1');
		const missing = await fetchTemplateRow('zz', s as any, makeSchema());
		expect(missing).toBeNull();
	});
});

describe('fetchAllTemplateRows', () => {
	it('returns all rows', async () => {
		const s = makeServices({
			items: { email_templates: { rows: [{ id: '1' }, { id: '2' }] } },
		});
		expect((await fetchAllTemplateRows(s as any, makeSchema())).length).toBe(2);
	});
});

describe('fetchTranslationRow', () => {
	it('returns a translation for template+lang', async () => {
		const s = makeServices({
			items: {
				email_template_translations: {
					rows: [
						{ id: 't1', email_templates_id: '1', languages_code: 'en' },
						{ id: 't2', email_templates_id: '1', languages_code: 'fr' },
					],
				},
			},
		});
		const r = await fetchTranslationRow('1', 'fr', s as any, makeSchema());
		expect(r?.id).toBe('t2');
		const missing = await fetchTranslationRow('1', 'de', s as any, makeSchema());
		expect(missing).toBeNull();
	});
});

describe('fetchTemplateWithTranslation', () => {
	const build = () =>
		makeServices({
			items: {
				email_templates: {
					rows: [{ id: '1', template_key: 'x', is_active: true }],
				},
				email_template_translations: {
					rows: [{ id: 'ten', email_templates_id: '1', languages_code: 'en' }],
				},
			},
		});
	it('falls back to default lang', async () => {
		const s = build();
		const r = await fetchTemplateWithTranslation('x', 'fr', 'en', s as any, makeSchema());
		expect(r?.translation?.id).toBe('ten');
	});
	it('returns null when template missing', async () => {
		const s = build();
		const r = await fetchTemplateWithTranslation('zz', 'fr', 'en', s as any, makeSchema());
		expect(r).toBeNull();
	});
	it('returns {translation:null} when none found even with fallback', async () => {
		const s = makeServices({
			items: {
				email_templates: {
					rows: [{ id: '1', template_key: 'x', is_active: true }],
				},
				email_template_translations: { rows: [] },
			},
		});
		const r = await fetchTemplateWithTranslation('x', 'fr', 'en', s as any, makeSchema());
		expect(r?.translation).toBeNull();
	});
	it('returns direct translation without fallback when effective == default', async () => {
		const s = build();
		const r = await fetchTemplateWithTranslation('x', 'en', 'en', s as any, makeSchema());
		expect(r?.translation?.id).toBe('ten');
	});
	it('returns null translation if row has no id', async () => {
		const s = makeServices({
			items: {
				email_templates: { rows: [{ template_key: 'x', is_active: true }] },
			},
		});
		expect(
			await fetchTemplateWithTranslation('x', 'en', 'en', s as any, makeSchema()),
		).toBeNull();
	});
	it('falls through empty placeholder (subject empty + strings {}) to default-lang row', async () => {
		// effective lang has a row, but it's the empty-default placeholder shape.
		// Fallback chain must continue to the default-lang row.
		const s = makeServices({
			items: {
				email_templates: {
					rows: [{ id: '1', template_key: 'x', is_active: true }],
				},
				email_template_translations: {
					rows: [
						{
							id: 'empty-fr',
							email_templates_id: '1',
							languages_code: 'fr-FR',
							subject: '',
							from_name: null,
							strings: {},
						},
						{
							id: 'full-en',
							email_templates_id: '1',
							languages_code: 'en-US',
							subject: 'Hello',
							from_name: null,
							strings: { greeting: 'hi' },
						},
					],
				},
			},
		});
		const r = await fetchTemplateWithTranslation(
			'x',
			'fr-FR',
			'en-US',
			s as any,
			makeSchema(),
		);
		expect(r?.translation?.id).toBe('full-en');
	});
	it('keeps placeholder when effective lang IS default lang (no fallback target)', async () => {
		const s = makeServices({
			items: {
				email_templates: {
					rows: [{ id: '1', template_key: 'x', is_active: true }],
				},
				email_template_translations: {
					rows: [
						{
							id: 'empty-en',
							email_templates_id: '1',
							languages_code: 'en-US',
							subject: '',
							from_name: null,
							strings: {},
						},
					],
				},
			},
		});
		const r = await fetchTemplateWithTranslation(
			'x',
			'en-US',
			'en-US',
			s as any,
			makeSchema(),
		);
		expect(r?.translation?.id).toBe('empty-en');
	});
});

describe('fetchTemplateVariables', () => {
	it('filters by template_key', async () => {
		const s = makeServices({
			items: {
				email_template_variables: {
					rows: [
						{ template_key: 'x', variable_name: 'a', is_required: true },
						{ template_key: 'y', variable_name: 'b', is_required: true },
					],
				},
			},
		});
		const r = await fetchTemplateVariables('x', s as any, makeSchema());
		expect(r.length).toBe(1);
		expect(r[0]?.variable_name).toBe('a');
	});
});

describe('fetchAdminEmails', () => {
	it('returns emails of active admins, dropping non-admins and null emails', async () => {
		// No readByQuery override here — exercises the mock filter engine
		// end-to-end, including the nested role.admin_access._eq path that
		// excludes non-admin rows.
		const s = makeServices({
			items: {
				directus_users: {
					rows: [
						{ email: 'a@x.co', status: 'active', role: { admin_access: true } },
						{ email: 'b@x.co', status: 'active', role: { admin_access: false } },
						{ email: 'c@x.co', status: 'inactive', role: { admin_access: true } },
						{ email: null, status: 'active', role: { admin_access: true } },
						{ email: '', status: 'active', role: { admin_access: true } },
					],
				},
			},
		});
		const r = await fetchAdminEmails(s as any, makeSchema());
		expect(r).toEqual(['a@x.co']);
	});
});

describe('fetchRecipientUser', () => {
	it('returns user shape', async () => {
		const s = makeServices({
			items: {
				directus_users: {
					rows: [
						{
							id: 7,
							first_name: 'A',
							last_name: 'B',
							email: 'a@b.co',
							language: 'fr',
						},
					],
				},
			},
		});
		const u = await fetchRecipientUser('a@b.co', s as any, makeSchema());
		expect(u).toEqual({
			id: '7',
			first_name: 'A',
			last_name: 'B',
			email: 'a@b.co',
			language: 'fr',
		});
	});
	it('returns null when missing', async () => {
		const s = makeServices({ items: { directus_users: { rows: [] } } });
		expect(await fetchRecipientUser('x@y.co', s as any, makeSchema())).toBeNull();
	});
	it('coerces missing first/last/lang to null', async () => {
		const s = makeServices({
			items: {
				directus_users: { rows: [{ id: 1, email: 'a@b.co' }] },
			},
		});
		const u = await fetchRecipientUser('a@b.co', s as any, makeSchema());
		expect(u?.first_name).toBeNull();
		expect(u?.last_name).toBeNull();
		expect(u?.language).toBeNull();
	});
});
