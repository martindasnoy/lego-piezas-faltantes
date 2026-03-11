export type CachedPartSuggestion = {
	part_num: string;
	name: string;
	part_img_url: string | null;
};

type CachedSuggestionPage = {
	key: string;
	query: string;
	offset: number;
	limit: number;
	results: CachedPartSuggestion[];
	has_more: boolean;
	updated_at: number;
};

type CachedPartRow = CachedPartSuggestion & {
	normalized_name: string;
	normalized_part_num: string;
	updated_at: number;
};

const DB_NAME = "lego-part-suggestions";
const DB_VERSION = 1;
const PAGE_STORE = "pages";
const PARTS_STORE = "parts";
const MAX_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function isBrowser() {
	return typeof window !== "undefined" && typeof window.indexedDB !== "undefined";
}

function normalizeSearchText(value: string) {
	return String(value ?? "")
		.toLowerCase()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/\b\d+(?:\s*(?:x|×|\*|by)\s*\d+)+\b/g, (sizeExpr) => sizeExpr.replace(/\s*(?:x|×|\*|by)\s*/g, "x"))
		.replace(/[^a-z0-9]+/g, " ")
		.trim()
		.replace(/\s+/g, " ");
}

function buildPageKey(query: string, offset: number, limit: number) {
	return `${normalizeSearchText(query)}|${Math.max(0, Math.trunc(offset))}|${Math.max(1, Math.trunc(limit))}`;
}

function openDb(): Promise<IDBDatabase | null> {
	if (!isBrowser()) return Promise.resolve(null);

	return new Promise((resolve) => {
		const request = window.indexedDB.open(DB_NAME, DB_VERSION);
		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(PAGE_STORE)) {
				db.createObjectStore(PAGE_STORE, { keyPath: "key" });
			}
			if (!db.objectStoreNames.contains(PARTS_STORE)) {
				db.createObjectStore(PARTS_STORE, { keyPath: "part_num" });
			}
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => resolve(null);
	});
}

export async function getCachedSuggestionPage(query: string, offset: number, limit: number) {
	const db = await openDb();
	if (!db) return null;

	const key = buildPageKey(query, offset, limit);
	return new Promise<{ results: CachedPartSuggestion[]; hasMore: boolean } | null>((resolve) => {
		const tx = db.transaction(PAGE_STORE, "readonly");
		const store = tx.objectStore(PAGE_STORE);
		const req = store.get(key);

		req.onsuccess = () => {
			const row = req.result as CachedSuggestionPage | undefined;
			if (!row) {
				resolve(null);
				return;
			}
			if (Date.now() - Number(row.updated_at ?? 0) > MAX_CACHE_AGE_MS) {
				resolve(null);
				return;
			}
			resolve({ results: row.results ?? [], hasMore: Boolean(row.has_more) });
		};

		req.onerror = () => resolve(null);
	});
}

export async function saveSuggestionPage(query: string, offset: number, limit: number, results: CachedPartSuggestion[], hasMore: boolean) {
	const db = await openDb();
	if (!db) return;

	const normalizedQuery = normalizeSearchText(query);
	const pageKey = buildPageKey(query, offset, limit);

	const tx = db.transaction([PAGE_STORE, PARTS_STORE], "readwrite");
	tx.objectStore(PAGE_STORE).put({
		key: pageKey,
		query: normalizedQuery,
		offset: Math.max(0, Math.trunc(offset)),
		limit: Math.max(1, Math.trunc(limit)),
		results,
		has_more: hasMore,
		updated_at: Date.now(),
	} satisfies CachedSuggestionPage);

	const partsStore = tx.objectStore(PARTS_STORE);
	for (const row of results) {
		partsStore.put({
			part_num: String(row.part_num ?? "").trim().toUpperCase(),
			name: String(row.name ?? "").trim(),
			part_img_url: row.part_img_url ?? null,
			normalized_name: normalizeSearchText(row.name),
			normalized_part_num: normalizeSearchText(row.part_num),
			updated_at: Date.now(),
		} satisfies CachedPartRow);
	}

	await new Promise<void>((resolve) => {
		tx.oncomplete = () => resolve();
		tx.onerror = () => resolve();
		tx.onabort = () => resolve();
	});
}

export async function saveSuggestionPartsBulk(results: CachedPartSuggestion[]) {
	const db = await openDb();
	if (!db || results.length === 0) return;

	const tx = db.transaction(PARTS_STORE, "readwrite");
	const partsStore = tx.objectStore(PARTS_STORE);
	const now = Date.now();

	for (const row of results) {
		partsStore.put({
			part_num: String(row.part_num ?? "").trim().toUpperCase(),
			name: String(row.name ?? "").trim(),
			part_img_url: row.part_img_url ?? null,
			normalized_name: normalizeSearchText(row.name),
			normalized_part_num: normalizeSearchText(row.part_num),
			updated_at: now,
		} satisfies CachedPartRow);
	}

	await new Promise<void>((resolve) => {
		tx.oncomplete = () => resolve();
		tx.onerror = () => resolve();
		tx.onabort = () => resolve();
	});
}

export async function searchLocalSuggestionParts(query: string, offset: number, limit: number) {
	const db = await openDb();
	if (!db) return null;

	const normalizedQuery = normalizeSearchText(query);
	const tokens = normalizedQuery.split(" ").filter((token) => token.length > 0);
	if (tokens.length === 0) return null;

	return new Promise<{ results: CachedPartSuggestion[]; hasMore: boolean } | null>((resolve) => {
		const tx = db.transaction(PARTS_STORE, "readonly");
		const req = tx.objectStore(PARTS_STORE).getAll();

		req.onsuccess = () => {
			const rows = (req.result as CachedPartRow[] | undefined) ?? [];
			if (rows.length === 0) {
				resolve(null);
				return;
			}

			const ranked = rows
				.map((row) => {
					const combined = `${row.normalized_part_num} ${row.normalized_name}`;
					if (!tokens.every((token) => combined.includes(token))) return null;
					const exactNum = row.normalized_part_num === normalizedQuery ? 1 : 0;
					const startsNum = row.normalized_part_num.startsWith(normalizedQuery) ? 1 : 0;
					const startsName = row.normalized_name.startsWith(normalizedQuery) ? 1 : 0;
					const score = exactNum * 10000 + startsNum * 4000 + startsName * 2000 - row.name.length * 0.3;
					return {
						part_num: row.part_num,
						name: row.name,
						part_img_url: row.part_img_url,
						score,
					};
				})
				.filter((row): row is CachedPartSuggestion & { score: number } => row !== null)
				.sort((a, b) => {
					if (a.score !== b.score) return b.score - a.score;
					return a.part_num.localeCompare(b.part_num);
				});

			const safeOffset = Math.max(0, Math.trunc(offset));
			const safeLimit = Math.max(1, Math.trunc(limit));
			const slice = ranked.slice(safeOffset, safeOffset + safeLimit).map((row) => ({
				part_num: row.part_num,
				name: row.name,
				part_img_url: row.part_img_url,
			}));
			resolve({ results: slice, hasMore: safeOffset + safeLimit < ranked.length });
		};

		req.onerror = () => resolve(null);
	});
}
