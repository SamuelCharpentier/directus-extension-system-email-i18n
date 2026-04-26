import { vi } from 'vitest';

export type ItemsStore = Record<string, any[]>;

/**
 * ItemsService surface actually exercised by src/. Anything else is
 * trimmed — adding a new method here means src/ should be calling it.
 */
export type ItemsServiceMock = {
	readByQuery: (query?: any) => Promise<any[]>;
	readMany: (keys: (string | number)[], query?: any) => Promise<any[]>;
	createOne: (data: any) => Promise<string | number>;
	updateOne: (id: string | number, data: any) => Promise<string | number>;
};

export type CollectionItemsInit = {
	rows?: any[];
	/** Override the default in-memory readByQuery (e.g. admin-alert tests). */
	readByQuery?: ItemsServiceMock['readByQuery'];
	/** Override createOne to simulate write failures (sync audit tests). */
	createOne?: ItemsServiceMock['createOne'];
	/** Override updateOne to simulate write failures (sync metadata tests). */
	updateOne?: ItemsServiceMock['updateOne'];
};

export type ServicesInit = {
	items?: Record<string, CollectionItemsInit>;
	settings?: { readSingleton: (q?: any) => Promise<any> };
	mail?: { send: (opts: any) => Promise<any> };
	collections?: Partial<{
		readOne: (c: string) => Promise<any>;
		createOne: (payload: any) => Promise<any>;
	}>;
	relations?: Partial<{
		readOne: (c: string, f: string) => Promise<any>;
		createOne: (payload: any) => Promise<any>;
		updateOne: (c: string, f: string, data: any) => Promise<any>;
	}>;
	fields?: Partial<{
		readOne: (c: string, f: string) => Promise<any>;
		createField: (c: string, field: any) => Promise<any>;
		updateField: (c: string, field: any) => Promise<any>;
	}>;
};

export type ServicesMock = {
	ItemsService: any;
	SettingsService: any;
	MailService: any;
	CollectionsService: any;
	RelationsService: any;
	FieldsService: any;
	_stores: ItemsStore;
	_mailSends: any[];
	_collectionsCreated: any[];
	_relationsCreated: any[];
	_relationsUpdated: any[];
	_fieldsCreated: any[];
	_fieldsUpdated: any[];
};

const matchFilter = (row: any, filter: any): boolean => {
	if (!filter || typeof filter !== 'object') return true;
	for (const [key, spec] of Object.entries(filter)) {
		if (spec && typeof spec === 'object') {
			const s = spec as Record<string, unknown>;
			if ('_eq' in s) {
				if (row[key] !== s['_eq']) return false;
			} else if ('_nnull' in s) {
				if (row[key] === null || row[key] === undefined) return false;
			} else {
				// nested relational-filter — treat shallowly, match by key
				if (!matchFilter(row[key] ?? {}, s)) return false;
			}
		}
	}
	return true;
};

let idCounter = 1;
const nextId = () => `id-${idCounter++}`;

export function makeServices(init: ServicesInit = {}): ServicesMock {
	const stores: ItemsStore = {};
	const mailSends: any[] = [];
	const collectionsCreated: any[] = [];
	const relationsCreated: any[] = [];
	const relationsUpdated: any[] = [];
	const fieldsCreated: any[] = [];
	const fieldsUpdated: any[] = [];

	for (const [name, cfg] of Object.entries(init.items ?? {})) {
		stores[name] = cfg.rows ? [...cfg.rows] : [];
	}

	function ItemsService(collection: string, _opts: any): ItemsServiceMock {
		if (!stores[collection]) stores[collection] = [];
		const rows = () => stores[collection]!;
		const cfg = init.items?.[collection] ?? {};

		return {
			readByQuery:
				cfg.readByQuery ??
				(async (query?: any) => {
					const filter = query?.filter;
					const filtered = rows().filter((r) => matchFilter(r, filter));
					const limit = query?.limit;
					if (typeof limit === 'number' && limit > 0) return filtered.slice(0, limit);
					return filtered;
				}),
			readMany: async (keys: (string | number)[]) =>
				rows().filter((r) => keys.map(String).includes(String(r.id))),
			createOne:
				cfg.createOne ??
				(async (data: any) => {
					const id = data.id ?? nextId();
					rows().push({ ...data, id });
					return id;
				}),
			updateOne:
				cfg.updateOne ??
				(async (id: string | number, data: any) => {
					const idx = rows().findIndex((r) => String(r.id) === String(id));
					if (idx >= 0) rows()[idx] = { ...rows()[idx], ...data };
					return id;
				}),
		};
	}

	function SettingsService(_opts: any) {
		// Tests that exercise SettingsService MUST provide `init.settings`;
		// otherwise the call surfaces as a clear runtime error rather than
		// a silent default.
		return {
			readSingleton: init.settings!.readSingleton,
		};
	}

	function MailService(_opts: any) {
		return {
			send:
				init.mail?.send ??
				(async (opts: any) => {
					mailSends.push(opts);
					return { messageId: 'test' };
				}),
		};
	}

	function CollectionsService(_opts: any) {
		return {
			readOne:
				init.collections?.readOne ??
				(async (c: string) => {
					throw new Error(`no collection: ${c}`);
				}),
			createOne:
				init.collections?.createOne ??
				(async (payload: any) => {
					collectionsCreated.push(payload);
					return payload.collection;
				}),
		};
	}

	function RelationsService(_opts: any) {
		return {
			readOne:
				init.relations?.readOne ??
				(async (_c: string, _f: string) => {
					throw new Error('no relation');
				}),
			createOne:
				init.relations?.createOne ??
				(async (payload: any) => {
					relationsCreated.push(payload);
					return payload;
				}),
			updateOne:
				init.relations?.updateOne ??
				(async (collection: string, field: string, data: any) => {
					relationsUpdated.push({ collection, field, data });
					return { collection, field };
				}),
		};
	}

	function FieldsService(_opts: any) {
		return {
			readOne:
				init.fields?.readOne ??
				(async (_c: string, _f: string) => {
					throw new Error('no field');
				}),
			createField:
				init.fields?.createField ??
				(async (collection: string, field: any) => {
					fieldsCreated.push({ collection, field });
					return field;
				}),
			updateField:
				init.fields?.updateField ??
				(async (collection: string, field: any) => {
					fieldsUpdated.push({ collection, field });
					return field;
				}),
		};
	}

	return {
		ItemsService,
		SettingsService,
		MailService,
		CollectionsService,
		RelationsService,
		FieldsService,
		_stores: stores,
		_mailSends: mailSends,
		_collectionsCreated: collectionsCreated,
		_relationsCreated: relationsCreated,
		_relationsUpdated: relationsUpdated,
		_fieldsCreated: fieldsCreated,
		_fieldsUpdated: fieldsUpdated,
	};
}

export function makeLogger() {
	return {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	};
}

export function makeSchema(): any {
	return { collections: {}, relations: [] };
}
