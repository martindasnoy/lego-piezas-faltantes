import { NextResponse } from "next/server";
import { getCatalogKvBinding } from "@/lib/rebrickable-catalog-cache";
import {
	getCachedMinifiguresByThemeFromKv,
} from "@/lib/rebrickable-minifig-cache";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const themeId = Number(id);
	if (!Number.isFinite(themeId) || themeId <= 0) {
		return NextResponse.json({ error: "Theme invalido." }, { status: 400 });
	}

	try {
		const kv = getCatalogKvBinding();
		const cached = await getCachedMinifiguresByThemeFromKv(themeId, kv);
		if (cached?.results && cached.results.length > 0) {
			return NextResponse.json({ results: cached.results, source: "kv" });
		}
		return NextResponse.json({ error: "Minifiguras de la serie no disponibles en KV. Ejecuta sync de minifiguras." }, { status: 503 });
	} catch {
		return NextResponse.json({ error: "No se pudieron cargar las minifiguras de la serie." }, { status: 500 });
	}
}
