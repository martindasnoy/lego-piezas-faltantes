import { NextResponse } from "next/server";
import { getRuntimeEnvValue } from "@/lib/runtime-env";
import { getCachedMinifigureParts } from "@/lib/rebrickable-minifig-cache";
import { toRebrickableImageProxyUrl } from "@/lib/rebrickable-image-proxy";

function normalizeSetNum(value: string) {
	return value.trim().toUpperCase();
}

export async function GET(request: Request) {
	const { searchParams } = new URL(request.url);
	const setNum = normalizeSetNum(searchParams.get("set_num") ?? "");
	const apiKey = getRuntimeEnvValue("REBRICKABLE_API_KEY");

	if (!apiKey) {
		return NextResponse.json({ error: "Configura REBRICKABLE_API_KEY." }, { status: 500 });
	}

	if (!setNum) {
		return NextResponse.json({ error: "Falta set_num." }, { status: 400 });
	}

	try {
		const results = await getCachedMinifigureParts(setNum, apiKey);
		const proxied = results.map((row) => ({
			...row,
			part_img_url: toRebrickableImageProxyUrl(row.part_img_url) ?? null,
		}));
		return NextResponse.json({ results: proxied });
	} catch {
		return NextResponse.json({ error: "No se pudo conectar con Rebrickable." }, { status: 500 });
	}
}
