import { NextResponse } from "next/server";
import { getRuntimeEnvValue } from "@/lib/runtime-env";
import { toRebrickableImageProxyUrl } from "@/lib/rebrickable-image-proxy";

const REBRICKABLE_PARTS_API_BASE = "https://rebrickable.com/api/v3/lego/parts/";
const FALLBACK_COLOR_NAMES = [
	"light bluish gray",
	"light bluish grey",
	"medium stone gray",
	"medium stone grey",
];

type ImageRequestItem = {
	part_num: string;
	color_name?: string | null;
};

type ColorResult = {
	color_id: number;
	color_name: string;
	part_img_url?: string | null;
};

type PartColorPayload = {
	results?: ColorResult[];
};

type PartPayload = {
	part_img_url?: string | null;
};

function normalizeColorName(raw: string | null | undefined): string {
	if (!raw) return "";
	const withoutSuffix = raw.replace(/\(chino\)/gi, "");
	return withoutSuffix
		.toLowerCase()
		.replace(/grey/g, "gray")
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

function getImageKey(partNum: string, colorName: string | null | undefined): string {
	return `${partNum.trim()}::${normalizeColorName(colorName)}`;
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
		next: { revalidate: 86400 },
	});

	if (direct.ok) {
		return (await direct.json()) as T;
	}

	if (direct.status !== 403) {
		throw new Error("rebrickable-fetch-error");
	}

	const proxyUrl = `https://r.jina.ai/http://${url.replace(/^https?:\/\//, "")}`;
	const proxied = await fetch(proxyUrl, {
		headers: { Accept: "text/plain" },
		next: { revalidate: 86400 },
	});

	if (!proxied.ok) {
		throw new Error("rebrickable-proxy-fetch-error");
	}

	const text = await proxied.text();
	return extractJsonObject(text) as T;
}

async function fetchPartColors(partNum: string, apiKey: string): Promise<ColorResult[]> {
	const url = new URL(`${REBRICKABLE_PARTS_API_BASE}${encodeURIComponent(partNum)}/colors/`);
	url.searchParams.set("page_size", "1000");
	url.searchParams.set("key", apiKey);
	const payload = await fetchRebrickableJson<PartColorPayload>(url.toString(), apiKey);
	return payload.results ?? [];
}

async function fetchGenericPartImage(partNum: string, apiKey: string): Promise<string | null> {
	const url = new URL(`${REBRICKABLE_PARTS_API_BASE}${encodeURIComponent(partNum)}/`);
	url.searchParams.set("key", apiKey);
	try {
		const payload = await fetchRebrickableJson<PartPayload>(url.toString(), apiKey);
		return payload.part_img_url ?? null;
	} catch {
		return null;
	}
}

function pickBestColorImage(colors: ColorResult[], requestedColorName: string | null | undefined): string | null {
	if (colors.length === 0) return null;

	const byName = new Map<string, ColorResult>();
	for (const color of colors) {
		const normalized = normalizeColorName(color.color_name);
		if (!normalized) continue;
		if (!byName.has(normalized)) {
			byName.set(normalized, color);
		}
	}

	const requested = normalizeColorName(requestedColorName);
	if (requested) {
		const requestedCandidates = [requested, ...getColorAliases(requested)];
		for (const candidate of requestedCandidates) {
			const found = byName.get(candidate);
			if (found?.part_img_url) return found.part_img_url;
		}
	}

	for (const fallbackName of FALLBACK_COLOR_NAMES) {
		const found = byName.get(normalizeColorName(fallbackName));
		if (found?.part_img_url) return found.part_img_url;
	}

	for (const color of colors) {
		if (color.part_img_url) return color.part_img_url;
	}

	return null;
}

export async function POST(request: Request) {
	const apiKey = getRuntimeEnvValue("REBRICKABLE_API_KEY");
	if (!apiKey) {
		return NextResponse.json({ error: "Configura REBRICKABLE_API_KEY." }, { status: 500 });
	}

	let body: { items?: ImageRequestItem[] };
	try {
		body = (await request.json()) as { items?: ImageRequestItem[] };
	} catch {
		return NextResponse.json({ error: "Body invalido." }, { status: 400 });
	}

	const items = (body.items ?? [])
		.map((item) => ({
			part_num: (item.part_num ?? "").trim(),
			color_name: item.color_name ?? null,
		}))
		.filter((item) => item.part_num.length > 0)
		.slice(0, 150);

	if (items.length === 0) {
		return NextResponse.json({ results: [] });
	}

	const uniqueByKey = new Map<string, ImageRequestItem>();
	for (const item of items) {
		const key = getImageKey(item.part_num, item.color_name);
		if (!uniqueByKey.has(key)) {
			uniqueByKey.set(key, item);
		}
	}

	const uniqueItems = [...uniqueByKey.entries()].map(([key, item]) => ({ key, ...item }));

	const results = await Promise.all(
		uniqueItems.map(async (item) => {
			try {
				const colors = await fetchPartColors(item.part_num, apiKey);
				const picked = pickBestColorImage(colors, item.color_name);
				if (picked) {
					return { key: item.key, part_num: item.part_num, part_img_url: picked };
				}

				const generic = await fetchGenericPartImage(item.part_num, apiKey);
				return { key: item.key, part_num: item.part_num, part_img_url: generic };
			} catch {
				const generic = await fetchGenericPartImage(item.part_num, apiKey);
				return { key: item.key, part_num: item.part_num, part_img_url: generic };
			}
		}),
	);

	const proxied = results.map((result) => ({
		...result,
		part_img_url: toRebrickableImageProxyUrl(result.part_img_url) ?? null,
	}));

	return NextResponse.json({ results: proxied });
}
