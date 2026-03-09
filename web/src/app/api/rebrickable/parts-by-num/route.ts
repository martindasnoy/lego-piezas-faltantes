import { NextResponse } from "next/server";
import { getRuntimeEnvValue } from "@/lib/runtime-env";

const REBRICKABLE_API_BASE = "https://rebrickable.com/api/v3/lego/parts/";

type RebrickablePart = {
	part_num: string;
	name?: string | null;
	part_img_url?: string | null;
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
		next: { revalidate: 60 },
	});

	if (direct.ok) {
		return (await direct.json()) as T;
	}

	if (direct.status !== 403) {
		throw new Error(String(direct.status));
	}

	const proxyUrl = `https://r.jina.ai/http://${url.replace(/^https?:\/\//, "")}`;
	const proxied = await fetch(proxyUrl, {
		headers: { Accept: "text/plain" },
		next: { revalidate: 60 },
	});

	if (!proxied.ok) {
		throw new Error(String(proxied.status));
	}

	const text = await proxied.text();
	return extractJsonObject(text) as T;
}

export async function GET(request: Request) {
	const { searchParams } = new URL(request.url);
	const rawNums = (searchParams.get("nums") ?? "").trim();
	const apiKey = getRuntimeEnvValue("REBRICKABLE_API_KEY");

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
		const payload = await fetchRebrickableJson<{ results?: RebrickablePart[] }>(url.toString(), apiKey);
		const results = (payload.results ?? []).map((part) => ({
			part_num: part.part_num,
			name: part.name ?? null,
			part_img_url: part.part_img_url ?? null,
		}));

		return NextResponse.json({ results });
	} catch {
		return NextResponse.json({ error: "No se pudo conectar con Rebrickable." }, { status: 500 });
	}
}
