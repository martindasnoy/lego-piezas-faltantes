import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

const READ_PAGE_SIZE = 1000;
const DEFAULT_BATCH_SIZE = 180;

type ListItemRow = {
	part_num: string | null;
	color_name: string | null;
};

function normalizePartNum(value: string | null | undefined) {
	return String(value ?? "").trim().toUpperCase();
}

function normalizeColorName(value: string | null | undefined) {
	return String(value ?? "").trim();
}

async function readAllUniqueListPairs() {
	const supabase = getSupabaseAdminClient();
	let from = 0;
	const unique = new Map<string, { part_num: string; color_name: string | null }>();

	while (true) {
		const to = from + READ_PAGE_SIZE - 1;
		const { data, error } = await supabase
			.from("list_items")
			.select("part_num,color_name")
			.range(from, to);

		if (error) throw new Error(error.message);

		const rows = (data ?? []) as ListItemRow[];
		for (const row of rows) {
			const partNum = normalizePartNum(row.part_num);
			if (!partNum) continue;
			const colorName = normalizeColorName(row.color_name);
			const key = `${partNum}::${colorName.toLowerCase()}`;
			if (!unique.has(key)) {
				unique.set(key, { part_num: partNum, color_name: colorName || null });
			}
		}

		if (rows.length < READ_PAGE_SIZE) break;
		from += READ_PAGE_SIZE;
	}

	return [...unique.values()];
}

async function callPartImages(origin: string, items: Array<{ part_num: string; color_name: string | null }>) {
	const response = await fetch(`${origin}/api/rebrickable/part-images`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ items }),
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`part-images failed ${response.status}: ${text}`);
	}

	return (await response.json()) as {
		results?: Array<{ part_num: string; part_img_url: string | null }>;
	};
}

export async function POST(request: Request) {
	let body: { offset?: number; batch_size?: number } = {};
	try {
		body = (await request.json()) as { offset?: number; batch_size?: number };
	} catch {
		body = {};
	}

	const offset = Math.max(0, Number(body.offset ?? 0) || 0);
	const batchSize = Math.max(1, Math.min(500, Number(body.batch_size ?? DEFAULT_BATCH_SIZE) || DEFAULT_BATCH_SIZE));

	try {
		const all = await readAllUniqueListPairs();
		const total = all.length;
		if (offset >= total) {
			return NextResponse.json({ ok: true, total, processed: 0, next_offset: null, done: true });
		}

		const chunk = all.slice(offset, offset + batchSize);
		const origin = new URL(request.url).origin;
		const result = await callPartImages(origin, chunk);
		const processed = (result.results ?? []).length;
		const nextOffset = offset + chunk.length;

		return NextResponse.json({
			ok: true,
			total,
			processed,
			offset,
			next_offset: nextOffset < total ? nextOffset : null,
			done: nextOffset >= total,
		});
	} catch (error) {
		const detail = error instanceof Error ? error.message : "error";
		return NextResponse.json({ error: `Backfill fallido (${detail}).` }, { status: 500 });
	}
}
