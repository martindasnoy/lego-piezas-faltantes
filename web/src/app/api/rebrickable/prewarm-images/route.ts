import { NextResponse } from "next/server";
import { getRuntimeEnvValue } from "@/lib/runtime-env";

type PoolLotRow = {
	part_num: string;
	color_name: string | null;
};

type PartImageResult = {
	key: string;
	part_num: string;
	part_img_url: string | null;
};

function normalizeColorKey(raw: string | null | undefined) {
	return (raw ?? "")
		.replace(/\(chino\)/gi, "")
		.toLowerCase()
		.replace(/\s+/g, " ")
		.trim();
}

function buildItemKey(partNum: string, colorName: string | null | undefined) {
	return `${partNum.trim()}::${normalizeColorKey(colorName)}`;
}

async function getPoolItemsFromSupabase() {
	const supabaseUrl = getRuntimeEnvValue("NEXT_PUBLIC_SUPABASE_URL").trim();
	const anonKey = getRuntimeEnvValue("NEXT_PUBLIC_SUPABASE_ANON_KEY").trim();

	if (!supabaseUrl || !anonKey) {
		throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY.");
	}

	const response = await fetch(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/get_public_pool_lots`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			apikey: anonKey,
			Authorization: `Bearer ${anonKey}`,
		},
		body: "{}",
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`RPC get_public_pool_lots fallo (${response.status}): ${text.slice(0, 240)}`);
	}

	const rows = (await response.json()) as PoolLotRow[];
	const uniqueByKey = new Map<string, { part_num: string; color_name: string | null }>();

	for (const row of rows ?? []) {
		const partNum = String(row.part_num ?? "").trim().toUpperCase();
		if (!partNum) continue;
		const colorName = typeof row.color_name === "string" ? row.color_name : null;
		const key = buildItemKey(partNum, colorName);
		if (!uniqueByKey.has(key)) {
			uniqueByKey.set(key, { part_num: partNum, color_name: colorName });
		}
	}

	return [...uniqueByKey.values()];
}

export async function POST(request: Request) {
	const token = request.headers.get("x-prewarm-token") ?? "";
	const configuredToken = getRuntimeEnvValue("REBRICKABLE_PREWARM_TOKEN");

	if (configuredToken && token !== configuredToken) {
		return NextResponse.json({ error: "Token invalido." }, { status: 401 });
	}

	const { searchParams } = new URL(request.url);
	const limitRaw = Number(searchParams.get("limit") ?? "2000");
	const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(5000, Math.floor(limitRaw))) : 2000;

	try {
		const items = await getPoolItemsFromSupabase();
		const origin = new URL(request.url).origin;
		const selectedItems = items.slice(0, limit);

		let resolvedUrls = 0;
		const imageUrls: string[] = [];

		const chunkSize = 120;
		for (let index = 0; index < selectedItems.length; index += chunkSize) {
			const chunk = selectedItems.slice(index, index + chunkSize);
			const response = await fetch(`${origin}/api/rebrickable/part-images`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ items: chunk }),
			});

			if (!response.ok) continue;
			const payload = (await response.json()) as { results?: PartImageResult[] };
			for (const row of payload.results ?? []) {
				if (!row.part_img_url) continue;
				resolvedUrls += 1;
				imageUrls.push(row.part_img_url.startsWith("http") ? row.part_img_url : `${origin}${row.part_img_url}`);
			}
		}

		let warmed = 0;
		let failed = 0;
		const warmChunkSize = 20;
		for (let index = 0; index < imageUrls.length; index += warmChunkSize) {
			const chunk = imageUrls.slice(index, index + warmChunkSize);
			const chunkResults = await Promise.all(
				chunk.map(async (url) => {
					try {
						const response = await fetch(url, { headers: { Accept: "image/*" } });
						return response.ok;
					} catch {
						return false;
					}
				}),
			);

			for (const ok of chunkResults) {
				if (ok) warmed += 1;
				else failed += 1;
			}
		}

		return NextResponse.json({
			ok: true,
			total_pool_items: items.length,
			selected_items: selectedItems.length,
			resolved_image_urls: resolvedUrls,
			warmed,
			failed,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : "No se pudo precalentar imagenes.";
		return NextResponse.json({ error: message }, { status: 500 });
	}
}
