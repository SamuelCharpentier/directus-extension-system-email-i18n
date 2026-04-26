import { describe, it, expect, beforeEach } from 'vitest';
import { makeServices, makeLogger, makeSchema } from './helpers';
import { runSendFilter } from '../src/send';

const mkInput = (overrides: any = {}) => ({
	to: 'user@x.co',
	subject: 'orig',
	template: { name: 'password-reset', data: { url: 'https://x' } },
	...overrides,
});

const buildServices = (
	opts: { withUser?: boolean; vars?: any[]; templates?: any[]; translations?: any[] } = {},
) =>
	makeServices({
		settings: {
			readSingleton: async () => ({ default_language: 'en', project_name: 'Acme' }),
		},
		items: {
			directus_users: {
				rows: opts.withUser
					? [
							{
								id: 'u1',
								first_name: 'Al',
								last_name: 'B',
								email: 'user@x.co',
								language: 'fr',
							},
						]
					: [],
			},
			email_templates: {
				rows: opts.templates ?? [
					{ id: 'tp', template_key: 'password-reset', is_active: true },
					{ id: 'tb', template_key: 'base', is_active: true },
				],
			},
			email_template_translations: {
				rows: opts.translations ?? [
					{
						id: 'pfr',
						email_templates_id: 'tp',
						languages_code: 'fr',
						subject: 'Réinit',
						from_name: 'Mon Org',
						strings: { heading: 'Salut' },
					},
					{
						id: 'pen',
						email_templates_id: 'tp',
						languages_code: 'en',
						subject: 'Reset',
						from_name: null,
						strings: { heading: 'Hi' },
					},
					{
						id: 'bfr',
						email_templates_id: 'tb',
						languages_code: 'fr',
						subject: '',
						from_name: null,
						strings: { footer_note: 'au revoir' },
					},
				],
			},
			email_template_variables: {
				rows: opts.vars ?? [
					{ template_key: 'password-reset', variable_name: 'url', is_required: true },
				],
			},
		},
	});

describe('runSendFilter', () => {
	let logger: ReturnType<typeof makeLogger>;
	beforeEach(() => {
		logger = makeLogger();
	});

	const deps = (s: any) => ({
		services: s,
		getSchema: async () => makeSchema(),
		logger,
		env: { EMAIL_FROM: 'no-reply@x.co' },
	});

	it('applies translation and base strings with user language', async () => {
		const s = buildServices({ withUser: true });
		const input = mkInput();
		await runSendFilter(input as any, deps(s));
		expect(input.subject).toBe('Réinit');
		expect(input.template.data.i18n).toEqual({
			heading: 'Salut',
			base: { footer_note: 'au revoir' },
		});
		expect(input.template.data.user).toMatchObject({ email: 'user@x.co' });
	});

	it('falls back to default lang when user lang translation missing', async () => {
		const s = buildServices({
			withUser: true,
			translations: [
				{
					id: 'pen',
					email_templates_id: 'tp',
					languages_code: 'en',
					subject: 'Reset',
					from_name: null,
					strings: { heading: 'Hi' },
				},
			],
		});
		const input = mkInput();
		await runSendFilter(input as any, deps(s));
		expect(input.subject).toBe('Reset');
	});

	it('passes through when template name missing', async () => {
		const s = buildServices();
		const input: any = { to: 'a@b.co' };
		const out = await runSendFilter(input, deps(s));
		expect(out).toBe(input);
	});

	it('passes through admin-error template', async () => {
		const s = buildServices();
		const input: any = mkInput({ template: { name: 'admin-error', data: {} } });
		const out = await runSendFilter(input, deps(s));
		expect(out).toBe(input);
	});

	it('passes through unknown template name', async () => {
		const s = buildServices();
		const input = mkInput({ template: { name: 'totally-unknown', data: {} } });
		await runSendFilter(input as any, deps(s));
		expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('No DB template'));
	});

	it('throws on missing required variable and notifies admins', async () => {
		const s = buildServices({ withUser: false });
		// plant admin
		s._stores.directus_users = [{ email: 'admin@x.co' }];
		const input = mkInput({ template: { name: 'password-reset', data: {} } });
		await expect(runSendFilter(input as any, deps(s))).rejects.toThrow(/Missing required/);
	});

	it('skips user hydration for non-system templates', async () => {
		const s = buildServices({
			withUser: true,
			templates: [
				{ id: 'cu', template_key: 'custom-x', is_active: true },
				{ id: 'tb', template_key: 'base', is_active: true },
			],
			translations: [
				{
					id: 'cuen',
					email_templates_id: 'cu',
					languages_code: 'en',
					subject: 'Sub',
					from_name: null,
					strings: {},
				},
			],
			vars: [],
		});
		const input = mkInput({ template: { name: 'custom-x', data: {} } });
		await runSendFilter(input as any, deps(s));
		expect(input.template.data.user).toBeUndefined();
	});

	it('skips user hydration when data.user already set', async () => {
		const s = buildServices({ withUser: true });
		const input = mkInput({
			template: {
				name: 'password-reset',
				data: { url: 'https://x', user: { id: 'preset' } },
			},
		});
		await runSendFilter(input as any, deps(s));
		expect(input.template.data.user).toEqual({ id: 'preset' });
	});

	it('hydration no-op when recipient not a known user', async () => {
		const s = buildServices({ withUser: false });
		const input = mkInput();
		await runSendFilter(input as any, deps(s));
		expect(input.template.data.user).toBeUndefined();
	});

	it('logs and passes through when pipeline throws', async () => {
		const s = buildServices();
		// make readSingleton blow up
		(s.SettingsService as any) = function () {
			return {
				readSingleton: async () => {
					throw new Error('settings down');
				},
			};
		};
		const input = mkInput();
		await runSendFilter(input as any, deps(s));
		expect(logger.error).toHaveBeenCalledWith(
			expect.stringContaining('Failed to apply translations'),
		);
	});

	it('uses env fallback from name when provided', async () => {
		const s = buildServices({
			translations: [
				{
					id: 'pen',
					email_templates_id: 'tp',
					languages_code: 'en',
					subject: 'Reset',
					from_name: null,
					strings: {},
				},
			],
		});
		const input = mkInput();
		await runSendFilter(input as any, {
			services: s as any,
			getSchema: async () => makeSchema(),
			logger,
			env: { EMAIL_FROM: 'raw@x.co', I18N_EMAIL_FALLBACK_FROM_NAME: 'EnvName' },
		});
		expect((input as any).from).toEqual({ name: 'EnvName', address: 'raw@x.co' });
	});

	it('handles input with no "to" (unable to extract recipient)', async () => {
		const s = buildServices();
		const input = { template: { name: 'password-reset', data: { url: 'https://x' } } } as any;
		await runSendFilter(input, deps(s));
		expect(input.template.data.i18n).toBeTruthy();
	});

	it('handles template without a data object', async () => {
		const s = buildServices({ vars: [] });
		const input = { to: 'a@b.co', template: { name: 'password-reset' } } as any;
		await runSendFilter(input, deps(s));
		expect(input.template.data.i18n).toBeTruthy();
	});

	it('omits from field when EMAIL_FROM env missing', async () => {
		const s = buildServices({ vars: [] });
		const input = mkInput({ template: { name: 'password-reset', data: {} } });
		await runSendFilter(input as any, {
			services: s as any,
			getSchema: async () => makeSchema(),
			logger,
			env: {}, // no EMAIL_FROM
		});
		expect((input as any).from).toBeUndefined();
	});

	it('notifies admins fully (args block) when missing required', async () => {
		const s = buildServices({ withUser: false });
		s._stores.directus_users = [
			{ email: 'admin@x.co', status: 'active', role: { admin_access: true } },
		];
		const input = mkInput({ template: { name: 'password-reset', data: {} } });
		const run = runSendFilter(input as any, deps(s));
		await expect(run).rejects.toThrow(/Missing required/);
		// Flush microtasks so the fire-and-forget notifyAdmins resolves.
		await new Promise((r) => setTimeout(r, 0));
		expect(s._mailSends.length).toBeGreaterThan(0);
	});

	it('notifies admins when required var missing AND translation absent', async () => {
		const s = buildServices({
			withUser: false,
			translations: [], // no translation rows at all
		});
		s._stores.directus_users = [
			{ email: 'admin@x.co', status: 'active', role: { admin_access: true } },
		];
		const input = mkInput({ template: { name: 'password-reset', data: {} } });
		await expect(runSendFilter(input as any, deps(s))).rejects.toThrow(/Missing required/);
		await new Promise((r) => setTimeout(r, 0));
		expect(s._mailSends.length).toBeGreaterThan(0);
	});

	it('falls back to effectiveLang for baseLang when no translation row exists', async () => {
		// Template exists but has zero translation rows in any language.
		// Validation passes (no required vars), so we proceed to line 89
		// where `translation` is null → `baseLang` must fall through to
		// `effectiveLang`. We assert that by giving `base` a translation
		// only in the user's language (`fr`) and confirming `i18n.base.*`
		// is populated from that row.
		const s = buildServices({
			withUser: true,
			vars: [], // no required variables
			translations: [
				{
					id: 'bfr',
					email_templates_id: 'tb',
					languages_code: 'fr',
					subject: '',
					from_name: null,
					strings: { footer_note: 'au revoir' },
				},
			],
		});
		const input = mkInput();
		await runSendFilter(input as any, deps(s));
		// translation was null → subject untouched
		expect(input.subject).toBe('orig');
		// baseLang resolved via the fallback, so base strings still load
		expect(input.template.data.i18n).toMatchObject({
			base: { footer_note: 'au revoir' },
		});
	});

	it('pre-renders Liquid tokens inside translation strings, subject, and from_name', async () => {
		// Translator put `{{ user.first_name }}` directly inside the
		// translated value because word order varies by language. The
		// pre-render pass should resolve it before Directus's body render
		// outputs `{{ i18n.heading }}` verbatim.
		const s = buildServices({
			withUser: true,
			vars: [],
			translations: [
				{
					id: 'pfr',
					email_templates_id: 'tp',
					languages_code: 'fr',
					subject: 'Bonjour {{ user.first_name }}',
					from_name: 'Org de {{ user.first_name }}',
					strings: {
						heading: 'Salut {{ user.first_name }}',
						body: 'Lien : {{ url }}',
					},
				},
				{
					id: 'bfr',
					email_templates_id: 'tb',
					languages_code: 'fr',
					subject: '',
					from_name: null,
					strings: { footer_note: 'À bientôt {{ user.first_name }}' },
				},
			],
		});
		const input = mkInput();
		await runSendFilter(input as any, deps(s));
		expect(input.subject).toBe('Bonjour Al');
		expect((input as any).from).toEqual({ name: 'Org de Al', address: 'no-reply@x.co' });
		expect(input.template.data.i18n).toEqual({
			heading: 'Salut Al',
			body: 'Lien : https://x',
			base: { footer_note: 'À bientôt Al' },
		});
	});

	it('warns and falls back to raw value when a translation has invalid Liquid', async () => {
		const s = buildServices({
			withUser: true,
			vars: [],
			translations: [
				{
					id: 'pfr',
					email_templates_id: 'tp',
					languages_code: 'fr',
					subject: 'OK',
					from_name: null,
					strings: { heading: '{% bogus %}' },
				},
			],
		});
		const input = mkInput();
		await runSendFilter(input as any, deps(s));
		expect(input.template.data.i18n.heading).toBe('{% bogus %}');
		expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Liquid render failed'));
	});
});
