import { NextResponse } from "next/server";
import {
	getCatalogKvBinding,
	getCachedCategoryAllParts,
	type CatalogPart,
} from "@/lib/rebrickable-catalog-cache";

type CategoryPartsResponse = {
	results: CatalogPart[];
	page: number;
	total_pages: number;
	has_next: boolean;
	has_previous: boolean;
};

const staleCategoryPartsCache = new Map<string, CategoryPartsResponse>();
const cooldownUntilByCacheKey = new Map<string, number>();
const CATEGORY_COOLDOWN_MS = 15000;

function toPagedResponse(parts: CatalogPart[], page: number, pageSize: number): CategoryPartsResponse {
	const totalPages = Math.max(1, Math.ceil(parts.length / pageSize));
	const normalizedPage = Math.max(1, Math.min(totalPages, page));
	const start = (normalizedPage - 1) * pageSize;
	return {
		results: parts.slice(start, start + pageSize),
		page: normalizedPage,
		total_pages: totalPages,
		has_next: normalizedPage < totalPages,
		has_previous: normalizedPage > 1,
	};
}

export async function GET(request: Request) {
	const { searchParams } = new URL(request.url);
	const categoryId = (searchParams.get("category_id") ?? "").trim();
	const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);
	const pageSize = Math.max(1, Math.min(100, Number(searchParams.get("page_size") ?? "20") || 20));
	const includePrinted = (searchParams.get("include_printed") ?? "true") !== "false";
	const includeNonPrinted = (searchParams.get("include_non_printed") ?? "true") !== "false";
	const cacheKey = `${categoryId}:${page}:${pageSize}:${includePrinted ? 1 : 0}:${includeNonPrinted ? 1 : 0}`;

	if (!categoryId) {
		return NextResponse.json({ error: "Falta category_id." }, { status: 400 });
	}

	if (!includePrinted && !includeNonPrinted) {
		return NextResponse.json({ results: [], page: 1, total_pages: 1, has_next: false, has_previous: false });
	}

	const now = Date.now();
	const cooldownUntil = cooldownUntilByCacheKey.get(cacheKey) ?? 0;
	if (now < cooldownUntil) {
		const stale = staleCategoryPartsCache.get(cacheKey);
		if (stale) {
			return NextResponse.json(
				{ ...stale, warning: "Mostrando cache local temporal (cooldown 15s)." },
				{ headers: { "cache-control": "public, s-maxage=15, stale-while-revalidate=300" } },
			);
		}
	}

	try {
		const kv = getCatalogKvBinding();
		let allParts: CatalogPart[] | null = null;
		const cached = await getCachedCategoryAllParts(categoryId, kv);
		if (cached?.parts?.length) {
			allParts = cached.parts;
		}

		if (!allParts) {
			return NextResponse.json({ error: "Categoria no disponible en cache KV. Ejecuta prewarm para esta categoria." }, { status: 503 });
		}

		const filtered = allParts.filter((part) => {
			if (part.is_printed && !includePrinted) return false;
			if (!part.is_printed && !includeNonPrinted) return false;
			return true;
		});

		const payload = toPagedResponse(filtered, page, pageSize);
		staleCategoryPartsCache.set(cacheKey, payload);

		return NextResponse.json(payload, {
			headers: {
				"cache-control": "public, s-maxage=3600, stale-while-revalidate=86400",
			},
		});
	} catch (error) {
		const code = error instanceof Error ? error.message : "";
		if (code === "429") {
			cooldownUntilByCacheKey.set(cacheKey, Date.now() + CATEGORY_COOLDOWN_MS);
			const stale = staleCategoryPartsCache.get(cacheKey);
			if (stale) {
				return NextResponse.json(
					{ ...stale, warning: "Mostrando cache local por limite temporal de Rebrickable." },
					{ headers: { "cache-control": "public, s-maxage=60, stale-while-revalidate=300" } },
				);
			}
			return NextResponse.json({ error: "Limite temporal de Rebrickable. Reintenta en unos segundos." }, { status: 429 });
		}

		const detail = code ? ` (${code})` : "";
		return NextResponse.json({ error: `No se pudo cargar piezas de categoria${detail}.` }, { status: 500 });
	}
}
