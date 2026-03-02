import { NextResponse } from "next/server";
import { staticRebrickableCategories } from "@/lib/rebrickable-categories-static";
import { getCachedCategoryParts } from "@/lib/rebrickable-parts-cache";
import { getCachedMinifigureParts, getCachedMinifigureThemes, getCachedMinifiguresByTheme } from "@/lib/rebrickable-minifig-cache";
import { getRuntimeEnvValue } from "@/lib/runtime-env";

export async function POST(request: Request) {
	const { searchParams } = new URL(request.url);
	const categoryId = (searchParams.get("category_id") ?? "").trim();
	const minifigureThemeId = (searchParams.get("minifigure_theme_id") ?? "").trim();
	const includeParts = searchParams.get("include_parts") === "1";
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
			const themeIdNum = Number(minifigureThemeId);
			if (!Number.isFinite(themeIdNum) || themeIdNum <= 0) {
				return NextResponse.json({ error: "minifigure_theme_id invalido." }, { status: 400 });
			}

			const figures = await getCachedMinifiguresByTheme(themeIdNum, apiKey);
			let warmedParts = 0;
			let failedParts = 0;

			if (includeParts) {
				for (const figure of figures) {
					if (!figure.setNum) continue;
					try {
						await getCachedMinifigureParts(figure.setNum, apiKey);
						warmedParts += 1;
					} catch {
						failedParts += 1;
					}
				}
			}

			return NextResponse.json({
				ok: true,
				theme_id: themeIdNum,
				figures: figures.length,
				warmed_parts: warmedParts,
				failed_parts: failedParts,
			});
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
			const themes = await getCachedMinifigureThemes(apiKey);
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
