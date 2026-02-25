import { NextResponse } from "next/server";
import { staticRebrickableCategories } from "@/lib/rebrickable-categories-static";
import { getCachedCategoryParts } from "@/lib/rebrickable-parts-cache";

export async function POST(request: Request) {
	const { searchParams } = new URL(request.url);
	const categoryId = (searchParams.get("category_id") ?? "").trim();
	const token = request.headers.get("x-prewarm-token") ?? "";
	const configuredToken = process.env.REBRICKABLE_PREWARM_TOKEN ?? "";
	const apiKey = process.env.REBRICKABLE_API_KEY ?? "";

	if (!apiKey) {
		return NextResponse.json({ error: "Configura REBRICKABLE_API_KEY." }, { status: 500 });
	}

	if (configuredToken && token !== configuredToken) {
		return NextResponse.json({ error: "Token invalido." }, { status: 401 });
	}

	if (!categoryId) {
		return NextResponse.json({ error: "Falta category_id." }, { status: 400 });
	}

	try {
		await getCachedCategoryParts(categoryId, apiKey);
		return NextResponse.json({ ok: true, category_id: categoryId });
	} catch {
		return NextResponse.json({ error: "No se pudo precalentar esa categoria." }, { status: 500 });
	}
}

export async function GET(request: Request) {
	const { searchParams } = new URL(request.url);
	const token = request.headers.get("x-prewarm-token") ?? "";
	const configuredToken = process.env.REBRICKABLE_PREWARM_TOKEN ?? "";
	const apiKey = process.env.REBRICKABLE_API_KEY ?? "";
	const onlyList = searchParams.get("list") === "1";

	if (configuredToken && token !== configuredToken) {
		return NextResponse.json({ error: "Token invalido." }, { status: 401 });
	}

	if (onlyList) {
		return NextResponse.json({
			results: staticRebrickableCategories.map((category) => ({ id: category.id, name: category.name })),
		});
	}

	if (!apiKey) {
		return NextResponse.json({ error: "Configura REBRICKABLE_API_KEY." }, { status: 500 });
	}

	try {
		for (const category of staticRebrickableCategories) {
			await getCachedCategoryParts(String(category.id), apiKey);
		}
		return NextResponse.json({ ok: true, warmed: staticRebrickableCategories.length });
	} catch {
		return NextResponse.json({ error: "No se pudo completar el precalentado total." }, { status: 500 });
	}
}
