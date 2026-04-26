import type { ExtensionsServices, SchemaOverview } from '@directus/types';
import type { EmailTemplateRow, Logger } from './types';
import {
	LANGUAGES_COLLECTION,
	PROTECTED_TEMPLATE_KEYS,
	TEMPLATES_COLLECTION,
	TRANSLATIONS_COLLECTION,
	VARIABLES_COLLECTION,
} from './constants';
import { ALL_COLLECTIONS, ALL_RELATIONS } from './schema';
import { SEED_LANGUAGES, SEED_TEMPLATES, SEED_TRANSLATIONS, SEED_VARIABLES } from './seeds';
import { computeChecksum } from './integrity';
import { readTemplateFromDisk, syncTemplateBody } from './sync';

let bootstrapRan = false;
let bootstrapInFlight: Promise<void> | null = null;

function isProtectedKey(key: string): boolean {
	return (PROTECTED_TEMPLATE_KEYS as readonly string[]).includes(key);
}

async function collectionExists(
	collection: string,
	services: ExtensionsServices,
	schema: SchemaOverview,
): Promise<boolean> {
	try {
		const collectionsService = new services.CollectionsService({
			schema,
			accountability: null,
		});
		await collectionsService.readOne(collection);
		return true;
	} catch {
		return false;
	}
}

async function createCollectionIfMissing(
	payload: (typeof ALL_COLLECTIONS)[number],
	services: ExtensionsServices,
	schema: SchemaOverview,
	logger: Pick<Logger, 'info'>,
): Promise<void> {
	if (await collectionExists(payload.collection, services, schema)) return;
	const collectionsService = new services.CollectionsService({ schema, accountability: null });
	await collectionsService.createOne(payload as any);
	logger.info(`[i18n-email] Created collection ${payload.collection}.`);
}

/**
 * Graceful field migration for an EXISTING collection:
 *  - Adds any field defined in the payload that is missing on the DB.
 *  - Upserts `meta` (interface, options, display, notes, etc.) on every
 *    field in the payload so future schema tweaks ship automatically.
 *
 * Never alters column types or drops fields — those need an explicit
 * migration. Failures per-field are logged and do not abort bootstrap.
 */
async function migrateCollectionFields(
	payload: (typeof ALL_COLLECTIONS)[number],
	services: ExtensionsServices,
	schema: SchemaOverview,
	logger: Pick<Logger, 'info' | 'warn'>,
): Promise<void> {
	const FieldsService = (services as any).FieldsService;
	if (typeof FieldsService !== 'function') {
		logger.warn('[i18n-email] FieldsService not available — skipping field migration.');
		return;
	}
	if (!(await collectionExists(payload.collection, services, schema))) return;
	const fields = new FieldsService({ schema, accountability: null });
	for (const field of payload.fields) {
		let current: any;
		try {
			current = await fields.readOne(payload.collection, field.field);
		} catch {
			current = null;
		}
		const exists = !!current;

		// Guard against legacy schema: an older version of this extension
		// may have registered an alias field (e.g. `translations`) as a
		// real DB column. We never alter column types, so just warn the
		// operator — they need to drop the stray column manually before
		// queries against this collection will work.
		if (
			exists &&
			field.type === 'alias' &&
			current?.type &&
			current.type !== 'alias'
		) {
			logger.warn(
				`[i18n-email] Field ${payload.collection}.${field.field} is declared as alias but a real "${current.type}" column exists in the DB. Drop the column manually (e.g. via SQL) so this extension can register the o2m alias.`,
			);
			continue;
		}

		try {
			if (!exists) {
				await fields.createField(payload.collection, field);
				logger.info(`[i18n-email] Added field ${payload.collection}.${field.field}.`);
			} else if (field.meta) {
				// Upsert meta only — never alter the underlying column.
				await fields.updateField(payload.collection, {
					field: field.field,
					meta: field.meta,
				});
			}
		} catch (err) {
			logger.warn(
				`[i18n-email] Field migrate skipped for ${payload.collection}.${field.field}: ${(err as Error).message}`,
			);
		}
	}
}

async function createRelationsIfMissing(
	services: ExtensionsServices,
	schema: SchemaOverview,
	logger: Pick<Logger, 'info' | 'warn'>,
): Promise<void> {
	// RelationsService is available on `services`. Some older Directus
	// versions (or stripped test mocks) may not expose it — non-fatal.
	const RelationsService = (services as any).RelationsService;
	if (typeof RelationsService !== 'function') {
		logger.warn('[i18n-email] RelationsService not available — skipping relation creation.');
		return;
	}
	const svc = new RelationsService({ schema, accountability: null });
	for (const rel of ALL_RELATIONS) {
		try {
			const existing = await svc.readOne(rel.collection, rel.field);
			if (existing) continue;
		} catch {
			// readOne throws when the relation doesn't exist — fall through to create.
		}
		try {
			await svc.createOne(rel);
			logger.info(
				`[i18n-email] Created relation ${rel.collection}.${rel.field} → ${rel.related_collection}.`,
			);
		} catch (err) {
			logger.warn(
				`[i18n-email] Relation create skipped for ${rel.collection}.${rel.field}: ${(err as Error).message}`,
			);
		}
	}
}

/**
 * Graceful relation migration for EXISTING relations:
 *  - Walks `ALL_RELATIONS` and, for each one already present in the DB,
 *    upserts its `meta` (e.g. `junction_field`, `one_field`,
 *    `one_deselect_action`) so future schema tweaks ship automatically.
 *  - Detects relations registered without an underlying DB foreign-key
 *    constraint (`schema === null`) or with the wrong `on_delete`
 *    behaviour, and rebuilds them via DELETE + recreate so referential
 *    integrity is enforced (e.g. cascade-deleting translation rows when
 *    a parent template or language is removed).
 *  - Skips missing relations entirely — `createRelationsIfMissing`
 *    handles those.
 *  - Failures per-relation are logged and do not abort bootstrap.
 *
 * Critical for upgrades from earlier extension versions that shipped
 * the translations junction without `junction_field` cross-refs (caused
 * the translations interface to fail to render) or without DB-level FK
 * constraints (allowed orphan rows when a related row was deleted).
 */
async function migrateRelationsMeta(
	services: ExtensionsServices,
	schema: SchemaOverview,
	logger: Pick<Logger, 'info' | 'warn'>,
): Promise<void> {
	const RelationsService = (services as any).RelationsService;
	if (typeof RelationsService !== 'function') {
		logger.warn('[i18n-email] RelationsService not available — skipping relation migration.');
		return;
	}
	const svc = new RelationsService({ schema, accountability: null });
	for (const rel of ALL_RELATIONS) {
		let existing: any;
		try {
			existing = await svc.readOne(rel.collection, rel.field);
		} catch {
			existing = null;
		}
		if (!existing) continue;

		// Detect a stale `directus_relations` row whose underlying DB-level
		// FK is missing or has the wrong on_delete. We do NOT try to
		// auto-rebuild — Directus's RelationsService.deleteOne does not
		// always synchronously drop the FK constraint, so a follow-up
		// createOne reliably trips "Field already has an associated
		// relationship". Instead, log a clear operator warning. The fix is
		// a one-time manual `DELETE FROM directus_relations WHERE …` and a
		// restart, after which createRelationsIfMissing installs the
		// relation cleanly with the correct schema.
		const expectedOnDelete = (rel.schema as any)?.on_delete;
		const actualSchema = existing.schema;
		const fkBroken =
			!!expectedOnDelete &&
			(actualSchema === null ||
				typeof actualSchema !== 'object' ||
				actualSchema.on_delete !== expectedOnDelete);
		if (fkBroken) {
			logger.warn(
				`[i18n-email] Relation ${rel.collection}.${rel.field} has a stale directus_relations row (expected on_delete=${expectedOnDelete}, found ${JSON.stringify(actualSchema)}). Delete the row manually and restart so the FK can be re-created with cascade behaviour.`,
			);
			continue;
		}

		// Skip the updateOne call entirely when the existing meta already
		// matches what we want. Directus's RelationsService.updateOne
		// unconditionally drops + re-adds the underlying FK constraint and
		// routes through alterType(), which is brittle (it reads
		// `relation.collection` / `relation.related_collection` against an
		// in-memory schema snapshot and throws an unhandledRejection inside
		// the knex transaction if any lookup misses). Avoiding the call on
		// a fresh boot — where we just createOne'd the relation with the
		// correct meta — sidesteps the crash entirely while still allowing
		// drifted deployments to be patched on subsequent boots.
		const metaMatches = (() => {
			const cur = existing.meta;
			if (!cur || typeof cur !== 'object') return false;
			for (const [k, v] of Object.entries(rel.meta)) {
				if ((cur as any)[k] !== v) return false;
			}
			return true;
		})();
		if (metaMatches) continue;

		if (typeof svc.updateOne !== 'function') {
			logger.warn(
				'[i18n-email] RelationsService.updateOne not available — skipping relation migration.',
			);
			return;
		}
		try {
			// Pass the full relation payload so Directus's alterType() can
			// dereference `collection` / `related_collection` against the
			// schema snapshot. Omitting these fields surfaces as
			// "Cannot read properties of undefined (reading 'fields')"
			// from inside the knex alterTable callback.
			await svc.updateOne(rel.collection, rel.field, {
				collection: rel.collection,
				field: rel.field,
				related_collection: rel.related_collection,
				meta: rel.meta,
				schema: rel.schema,
			});
		} catch (err) {
			logger.warn(
				`[i18n-email] Relation migrate skipped for ${rel.collection}.${rel.field}: ${(err as Error).message}`,
			);
		}
	}
}

async function seedLanguages(
	services: ExtensionsServices,
	schema: SchemaOverview,
	logger: Pick<Logger, 'info'>,
): Promise<void> {
	const items = new services.ItemsService(LANGUAGES_COLLECTION, {
		schema,
		accountability: null,
	});
	for (const lang of SEED_LANGUAGES) {
		const existing = await items.readByQuery({
			filter: { code: { _eq: lang.code } },
			limit: 1,
		});
		if (existing.length > 0) continue;
		await items.createOne(lang);
		logger.info(`[i18n-email] Seeded language ${lang.code}.`);
	}
}

/**
 * Seed template rows. If a `.liquid` file exists on disk for a
 * given template_key AND no DB row exists yet, the disk body takes
 * precedence over the shipped default. Never overwrites existing
 * DB rows.
 */
async function seedTemplates(
	templatesPath: string,
	services: ExtensionsServices,
	schema: SchemaOverview,
	logger: Pick<Logger, 'info'>,
): Promise<EmailTemplateRow[]> {
	const items = new services.ItemsService(TEMPLATES_COLLECTION, {
		schema,
		accountability: null,
	});
	const insertedOrExisting: EmailTemplateRow[] = [];
	for (const seed of SEED_TEMPLATES) {
		const existing = await items.readByQuery({
			filter: { template_key: { _eq: seed.template_key } },
			limit: 1,
		});
		if (existing.length > 0) {
			insertedOrExisting.push(existing[0] as EmailTemplateRow);
			continue;
		}
		const diskBody = await readTemplateFromDisk(templatesPath, seed.template_key);
		const body = diskBody ?? seed.body;
		const checksum = computeChecksum({ body });
		const id = await items.createOne({
			template_key: seed.template_key,
			category: seed.category,
			body,
			description: seed.description,
			is_active: true,
			is_protected: isProtectedKey(seed.template_key),
			checksum,
			last_synced_at: null,
		});
		logger.info(
			`[i18n-email] Seeded template ${seed.template_key}${diskBody ? ' (from existing disk file)' : ''}.`,
		);
		insertedOrExisting.push({
			...(id ? { id: String(id) } : {}),
			template_key: seed.template_key,
			category: seed.category,
			body,
			description: seed.description,
			is_active: true,
			is_protected: isProtectedKey(seed.template_key),
			checksum,
			last_synced_at: null,
		});
	}
	return insertedOrExisting;
}

async function seedTranslations(
	templateRows: EmailTemplateRow[],
	services: ExtensionsServices,
	schema: SchemaOverview,
	logger: Pick<Logger, 'info' | 'warn'>,
): Promise<void> {
	const items = new services.ItemsService(TRANSLATIONS_COLLECTION, {
		schema,
		accountability: null,
	});
	const byKey = new Map(templateRows.map((r) => [r.template_key, r]));
	for (const seed of SEED_TRANSLATIONS) {
		const parent = byKey.get(seed.template_key);
		if (!parent || !parent.id) {
			logger.warn(
				`[i18n-email] Skipping translation seed for ${seed.template_key}/${seed.languages_code}: parent row missing.`,
			);
			continue;
		}
		const existing = await items.readByQuery({
			filter: {
				email_templates_id: { _eq: parent.id },
				languages_code: { _eq: seed.languages_code },
			},
			limit: 1,
		});
		if (existing.length > 0) continue;
		await items.createOne({
			email_templates_id: parent.id,
			languages_code: seed.languages_code,
			subject: seed.subject,
			from_name: seed.from_name,
			strings: seed.strings,
		});
		logger.info(`[i18n-email] Seeded translation ${seed.template_key}/${seed.languages_code}.`);
	}
}

async function seedVariables(
	services: ExtensionsServices,
	schema: SchemaOverview,
	logger: Pick<Logger, 'info'>,
): Promise<void> {
	const items = new services.ItemsService(VARIABLES_COLLECTION, {
		schema,
		accountability: null,
	});
	for (const seed of SEED_VARIABLES) {
		const existing = await items.readByQuery({
			filter: {
				template_key: { _eq: seed.template_key },
				variable_name: { _eq: seed.variable_name },
			},
			limit: 1,
		});
		if (existing.length > 0) continue;
		await items.createOne({
			template_key: seed.template_key,
			variable_name: seed.variable_name,
			is_required: seed.is_required,
			is_protected: isProtectedKey(seed.template_key),
			description: seed.description,
			example_value: seed.example_value,
		});
		logger.info(`[i18n-email] Seeded variable ${seed.template_key}.${seed.variable_name}.`);
	}
}

/**
 * Idempotent bootstrap: creates collections + relations if missing,
 * seeds protected templates (preferring any existing on-disk body over
 * the shipped default), seeds translations + variables, and flushes
 * each template body to disk. Never overwrites admin-edited DB rows.
 */
export async function runBootstrap(
	templatesPath: string,
	services: ExtensionsServices,
	getSchema: () => Promise<SchemaOverview>,
	logger: Pick<Logger, 'info' | 'warn' | 'error'>,
): Promise<void> {
	if (bootstrapRan) return;
	if (bootstrapInFlight) return bootstrapInFlight;

	bootstrapInFlight = (async () => {
		logger.info('[i18n-email] Bootstrap started.');
		try {
			let schema = await getSchema();
			for (const payload of ALL_COLLECTIONS) {
				await createCollectionIfMissing(payload, services, schema, logger);
			}
			schema = await getSchema();
			for (const payload of ALL_COLLECTIONS) {
				await migrateCollectionFields(payload, services, schema, logger);
			}
			schema = await getSchema();
			await createRelationsIfMissing(services, schema, logger);
			schema = await getSchema();
			await migrateRelationsMeta(services, schema, logger);
			schema = await getSchema();
			await seedLanguages(services, schema, logger);
			const templateRows = await seedTemplates(templatesPath, services, schema, logger);
			await seedTranslations(templateRows, services, schema, logger);
			await seedVariables(services, schema, logger);
			// Flush each template body to disk so Directus's MailService can render it.
			for (const row of templateRows) {
				await syncTemplateBody(row, templatesPath, services, schema, logger, 'bootstrap');
			}
			bootstrapRan = true;
			logger.info('[i18n-email] Bootstrap completed.');
		} catch (err) {
			logger.error(
				`[i18n-email] Bootstrap failed (non-strict, extension will continue): ${(err as Error).message}`,
			);
		} finally {
			bootstrapInFlight = null;
		}
	})();

	return bootstrapInFlight;
}

export const __INTERNAL__ = {
	reset(): void {
		bootstrapRan = false;
		bootstrapInFlight = null;
	},
	get ran(): boolean {
		return bootstrapRan;
	},
	get inFlight(): Promise<void> | null {
		return bootstrapInFlight;
	},
};
