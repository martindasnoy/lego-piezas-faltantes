import { NextResponse } from "next/server";
import { staticRebrickableCategories } from "@/lib/rebrickable-categories-static";
import { getRuntimeEnvValue } from "@/lib/runtime-env";

const REBRICKABLE_API_BASE = "https://rebrickable.com/api/v3/lego/part_categories/";

type RebrickableCategory = {
	id: number;
	name: string;
	part_count?: number;
	parent_id?: number | null;
};

export async function GET() {
	const apiKey = getRuntimeEnvValue("REBRICKABLE_API_KEY");

	if (!apiKey) {
		return NextResponse.json({ results: staticRebrickableCategories });
	}

	const url = new URL(REBRICKABLE_API_BASE);
	url.searchParams.set("page_size", "200");
	url.searchParams.set("key", apiKey);

	try {
		const response = await fetch(url.toString(), {
			headers: { Accept: "application/json" },
			next: { revalidate: 3600 },
		});

		if (!response.ok) {
			const detail = response.status === 429 ? "Limite de Rebrickable alcanzado." : "Error consultando Rebrickable.";
			return NextResponse.json({ error: detail }, { status: response.status });
		}

		const payload = (await response.json()) as { results?: RebrickableCategory[] };
		const topLevel = (payload.results ?? [])
			.filter((category) => category.parent_id == null)
			.sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }))
			.map((category) => ({
				id: category.id,
				name: category.name,
				part_count: Number(category.part_count ?? 0),
			}));

		return NextResponse.json({ results: topLevel });
	} catch {
		return NextResponse.json({ results: staticRebrickableCategories });
	}
}
