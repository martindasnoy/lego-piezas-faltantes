import { NextResponse } from "next/server";
import { getRuntimeEnvValue } from "@/lib/runtime-env";
import { getCachedMinifigureThemes } from "@/lib/rebrickable-minifig-cache";

export async function GET() {
	const apiKey = getRuntimeEnvValue("REBRICKABLE_API_KEY");
	if (!apiKey) {
		return NextResponse.json({ error: "Configura REBRICKABLE_API_KEY." }, { status: 500 });
	}

	try {
		const results = await getCachedMinifigureThemes(apiKey);
		return NextResponse.json({ results });
	} catch {
		return NextResponse.json({ error: "No se pudo conectar con Rebrickable." }, { status: 500 });
	}
}
