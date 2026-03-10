import { unstable_cache } from "next/cache";
import { getCatalogKvBinding } from "@/lib/rebrickable-catalog-cache";

const REBRICKABLE_THEMES_API = "https://rebrickable.com/api/v3/lego/themes/";
const REBRICKABLE_SETS_API = "https://rebrickable.com/api/v3/lego/sets/";
const PREWARM_REVALIDATE_SECONDS = 60 * 60 * 24 * 10;
const MINIFIG_CACHE_VERSION = "v1";
const MINIFIG_THEMES_KV_KEY = `minifig:${MINIFIG_CACHE_VERSION}:themes`;

function getMinifigThemeFiguresKvKey(themeId: number) {
	return `minifig:${MINIFIG_CACHE_VERSION}:theme:${themeId}:figures`;
}

type RebrickableTheme = {
	id: number;
	name: string;
	parent_id: number | null;
};

type RebrickableSet = {
	set_num: string;
	name: string;
	year?: number | null;
	set_img_url?: string | null;
};

type RebrickableSetPart = {
	quantity: number;
	part?: {
		part_num: string;
		name: string;
		part_img_url?: string | null;
	} | null;
	color?: {
		name: string;
	} | null;
	is_spare?: boolean;
};

export type CachedMinifigureTheme = {
	id: number;
	name: string;
	year: number | null;
	itemCount: number;
};

export type CachedMinifigureEntry = {
	name: string;
	imageUrl: string | null;
	setNum: string;
};

export type CachedMinifigurePart = {
	part_num: string;
	name: string;
	quantity: number;
	color_name: string | null;
	part_img_url: string | null;
	is_spare: boolean;
};

type MinifigureThemesKvPayload = {
	updatedAt: string;
	results: CachedMinifigureTheme[];
};

type MinifigureThemeFiguresKvPayload = {
	updatedAt: string;
	themeId: number;
	results: CachedMinifigureEntry[];
};

type ThemeStats = {
	itemCount: number;
	year: number | null;
};

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
	});

	if (direct.ok) {
		return (await direct.json()) as T;
	}

	if (direct.status !== 403) {
		throw new Error(String(direct.status));
	}

	const proxyUrl = `https://r.jina.ai/http://${url.replace(/^https?:\/\//, "")}`;
	const proxied = await fetch(proxyUrl, {
		headers: { Accept: "text/plain" },
	});

	if (!proxied.ok) {
		throw new Error(String(proxied.status));
	}

	const text = await proxied.text();
	return extractJsonObject(text) as T;
}

function inferThemeYear(displayName: string) {
	const seriesMatch = displayName.match(/^Serie\s*(\d+)$/i);
	if (seriesMatch) {
		const series = Number(seriesMatch[1]);
		const yearBySeries: Record<number, number> = {
			1: 2010,
			2: 2010,
			3: 2011,
			4: 2011,
			5: 2011,
			6: 2012,
			7: 2012,
			8: 2013,
			9: 2013,
			10: 2013,
			11: 2013,
			12: 2014,
			13: 2015,
			14: 2015,
			15: 2016,
			16: 2016,
			17: 2017,
			18: 2018,
			19: 2019,
			20: 2020,
			21: 2021,
			22: 2022,
			23: 2023,
			24: 2023,
			25: 2024,
			26: 2024,
			27: 2025,
		};

		return yearBySeries[series] ?? null;
	}

	if (/^Team GB \(Olimpiadas\)$/i.test(displayName)) return 2012;
	if (/^The Simpsons - Serie\s*1$/i.test(displayName)) return 2014;
	if (/^The Simpsons - Serie\s*2$/i.test(displayName)) return 2015;
	if (/^Disney - Serie\s*1$/i.test(displayName)) return 2016;
	if (/^LEGO Batman Movie - Serie\s*1$/i.test(displayName)) return 2017;
	if (/^LEGO Batman Movie - Serie\s*2$/i.test(displayName)) return 2018;
	if (/^Harry Potter - Serie\s*1$/i.test(displayName)) return 2018;
	if (/^Disney - Serie\s*2$/i.test(displayName)) return 2019;
	if (/^Harry Potter - Serie\s*2$/i.test(displayName)) return 2020;
	if (/^Dungeons & Dragons$/i.test(displayName)) return 2024;

	return null;
}

function normalizeSeriesName(name: string) {
	return name
		.replace(/^collectible minifigures\s*>\s*/i, "")
		.replace(/^collectable minifigures\s*>\s*/i, "")
		.replace(/^collectible minifigures\s*/i, "")
		.replace(/^collectable minifigures\s*/i, "")
		.replace(/\s*minifigures$/i, "")
		.replace(/^series\s*/i, "Series ")
		.trim();
}

function toDisplayThemeName(name: string) {
	const n = name.trim();

	const regularSeries = n.match(/^Series\s*(\d+)$/i);
	if (regularSeries) return `Serie ${regularSeries[1]}`;

	const simpsons = n.match(/^The Simpsons\s*Series\s*(\d+)$/i);
	if (simpsons) return `The Simpsons - Serie ${simpsons[1]}`;

	const disney = n.match(/^Disney\s*Series\s*(\d+)$/i);
	if (disney) return `Disney - Serie ${disney[1]}`;

	const harryPotter = n.match(/^Harry Potter\s*Series\s*(\d+)$/i);
	if (harryPotter) return `Harry Potter - Serie ${harryPotter[1]}`;

	const batmanMovie = n.match(/^LEGO Batman Movie\s*Series\s*(\d+)$/i);
	if (batmanMovie) return `LEGO Batman Movie - Serie ${batmanMovie[1]}`;

	if (/^Team GB$/i.test(n)) return "Team GB (Olimpiadas)";
	if (/Dungeons\s*&\s*Dragons/i.test(n)) return "Dungeons & Dragons";

	return n;
}

function startsWithCollectiblePrefix(themePath: string) {
	const lowered = themePath.trim().toLowerCase();
	return lowered.startsWith("collectible minifigures >") || lowered.startsWith("collectable minifigures >");
}

function buildThemePath(themeId: number, themesById: Map<number, RebrickableTheme>) {
	const names: string[] = [];
	const visited = new Set<number>();
	let currentId: number | null = themeId;

	while (currentId !== null && !visited.has(currentId)) {
		visited.add(currentId);
		const theme = themesById.get(currentId);
		if (!theme) break;
		names.unshift(theme.name.trim());
		currentId = theme.parent_id;
	}

	return names.join(" > ");
}

function sortThemes(a: { name: string }, b: { name: string }) {
	const aSeries = a.name.match(/^Serie\s*(\d+)$/i);
	const bSeries = b.name.match(/^Serie\s*(\d+)$/i);

	if (aSeries && bSeries) {
		return Number(aSeries[1]) - Number(bSeries[1]);
	}

	if (aSeries) return -1;
	if (bSeries) return 1;

	return a.name.localeCompare(b.name, "es", { sensitivity: "base" });
}

function pickMinifigureName(setName: string) {
	const dashIndex = setName.indexOf(" - ");
	if (dashIndex >= 0) {
		return setName.slice(dashIndex + 3).trim();
	}
	return setName.trim();
}

function shouldExcludeEntry(name: string) {
	const normalized = name.trim().toLowerCase();
	if (/\b(pack|complete|box|bag|sets?)\b/.test(normalized)) return true;
	if (/^[0-9]{5,}[a-z0-9]*-[0-9]+$/i.test(normalized)) return true;
	return false;
}

async function fetchThemesByUrl(url: string) {
	const keyMatch = url.match(/[?&]key=([^&]+)/);
	const apiKey = keyMatch ? decodeURIComponent(keyMatch[1]) : "";
	if (!apiKey) throw new Error("missing-api-key");
	return fetchRebrickableJson<{ results?: RebrickableTheme[]; next?: string | null }>(url, apiKey);
}

async function fetchAllThemes(apiKey: string) {
	const all: RebrickableTheme[] = [];
	let nextUrl: string | null = `${REBRICKABLE_THEMES_API}?page_size=200&key=${encodeURIComponent(apiKey)}`;

	while (nextUrl) {
		const page = await fetchThemesByUrl(nextUrl);
		all.push(...(page.results ?? []));
		nextUrl = page.next ?? null;
	}

	return all;
}

async function fetchThemeStats(themeId: number, apiKey: string): Promise<ThemeStats> {
	const url = new URL(REBRICKABLE_SETS_API);
	url.searchParams.set("theme_id", String(themeId));
	url.searchParams.set("page_size", "500");
	url.searchParams.set("key", apiKey);

	let payload: { results?: RebrickableSet[] };
	try {
		payload = await fetchRebrickableJson<{ results?: RebrickableSet[] }>(url.toString(), apiKey);
	} catch {
		return { itemCount: 0, year: null };
	}
	const rows = payload.results ?? [];
	const names = [...new Set(rows.map((set) => pickMinifigureName(set.name)).filter((name) => name && !shouldExcludeEntry(name)))];
	const years = rows
		.map((set) => Number(set.year ?? 0))
		.filter((year) => Number.isFinite(year) && year > 0);

	return {
		itemCount: names.length,
		year: years.length > 0 ? Math.min(...years) : null,
	};
}

async function fetchMinifiguresByTheme(themeId: number, apiKey: string) {
	const url = new URL(REBRICKABLE_SETS_API);
	url.searchParams.set("theme_id", String(themeId));
	url.searchParams.set("page_size", "500");
	url.searchParams.set("key", apiKey);

	const payload = await fetchRebrickableJson<{ results?: RebrickableSet[] }>(url.toString(), apiKey);
	const byName = new Map<string, CachedMinifigureEntry>();

	for (const set of payload.results ?? []) {
		const name = pickMinifigureName(set.name);
		if (!name || shouldExcludeEntry(name)) continue;

		const existing = byName.get(name);
		const nextImage = set.set_img_url ?? null;

		if (!existing) {
			byName.set(name, { name, imageUrl: nextImage, setNum: set.set_num });
			continue;
		}

		if ((!existing.imageUrl && nextImage) || !existing.setNum) {
			byName.set(name, { ...existing, imageUrl: existing.imageUrl ?? nextImage, setNum: existing.setNum || set.set_num });
		}
	}

	return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" }));
}

async function fetchMinifigureParts(setNum: string, apiKey: string) {
	const url = new URL(`${REBRICKABLE_SETS_API}${encodeURIComponent(setNum)}/parts/`);
	url.searchParams.set("page_size", "1000");
	url.searchParams.set("inc_minifig_parts", "1");
	url.searchParams.set("inc_spares", "1");
	url.searchParams.set("key", apiKey);

	const payload = await fetchRebrickableJson<{ results?: RebrickableSetPart[] }>(url.toString(), apiKey);
	return (payload.results ?? [])
		.filter((item) => item.part?.part_num && item.part?.name)
		.map((item) => ({
			part_num: item.part?.part_num ?? "",
			name: item.part?.name ?? "",
			quantity: item.quantity,
			color_name: item.color?.name ?? null,
			part_img_url: item.part?.part_img_url ?? null,
			is_spare: Boolean(item.is_spare),
		}));
}

export async function getCachedMinifigureThemes(apiKey: string): Promise<CachedMinifigureTheme[]> {
	const cacheFn = unstable_cache(
		async () => {
			const allThemes = await fetchAllThemes(apiKey);
			const unique = new Map<number, RebrickableTheme>();
			const themesById = new Map<number, RebrickableTheme>(allThemes.map((theme) => [theme.id, theme]));

			for (const theme of allThemes) {
				const themePath = buildThemePath(theme.id, themesById);
				if (!startsWithCollectiblePrefix(themePath)) continue;

				const normalizedName = normalizeSeriesName(themePath);
				if (!normalizedName) continue;

				unique.set(theme.id, {
					...theme,
					name: normalizedName,
				});
			}

			const rawResults = [...unique.values()]
				.map((theme) => {
					const displayName = toDisplayThemeName(theme.name);
					return {
						id: theme.id,
						name: displayName,
						year: inferThemeYear(displayName),
					};
				})
				.sort(sortThemes);

			const resultsWithCount = await Promise.all(
				rawResults.map(async (theme) => {
					try {
						const stats = await fetchThemeStats(theme.id, apiKey);
						return {
							...theme,
							year: theme.year ?? stats.year,
							itemCount: stats.itemCount,
						};
					} catch {
						return {
							...theme,
							year: theme.year ?? null,
							itemCount: 0,
						};
					}
				}),
			);

			return resultsWithCount;
		},
		["rebrickable-cmf-themes-v1"],
		{ revalidate: PREWARM_REVALIDATE_SECONDS },
	);

	return cacheFn();
}

export async function getCachedMinifigureThemesFromKv(kvBinding?: KVNamespace | null) {
	const kv = kvBinding ?? getCatalogKvBinding();
	if (!kv) return null;

	const raw = await kv.get(MINIFIG_THEMES_KV_KEY);
	if (!raw) return null;

	try {
		const parsed = JSON.parse(raw) as MinifigureThemesKvPayload;
		if (!Array.isArray(parsed.results)) return null;
		return {
			updatedAt: String(parsed.updatedAt ?? new Date(0).toISOString()),
			results: parsed.results,
		};
	} catch {
		return null;
	}
}

export async function setCachedMinifigureThemesToKv(themes: CachedMinifigureTheme[], kvBinding?: KVNamespace | null) {
	const kv = kvBinding ?? getCatalogKvBinding();
	if (!kv) throw new Error("CATALOG_CACHE binding missing");

	await kv.put(
		MINIFIG_THEMES_KV_KEY,
		JSON.stringify({
			updatedAt: new Date().toISOString(),
			results: themes,
		} satisfies MinifigureThemesKvPayload),
	);
}

export async function getCachedMinifiguresByThemeFromKv(themeId: number, kvBinding?: KVNamespace | null) {
	const kv = kvBinding ?? getCatalogKvBinding();
	if (!kv) return null;

	const raw = await kv.get(getMinifigThemeFiguresKvKey(themeId));
	if (!raw) return null;

	try {
		const parsed = JSON.parse(raw) as MinifigureThemeFiguresKvPayload;
		if (!Array.isArray(parsed.results)) return null;
		return {
			updatedAt: String(parsed.updatedAt ?? new Date(0).toISOString()),
			themeId: Number(parsed.themeId ?? themeId),
			results: parsed.results,
		};
	} catch {
		return null;
	}
}

export async function setCachedMinifiguresByThemeToKv(themeId: number, entries: CachedMinifigureEntry[], kvBinding?: KVNamespace | null) {
	const kv = kvBinding ?? getCatalogKvBinding();
	if (!kv) throw new Error("CATALOG_CACHE binding missing");

	await kv.put(
		getMinifigThemeFiguresKvKey(themeId),
		JSON.stringify({
			updatedAt: new Date().toISOString(),
			themeId,
			results: entries,
		} satisfies MinifigureThemeFiguresKvPayload),
	);
}

export async function getCachedMinifiguresByTheme(themeId: number, apiKey: string): Promise<CachedMinifigureEntry[]> {
	const cacheFn = unstable_cache(
		async () => fetchMinifiguresByTheme(themeId, apiKey),
		["rebrickable-cmf-theme-figures-v1", String(themeId)],
		{ revalidate: PREWARM_REVALIDATE_SECONDS },
	);

	return cacheFn();
}

export async function getCachedMinifigureParts(setNum: string, apiKey: string): Promise<CachedMinifigurePart[]> {
	const normalized = setNum.trim().toUpperCase();
	const cacheFn = unstable_cache(
		async () => fetchMinifigureParts(normalized, apiKey),
		["rebrickable-cmf-figure-parts-v1", normalized],
		{ revalidate: PREWARM_REVALIDATE_SECONDS },
	);

	return cacheFn();
}
