import { NextResponse } from "next/server";
import { getRuntimeEnvValue } from "@/lib/runtime-env";
import { getCachedMinifiguresByTheme } from "@/lib/rebrickable-minifig-cache";
import { toRebrickableImageProxyUrl } from "@/lib/rebrickable-image-proxy";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
	const apiKey = getRuntimeEnvValue("REBRICKABLE_API_KEY");
	if (!apiKey) {
		return NextResponse.json({ error: "Configura REBRICKABLE_API_KEY." }, { status: 500 });
	}

	const { id } = await params;
	const themeId = Number(id);
	if (!Number.isFinite(themeId) || themeId <= 0) {
		return NextResponse.json({ error: "Theme invalido." }, { status: 400 });
	}

	try {
		const results = await getCachedMinifiguresByTheme(themeId, apiKey);
		const proxied = results.map((row) => ({
			...row,
			imageUrl: toRebrickableImageProxyUrl(row.imageUrl) ?? null,
		}));
		return NextResponse.json({ results: proxied });
	} catch {
		return NextResponse.json({ error: "No se pudo conectar con Rebrickable." }, { status: 500 });
	}
}
