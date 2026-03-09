import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";

export async function GET() {
	let hasCatalogKv = false;

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
	});
}
