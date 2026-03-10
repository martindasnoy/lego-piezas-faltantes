import { NextResponse } from "next/server";
import { getCatalogKvBinding } from "@/lib/rebrickable-catalog-cache";
import { getCachedMinifigureThemesFromKv, getCachedMinifiguresByThemeFromKv } from "@/lib/rebrickable-minifig-cache";
import { countMinifigPartsRows } from "@/lib/minifig-parts-db";

export async function GET() {
	try {
		const kv = getCatalogKvBinding();
		const themes = (await getCachedMinifigureThemesFromKv(kv))?.results ?? [];

		let figuresCount = 0;
		for (const theme of themes) {
			const figures = (await getCachedMinifiguresByThemeFromKv(theme.id, kv))?.results ?? [];
			figuresCount += figures.length;
		}

		const partsCount = await countMinifigPartsRows();

		return NextResponse.json({
			themes_count: themes.length,
			figures_count: figuresCount,
			parts_count: partsCount,
			checked_at: new Date().toISOString(),
		});
	} catch {
		return NextResponse.json({ error: "No se pudieron calcular estadisticas de minifiguras." }, { status: 500 });
	}
}
