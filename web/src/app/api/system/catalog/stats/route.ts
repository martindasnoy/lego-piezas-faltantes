import { NextResponse } from "next/server";
import { getCachedCategories, getCachedCategoryAllParts, getCatalogKvBinding } from "@/lib/rebrickable-catalog-cache";
import { staticRebrickableCategories } from "@/lib/rebrickable-categories-static";
import { countPartImageRows } from "@/lib/image-cache-db";
import { countPartPopularityRows } from "@/lib/part-popularity-db";

export async function GET() {
	try {
		const kv = getCatalogKvBinding();
		const categories = (await getCachedCategories(kv))?.categories ?? staticRebrickableCategories;

		const uniqueParts = new Set<string>();
		for (const category of categories) {
			const cached = await getCachedCategoryAllParts(String(category.id), kv);
			for (const row of cached?.parts ?? []) {
				const partNum = String(row.part_num ?? "").trim().toUpperCase();
				if (partNum) uniqueParts.add(partNum);
			}
		}

		const [imageRows, popularityRows] = await Promise.all([countPartImageRows(), countPartPopularityRows()]);

		return NextResponse.json({
			categories_count: categories.length,
			pieces_count: uniqueParts.size,
			image_rows_count: imageRows,
			priority_rows_count: popularityRows,
			checked_at: new Date().toISOString(),
		});
	} catch {
		return NextResponse.json({ error: "No se pudieron calcular estadisticas de piezas." }, { status: 500 });
	}
}
