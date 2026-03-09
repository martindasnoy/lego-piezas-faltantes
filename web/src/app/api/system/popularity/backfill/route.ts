import { NextResponse } from "next/server";
import { staticRebrickableCategories } from "@/lib/rebrickable-categories-static";
import { getCachedCategoryAllParts } from "@/lib/rebrickable-catalog-cache";
import { getPopularityByPartNums, upsertPopularities } from "@/lib/part-popularity-db";
import { getRuntimeEnvValue } from "@/lib/runtime-env";

const DEFAULT_BATCH_SIZE = 80;

function getRebrickableHeaders(apiKey: string) {
	return {
		Accept: "application/json",
		Authorization: `key ${apiKey}`,
		"User-Agent": "lego-piezas-faltantes/1.0",
	};
}

async function getAllCatalogPartNumsFromKv() {
	const all = new Set<string>();
	for (const category of staticRebrickableCategories) {
		const cached = await getCachedCategoryAllParts(String(category.id));
		for (const part of cached?.parts ?? []) {
			const partNum = String(part.part_num ?? "").trim().toUpperCase();
			if (partNum) all.add(partNum);
		}
	}
	return [...all].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
}

async function fetchSetCountByPartNum(partNum: string, apiKey: string) {
	const url = new URL(`https://rebrickable.com/api/v3/lego/parts/${encodeURIComponent(partNum)}/sets/`);
	url.searchParams.set("page_size", "1");
	url.searchParams.set("key", apiKey);

	const response = await fetch(url.toString(), {
		headers: getRebrickableHeaders(apiKey),
		next: { revalidate: 60 * 60 * 24 },
	});

	if (!response.ok) {
		throw new Error(`${response.status}`);
	}

	const payload = (await response.json()) as { count?: number };
	return Number(payload.count ?? 0);
}

export async function POST(request: Request) {
	let body: { offset?: number; batch_size?: number; force?: boolean } = {};
	try {
		body = (await request.json()) as { offset?: number; batch_size?: number; force?: boolean };
	} catch {
		body = {};
	}

	const offset = Math.max(0, Number(body.offset ?? 0) || 0);
	const batchSize = Math.max(1, Math.min(120, Number(body.batch_size ?? DEFAULT_BATCH_SIZE) || DEFAULT_BATCH_SIZE));
	const force = body.force === true;
	const apiKey = getRuntimeEnvValue("REBRICKABLE_API_KEY");

	if (!apiKey) {
		return NextResponse.json({ error: "Configura REBRICKABLE_API_KEY." }, { status: 500 });
	}

	try {
		const allPartNums = await getAllCatalogPartNumsFromKv();
		const total = allPartNums.length;
		if (offset >= total) {
			return NextResponse.json({ ok: true, total, processed: 0, next_offset: null, done: true });
		}

		const chunk = allPartNums.slice(offset, offset + batchSize);
		const existing = await getPopularityByPartNums(chunk);
		const toProcess = force ? chunk : chunk.filter((partNum) => !existing.has(partNum));

		const upserts: Array<{ part_num: string; set_count: number }> = [];
		const errors: Array<{ part_num: string; error: string }> = [];

		for (const partNum of toProcess) {
			try {
				const setCount = await fetchSetCountByPartNum(partNum, apiKey);
				upserts.push({ part_num: partNum, set_count: setCount });
			} catch (error) {
				errors.push({
					part_num: partNum,
					error: error instanceof Error ? error.message : "error",
				});
			}
		}

		await upsertPopularities(upserts);

		const nextOffset = offset + chunk.length;
		return NextResponse.json({
			ok: true,
			total,
			offset,
			processed: chunk.length,
			upserted: upserts.length,
			skipped_existing: chunk.length - toProcess.length,
			errors: errors.slice(0, 20),
			next_offset: nextOffset < total ? nextOffset : null,
			done: nextOffset >= total,
		});
	} catch (error) {
		const detail = error instanceof Error ? error.message : "error";
		return NextResponse.json({ error: `Backfill de ranking fallido (${detail}).` }, { status: 500 });
	}
}
