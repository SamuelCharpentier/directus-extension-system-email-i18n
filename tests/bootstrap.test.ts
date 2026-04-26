import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeServices, makeLogger, makeSchema } from './helpers';
import { runBootstrap, __INTERNAL__ } from '../src/bootstrap';

describe('runBootstrap', () => {
	let dir: string;
	beforeEach(async () => {
		__INTERNAL__.reset();
		dir = await mkdtemp(join(tmpdir(), 'i18n-email-boot-'));
	});
	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	const getSchema = async () => makeSchema();

	it('creates collections, relations, seeds, flushes bodies', async () => {
		const s = makeServices();
		const logger = makeLogger();
		await runBootstrap(dir, s as any, getSchema, logger);
		// collections
		expect(s._collectionsCreated.length).toBeGreaterThanOrEqual(5);
		// relations
		expect(s._relationsCreated.length).toBe(2);
		// language seeded
		expect(s._stores.languages?.find((r: any) => r.code === 'en')).toBeTruthy();
		// templates seeded
		expect(s._stores.email_templates?.length).toBe(5);
		// translations seeded (5 templates × 2 langs)
		expect(s._stores.email_template_translations?.length).toBe(10);
		// variables seeded
		expect(s._stores.email_template_variables?.length).toBeGreaterThan(0);
		// bodies flushed
		const body = await readFile(join(dir, 'base.liquid'), 'utf-8');
		expect(body).toContain('<html');
	});

	it('prefers disk body over seed default when row missing', async () => {
		await mkdir(dir, { recursive: true });
		await writeFile(join(dir, 'base.liquid'), 'FROM_DISK', 'utf-8');
		const s = makeServices();
		const logger = makeLogger();
		await runBootstrap(dir, s as any, getSchema, logger);
		const baseRow = s._stores.email_templates?.find((r: any) => r.template_key === 'base');
		expect(baseRow.body).toBe('FROM_DISK');
	});

	it('does not overwrite existing DB row', async () => {
		const s = makeServices({
			items: {
				email_templates: {
					rows: [
						{
							id: 'pre',
							template_key: 'base',
							category: 'layout',
							body: 'EXISTING',
						},
					],
				},
			},
		});
		const logger = makeLogger();
		await runBootstrap(dir, s as any, getSchema, logger);
		const baseRow = s._stores.email_templates?.find((r: any) => r.template_key === 'base');
		expect(baseRow.body).toBe('EXISTING');
	});

	it('is idempotent on a second call', async () => {
		const s = makeServices();
		const logger = makeLogger();
		await runBootstrap(dir, s as any, getSchema, logger);
		const before = s._stores.email_templates?.length;
		await runBootstrap(dir, s as any, getSchema, logger);
		expect(s._stores.email_templates?.length).toBe(before);
	});

	it('concurrent calls coalesce', async () => {
		const s = makeServices();
		const logger = makeLogger();
		await Promise.all([
			runBootstrap(dir, s as any, getSchema, logger),
			runBootstrap(dir, s as any, getSchema, logger),
		]);
		expect(s._stores.email_templates?.length).toBe(5);
	});

	it('warns when RelationsService is missing', async () => {
		const s = makeServices();
		(s as any).RelationsService = undefined;
		const logger = makeLogger();
		await runBootstrap(dir, s as any, getSchema, logger);
		expect(logger.warn).toHaveBeenCalledWith(
			expect.stringContaining('RelationsService not available'),
		);
	});

	it('skips relation when readOne finds existing', async () => {
		const s = makeServices({
			relations: {
				readOne: async (c: string, f: string) => ({
					collection: c,
					field: f,
					schema: { on_delete: 'CASCADE' },
				}),
			},
		});
		const logger = makeLogger();
		await runBootstrap(dir, s as any, getSchema, logger);
		expect(s._relationsCreated.length).toBe(0);
	});

	it('logs warning when relation creation fails', async () => {
		const s = makeServices({
			relations: {
				readOne: async () => {
					throw new Error('nope');
				},
				createOne: async () => {
					throw new Error('duplicate');
				},
			},
		});
		const logger = makeLogger();
		await runBootstrap(dir, s as any, getSchema, logger);
		expect(logger.warn).toHaveBeenCalledWith(
			expect.stringContaining('Relation create skipped'),
		);
	});

	it('skips collection creation when exists', async () => {
		const s = makeServices({
			collections: {
				readOne: async () => ({ collection: 'x' }),
			},
		});
		const logger = makeLogger();
		await runBootstrap(dir, s as any, getSchema, logger);
		expect(s._collectionsCreated.length).toBe(0);
	});

	it('skips translation seed when parent missing', async () => {
		const s = makeServices();
		const logger = makeLogger();
		const originalItemsService = (s as any).ItemsService;
		(s as any).ItemsService = function (name: string, opts: any) {
			const svc = originalItemsService(name, opts);
			if (name === 'email_templates') {
				svc.createOne = async () => undefined as any;
			}
			return svc;
		};
		await runBootstrap(dir, s as any, getSchema, logger);
		expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('parent row missing'));
	});

	it('exposes inFlight getter while running and null after', async () => {
		const s = makeServices();
		const logger = makeLogger();
		const p = runBootstrap(dir, s as any, getSchema, logger);
		expect(__INTERNAL__.inFlight).toBeInstanceOf(Promise);
		await p;
		expect(__INTERNAL__.inFlight).toBeNull();
		expect(__INTERNAL__.ran).toBe(true);
	});

	it('logs error and does not throw when bootstrap pipeline explodes', async () => {
		const s = makeServices({
			collections: {
				readOne: async () => {
					throw new Error('no coll');
				},
				createOne: async () => {
					throw new Error('boom');
				},
			},
		});
		const logger = makeLogger();
		await runBootstrap(dir, s as any, getSchema, logger);
		expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Bootstrap failed'));
	});

	it('skips re-seeding languages that already exist', async () => {
		// Simulates a second boot: every seed language is already in the
		// store, so seedLanguages must NOT call createOne for any of them.
		const s = makeServices({
			items: {
				languages: {
					rows: [
						{ code: 'en', name: 'English', direction: 'ltr' },
						{ code: 'fr', name: 'Français', direction: 'ltr' },
					],
				},
			},
		});
		const logger = makeLogger();
		await runBootstrap(dir, s as any, getSchema, logger);
		// Still exactly the two we pre-seeded — no duplicates.
		expect(s._stores.languages?.length).toBe(2);
		expect(logger.info).not.toHaveBeenCalledWith(expect.stringContaining('Seeded language'));
	});

	it('skips re-seeding variables that already exist', async () => {
		// Pre-seed every SEED_VARIABLES row so the (template_key,
		// variable_name) lookup hits an existing record and createOne
		// is bypassed.
		const s = makeServices({
			items: {
				email_template_variables: {
					rows: [
						{ template_key: 'password-reset', variable_name: 'url' },
						{ template_key: 'user-invitation', variable_name: 'url' },
						{ template_key: 'user-registration', variable_name: 'url' },
						{ template_key: 'admin-error', variable_name: 'reason' },
						{ template_key: 'admin-error', variable_name: 'context' },
						{ template_key: 'admin-error', variable_name: 'timestamp' },
					],
				},
			},
		});
		const logger = makeLogger();
		await runBootstrap(dir, s as any, getSchema, logger);
		// No new variable rows added.
		expect(s._stores.email_template_variables?.length).toBe(6);
		expect(logger.info).not.toHaveBeenCalledWith(expect.stringContaining('Seeded variable'));
	});

	it('skips re-seeding translations that already exist', async () => {
		// Pre-seed a template row with a known id, plus a translation
		// row matching one of the SEED_TRANSLATIONS entries. seedTemplates
		// will reuse the existing template (parent.id === 't-base'), and
		// seedTranslations' (email_templates_id, languages_code) lookup
		// must hit the existing row — exercising the skip-when-exists
		// continue branch — instead of creating a duplicate.
		const s = makeServices({
			items: {
				email_templates: {
					rows: [{ id: 't-base', template_key: 'base' }],
				},
				email_template_translations: {
					rows: [
						{
							id: 'tr-base-fr',
							email_templates_id: 't-base',
							languages_code: 'fr',
							subject: '',
							from_name: 'pre-seeded',
							strings: { footer_note: 'pre-seeded' },
						},
					],
				},
			},
		});
		const logger = makeLogger();
		await runBootstrap(dir, s as any, getSchema, logger);
		// The existing 'base/fr' translation must be untouched (still 1 row
		// with that pair) and no 'Seeded translation base/fr' info was logged.
		const baseFrRows = s._stores.email_template_translations!.filter(
			(r: any) => r.email_templates_id === 't-base' && r.languages_code === 'fr',
		);
		expect(baseFrRows.length).toBe(1);
		expect(baseFrRows[0]!.from_name).toBe('pre-seeded');
		expect(logger.info).not.toHaveBeenCalledWith(
			expect.stringContaining('Seeded translation base/fr'),
		);
		// Other translations are still seeded normally.
		expect(logger.info).toHaveBeenCalledWith(
			expect.stringContaining('Seeded translation base/en'),
		);
	});

	describe('field migration', () => {
		it('upserts meta on existing fields without recreating them', async () => {
			const s = makeServices({
				collections: {
					readOne: async () => ({ collection: 'x' }),
				},
				fields: {
					readOne: async () => ({ field: 'translations' }),
				},
			});
			const logger = makeLogger();
			await runBootstrap(dir, s as any, getSchema, logger);
			expect(s._fieldsCreated.length).toBe(0);
			expect(s._fieldsUpdated.length).toBeGreaterThan(0);
			const translationsUpdate = s._fieldsUpdated.find(
				(u: any) => u.collection === 'email_templates' && u.field.field === 'translations',
			);
			expect(translationsUpdate).toBeTruthy();
			expect(translationsUpdate.field.meta.options.languageField).toBe('name');
		});

		it('creates missing fields on existing collections', async () => {
			const s = makeServices({
				collections: {
					readOne: async () => ({ collection: 'x' }),
				},
				fields: {
					readOne: async () => {
						throw new Error('not found');
					},
				},
			});
			const logger = makeLogger();
			await runBootstrap(dir, s as any, getSchema, logger);
			expect(s._fieldsCreated.length).toBeGreaterThan(0);
			const tField = s._fieldsCreated.find(
				(c: any) => c.collection === 'email_templates' && c.field.field === 'translations',
			);
			expect(tField).toBeTruthy();
		});

		it('warns when FieldsService is missing', async () => {
			const s = makeServices({
				collections: { readOne: async () => ({ collection: 'x' }) },
			});
			(s as any).FieldsService = undefined;
			const logger = makeLogger();
			await runBootstrap(dir, s as any, getSchema, logger);
			expect(logger.warn).toHaveBeenCalledWith(
				expect.stringContaining('FieldsService not available'),
			);
		});

		it('logs and continues when field migration throws per-field', async () => {
			const s = makeServices({
				collections: { readOne: async () => ({ collection: 'x' }) },
				fields: {
					readOne: async () => ({ field: 'x' }),
					updateField: async () => {
						throw new Error('nope');
					},
				},
			});
			const logger = makeLogger();
			await runBootstrap(dir, s as any, getSchema, logger);
			expect(logger.warn).toHaveBeenCalledWith(
				expect.stringContaining('Field migrate skipped'),
			);
		});

		it('warns when an alias field exists as a real DB column', async () => {
			// Legacy schema: an older extension version registered
			// `translations` as a real text column. Don't try to alter the
			// column — surface a clear operator warning and move on.
			const s = makeServices({
				collections: { readOne: async () => ({ collection: 'x' }) },
				fields: {
					readOne: async (_c: string, f: string) =>
						f === 'translations'
							? { field: 'translations', type: 'text' }
							: { field: f, type: 'string' },
				},
			});
			const logger = makeLogger();
			await runBootstrap(dir, s as any, getSchema, logger);
			expect(logger.warn).toHaveBeenCalledWith(
				expect.stringContaining(
					'email_templates.translations is declared as alias but a real "text" column exists',
				),
			);
			// updateField MUST NOT fire for the conflicting alias field.
			const aliasUpdate = s._fieldsUpdated.find((u: any) => u.field.field === 'translations');
			expect(aliasUpdate).toBeUndefined();
		});
	});

	describe('relation migration', () => {
		// Healthy existing relation: schema includes the expected on_delete
		// AND meta is intentionally drifted (empty object) so the
		// metaMatches short-circuit lets the updateOne path fire.
		const healthyReadOne = async (c: string, f: string) => ({
			collection: c,
			field: f,
			schema: { on_delete: 'CASCADE' },
			meta: {},
		});

		it('upserts meta on existing relations with junction_field cross-refs', async () => {
			const s = makeServices({
				relations: { readOne: healthyReadOne },
			});
			const logger = makeLogger();
			await runBootstrap(dir, s as any, getSchema, logger);
			expect(s._relationsCreated.length).toBe(0);
			expect(s._relationsUpdated.length).toBe(2);
			const fwd = s._relationsUpdated.find((u: any) => u.field === 'email_templates_id');
			expect(fwd).toBeTruthy();
			expect(fwd.data.collection).toBe('email_template_translations');
			expect(fwd.data.related_collection).toBe('email_templates');
			expect(fwd.data.meta.junction_field).toBe('languages_code');
			const rev = s._relationsUpdated.find((u: any) => u.field === 'languages_code');
			expect(rev).toBeTruthy();
			expect(rev.data.related_collection).toBe('languages');
			expect(rev.data.meta.junction_field).toBe('email_templates_id');
		});

		it('skips updateOne when existing relation meta already matches', async () => {
			// Meta already carries the expected cross-refs → no need to
			// touch the FK; updateOne MUST NOT be called (avoids triggering
			// Directus's alterType crash on a steady-state boot).
			const s = makeServices({
				relations: {
					readOne: async (c: string, f: string) => ({
						collection: c,
						field: f,
						schema: { on_delete: 'CASCADE' },
						meta:
							f === 'email_templates_id'
								? {
										one_field: 'translations',
										junction_field: 'languages_code',
										sort_field: null,
										one_deselect_action: 'delete',
									}
								: {
										junction_field: 'email_templates_id',
										sort_field: null,
									},
					}),
				},
			});
			const logger = makeLogger();
			await runBootstrap(dir, s as any, getSchema, logger);
			expect(s._relationsUpdated.length).toBe(0);
			expect(s._relationsCreated.length).toBe(0);
		});

		it('skips migration for relations that do not yet exist', async () => {
			const s = makeServices();
			const logger = makeLogger();
			await runBootstrap(dir, s as any, getSchema, logger);
			// fresh bootstrap: relations were just created, so no migration updates
			expect(s._relationsUpdated.length).toBe(0);
		});

		it('logs and continues when relation migration throws per-relation', async () => {
			const s = makeServices({
				relations: {
					readOne: healthyReadOne,
					updateOne: async () => {
						throw new Error('nope');
					},
				},
			});
			const logger = makeLogger();
			await runBootstrap(dir, s as any, getSchema, logger);
			expect(logger.warn).toHaveBeenCalledWith(
				expect.stringContaining('Relation migrate skipped'),
			);
		});

		it('warns when RelationsService.updateOne is unavailable', async () => {
			const s = makeServices({
				relations: { readOne: healthyReadOne },
			});
			const originalRelations = (s as any).RelationsService;
			(s as any).RelationsService = function (opts: any) {
				const inst = originalRelations(opts);
				delete inst.updateOne;
				return inst;
			};
			const logger = makeLogger();
			await runBootstrap(dir, s as any, getSchema, logger);
			expect(logger.warn).toHaveBeenCalledWith(
				expect.stringContaining('updateOne not available'),
			);
		});

		it('rebuilds relations whose DB foreign key was never installed', async () => {
			// Stale directus_relations row with no FK schema: warn the
			// operator instead of attempting a brittle delete+recreate.
			const s = makeServices({
				relations: {
					readOne: async (c: string, f: string) => ({
						collection: c,
						field: f,
						schema: null,
						meta: {},
					}),
				},
			});
			const logger = makeLogger();
			await runBootstrap(dir, s as any, getSchema, logger);
			expect(s._relationsCreated.length).toBe(0);
			expect(s._relationsUpdated.length).toBe(0);
			expect(logger.warn).toHaveBeenCalledWith(
				expect.stringContaining('stale directus_relations row'),
			);
		});

		it('rebuilds relations whose on_delete drifted from the expected value', async () => {
			const s = makeServices({
				relations: {
					readOne: async (c: string, f: string) => ({
						collection: c,
						field: f,
						schema: { on_delete: 'NO ACTION' },
						meta: {},
					}),
				},
			});
			const logger = makeLogger();
			await runBootstrap(dir, s as any, getSchema, logger);
			expect(s._relationsCreated.length).toBe(0);
			expect(logger.warn).toHaveBeenCalledWith(
				expect.stringContaining('stale directus_relations row'),
			);
		});
	});
});
