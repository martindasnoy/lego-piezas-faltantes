import { NextResponse } from "next/server";
import { getCatalogKvBinding } from "@/lib/rebrickable-catalog-cache";
import { getCachedMinifigureThemesFromKv } from "@/lib/rebrickable-minifig-cache";

export async function GET() {
	try {
		const kv = getCatalogKvBinding();
		const cached = await getCachedMinifigureThemesFromKv(kv);
		if (cached?.results && cached.results.length > 0) {
			return NextResponse.json({ results: cached.results, source: "kv" });
		}
		return NextResponse.json({ error: "Series de minifiguras no disponibles en KV. Ejecuta sync de minifiguras." }, { status: 503 });
	} catch {
		return NextResponse.json({ error: "No se pudieron cargar las series de minifiguras." }, { status: 500 });
	}
}
