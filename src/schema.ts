import {
	TEMPLATES_COLLECTION,
	TRANSLATIONS_COLLECTION,
	VARIABLES_COLLECTION,
	SYNC_AUDIT_COLLECTION,
	LANGUAGES_COLLECTION,
	TEMPLATE_CATEGORIES,
} from './constants';

type FieldPayload = {
	field: string;
	type: string;
	meta?: Record<string, unknown>;
	schema?: Record<string, unknown>;
};

type CollectionPayload = {
	collection: string;
	meta: Record<string, unknown>;
	schema: { name: string };
	fields: FieldPayload[];
};

export type RelationPayload = {
	collection: string;
	field: string;
	related_collection: string;
	meta?: Record<string, unknown>;
	schema?: Record<string, unknown>;
};

const uuidPkField: FieldPayload = {
	field: 'id',
	type: 'uuid',
	meta: {
		hidden: true,
		readonly: true,
		interface: 'input',
		special: ['uuid'],
	},
	schema: { is_primary_key: true, has_auto_increment: false },
};

const createdAtField: FieldPayload = {
	field: 'created_at',
	type: 'timestamp',
	meta: {
		readonly: true,
		hidden: true,
		interface: 'datetime',
		special: ['date-created'],
	},
};

const updatedAtField: FieldPayload = {
	field: 'updated_at',
	type: 'timestamp',
	meta: {
		readonly: true,
		hidden: true,
		interface: 'datetime',
		special: ['date-updated'],
	},
};

// ─────────────────────────── languages ───────────────────────────
export const LANGUAGES_COLLECTION_PAYLOAD: CollectionPayload = {
	collection: LANGUAGES_COLLECTION,
	meta: {
		icon: 'translate',
		note: 'Supported languages for email template translations.',
		display_template: '{{ name }} ({{ code }})',
		sort_field: 'code',
	},
	schema: { name: LANGUAGES_COLLECTION },
	fields: [
		{
			field: 'code',
			type: 'string',
			meta: {
				interface: 'input',
				required: true,
				width: 'half',
				note: 'ISO short language code, e.g. "en" or "fr".',
			},
			schema: { is_primary_key: true, is_nullable: false, has_auto_increment: false },
		},
		{
			field: 'name',
			type: 'string',
			meta: { interface: 'input', required: true, width: 'half' },
			schema: { is_nullable: false },
		},
		{
			field: 'direction',
			type: 'string',
			meta: {
				interface: 'select-dropdown',
				options: {
					choices: [
						{ text: 'Left-to-Right', value: 'ltr' },
						{ text: 'Right-to-Left', value: 'rtl' },
					],
				},
				width: 'half',
			},
			schema: { is_nullable: false, default_value: 'ltr' },
		},
	],
};

// ─────────────────────────── email_templates ───────────────────────────
export const EMAIL_TEMPLATES_COLLECTION: CollectionPayload = {
	collection: TEMPLATES_COLLECTION,
	meta: {
		icon: 'mail',
		note: 'Email templates. Liquid body is the source of truth; translations attached as o2m.',
		display_template: '{{ template_key }}',
		archive_field: 'is_active',
		archive_value: 'false',
		unarchive_value: 'true',
		sort_field: 'template_key',
	},
	schema: { name: TEMPLATES_COLLECTION },
	fields: [
		uuidPkField,
		{
			field: 'template_key',
			type: 'string',
			meta: {
				interface: 'input',
				required: true,
				width: 'half',
				note: 'Machine identifier, e.g. "password-reset".',
			},
			schema: { is_nullable: false, is_unique: true },
		},
		{
			field: 'category',
			type: 'string',
			meta: {
				interface: 'select-dropdown',
				options: {
					choices: TEMPLATE_CATEGORIES.map((c) => ({ text: c, value: c })),
				},
				required: true,
				width: 'half',
			},
			schema: { is_nullable: false, default_value: 'custom' },
		},
		{
			field: 'is_active',
			type: 'boolean',
			meta: { interface: 'boolean', width: 'half' },
			schema: { is_nullable: false, default_value: true },
		},
		{
			field: 'is_protected',
			type: 'boolean',
			meta: {
				interface: 'boolean',
				width: 'half',
				readonly: true,
				note: 'Protected rows cannot be deleted.',
			},
			schema: { is_nullable: false, default_value: false },
		},
		{
			field: 'body',
			type: 'text',
			meta: {
				interface: 'input-code',
				options: { language: 'htmlmixed', lineNumber: true },
				note: 'Full Liquid template (e.g. {% layout "base" %}{% block content %}…{% endblock %}).',
				width: 'full',
			},
			schema: { is_nullable: false, default_value: '' },
		},
		{
			field: 'translations',
			type: 'alias',
			meta: {
				interface: 'translations',
				special: ['translations'],
				options: {
					languageField: 'name',
					languageDirectionField: 'direction',
					defaultOpenSplitView: true,
					userLanguage: true,
				},
				width: 'full',
			},
		},
		{
			field: 'description',
			type: 'text',
			meta: { interface: 'input-multiline', width: 'full' },
			schema: { is_nullable: true },
		},
		{
			field: 'checksum',
			type: 'string',
			meta: { interface: 'input', width: 'half', readonly: true, hidden: true },
			schema: { is_nullable: true },
		},
		{
			field: 'last_synced_at',
			type: 'timestamp',
			meta: { interface: 'datetime', width: 'half', readonly: true },
			schema: { is_nullable: true },
		},
		createdAtField,
		updatedAtField,
	],
};

// ─────────────────────────── email_template_translations ───────────────────────────
export const EMAIL_TEMPLATE_TRANSLATIONS_COLLECTION: CollectionPayload = {
	collection: TRANSLATIONS_COLLECTION,
	meta: {
		icon: 'translate',
		note: 'Per-language subject, from_name, and i18n strings for an email template.',
		display_template: '{{ email_templates_id.template_key }} · {{ languages_code }}',
		sort_field: 'languages_code',
		hidden: true,
	},
	schema: { name: TRANSLATIONS_COLLECTION },
	fields: [
		uuidPkField,
		{
			field: 'email_templates_id',
			type: 'uuid',
			meta: {
				interface: 'select-dropdown-m2o',
				special: ['m2o'],
				display: 'related-values',
				display_options: { template: '{{ template_key }}' },
				required: true,
				width: 'half',
			},
			schema: { is_nullable: false },
		},
		{
			field: 'languages_code',
			type: 'string',
			meta: {
				interface: 'select-dropdown-m2o',
				special: ['m2o'],
				display: 'related-values',
				display_options: { template: '{{ name }} ({{ code }})' },
				required: true,
				width: 'half',
			},
			schema: { is_nullable: false },
		},
		{
			field: 'subject',
			type: 'string',
			meta: { interface: 'input', width: 'full' },
			schema: { is_nullable: true },
		},
		{
			field: 'from_name',
			type: 'string',
			meta: {
				interface: 'input',
				width: 'half',
				note: 'Optional sender display name override for this language.',
			},
			schema: { is_nullable: true },
		},
		{
			field: 'strings',
			type: 'json',
			meta: {
				interface: 'input-code',
				options: { language: 'JSON' },
				note: 'Flat key→string map. Injected into Liquid as {{ i18n.* }}.',
				width: 'full',
			},
			schema: { is_nullable: false, default_value: '{}' },
		},
	],
};

// ─────────────────────────── email_template_variables ───────────────────────────
export const EMAIL_TEMPLATE_VARIABLES_COLLECTION: CollectionPayload = {
	collection: VARIABLES_COLLECTION,
	meta: {
		icon: 'data_object',
		note: 'Registry of variables that each template_key accepts / requires.',
		display_template: '{{ template_key }} · {{ variable_name }}',
		sort_field: 'template_key',
	},
	schema: { name: VARIABLES_COLLECTION },
	fields: [
		uuidPkField,
		{
			field: 'template_key',
			type: 'string',
			meta: { interface: 'input', required: true, width: 'half' },
			schema: { is_nullable: false },
		},
		{
			field: 'variable_name',
			type: 'string',
			meta: { interface: 'input', required: true, width: 'half' },
			schema: { is_nullable: false },
		},
		{
			field: 'is_required',
			type: 'boolean',
			meta: { interface: 'boolean', width: 'half' },
			schema: { is_nullable: false, default_value: false },
		},
		{
			field: 'is_protected',
			type: 'boolean',
			meta: { interface: 'boolean', width: 'half', readonly: true },
			schema: { is_nullable: false, default_value: false },
		},
		{
			field: 'description',
			type: 'text',
			meta: { interface: 'input-multiline', width: 'full' },
			schema: { is_nullable: true },
		},
		{
			field: 'example_value',
			type: 'string',
			meta: { interface: 'input', width: 'full' },
			schema: { is_nullable: true },
		},
	],
};

// ─────────────────────────── email_template_sync_audit ───────────────────────────
export const EMAIL_TEMPLATE_SYNC_AUDIT_COLLECTION: CollectionPayload = {
	collection: SYNC_AUDIT_COLLECTION,
	meta: {
		icon: 'history',
		note: 'Audit trail of template filesystem syncs.',
		display_template: '{{ template_key }} · {{ action }}',
		sort_field: '-created_at',
	},
	schema: { name: SYNC_AUDIT_COLLECTION },
	fields: [
		uuidPkField,
		{
			field: 'template_key',
			type: 'string',
			meta: { interface: 'input', required: true, width: 'half', readonly: true },
			schema: { is_nullable: false },
		},
		{
			field: 'reason',
			type: 'string',
			meta: { interface: 'input', width: 'full', readonly: true },
			schema: { is_nullable: true },
		},
		{
			field: 'action',
			type: 'string',
			meta: { interface: 'input', width: 'half', readonly: true },
			schema: { is_nullable: true },
		},
		createdAtField,
	],
};

/** Order matters: parents first, then children that reference them. */
export const ALL_COLLECTIONS: readonly CollectionPayload[] = [
	LANGUAGES_COLLECTION_PAYLOAD,
	EMAIL_TEMPLATES_COLLECTION,
	EMAIL_TEMPLATE_TRANSLATIONS_COLLECTION,
	EMAIL_TEMPLATE_VARIABLES_COLLECTION,
	EMAIL_TEMPLATE_SYNC_AUDIT_COLLECTION,
];

/**
 * Relations registered after collections exist.
 *
 * Both relations on the `email_template_translations` junction MUST
 * declare `junction_field` cross-references to one another. Without
 * them Directus computes the parent o2m alias's `localType` as plain
 * `o2m` instead of `translations`, and the translations interface —
 * which only registers for `localTypes:['translations']` — refuses to
 * render ("interface introuvable"). With both fields set the alias is
 * classified correctly and the per-language tab editor appears.
 */
export const ALL_RELATIONS: readonly RelationPayload[] = [
	{
		collection: TRANSLATIONS_COLLECTION,
		field: 'email_templates_id',
		related_collection: TEMPLATES_COLLECTION,
		meta: {
			one_field: 'translations',
			junction_field: 'languages_code',
			sort_field: null,
			one_deselect_action: 'delete',
		},
		schema: {
			on_delete: 'CASCADE',
		},
	},
	{
		collection: TRANSLATIONS_COLLECTION,
		field: 'languages_code',
		related_collection: LANGUAGES_COLLECTION,
		meta: {
			junction_field: 'email_templates_id',
			sort_field: null,
		},
		schema: { on_delete: 'NO ACTION' },
	},
];
