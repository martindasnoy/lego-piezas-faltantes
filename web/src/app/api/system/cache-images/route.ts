import { NextResponse } from "next/server";
import { getCatalogKvBinding, type CachedPartColorsMetadata } from "@/lib/rebrickable-catalog-cache";

const PART_COLORS_PREFIX = "catalog:v1:part-colors:";

type CacheImageRow = {
	part_num: string;
	color_name: string;
	part_img_url: string;
	updated_at: string;
};

export async function GET(request: Request) {
	const kv = getCatalogKvBinding();
	if (!kv) {
		return NextResponse.json({ error: "CATALOG_CACHE binding missing." }, { status: 500 });
	}

	const { searchParams } = new URL(request.url);
	const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);
	const pageSize = Math.max(1, Math.min(120, Number(searchParams.get("page_size") ?? "60") || 60));

	const entries: Array<{ updatedAt: string; rows: CacheImageRow[] }> = [];
	let cursor: string | undefined;
	let safety = 0;

	while (safety < 20) {
		safety += 1;
		const listed = await kv.list<CachedPartColorsMetadata>({ prefix: PART_COLORS_PREFIX, cursor, limit: 1000 });
		for (const key of listed.keys) {
			const meta = key.metadata;
			if (!meta || !meta.updatedAt || !Array.isArray(meta.preview) || meta.preview.length === 0) continue;
			const rows = meta.preview
				.filter((row) => row && typeof row.part_img_url === "string" && row.part_img_url.length > 0)
				.map((row) => ({
					part_num: meta.part_num,
					color_name: row.color_name,
					part_img_url: row.part_img_url,
					updated_at: meta.updatedAt,
				}));
			if (rows.length > 0) {
				entries.push({ updatedAt: meta.updatedAt, rows });
			}
		}

		if (listed.list_complete) break;
		cursor = listed.cursor;
	}

	entries.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
	const flattened = entries.flatMap((entry) => entry.rows);

	const total = flattened.length;
	const totalPages = Math.max(1, Math.ceil(total / pageSize));
	const normalizedPage = Math.max(1, Math.min(totalPages, page));
	const start = (normalizedPage - 1) * pageSize;

	return NextResponse.json({
		results: flattened.slice(start, start + pageSize),
		page: normalizedPage,
		total_pages: totalPages,
		total,
	});
}
