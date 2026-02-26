import { NextResponse } from "next/server";
import { getRuntimeEnvValue } from "@/lib/runtime-env";

const REBRICKABLE_API_BASE = "https://rebrickable.com/api/v3/lego/parts/";
const fallbackApiKey = "";

type RebrickablePart = {
	part_num: string;
	name: string;
	part_img_url?: string | null;
};

export async function GET(request: Request) {
	const { searchParams } = new URL(request.url);
	const rawQuery = (searchParams.get("q") ?? "").trim();
	const query = rawQuery.trim();
	const apiKey = getRuntimeEnvValue("REBRICKABLE_API_KEY") || fallbackApiKey;

	if (!apiKey) {
		return NextResponse.json(
			{ error: "Configura REBRICKABLE_API_KEY para habilitar autocompletado." },
			{ status: 500 },
		);
	}

	if (query.length < 2) {
		return NextResponse.json({ results: [] });
	}

	const url = new URL(REBRICKABLE_API_BASE);
	url.searchParams.set("search", query);
	url.searchParams.set("page_size", "10");
	url.searchParams.set("inc_part_details", "1");
	url.searchParams.set("key", apiKey);

	const exactPartUrl = `${REBRICKABLE_API_BASE}${encodeURIComponent(query)}/?key=${encodeURIComponent(apiKey)}`;

	try {
		const [searchResponse, exactResponse] = await Promise.all([
			fetch(url.toString(), {
				headers: { Accept: "application/json" },
				next: { revalidate: 60 },
			}),
			fetch(exactPartUrl, {
				headers: { Accept: "application/json" },
				next: { revalidate: 60 },
			}),
		]);

		if (!searchResponse.ok && !exactResponse.ok) {
			const detail =
				searchResponse.status === 429 || exactResponse.status === 429
					? "Limite de Rebrickable alcanzado. Intenta en unos segundos."
					: "Error consultando Rebrickable.";
			return NextResponse.json({ error: detail }, { status: searchResponse.status || exactResponse.status });
		}

		let searchResults: RebrickablePart[] = [];
		if (searchResponse.ok) {
			const data = (await searchResponse.json()) as { results?: RebrickablePart[] };
			searchResults = data.results ?? [];
		}

		let exactPart: RebrickablePart | null = null;
		if (exactResponse.ok) {
			exactPart = (await exactResponse.json()) as RebrickablePart;
		}

		const normalizedQuery = query.toLowerCase();
		const merged = new Map<string, RebrickablePart>();

		if (exactPart) {
			merged.set(exactPart.part_num, exactPart);
		}

		for (const result of searchResults) {
			if (!merged.has(result.part_num)) {
				merged.set(result.part_num, result);
			}
		}

		const results = [...merged.values()]
			.sort((a, b) => {
				const aNum = a.part_num.toLowerCase();
				const bNum = b.part_num.toLowerCase();
				const aExact = aNum === normalizedQuery ? 0 : aNum.startsWith(normalizedQuery) ? 1 : 2;
				const bExact = bNum === normalizedQuery ? 0 : bNum.startsWith(normalizedQuery) ? 1 : 2;
				if (aExact !== bExact) return aExact - bExact;
				return aNum.localeCompare(bNum);
			})
			.slice(0, 10)
			.map((part) => ({
				part_num: part.part_num,
				name: part.name,
				part_img_url: part.part_img_url ?? null,
			}));

		return NextResponse.json({ results });
	} catch {
		return NextResponse.json({ error: "No se pudo conectar con Rebrickable." }, { status: 500 });
	}
}
