import { NextResponse } from "next/server";
import { getCatalogKvBinding } from "@/lib/rebrickable-catalog-cache";
import { getCachedMinifigureThemesFromKv } from "@/lib/rebrickable-minifig-cache";

const REMOTE_FALLBACK_BASE_URL = "https://lego-piezas-faltantes.martindasnoy.workers.dev";

export async function GET() {
	try {
		const kv = getCatalogKvBinding();
		const cached = await getCachedMinifigureThemesFromKv(kv);
		if (cached?.results && cached.results.length > 0) {
			return NextResponse.json({ results: cached.results, source: "kv" });
		}

		const remoteResponse = await fetch(`${REMOTE_FALLBACK_BASE_URL}/api/rebrickable/minifigures/themes`, { cache: "no-store" });
		if (remoteResponse.ok) {
			const payload = (await remoteResponse.json()) as { results?: unknown[] };
			if (Array.isArray(payload.results) && payload.results.length > 0) {
				return NextResponse.json({ results: payload.results, source: "remote-fallback" });
			}
		}

		return NextResponse.json({ error: "Series de minifiguras no disponibles en KV y fallback remoto vacio." }, { status: 503 });
	} catch {
		return NextResponse.json({ error: "No se pudieron cargar las series de minifiguras." }, { status: 500 });
	}
}
