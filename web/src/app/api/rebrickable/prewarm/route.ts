import { NextResponse } from "next/server";
import { staticRebrickableCategories } from "@/lib/rebrickable-categories-static";
import { getCachedCategoryParts } from "@/lib/rebrickable-parts-cache";
import { getRuntimeEnvValue } from "@/lib/runtime-env";

const REBRICKABLE_THEMES_API = "https://rebrickable.com/api/v3/lego/themes/";
const REBRICKABLE_SETS_API = "https://rebrickable.com/api/v3/lego/sets/";

type RebrickableTheme = {
	id: number;
	name: string;
	parent_id: number | null;
};

type RebrickableSet = {
	set_num: string;
	name: string;
};

function normalizeThemeName(name: string) {
	return name
		.replace(/^collectible minifigures\s*>\s*/i, "")
		.replace(/^collectable minifigures\s*>\s*/i, "")
		.replace(/^collectible minifigures\s*/i, "")
		.replace(/^collectable minifigures\s*/i, "")
		.replace(/\s*minifigures$/i, "")
		.trim();
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

function pickMinifigureName(setName: string) {
	const dashIndex = setName.indexOf(" - ");
	if (dashIndex >= 0) return setName.slice(dashIndex + 3).trim();
	return setName.trim();
}

function shouldExcludeEntry(name: string) {
	const normalized = name.trim().toLowerCase();
	if (/\b(pack|complete|box|bag)\b/.test(normalized)) return true;
	if (/^[0-9]{5,}[a-z0-9]*-[0-9]+$/i.test(normalized)) return true;
	return false;
}

async function fetchAllThemes(apiKey: string) {
	const all: RebrickableTheme[] = [];
	let nextUrl: string | null = `${REBRICKABLE_THEMES_API}?page_size=200&key=${encodeURIComponent(apiKey)}`;

	while (nextUrl) {
		const response = await fetch(nextUrl, {
			headers: { Accept: "application/json" },
			next: { revalidate: 86400 },
		});
		if (!response.ok) throw new Error(String(response.status));

		const payload = (await response.json()) as { results?: RebrickableTheme[]; next?: string | null };
		all.push(...(payload.results ?? []));
		nextUrl = payload.next ?? null;
	}

	return all;
}

async function fetchCollectibleThemes(apiKey: string) {
	const themes = await fetchAllThemes(apiKey);
	const themesById = new Map<number, RebrickableTheme>(themes.map((theme) => [theme.id, theme]));

	return themes
		.map((theme) => {
			const themePath = buildThemePath(theme.id, themesById);
			return {
				id: theme.id,
				name: normalizeThemeName(themePath),
				path: themePath,
			};
		})
		.filter((theme) => startsWithCollectiblePrefix(theme.path) && theme.name.length > 0)
		.sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" }));
}

async function warmMinifigureTheme(themeId: string, apiKey: string) {
	const url = new URL(REBRICKABLE_SETS_API);
	url.searchParams.set("theme_id", themeId);
	url.searchParams.set("page_size", "500");
	url.searchParams.set("key", apiKey);

	const response = await fetch(url.toString(), {
		headers: { Accept: "application/json" },
		next: { revalidate: 86400 },
	});

	if (!response.ok) throw new Error(String(response.status));

	const payload = (await response.json()) as { results?: RebrickableSet[] };
	const uniqueNames = [...new Set((payload.results ?? []).map((set) => pickMinifigureName(set.name)).filter((name) => name && !shouldExcludeEntry(name)))];

	return {
		theme_id: Number(themeId),
		figures: uniqueNames.length,
	};
}

export async function POST(request: Request) {
	const { searchParams } = new URL(request.url);
	const categoryId = (searchParams.get("category_id") ?? "").trim();
	const minifigureThemeId = (searchParams.get("minifigure_theme_id") ?? "").trim();
	const token = request.headers.get("x-prewarm-token") ?? "";
	const configuredToken = getRuntimeEnvValue("REBRICKABLE_PREWARM_TOKEN");
	const apiKey = getRuntimeEnvValue("REBRICKABLE_API_KEY");

	if (!apiKey) {
		return NextResponse.json({ error: "Configura REBRICKABLE_API_KEY." }, { status: 500 });
	}

	if (configuredToken && token !== configuredToken) {
		return NextResponse.json({ error: "Token invalido." }, { status: 401 });
	}

	try {
		if (categoryId) {
			await getCachedCategoryParts(categoryId, apiKey);
			return NextResponse.json({ ok: true, category_id: categoryId });
		}

		if (minifigureThemeId) {
			const warmed = await warmMinifigureTheme(minifigureThemeId, apiKey);
			return NextResponse.json({ ok: true, ...warmed });
		}

		return NextResponse.json({ error: "Falta category_id o minifigure_theme_id." }, { status: 400 });
	} catch {
		return NextResponse.json({ error: "No se pudo completar el precalentado solicitado." }, { status: 500 });
	}
}

export async function GET(request: Request) {
	const { searchParams } = new URL(request.url);
	const token = request.headers.get("x-prewarm-token") ?? "";
	const configuredToken = getRuntimeEnvValue("REBRICKABLE_PREWARM_TOKEN");
	const apiKey = getRuntimeEnvValue("REBRICKABLE_API_KEY");
	const listMode = (searchParams.get("list") ?? "").trim();

	if (configuredToken && token !== configuredToken) {
		return NextResponse.json({ error: "Token invalido." }, { status: 401 });
	}

	if (listMode === "1") {
		return NextResponse.json({
			results: staticRebrickableCategories.map((category) => ({ id: category.id, name: category.name })),
		});
	}

	if (!apiKey) {
		return NextResponse.json({ error: "Configura REBRICKABLE_API_KEY." }, { status: 500 });
	}

	if (listMode === "minifigures") {
		try {
			const themes = await fetchCollectibleThemes(apiKey);
			return NextResponse.json({
				results: themes.map((theme) => ({ id: theme.id, name: theme.name })),
			});
		} catch {
			return NextResponse.json({ error: "No se pudo listar minifiguras para prewarm." }, { status: 500 });
		}
	}

	try {
		for (const category of staticRebrickableCategories) {
			await getCachedCategoryParts(String(category.id), apiKey);
		}
		return NextResponse.json({ ok: true, warmed: staticRebrickableCategories.length });
	} catch {
		return NextResponse.json({ error: "No se pudo completar el precalentado total." }, { status: 500 });
	}
}
