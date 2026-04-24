import {
	TEMPLATES_COLLECTION,
	VARIABLES_COLLECTION,
	SYNC_AUDIT_COLLECTION,
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

const idField: FieldPayload = {
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

export const EMAIL_TEMPLATES_COLLECTION: CollectionPayload = {
	collection: TEMPLATES_COLLECTION,
	meta: {
		icon: 'mail',
		note: 'Multilingual email templates. Source of truth for i18n-email extension.',
		display_template: '{{ template_key }} · {{ language }}',
		archive_field: 'is_active',
		archive_value: 'false',
		unarchive_value: 'true',
		sort_field: 'template_key',
	},
	schema: { name: TEMPLATES_COLLECTION },
	fields: [
		idField,
		{
			field: 'template_key',
			type: 'string',
			meta: {
				interface: 'input',
				required: true,
				width: 'half',
				note: 'Machine identifier, e.g. "password-reset".',
			},
			schema: { is_nullable: false },
		},
		{
			field: 'language',
			type: 'string',
			meta: {
				interface: 'input',
				required: true,
				width: 'half',
				note: 'ISO short code, e.g. "fr" or "en".',
			},
			schema: { is_nullable: false },
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
				note: 'Overrides the sender display name for this template.',
			},
			schema: { is_nullable: true },
		},
		{
			field: 'strings',
			type: 'json',
			meta: {
				interface: 'input-code',
				options: { language: 'JSON' },
				note: 'Flat map of i18n keys injected as {{ i18n.* }} in the Liquid template.',
				width: 'full',
			},
			schema: { is_nullable: false, default_value: '{}' },
		},
		{
			field: 'description',
			type: 'text',
			meta: { interface: 'input-multiline', width: 'full' },
			schema: { is_nullable: true },
		},
		{
			field: 'is_protected',
			type: 'boolean',
			meta: {
				interface: 'boolean',
				width: 'half',
				readonly: true,
				note: 'Protected templates cannot be deleted.',
			},
			schema: { is_nullable: false, default_value: false },
		},
		{
			field: 'version',
			type: 'integer',
			meta: { interface: 'input', width: 'half', readonly: true },
			schema: { is_nullable: false, default_value: 1 },
		},
		{
			field: 'checksum',
			type: 'string',
			meta: { interface: 'input', width: 'full', readonly: true, hidden: true },
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
		idField,
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

export const EMAIL_TEMPLATE_SYNC_AUDIT_COLLECTION: CollectionPayload = {
	collection: SYNC_AUDIT_COLLECTION,
	meta: {
		icon: 'history',
		note: 'Audit trail of template filesystem re-syncs triggered by integrity mismatches.',
		display_template: '{{ template_key }} · {{ language }} · {{ reason }}',
		sort_field: '-created_at',
	},
	schema: { name: SYNC_AUDIT_COLLECTION },
	fields: [
		idField,
		{
			field: 'template_key',
			type: 'string',
			meta: { interface: 'input', required: true, width: 'half', readonly: true },
			schema: { is_nullable: false },
		},
		{
			field: 'language',
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
			meta: { interface: 'input', width: 'full', readonly: true },
			schema: { is_nullable: true },
		},
		createdAtField,
	],
};

export const ALL_COLLECTIONS: readonly CollectionPayload[] = [
	EMAIL_TEMPLATES_COLLECTION,
	EMAIL_TEMPLATE_VARIABLES_COLLECTION,
	EMAIL_TEMPLATE_SYNC_AUDIT_COLLECTION,
];
