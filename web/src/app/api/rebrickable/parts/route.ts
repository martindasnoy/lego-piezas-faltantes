import { NextResponse } from "next/server";
import { getRuntimeEnvValue } from "@/lib/runtime-env";
import { getPopularityByPartNums } from "@/lib/part-popularity-db";

type RebrickablePart = {
	part_num: string;
	name: string;
	part_img_url?: string | null;
};

export async function GET(request: Request) {
	const { searchParams } = new URL(request.url);
	const query = (searchParams.get("q") ?? "").trim();

	if (query.length < 2) {
		return NextResponse.json({ results: [] });
	}

	const apiKey = getRuntimeEnvValue("REBRICKABLE_API_KEY");
	if (!apiKey) {
		return NextResponse.json({ error: "Configura REBRICKABLE_API_KEY para sugerencias." }, { status: 500 });
	}

	const url = new URL("https://rebrickable.com/api/v3/lego/parts/");
	url.searchParams.set("search", query);
	url.searchParams.set("page_size", "10");
	url.searchParams.set("inc_part_details", "1");
	url.searchParams.set("key", apiKey);

	try {
		const response = await fetch(url.toString(), {
			headers: {
				Accept: "application/json",
				Authorization: `key ${apiKey}`,
				"User-Agent": "lego-piezas-faltantes/1.0",
			},
			next: { revalidate: 300 },
		});

		if (!response.ok) {
			return NextResponse.json({ error: `Error consultando catalogo (${response.status}).` }, { status: response.status });
		}

		const payload = (await response.json()) as { results?: RebrickablePart[] };
		const normalizedQuery = query.toLowerCase();
		const base = (payload.results ?? []).map((part) => ({
			part_num: part.part_num,
			name: part.name,
			part_img_url: part.part_img_url ?? null,
		}));

		let popularityByPart = new Map<string, { set_count: number }>();
		try {
			popularityByPart = await getPopularityByPartNums(base.map((part) => part.part_num));
		} catch {
			popularityByPart = new Map();
		}

		const results = base
			.sort((a, b) => {
				const aNum = a.part_num.toLowerCase();
				const bNum = b.part_num.toLowerCase();
				const aRank = aNum === normalizedQuery ? 0 : aNum.startsWith(normalizedQuery) ? 1 : 2;
				const bRank = bNum === normalizedQuery ? 0 : bNum.startsWith(normalizedQuery) ? 1 : 2;
				if (aRank !== bRank) return aRank - bRank;

				const aPopularity = Number(popularityByPart.get(a.part_num)?.set_count ?? 0);
				const bPopularity = Number(popularityByPart.get(b.part_num)?.set_count ?? 0);
				if (aPopularity !== bPopularity) return bPopularity - aPopularity;

				return aNum.localeCompare(bNum);
			})
			.slice(0, 10);

		return NextResponse.json({ results });
	} catch {
		return NextResponse.json({ error: "No se pudo buscar en catalogo." }, { status: 500 });
	}
}
