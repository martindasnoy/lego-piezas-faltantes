import { NextResponse } from "next/server";
import {
	fetchAllCategoryPartsFromRebrickable,
	fetchPartColorsFromRebrickable,
	fetchTopLevelCategoriesFromRebrickable,
	getCachedCategories,
	getCachedCategoryAllParts,
	getCatalogKvBinding,
	setCachedCategories,
	setCachedCategoryAllParts,
	type CatalogCategory,
} from "@/lib/rebrickable-catalog-cache";
import { getRuntimeEnvValue } from "@/lib/runtime-env";
import { buildCacheKey, normalizeColorName, upsertCachedImages } from "@/lib/image-cache-db";
import { getPopularityByPartNums, upsertPopularities } from "@/lib/part-popularity-db";
import { staticRebrickableCategories } from "@/lib/rebrickable-categories-static";

const DEFAULT_BATCH_SIZE = 1;
const REQUEST_TIMEOUT_MS = 10000;

type Body = {
	offset?: number;
	batch_size?: number;
	sync_categories?: boolean;
};

function getRebrickableHeaders(apiKey: string) {
	return {
		Accept: "application/json",
		Authorization: `key ${apiKey}`,
		"User-Agent": "lego-piezas-faltantes/1.0",
	};
}

async function fetchSetCountByPartNum(partNum: string, apiKey: string) {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	try {
		const url = new URL(`https://rebrickable.com/api/v3/lego/parts/${encodeURIComponent(partNum)}/sets/`);
		url.searchParams.set("page_size", "1");
		url.searchParams.set("key", apiKey);

		const response = await fetch(url.toString(), {
			headers: getRebrickableHeaders(apiKey),
			next: { revalidate: 60 * 60 * 24 },
			signal: controller.signal,
		});

		if (response.status === 404) return 0;
		if (!response.ok) throw new Error(String(response.status));

		const payload = (await response.json()) as { count?: number };
		return Math.max(0, Number(payload.count ?? 0) || 0);
	} finally {
		clearTimeout(timeout);
	}
}

function asCategoryList(categories: CatalogCategory[] | undefined) {
	if (categories && categories.length > 0) return categories;
	return staticRebrickableCategories.map((row) => ({ id: Number(row.id), name: String(row.name), part_count: Number(row.part_count ?? 0) || 0 }));
}

export async function POST(request: Request) {
	let body: Body = {};
	try {
		body = (await request.json()) as Body;
	} catch {
		body = {};
	}

	const offset = Math.max(0, Number(body.offset ?? 0) || 0);
	const batchSize = Math.max(1, Math.min(5, Number(body.batch_size ?? DEFAULT_BATCH_SIZE) || DEFAULT_BATCH_SIZE));
	const syncCategories = Boolean(body.sync_categories);

	const kv = getCatalogKvBinding();
	if (!kv) {
		return NextResponse.json({ error: "CATALOG_CACHE binding missing." }, { status: 500 });
	}

	const apiKey = getRuntimeEnvValue("REBRICKABLE_API_KEY");
	if (!apiKey) {
		return NextResponse.json({ error: "Configura REBRICKABLE_API_KEY." }, { status: 500 });
	}

	try {
		const beforeCategories = asCategoryList((await getCachedCategories(kv))?.categories);
		let categories = beforeCategories;
		let newCategories = 0;

		if (syncCategories) {
			const fetched = await fetchTopLevelCategoriesFromRebrickable(apiKey);
			await setCachedCategories(fetched, kv);
			categories = fetched;
			const beforeIds = new Set(beforeCategories.map((row) => row.id));
			newCategories = fetched.filter((row) => !beforeIds.has(row.id)).length;
		}

		const totalCategories = categories.length;
		if (offset >= totalCategories) {
			return NextResponse.json({
				ok: true,
				total_categories: totalCategories,
				offset,
				processed_categories: 0,
				next_offset: null,
				done: true,
				new_categories: newCategories,
			});
		}

		const chunk = categories.slice(offset, offset + batchSize);
		const stats: Array<{
			category_id: number;
			ok: boolean;
			total_parts: number;
			new_parts: number;
			new_color_variants: number;
			new_popularity_rows: number;
			error?: string;
		}> = [];

		for (const category of chunk) {
			try {
				const previous = await getCachedCategoryAllParts(String(category.id), kv);
				const previousParts = new Set((previous?.parts ?? []).map((row) => String(row.part_num ?? "").trim().toUpperCase()).filter(Boolean));

				const latest = await fetchAllCategoryPartsFromRebrickable(String(category.id), apiKey);
				await setCachedCategoryAllParts(String(category.id), latest, kv);

				const latestPartNums = [...new Set(latest.map((row) => String(row.part_num ?? "").trim().toUpperCase()).filter(Boolean))];
				const newPartNums = latestPartNums.filter((partNum) => !previousParts.has(partNum));

				let newColorVariants = 0;
				if (newPartNums.length > 0) {
					for (const partNum of newPartNums) {
						let colors: Array<{ color_name: string; part_img_url: string | null }> = [];
						try {
							colors = await fetchPartColorsFromRebrickable(partNum, apiKey);
						} catch {
							colors = [];
						}

						const imageRows = colors.map((color) => ({
							cache_key: buildCacheKey(partNum, color.color_name),
							part_num: partNum,
							color_name: color.color_name ?? "",
							color_name_norm: normalizeColorName(color.color_name),
							part_img_url: color.part_img_url ?? null,
							status: color.part_img_url ? ("found" as const) : ("missing" as const),
						}));

						if (imageRows.length > 0) {
							await upsertCachedImages(imageRows);
							newColorVariants += imageRows.length;
						}
					}
				}

				let newPopularityRows = 0;
				if (newPartNums.length > 0) {
					const existingPopularity = await getPopularityByPartNums(newPartNums);
					const missingPopularity = newPartNums.filter((partNum) => !existingPopularity.has(partNum));
					if (missingPopularity.length > 0) {
						const rows: Array<{ part_num: string; set_count: number }> = [];
						for (const partNum of missingPopularity) {
							try {
								const setCount = await fetchSetCountByPartNum(partNum, apiKey);
								rows.push({ part_num: partNum, set_count: setCount });
							} catch {
								rows.push({ part_num: partNum, set_count: 0 });
							}
						}
						await upsertPopularities(rows);
						newPopularityRows = rows.length;
					}
				}

				stats.push({
					category_id: category.id,
					ok: true,
					total_parts: latestPartNums.length,
					new_parts: newPartNums.length,
					new_color_variants: newColorVariants,
					new_popularity_rows: newPopularityRows,
				});
			} catch (error) {
				stats.push({
					category_id: category.id,
					ok: false,
					total_parts: 0,
					new_parts: 0,
					new_color_variants: 0,
					new_popularity_rows: 0,
					error: error instanceof Error ? error.message : "error",
				});
			}
		}

		const nextOffset = offset + chunk.length;
		return NextResponse.json({
			ok: true,
			total_categories: totalCategories,
			offset,
			processed_categories: chunk.length,
			next_offset: nextOffset < totalCategories ? nextOffset : null,
			done: nextOffset >= totalCategories,
			new_categories: newCategories,
			stats,
		});
	} catch (error) {
		const detail = error instanceof Error ? error.message : "error";
		return NextResponse.json({ error: `No se pudo completar el chequeo de piezas (${detail}).` }, { status: 500 });
	}
}
