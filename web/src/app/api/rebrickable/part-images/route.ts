import { NextResponse } from "next/server";
import { getRuntimeEnvValue } from "@/lib/runtime-env";
import {
	fetchPartColorsFromRebrickable,
} from "@/lib/rebrickable-catalog-cache";
import {
	buildCacheKey,
	getCachedImagesByKeys,
	getFallbackImagesByPartNums,
	normalizeColorName,
	type PartImageCacheRow,
	upsertCachedImages,
} from "@/lib/image-cache-db";

const MAX_ITEMS = 200;

type ImageRequestItem = {
	part_num: string;
	color_name?: string | null;
};

const imageCacheByKey = new Map<string, string | null>();
const imageCacheByPartNum = new Map<string, string | null>();

function getImageKey(partNum: string, colorName: string | null | undefined) {
	return buildCacheKey(partNum, colorName);
}

function getColorAliases(normalized: string): string[] {
	const aliases: Record<string, string[]> = {
		"light bluish gray": ["medium stone gray"],
		"medium stone gray": ["light bluish gray"],
		"dark bluish gray": ["dark stone gray"],
		"dark stone gray": ["dark bluish gray"],
	};
	return aliases[normalized] ?? [];
}

function pickBestColorImage(
	colors: Array<{ color_name: string; part_img_url: string | null }>,
	requestedColorName: string | null | undefined,
) {
	if (colors.length === 0) return null;
	const byName = new Map<string, string | null>();
	for (const color of colors) {
		const normalized = normalizeColorName(color.color_name);
		if (!normalized) continue;
		if (!byName.has(normalized)) {
			byName.set(normalized, color.part_img_url ?? null);
		}
	}

	const requested = normalizeColorName(requestedColorName);
	if (requested) {
		for (const candidate of [requested, ...getColorAliases(requested)]) {
			const image = byName.get(candidate);
			if (image) return image;
		}
	}

	for (const color of colors) {
		if (color.part_img_url) return color.part_img_url;
	}

	return null;
}

export async function POST(request: Request) {
	let body: { items?: ImageRequestItem[] };
	try {
		body = (await request.json()) as { items?: ImageRequestItem[] };
	} catch {
		return NextResponse.json({ error: "Body invalido." }, { status: 400 });
	}

	const items = (body.items ?? [])
		.map((item) => ({
			part_num: (item.part_num ?? "").trim().toUpperCase(),
			color_name: item.color_name ?? null,
		}))
		.filter((item) => item.part_num.length > 0)
		.slice(0, MAX_ITEMS);

	if (items.length === 0) {
		return NextResponse.json({ results: [] });
	}

	const apiKey = getRuntimeEnvValue("REBRICKABLE_API_KEY");
	const partColorsByPartNum = new Map<string, Array<{ color_name: string; part_img_url: string | null }> | null>();
	const pendingWithoutCache = new Set<string>();
	const dbUpserts: Array<{
		cache_key: string;
		part_num: string;
		color_name: string;
		color_name_norm: string;
		part_img_url: string | null;
		status: "found" | "missing" | "error";
	}> = [];

	const keysToQuery = items.map((item) => getImageKey(item.part_num, item.color_name));
	let dbRowsByKey = new Map<string, PartImageCacheRow>();
	let fallbackByPartNum = new Map<string, string>();
	try {
		dbRowsByKey = await getCachedImagesByKeys(keysToQuery);
	} catch {
		dbRowsByKey = new Map();
	}

	try {
		fallbackByPartNum = await getFallbackImagesByPartNums(items.map((item) => item.part_num));
	} catch {
		fallbackByPartNum = new Map();
	}

	for (const item of items) {
		const key = getImageKey(item.part_num, item.color_name);
		if (imageCacheByKey.has(key)) continue;

		const dbRow = dbRowsByKey.get(key);
		if (dbRow) {
			if (dbRow.part_img_url) {
				imageCacheByKey.set(key, dbRow.part_img_url);
				imageCacheByPartNum.set(item.part_num, dbRow.part_img_url);
				continue;
			}

			if (dbRow.status === "missing") {
				const fallbackByCatalog = fallbackByPartNum.get(item.part_num) ?? null;
				if (fallbackByCatalog) {
					imageCacheByKey.set(key, fallbackByCatalog);
					imageCacheByPartNum.set(item.part_num, fallbackByCatalog);
					dbUpserts.push({
						cache_key: key,
						part_num: item.part_num,
						color_name: item.color_name ?? "",
						color_name_norm: normalizeColorName(item.color_name),
						part_img_url: fallbackByCatalog,
						status: "found",
					});
					continue;
				}
			}

			imageCacheByKey.set(key, null);
			continue;
		}

		if (imageCacheByPartNum.has(item.part_num)) continue;
		pendingWithoutCache.add(item.part_num);
	}

	for (const partNum of pendingWithoutCache) {
		if (!apiKey) {
			if (!imageCacheByPartNum.has(partNum)) imageCacheByPartNum.set(partNum, null);
			continue;
		}

		try {
			const colors = await fetchPartColorsFromRebrickable(partNum, apiKey);
			partColorsByPartNum.set(partNum, colors);

			const picked = pickBestColorImage(colors, null);
			imageCacheByPartNum.set(partNum, picked ?? null);
		} catch {
			partColorsByPartNum.set(partNum, null);
			if (!imageCacheByPartNum.has(partNum)) {
				imageCacheByPartNum.set(partNum, null);
			}
		}
	}

	for (const partNum of pendingWithoutCache) {
		if (!imageCacheByPartNum.has(partNum)) {
			imageCacheByPartNum.set(partNum, null);
		}
	}

	const results = items.map((item) => {
		const key = getImageKey(item.part_num, item.color_name);
		const cachedByKey = imageCacheByKey.get(key);
		if (cachedByKey !== undefined) {
			return { key, part_num: item.part_num, part_img_url: cachedByKey };
		}

		const partColors = partColorsByPartNum.get(item.part_num) ?? null;
		if (partColors && partColors.length > 0) {
			const picked = pickBestColorImage(partColors, item.color_name);
			const status = picked ? "found" : "missing";
			dbUpserts.push({
				cache_key: key,
				part_num: item.part_num,
				color_name: item.color_name ?? "",
				color_name_norm: normalizeColorName(item.color_name),
				part_img_url: picked ?? null,
				status,
			});
			imageCacheByKey.set(key, picked ?? null);
			return { key, part_num: item.part_num, part_img_url: picked ?? null };
		}

		const byPart = imageCacheByPartNum.get(item.part_num) ?? null;
		const fallbackByCatalog = fallbackByPartNum.get(item.part_num) ?? null;
		const finalImage = byPart ?? fallbackByCatalog;
		dbUpserts.push({
			cache_key: key,
			part_num: item.part_num,
			color_name: item.color_name ?? "",
			color_name_norm: normalizeColorName(item.color_name),
			part_img_url: finalImage,
			status: finalImage ? "found" : "missing",
		});
		imageCacheByKey.set(key, finalImage);
		return {
			key,
			part_num: item.part_num,
			part_img_url: finalImage,
		};
	});

	if (dbUpserts.length > 0) {
		try {
			await upsertCachedImages(dbUpserts);
		} catch {
			// keep response working even if DB write fails
		}
	}

	return NextResponse.json({ results });
}
