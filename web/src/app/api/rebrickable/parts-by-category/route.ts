import { NextResponse } from "next/server";
import { getRuntimeEnvValue } from "@/lib/runtime-env";

const REBRICKABLE_API_BASE = "https://rebrickable.com/api/v3/lego/parts/";

type RebrickablePart = {
	part_num: string;
	name?: string;
	part_img_url?: string | null;
	print_of?: string | null;
};

type RebrickablePartsPayload = {
	count?: number;
	results?: RebrickablePart[];
};

function getRebrickableHeaders(apiKey: string) {
	return {
		Accept: "application/json",
		Authorization: `key ${apiKey}`,
		"User-Agent": "lego-piezas-faltantes/1.0",
	};
}

function extractJsonObject(text: string) {
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	if (start < 0 || end <= start) {
		throw new Error("json-extract-failed");
	}
	return JSON.parse(text.slice(start, end + 1)) as unknown;
}

async function fetchRebrickableJson<T>(url: string, apiKey: string): Promise<T> {
	const direct = await fetch(url, {
		headers: getRebrickableHeaders(apiKey),
		next: { revalidate: 60 * 60 },
	});

	if (direct.ok) return (await direct.json()) as T;
	if (direct.status === 429) {
		const retry = await fetch(url, {
			headers: getRebrickableHeaders(apiKey),
			next: { revalidate: 60 * 60 },
		});
		if (retry.ok) return (await retry.json()) as T;
		if (retry.status !== 403 && retry.status !== 429) throw new Error(String(retry.status));
	}

	if (direct.status !== 403 && direct.status !== 429) throw new Error(String(direct.status));

	const proxyUrl = `https://r.jina.ai/http://${url.replace(/^https?:\/\//, "")}`;
	const proxied = await fetch(proxyUrl, {
		headers: { Accept: "text/plain" },
		next: { revalidate: 60 * 60 },
	});

	if (!proxied.ok) throw new Error(String(proxied.status));
	const text = await proxied.text();
	return extractJsonObject(text) as T;
}

export async function GET(request: Request) {
	const { searchParams } = new URL(request.url);
	const categoryId = (searchParams.get("category_id") ?? "").trim();
	const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);
	const pageSize = Math.max(1, Math.min(100, Number(searchParams.get("page_size") ?? "20") || 20));
	const includePrinted = (searchParams.get("include_printed") ?? "true") !== "false";
	const includeNonPrinted = (searchParams.get("include_non_printed") ?? "true") !== "false";

	if (!categoryId) {
		return NextResponse.json({ error: "Falta category_id." }, { status: 400 });
	}

	if (!includePrinted && !includeNonPrinted) {
		return NextResponse.json({ results: [], page: 1, total_pages: 1, has_next: false, has_previous: false });
	}

	const apiKey = getRuntimeEnvValue("REBRICKABLE_API_KEY");
	if (!apiKey) {
		return NextResponse.json({ error: "Configura REBRICKABLE_API_KEY." }, { status: 500 });
	}

	const url = new URL(REBRICKABLE_API_BASE);
	url.searchParams.set("part_cat_id", categoryId);
	url.searchParams.set("page", String(page));
	url.searchParams.set("page_size", String(pageSize));
	url.searchParams.set("inc_part_details", "1");
	url.searchParams.set("key", apiKey);

	try {
		const payload = await fetchRebrickableJson<RebrickablePartsPayload>(url.toString(), apiKey);
		const results = (payload.results ?? [])
			.filter((part) => {
				const isPrinted = Boolean(part.print_of);
				if (!includePrinted && isPrinted) return false;
				if (!includeNonPrinted && !isPrinted) return false;
				return true;
			})
			.map((part) => ({
				part_num: part.part_num,
				name: part.name ?? part.part_num,
				part_img_url: part.part_img_url ?? null,
				is_printed: Boolean(part.print_of),
			}));

		const count = Number(payload.count ?? 0);
		const totalPages = Math.max(1, Math.ceil(count / pageSize));

		return NextResponse.json({
			results,
			page,
			total_pages: totalPages,
			has_next: page < totalPages,
			has_previous: page > 1,
		});
	} catch (error) {
		const code = error instanceof Error ? error.message : "";
		if (code === "429") {
			return NextResponse.json({ error: "Limite temporal de Rebrickable. Reintenta en unos segundos." }, { status: 429 });
		}
		const detail = code ? ` (${code})` : "";
		return NextResponse.json({ error: `No se pudo cargar piezas de categoria${detail}.` }, { status: 500 });
	}

}
