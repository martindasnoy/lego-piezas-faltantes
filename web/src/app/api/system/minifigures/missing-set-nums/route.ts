import { NextResponse } from "next/server";
import { getCatalogKvBinding } from "@/lib/rebrickable-catalog-cache";
import { getCachedMinifigureThemesFromKv, getCachedMinifiguresByThemeFromKv } from "@/lib/rebrickable-minifig-cache";
import { listDistinctMinifigPartSetNums } from "@/lib/minifig-parts-db";

export async function GET(request: Request) {
	const { searchParams } = new URL(request.url);
	const limit = Math.max(1, Math.min(5000, Number(searchParams.get("limit") ?? "200") || 200));

	try {
		const kv = getCatalogKvBinding();
		const themes = (await getCachedMinifigureThemesFromKv(kv))?.results ?? [];
		const kvSetNums = new Set<string>();

		for (const theme of themes) {
			const figures = (await getCachedMinifiguresByThemeFromKv(theme.id, kv))?.results ?? [];
			for (const figure of figures) {
				const setNum = String(figure.setNum ?? "").trim().toUpperCase();
				if (setNum) kvSetNums.add(setNum);
			}
		}

		const dbSetNums = new Set(await listDistinctMinifigPartSetNums());
		const missing = [...kvSetNums].filter((setNum) => !dbSetNums.has(setNum)).sort((a, b) =>
			a.localeCompare(b, "en", { sensitivity: "base" }),
		);

		return NextResponse.json({
			total_kv_set_nums: kvSetNums.size,
			total_db_set_nums: dbSetNums.size,
			missing_count: missing.length,
			missing_set_nums: missing.slice(0, limit),
		});
	} catch {
		return NextResponse.json({ error: "No se pudieron calcular set_num faltantes de minifiguras." }, { status: 500 });
	}
}
