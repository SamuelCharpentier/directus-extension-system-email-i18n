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
		let exists: boolean;
		try {
			const current = await fields.readOne(payload.collection, field.field);
			exists = !!current;
		} catch {
			exists = false;
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

		// Detect missing or drifted DB-level FK and rebuild via DELETE + create.
		const expectedOnDelete = (rel.schema as any)?.on_delete;
		const actualSchema = existing.schema;
		const fkBroken =
			!!expectedOnDelete &&
			(actualSchema === null ||
				typeof actualSchema !== 'object' ||
				actualSchema.on_delete !== expectedOnDelete);
		if (fkBroken) {
			if (typeof svc.deleteOne !== 'function' || typeof svc.createOne !== 'function') {
				logger.warn(
					'[i18n-email] RelationsService.deleteOne/createOne not available — cannot rebuild FK.',
				);
			} else {
				try {
					await svc.deleteOne(rel.collection, rel.field);
					await svc.createOne(rel);
					logger.info(
						`[i18n-email] Rebuilt relation ${rel.collection}.${rel.field} to install FK (on_delete=${expectedOnDelete}).`,
					);
					continue;
				} catch (err) {
					logger.warn(
						`[i18n-email] Relation rebuild skipped for ${rel.collection}.${rel.field}: ${(err as Error).message}`,
					);
					// Fall through to a meta-only update so we still patch what we can.
				}
			}
		}

		if (!rel.meta) continue;
		if (typeof svc.updateOne !== 'function') {
			logger.warn(
				'[i18n-email] RelationsService.updateOne not available — skipping relation migration.',
			);
			return;
		}
		try {
			// Pass full relation payload (including `related_collection` and
			// `schema`) — Directus's RelationsService.updateOne calls
			// alterType() which dereferences `relation.related_collection`
			// without a guard, throwing an unhandled rejection inside the
			// knex transaction when only `meta` is supplied.
			await svc.updateOne(rel.collection, rel.field, {
				related_collection: rel.related_collection,
				meta: rel.meta,
				...(rel.schema ? { schema: rel.schema } : {}),
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
