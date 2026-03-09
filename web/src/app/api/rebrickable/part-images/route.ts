import { NextResponse } from "next/server";
import { getRuntimeEnvValue } from "@/lib/runtime-env";
import {
	fetchPartColorsFromRebrickable,
	getCachedPartColors,
	getCatalogKvBinding,
	setCachedPartColors,
} from "@/lib/rebrickable-catalog-cache";

const MAX_ITEMS = 200;

type ImageRequestItem = {
	part_num: string;
	color_name?: string | null;
};

const imageCacheByKey = new Map<string, string | null>();
const imageCacheByPartNum = new Map<string, string | null>();

function getImageKey(partNum: string, colorName: string | null | undefined) {
	const normalizedColor = (colorName ?? "").toLowerCase().trim();
	return `${partNum.trim()}::${normalizedColor}`;
}

function normalizeColorName(raw: string | null | undefined): string {
	if (!raw) return "";
	return raw
		.toLowerCase()
		.replace(/grey/g, "gray")
		.replace(/\(chino\)/g, "")
		.replace(/\s+/g, " ")
		.trim();
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

	const kv = getCatalogKvBinding();
	const apiKey = getRuntimeEnvValue("REBRICKABLE_API_KEY");
	const partColorsByPartNum = new Map<string, Array<{ color_name: string; part_img_url: string | null }> | null>();
	const pendingWithoutCache = new Set<string>();

	for (const item of items) {
		const key = getImageKey(item.part_num, item.color_name);
		if (imageCacheByKey.has(key)) continue;

		let cachedPartColors = partColorsByPartNum.get(item.part_num);
		if (cachedPartColors === undefined) {
			const cached = await getCachedPartColors(item.part_num, kv);
			cachedPartColors = cached?.colors ?? null;
			partColorsByPartNum.set(item.part_num, cachedPartColors);
		}

		if (cachedPartColors && cachedPartColors.length > 0) {
			const picked = pickBestColorImage(cachedPartColors, item.color_name);
			if (picked) {
				imageCacheByKey.set(key, picked);
				imageCacheByPartNum.set(item.part_num, picked);
				continue;
			}
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
			await setCachedPartColors(partNum, colors, kv);
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
			if (picked) {
				imageCacheByKey.set(key, picked);
				return { key, part_num: item.part_num, part_img_url: picked };
			}
		}

		const byPart = imageCacheByPartNum.get(item.part_num) ?? null;
		imageCacheByKey.set(key, byPart);
		return {
			key,
			part_num: item.part_num,
			part_img_url: byPart,
		};
	});

	return NextResponse.json({ results });
}
