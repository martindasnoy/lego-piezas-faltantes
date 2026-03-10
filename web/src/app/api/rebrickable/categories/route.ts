import { NextResponse } from "next/server";
import { staticRebrickableCategories } from "@/lib/rebrickable-categories-static";
import { getCatalogKvBinding, getCachedCategories } from "@/lib/rebrickable-catalog-cache";

export async function GET() {
	const kv = getCatalogKvBinding();
	const cached = await getCachedCategories(kv);
	if (cached?.categories && cached.categories.length > 0) {
		return NextResponse.json({ results: cached.categories, source: "kv" });
	}

	return NextResponse.json({ results: staticRebrickableCategories, source: "static" });
}
