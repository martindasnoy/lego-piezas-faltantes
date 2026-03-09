import { getCloudflareContext } from "@opennextjs/cloudflare";

const REBRICKABLE_API_BASE = "https://rebrickable.com/api/v3/lego/parts/";
const CACHE_VERSION = "v1";

export type CatalogPart = {
	part_num: string;
	name: string;
	part_img_url: string | null;
	is_printed: boolean;
};

export type CatalogPartColorVariant = {
	color_id: number;
	color_name: string;
	part_img_url: string | null;
};

type RebrickablePart = {
	part_num: string;
	name?: string;
	part_img_url?: string | null;
	print_of?: string | null;
};

type RebrickablePartsPayload = {
	count?: number;
	results?: RebrickablePart[];
	next?: string | null;
};

type RebrickablePartColor = {
	color_id: number;
	color_name: string;
	part_img_url?: string | null;
};

type RebrickablePartColorsPayload = {
	results?: RebrickablePartColor[];
};

function getCacheKey(categoryId: string) {
	return `catalog:${CACHE_VERSION}:category:${categoryId}:all`;
}

function getPartColorsCacheKey(partNum: string) {
	return `catalog:${CACHE_VERSION}:part-colors:${partNum.trim().toUpperCase()}`;
}

function getRebrickableHeaders(apiKey: string) {
	return {
		Accept: "application/json",
		Authorization: `key ${apiKey}`,
		"User-Agent": "lego-piezas-faltantes/1.0",
	};
}

function extractJsonObject(text: string) {
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	if (start < 0 || end <= start) {
		throw new Error("json-extract-failed");
	}
	return JSON.parse(text.slice(start, end + 1)) as unknown;
}

async function fetchRebrickableJson<T>(url: string, apiKey: string): Promise<T> {
	const direct = await fetch(url, {
		headers: getRebrickableHeaders(apiKey),
		next: { revalidate: 60 * 60 },
	});

	if (direct.ok) return (await direct.json()) as T;
	if (direct.status !== 403 && direct.status !== 429) throw new Error(String(direct.status));

	const proxyUrl = `https://r.jina.ai/http://${url.replace(/^https?:\/\//, "")}`;
	const proxied = await fetch(proxyUrl, {
		headers: { Accept: "text/plain" },
		next: { revalidate: 60 * 60 },
	});

	if (!proxied.ok) throw new Error(String(proxied.status));
	const text = await proxied.text();
	return extractJsonObject(text) as T;
}

function getCatalogKv(): KVNamespace | null {
	try {
		const env = getCloudflareContext()?.env as Record<string, unknown> | undefined;
		const kv = env?.CATALOG_CACHE;
		if (!kv || typeof kv !== "object") return null;
		return kv as KVNamespace;
	} catch {
		return null;
	}
}

export async function getCachedCategoryAllParts(categoryId: string) {
	const kv = getCatalogKv();
	if (!kv) return null;
	const raw = await kv.get(getCacheKey(categoryId));
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw) as { updatedAt: string; parts: CatalogPart[] };
		if (!Array.isArray(parsed.parts)) return null;
		return parsed;
	} catch {
		return null;
	}
}

export async function setCachedCategoryAllParts(categoryId: string, parts: CatalogPart[]) {
	const kv = getCatalogKv();
	if (!kv) throw new Error("CATALOG_CACHE binding missing");
	await kv.put(
		getCacheKey(categoryId),
		JSON.stringify({
			updatedAt: new Date().toISOString(),
			parts,
		}),
	);
}

export async function getCachedPartColors(partNum: string) {
	const kv = getCatalogKv();
	if (!kv) return null;
	const raw = await kv.get(getPartColorsCacheKey(partNum));
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw) as { updatedAt: string; part_num: string; colors: CatalogPartColorVariant[] };
		if (!Array.isArray(parsed.colors)) return null;
		return parsed;
	} catch {
		return null;
	}
}

export async function setCachedPartColors(partNum: string, colors: CatalogPartColorVariant[]) {
	const kv = getCatalogKv();
	if (!kv) throw new Error("CATALOG_CACHE binding missing");
	await kv.put(
		getPartColorsCacheKey(partNum),
		JSON.stringify({
			updatedAt: new Date().toISOString(),
			part_num: partNum.trim().toUpperCase(),
			colors,
		}),
	);
}

export async function fetchAllCategoryPartsFromRebrickable(categoryId: string, apiKey: string): Promise<CatalogPart[]> {
	const url = new URL(REBRICKABLE_API_BASE);
	url.searchParams.set("part_cat_id", categoryId);
	url.searchParams.set("page", "1");
	url.searchParams.set("page_size", "1000");
	url.searchParams.set("inc_part_details", "1");
	url.searchParams.set("key", apiKey);

	const first = await fetchRebrickableJson<RebrickablePartsPayload>(url.toString(), apiKey);
	const all = [...(first.results ?? [])];
	const count = Number(first.count ?? all.length);
	const totalPages = Math.max(1, Math.ceil(count / 1000));

	for (let page = 2; page <= totalPages; page += 1) {
		const pageUrl = new URL(REBRICKABLE_API_BASE);
		pageUrl.searchParams.set("part_cat_id", categoryId);
		pageUrl.searchParams.set("page", String(page));
		pageUrl.searchParams.set("page_size", "1000");
		pageUrl.searchParams.set("inc_part_details", "1");
		pageUrl.searchParams.set("key", apiKey);
		const payload = await fetchRebrickableJson<RebrickablePartsPayload>(pageUrl.toString(), apiKey);
		all.push(...(payload.results ?? []));
	}

	return all.map((part) => ({
		part_num: part.part_num,
		name: part.name ?? part.part_num,
		part_img_url: part.part_img_url ?? null,
		is_printed: Boolean(part.print_of),
	}));
}

export async function fetchPartColorsFromRebrickable(partNum: string, apiKey: string): Promise<CatalogPartColorVariant[]> {
	const url = new URL(`${REBRICKABLE_API_BASE}${encodeURIComponent(partNum.trim().toUpperCase())}/colors/`);
	url.searchParams.set("page_size", "1000");
	url.searchParams.set("key", apiKey);

	const payload = await fetchRebrickableJson<RebrickablePartColorsPayload>(url.toString(), apiKey);
	return (payload.results ?? []).map((color) => ({
		color_id: Number(color.color_id ?? 0),
		color_name: color.color_name ?? "",
		part_img_url: color.part_img_url ?? null,
	}));
}
