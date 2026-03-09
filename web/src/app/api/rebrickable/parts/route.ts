import { NextResponse } from "next/server";
import { getRuntimeEnvValue } from "@/lib/runtime-env";

const REBRICKABLE_API_BASE = "https://rebrickable.com/api/v3/lego/parts/";
const fallbackApiKey = "";

function normalizeApiKey(value: string) {
	const trimmed = value.trim();
	const token = trimmed.match(/[A-Za-z0-9_-]{20,}/)?.[0] ?? "";
	return token;
}

function getApiKeyCandidates() {
	const candidates = [normalizeApiKey(getRuntimeEnvValue("REBRICKABLE_API_KEY")), normalizeApiKey(process.env.REBRICKABLE_API_KEY ?? ""), normalizeApiKey(fallbackApiKey)].filter(
		(value) => value.length > 0,
	);
	return [...new Set(candidates)];
}

function getRebrickableHeaders(apiKey: string) {
	return {
		Accept: "application/json",
		Authorization: `key ${apiKey}`,
		"User-Agent": "lego-piezas-faltantes/1.0",
	};
}

type RebrickablePart = {
	part_num: string;
	name: string;
	part_img_url?: string | null;
};

export async function GET(request: Request) {
	const { searchParams } = new URL(request.url);
	const rawQuery = (searchParams.get("q") ?? "").trim();
	const query = rawQuery.trim();
	const apiKeys = getApiKeyCandidates();
	const apiKey = apiKeys[0] ?? "";

	if (!apiKey) {
		return NextResponse.json(
			{ error: "Configura REBRICKABLE_API_KEY para habilitar autocompletado." },
			{ status: 500 },
		);
	}

	if (query.length < 2) {
		return NextResponse.json({ results: [] });
	}

	try {
		let searchResponse: Response | null = null;
		let exactResponse: Response | null = null;
		let usedKey = "";

		for (const candidateKey of apiKeys) {
			const url = new URL(REBRICKABLE_API_BASE);
			url.searchParams.set("search", query);
			url.searchParams.set("page_size", "10");
			url.searchParams.set("inc_part_details", "1");
			url.searchParams.set("key", candidateKey);

			const exactPartUrl = `${REBRICKABLE_API_BASE}${encodeURIComponent(query)}/?key=${encodeURIComponent(candidateKey)}`;

			const [searchTry, exactTry] = await Promise.all([
				fetch(url.toString(), {
					headers: getRebrickableHeaders(candidateKey),
					next: { revalidate: 60 },
				}),
				fetch(exactPartUrl, {
					headers: getRebrickableHeaders(candidateKey),
					next: { revalidate: 60 },
				}),
			]);

			searchResponse = searchTry;
			exactResponse = exactTry;
			usedKey = candidateKey;

			if (searchTry.status !== 403 || exactTry.status !== 403) {
				break;
			}
		}

		if (!searchResponse || !exactResponse) {
			return NextResponse.json({ error: "Error consultando Rebrickable (sin respuesta)." }, { status: 500 });
		}

		if (!searchResponse.ok && !exactResponse.ok) {
			const status = searchResponse.status || exactResponse.status;
			if (status === 403) {
				const browserUrl = new URL(REBRICKABLE_API_BASE);
				browserUrl.searchParams.set("search", query);
				browserUrl.searchParams.set("page_size", "10");
				browserUrl.searchParams.set("inc_part_details", "1");
				browserUrl.searchParams.set("key", usedKey);
				return NextResponse.redirect(browserUrl.toString(), 307);
			}
			const detail =
				status === 429
					? "Limite de Rebrickable alcanzado. Intenta en unos segundos."
					: `Error consultando Rebrickable (${status}). key=${usedKey.slice(0, 6)}...`;
			return NextResponse.json({ error: detail }, { status });
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
