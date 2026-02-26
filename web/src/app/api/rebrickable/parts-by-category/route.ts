import { NextResponse } from "next/server";
import { getCachedCategoryParts } from "@/lib/rebrickable-parts-cache";
import { getRuntimeEnvValue } from "@/lib/runtime-env";

export async function GET(request: Request) {
	const { searchParams } = new URL(request.url);
	const categoryId = (searchParams.get("category_id") ?? "").trim();
	const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);
	const pageSize = Math.max(1, Math.min(20, Number(searchParams.get("page_size") ?? "20") || 20));
	const includePrinted = (searchParams.get("include_printed") ?? "true") !== "false";
	const includeNonPrinted = (searchParams.get("include_non_printed") ?? "true") !== "false";
	const apiKey = getRuntimeEnvValue("REBRICKABLE_API_KEY");

	if (!apiKey) {
		return NextResponse.json({ error: "Configura REBRICKABLE_API_KEY." }, { status: 500 });
	}

	if (!categoryId) {
		return NextResponse.json({ error: "Falta category_id." }, { status: 400 });
	}

	if (!includePrinted && !includeNonPrinted) {
		return NextResponse.json({
			results: [],
			page: 1,
			total_pages: 1,
			has_next: false,
			has_previous: false,
		});
	}

	try {
		const allParts = await getCachedCategoryParts(categoryId, apiKey);
		const filteredParts = allParts.filter((part) => {
			if (part.is_printed && !includePrinted) return false;
			if (!part.is_printed && !includeNonPrinted) return false;
			return true;
		});
		const totalPages = Math.max(1, Math.ceil(filteredParts.length / pageSize));
		const normalizedPage = Math.min(page, totalPages);
		const start = (normalizedPage - 1) * pageSize;
		const results = filteredParts.slice(start, start + pageSize);

		return NextResponse.json({
			results,
			page: normalizedPage,
			total_pages: totalPages,
			has_next: normalizedPage < totalPages,
			has_previous: normalizedPage > 1,
		});
	} catch {
		return NextResponse.json({ error: "No se pudo conectar con Rebrickable." }, { status: 500 });
	}
}
