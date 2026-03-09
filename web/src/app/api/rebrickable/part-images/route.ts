import { NextResponse } from "next/server";
import { getRuntimeEnvValue } from "@/lib/runtime-env";
import { getCachedPartColors, getCatalogKvBinding } from "@/lib/rebrickable-catalog-cache";

const REBRICKABLE_PARTS_API_BASE = "https://rebrickable.com/api/v3/lego/parts/";
const MAX_ITEMS = 200;
const CHUNK_SIZE = 80;

type ImageRequestItem = {
	part_num: string;
	color_name?: string | null;
};

type RebrickablePart = {
	part_num: string;
	part_img_url?: string | null;
};

type RebrickablePartsPayload = {
	results?: RebrickablePart[];
};

const imageCacheByKey = new Map<string, string | null>();
const imageCacheByPartNum = new Map<string, string | null>();
const cooldownUntilByPartNum = new Map<string, number>();
const IMAGE_COOLDOWN_MS = 5000;

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

function getRebrickableHeaders(apiKey: string) {
	return {
		Accept: "application/json",
		Authorization: `key ${apiKey}`,
		"User-Agent": "lego-piezas-faltantes/1.0",
	};
}

async function fetchPartImageBatch(partNums: string[], apiKey: string) {
	if (partNums.length === 0) return new Map<string, string | null>();

	const url = new URL(REBRICKABLE_PARTS_API_BASE);
	url.searchParams.set("part_nums", partNums.join(","));
	url.searchParams.set("inc_part_details", "1");
	url.searchParams.set("page_size", String(partNums.length));
	url.searchParams.set("key", apiKey);

	const response = await fetch(url.toString(), {
		headers: getRebrickableHeaders(apiKey),
		next: { revalidate: 60 * 60 * 24 },
	});

	if (!response.ok) {
		throw new Error(String(response.status));
	}

	const payload = (await response.json()) as RebrickablePartsPayload;
	const byPart = new Map<string, string | null>();
	for (const part of payload.results ?? []) {
		byPart.set(part.part_num.toUpperCase(), part.part_img_url ?? null);
	}

	for (const partNum of partNums) {
		if (!byPart.has(partNum)) {
			byPart.set(partNum, null);
		}
	}

	return byPart;
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

	const now = Date.now();
	const kv = getCatalogKvBinding();
	const missingPartNums = new Set<string>();
	for (const item of items) {
		const key = getImageKey(item.part_num, item.color_name);
		if (imageCacheByKey.has(key)) continue;

		const cachedPartColors = await getCachedPartColors(item.part_num, kv);
		if (cachedPartColors?.colors?.length) {
			const picked = pickBestColorImage(cachedPartColors.colors, item.color_name);
			if (picked) {
				imageCacheByKey.set(key, picked);
				imageCacheByPartNum.set(item.part_num, picked);
				continue;
			}
		}

		if (imageCacheByPartNum.has(item.part_num)) continue;
		const cooldownUntil = cooldownUntilByPartNum.get(item.part_num) ?? 0;
		if (now < cooldownUntil) continue;
		missingPartNums.add(item.part_num);
	}

	const apiKey = getRuntimeEnvValue("REBRICKABLE_API_KEY");
	if (!apiKey) {
		for (const partNum of missingPartNums) {
			if (!imageCacheByPartNum.has(partNum)) {
				imageCacheByPartNum.set(partNum, null);
			}
		}
	}

	if (missingPartNums.size > 0 && apiKey) {
		const pending = [...missingPartNums];
		for (let index = 0; index < pending.length; index += CHUNK_SIZE) {
			const chunk = pending.slice(index, index + CHUNK_SIZE);
			try {
				const byPart = await fetchPartImageBatch(chunk, apiKey);
				for (const [partNum, imageUrl] of byPart.entries()) {
					imageCacheByPartNum.set(partNum, imageUrl);
				}
			} catch (error) {
				const code = error instanceof Error ? error.message : "";
				if (code === "429") {
					for (const partNum of chunk) {
						cooldownUntilByPartNum.set(partNum, Date.now() + IMAGE_COOLDOWN_MS);
					}
				}
				for (const partNum of chunk) {
					if (!imageCacheByPartNum.has(partNum)) {
						imageCacheByPartNum.set(partNum, null);
					}
				}
			}
		}
	}

	const results = items.map((item) => {
		const key = getImageKey(item.part_num, item.color_name);
		const cachedByKey = imageCacheByKey.get(key);
		if (cachedByKey !== undefined) {
			return { key, part_num: item.part_num, part_img_url: cachedByKey };
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
