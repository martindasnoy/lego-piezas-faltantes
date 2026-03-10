import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getRuntimeEnvValue } from "@/lib/runtime-env";

export async function GET() {
	let hasCatalogKv = false;
	const hasRebrickableApiKey = Boolean(getRuntimeEnvValue("REBRICKABLE_API_KEY"));

	try {
		const env = getCloudflareContext()?.env as Record<string, unknown> | undefined;
		hasCatalogKv = Boolean(env?.CATALOG_CACHE && typeof env.CATALOG_CACHE === "object");
	} catch {
		hasCatalogKv = false;
	}

	return NextResponse.json({
		ok: true,
		bindings: {
			catalog_cache: hasCatalogKv,
		},
		env: {
			rebrickable_api_key: hasRebrickableApiKey,
		},
	});
}
