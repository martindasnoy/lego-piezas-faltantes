import { NextResponse } from "next/server";
import { staticRebrickableCategories } from "@/lib/rebrickable-categories-static";
import {
	fetchAllCategoryPartsFromRebrickable,
	fetchPartColorsFromRebrickable,
	setCachedCategoryAllParts,
	setCachedPartColors,
} from "@/lib/rebrickable-catalog-cache";
import { getRuntimeEnvValue } from "@/lib/runtime-env";

function isTokenValid(request: Request) {
	const configuredToken = getRuntimeEnvValue("REBRICKABLE_PREWARM_TOKEN") || getRuntimeEnvValue("CATALOG_PREWARM_TOKEN");
	if (!configuredToken) return true;
	const incomingToken = request.headers.get("x-prewarm-token") ?? "";
	return incomingToken === configuredToken;
}

export async function GET(request: Request) {
	if (!isTokenValid(request)) {
		return NextResponse.json({ error: "Token invalido." }, { status: 401 });
	}

	const { searchParams } = new URL(request.url);
	const list = (searchParams.get("list") ?? "").trim();

	if (list === "1") {
		return NextResponse.json({
			results: staticRebrickableCategories.map((category) => ({ id: category.id, name: category.name })),
		});
	}

	return NextResponse.json({ ok: true, mode: "catalog", available: ["list", "category_id", "all"] });
}

export async function POST(request: Request) {
	if (!isTokenValid(request)) {
		return NextResponse.json({ error: "Token invalido." }, { status: 401 });
	}

	const apiKey = getRuntimeEnvValue("REBRICKABLE_API_KEY");
	if (!apiKey) {
		return NextResponse.json({ error: "Configura REBRICKABLE_API_KEY." }, { status: 500 });
	}

	const { searchParams } = new URL(request.url);
	const categoryId = (searchParams.get("category_id") ?? "").trim();
	const all = searchParams.get("all") === "1";
	const includeColors = searchParams.get("include_colors") === "1";

	try {
		if (all) {
			const stats: Array<{ category_id: number; parts: number; ok: boolean; error?: string }> = [];
			for (const category of staticRebrickableCategories) {
				try {
					const parts = await fetchAllCategoryPartsFromRebrickable(String(category.id), apiKey);
					await setCachedCategoryAllParts(String(category.id), parts);
					stats.push({ category_id: category.id, parts: parts.length, ok: true });
				} catch (error) {
					stats.push({
						category_id: category.id,
						parts: 0,
						ok: false,
						error: error instanceof Error ? error.message : "error",
					});
				}
			}

			const warmed = stats.filter((item) => item.ok).length;
			const failed = stats.length - warmed;
			return NextResponse.json({ ok: true, warmed, failed, stats });
		}

		if (!categoryId) {
			return NextResponse.json({ error: "Falta category_id o all=1." }, { status: 400 });
		}

		const parts = await fetchAllCategoryPartsFromRebrickable(categoryId, apiKey);
		await setCachedCategoryAllParts(categoryId, parts);

		if (!includeColors) {
			return NextResponse.json({ ok: true, category_id: categoryId, parts: parts.length, colors_warmed: 0 });
		}

		let colorsWarmed = 0;
		let colorsFailed = 0;
		const colorErrors: Array<{ part_num: string; error: string }> = [];

		for (const part of parts) {
			try {
				const colors = await fetchPartColorsFromRebrickable(part.part_num, apiKey);
				await setCachedPartColors(part.part_num, colors);
				colorsWarmed += 1;
			} catch (error) {
				colorsFailed += 1;
				colorErrors.push({
					part_num: part.part_num,
					error: error instanceof Error ? error.message : "error",
				});
				if ((error instanceof Error ? error.message : "") === "429") {
					break;
				}
			}
		}

		return NextResponse.json({
			ok: true,
			category_id: categoryId,
			parts: parts.length,
			colors_warmed: colorsWarmed,
			colors_failed: colorsFailed,
			errors: colorErrors.slice(0, 20),
		});
	} catch (error) {
		const detail = error instanceof Error ? error.message : "error";
		return NextResponse.json({ error: `No se pudo completar la bajada inicial (${detail}).` }, { status: 500 });
	}
}
