import { NextResponse } from "next/server";
import { getRuntimeEnvValue } from "@/lib/runtime-env";
import { getPopularityByPartNums } from "@/lib/part-popularity-db";
import { staticRebrickableCategories } from "@/lib/rebrickable-categories-static";
import { getCachedCategories, getCachedCategoryAllParts } from "@/lib/rebrickable-catalog-cache";

type RebrickablePart = {
	part_num: string;
	name: string;
	part_img_url?: string | null;
};

type CatalogPartLite = {
	part_num: string;
	name: string;
	part_img_url: string | null;
};

let kvCatalogCache: { loadedAt: number; parts: CatalogPartLite[] } | null = null;
const KV_CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;

async function getAllCatalogPartsFromKv(): Promise<CatalogPartLite[]> {
	const now = Date.now();
	if (kvCatalogCache && now - kvCatalogCache.loadedAt < KV_CATALOG_CACHE_TTL_MS) {
		return kvCatalogCache.parts;
	}

	const categories = (await getCachedCategories())?.categories ?? staticRebrickableCategories;

	const byPartNum = new Map<string, CatalogPartLite>();
	await Promise.all(
		categories.map(async (category) => {
			const cached = await getCachedCategoryAllParts(String(category.id));
			for (const row of cached?.parts ?? []) {
				const partNum = String(row.part_num ?? "").trim().toUpperCase();
				if (!partNum) continue;
				const name = String(row.name ?? "").trim() || partNum;
				const partImg = row.part_img_url ?? null;

				const existing = byPartNum.get(partNum);
				if (!existing) {
					byPartNum.set(partNum, { part_num: partNum, name, part_img_url: partImg });
					continue;
				}

				if (!existing.part_img_url && partImg) {
					existing.part_img_url = partImg;
				}
			}
		}),
	);

	const parts = [...byPartNum.values()];
	kvCatalogCache = { loadedAt: now, parts };
	return parts;
}

function getTextRank(part: CatalogPartLite, query: string) {
	const partNum = part.part_num.toLowerCase();
	const name = part.name.toLowerCase();
	if (partNum === query) return 0;
	if (partNum.startsWith(query)) return 1;
	if (partNum.includes(query)) return 2;
	if (name.includes(query)) return 3;
	return 99;
}

export async function GET(request: Request) {
	const { searchParams } = new URL(request.url);
	const query = (searchParams.get("q") ?? "").trim();

	if (query.length < 2) {
		return NextResponse.json({ results: [] });
	}

	try {
		const normalizedQuery = query.toLowerCase();
		const kvParts = await getAllCatalogPartsFromKv();

		if (kvParts.length > 0) {
			const candidates = kvParts
				.map((part) => ({
					part_num: part.part_num,
					name: part.name,
					part_img_url: part.part_img_url,
					rank: getTextRank(part, normalizedQuery),
				}))
				.filter((part) => part.rank < 99)
				.sort((a, b) => {
					if (a.rank !== b.rank) return a.rank - b.rank;
					return a.part_num.localeCompare(b.part_num);
				})
				.slice(0, 300);

			let popularityByPart = new Map<string, { set_count: number }>();
			try {
				popularityByPart = await getPopularityByPartNums(candidates.map((part) => part.part_num));
			} catch {
				popularityByPart = new Map();
			}

			const results = candidates
				.sort((a, b) => {
					if (a.rank !== b.rank) return a.rank - b.rank;
					const aPopularity = Number(popularityByPart.get(a.part_num)?.set_count ?? 0);
					const bPopularity = Number(popularityByPart.get(b.part_num)?.set_count ?? 0);
					if (aPopularity !== bPopularity) return bPopularity - aPopularity;
					return a.part_num.localeCompare(b.part_num);
				})
				.slice(0, 10)
				.map(({ part_num, name, part_img_url }) => ({ part_num, name, part_img_url }));

			return NextResponse.json({ results });
		}

		const apiKey = getRuntimeEnvValue("REBRICKABLE_API_KEY");
		if (!apiKey) {
			return NextResponse.json({ error: "No hay cache KV cargado y falta REBRICKABLE_API_KEY." }, { status: 500 });
		}

		const url = new URL("https://rebrickable.com/api/v3/lego/parts/");
		url.searchParams.set("search", query);
		url.searchParams.set("page_size", "10");
		url.searchParams.set("inc_part_details", "1");
		url.searchParams.set("key", apiKey);

		const response = await fetch(url.toString(), {
			headers: {
				Accept: "application/json",
				Authorization: `key ${apiKey}`,
				"User-Agent": "lego-piezas-faltantes/1.0",
			},
			next: { revalidate: 300 },
		});

		if (!response.ok) {
			return NextResponse.json({ error: `Error consultando catalogo (${response.status}).` }, { status: response.status });
		}

		const payload = (await response.json()) as { results?: RebrickablePart[] };
		const base = (payload.results ?? []).map((part) => ({
			part_num: part.part_num,
			name: part.name,
			part_img_url: part.part_img_url ?? null,
		}));

		let popularityByPart = new Map<string, { set_count: number }>();
		try {
			popularityByPart = await getPopularityByPartNums(base.map((part) => part.part_num));
		} catch {
			popularityByPart = new Map();
		}

		const results = base
			.sort((a, b) => {
				const aNum = a.part_num.toLowerCase();
				const bNum = b.part_num.toLowerCase();
				const aNumKey = a.part_num.trim().toUpperCase();
				const bNumKey = b.part_num.trim().toUpperCase();
				const aRank = aNum === normalizedQuery ? 0 : aNum.startsWith(normalizedQuery) ? 1 : 2;
				const bRank = bNum === normalizedQuery ? 0 : bNum.startsWith(normalizedQuery) ? 1 : 2;
				if (aRank !== bRank) return aRank - bRank;

				const aPopularity = Number(popularityByPart.get(aNumKey)?.set_count ?? 0);
				const bPopularity = Number(popularityByPart.get(bNumKey)?.set_count ?? 0);
				if (aPopularity !== bPopularity) return bPopularity - aPopularity;

				return aNum.localeCompare(bNum);
			})
			.slice(0, 10);

		return NextResponse.json({ results });
	} catch {
		return NextResponse.json({ error: "No se pudo buscar en catalogo." }, { status: 500 });
	}
}
