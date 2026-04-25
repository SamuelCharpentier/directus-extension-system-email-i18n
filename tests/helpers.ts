import { vi } from 'vitest';

export type ItemsStore = Record<string, any[]>;

/** Configurable ItemsService-alike for a single collection. */
export type ItemsServiceMock = {
	readByQuery: (query?: any) => Promise<any[]>;
	readOne: (id: string | number, query?: any) => Promise<any>;
	readMany: (keys: (string | number)[], query?: any) => Promise<any[]>;
	createOne: (data: any) => Promise<string | number>;
	createMany: (rows: any[]) => Promise<(string | number)[]>;
	updateOne: (id: string | number, data: any) => Promise<string | number>;
	deleteOne: (id: string | number) => Promise<void>;
};

export type CollectionItemsInit = Partial<ItemsServiceMock> & { rows?: any[] };

export type ServicesInit = {
	items?: Record<string, CollectionItemsInit>;
	settings?: Partial<{ readSingleton: (q?: any) => Promise<any> }>;
	mail?: Partial<{ send: (opts: any) => Promise<any> }>;
	collections?: Partial<{
		readOne: (c: string) => Promise<any>;
		createOne: (payload: any) => Promise<any>;
	}>;
	relations?: Partial<{
		readOne: (c: string, f: string) => Promise<any>;
		createOne: (payload: any) => Promise<any>;
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

export function resetIdCounter(): void {
	idCounter = 1;
}

export function makeServices(init: ServicesInit = {}): ServicesMock {
	const stores: ItemsStore = {};
	const mailSends: any[] = [];
	const collectionsCreated: any[] = [];
	const relationsCreated: any[] = [];
	const fieldsCreated: any[] = [];
	const fieldsUpdated: any[] = [];

	for (const [name, cfg] of Object.entries(init.items ?? {})) {
		stores[name] = cfg.rows ? [...cfg.rows] : [];
	}

	function ItemsService(collection: string, _opts: any): ItemsServiceMock {
		if (!stores[collection]) stores[collection] = [];
		const rows = () => stores[collection]!;
		const cfg = init.items?.[collection] ?? {};

		const api: ItemsServiceMock = {
			readByQuery: cfg.readByQuery
				? cfg.readByQuery
				: async (query?: any) => {
						const filter = query?.filter;
						const filtered = rows().filter((r) => matchFilter(r, filter));
						const limit = query?.limit;
						if (typeof limit === 'number' && limit > 0) return filtered.slice(0, limit);
						return filtered;
					},
			readOne: cfg.readOne
				? cfg.readOne
				: async (id: string | number) => {
						const found = rows().find((r) => String(r.id) === String(id));
						if (!found) throw new Error(`not found: ${id}`);
						return found;
					},
			readMany: cfg.readMany
				? cfg.readMany
				: async (keys: (string | number)[]) =>
						rows().filter((r) => keys.map(String).includes(String(r.id))),
			createOne: cfg.createOne
				? cfg.createOne
				: async (data: any) => {
						const id = data.id ?? nextId();
						rows().push({ ...data, id });
						return id;
					},
			createMany: cfg.createMany
				? cfg.createMany
				: async (inputs: any[]) => {
						const ids: (string | number)[] = [];
						for (const input of inputs) {
							const id = input.id ?? nextId();
							rows().push({ ...input, id });
							ids.push(id);
						}
						return ids;
					},
			updateOne: cfg.updateOne
				? cfg.updateOne
				: async (id: string | number, data: any) => {
						const idx = rows().findIndex((r) => String(r.id) === String(id));
						if (idx >= 0) rows()[idx] = { ...rows()[idx], ...data };
						return id;
					},
			deleteOne: cfg.deleteOne
				? cfg.deleteOne
				: async (id: string | number) => {
						const idx = rows().findIndex((r) => String(r.id) === String(id));
						if (idx >= 0) rows().splice(idx, 1);
					},
		};
		return api;
	}

	function SettingsService(_opts: any) {
		return {
			readSingleton:
				init.settings?.readSingleton ??
				(async () => ({ default_language: 'en', project_name: 'Test Project' })),
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
