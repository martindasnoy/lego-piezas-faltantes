import { NextResponse } from "next/server";

const REBRICKABLE_API_BASE = "https://rebrickable.com/api/v3/lego/parts/";

type RebrickablePart = {
	part_num: string;
	part_img_url?: string | null;
};

export async function GET(request: Request) {
	const { searchParams } = new URL(request.url);
	const rawNums = (searchParams.get("nums") ?? "").trim();
	const apiKey = process.env.REBRICKABLE_API_KEY ?? "";

	if (!apiKey) {
		return NextResponse.json({ error: "Configura REBRICKABLE_API_KEY." }, { status: 500 });
	}

	if (!rawNums) {
		return NextResponse.json({ results: [] });
	}

	const nums = rawNums
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean)
		.slice(0, 100);

	if (nums.length === 0) {
		return NextResponse.json({ results: [] });
	}

	const url = new URL(REBRICKABLE_API_BASE);
	url.searchParams.set("part_nums", nums.join(","));
	url.searchParams.set("inc_part_details", "1");
	url.searchParams.set("page_size", String(nums.length));
	url.searchParams.set("key", apiKey);

	try {
		const response = await fetch(url.toString(), {
			headers: { Accept: "application/json" },
			next: { revalidate: 60 },
		});

		if (!response.ok) {
			const detail = response.status === 429 ? "Limite de Rebrickable alcanzado." : "Error consultando Rebrickable.";
			return NextResponse.json({ error: detail }, { status: response.status });
		}

		const payload = (await response.json()) as { results?: RebrickablePart[] };
		const results = (payload.results ?? []).map((part) => ({
			part_num: part.part_num,
			part_img_url: part.part_img_url ?? null,
		}));

		return NextResponse.json({ results });
	} catch {
		return NextResponse.json({ error: "No se pudo conectar con Rebrickable." }, { status: 500 });
	}
}
