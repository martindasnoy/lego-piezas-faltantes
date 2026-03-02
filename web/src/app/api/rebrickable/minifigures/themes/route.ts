import { NextResponse } from "next/server";
import { getRuntimeEnvValue } from "@/lib/runtime-env";

const REBRICKABLE_THEMES_API = "https://rebrickable.com/api/v3/lego/themes/";
const REBRICKABLE_SETS_API = "https://rebrickable.com/api/v3/lego/sets/";

type RebrickableTheme = {
	id: number;
	name: string;
	parent_id: number | null;
};

type RebrickableSet = {
	name: string;
	year?: number | null;
};

type ThemeStats = {
	itemCount: number;
	year: number | null;
};

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

function startsWithCollectiblePrefix(themeName: string) {
	const lowered = themeName.trim().toLowerCase();
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
	if (/\b(pack|complete|box|bag)\b/.test(normalized)) return true;
	if (/^[0-9]{5,}[a-z0-9]*-[0-9]+$/i.test(normalized)) return true;
	return false;
}

async function fetchThemeStats(themeId: number, apiKey: string): Promise<ThemeStats> {
	const url = new URL(REBRICKABLE_SETS_API);
	url.searchParams.set("theme_id", String(themeId));
	url.searchParams.set("page_size", "500");
	url.searchParams.set("key", apiKey);

	const response = await fetch(url.toString(), {
		headers: { Accept: "application/json" },
		next: { revalidate: 86400 },
	});

	if (!response.ok) return { itemCount: 0, year: null };
	const payload = (await response.json()) as { results?: RebrickableSet[] };
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

async function fetchThemesByUrl(url: string) {
	const response = await fetch(url, {
		headers: { Accept: "application/json" },
		next: { revalidate: 86400 },
	});

	if (!response.ok) {
		return { ok: false, results: [] as RebrickableTheme[] };
	}

	const payload = (await response.json()) as { results?: RebrickableTheme[]; next?: string | null };
	return { ok: true, results: payload.results ?? [], next: payload.next ?? null };
}

async function fetchAllThemes(apiKey: string) {
	const all: RebrickableTheme[] = [];
	let nextUrl: string | null = `${REBRICKABLE_THEMES_API}?page_size=200&key=${encodeURIComponent(apiKey)}`;

	while (nextUrl) {
		const page = await fetchThemesByUrl(nextUrl);
		if (!page.ok) return { ok: false, results: all };
		all.push(...page.results);
		nextUrl = page.next ?? null;
	}

	return { ok: true, results: all };
}

export async function GET() {
	const apiKey = getRuntimeEnvValue("REBRICKABLE_API_KEY");
	if (!apiKey) {
		return NextResponse.json({ error: "Configura REBRICKABLE_API_KEY." }, { status: 500 });
	}

	try {
		const allThemes = await fetchAllThemes(apiKey);
		if (!allThemes.ok) {
			return NextResponse.json({ error: "No se pudo obtener la lista de minifiguras." }, { status: 500 });
		}

		const unique = new Map<number, RebrickableTheme>();
		const themesById = new Map<number, RebrickableTheme>(allThemes.results.map((theme) => [theme.id, theme]));

		for (const theme of allThemes.results) {
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

		return NextResponse.json({ results: resultsWithCount });
	} catch {
		return NextResponse.json({ error: "No se pudo conectar con Rebrickable." }, { status: 500 });
	}
}
