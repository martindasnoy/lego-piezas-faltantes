import { NextResponse } from "next/server";
import { getRuntimeEnvValue } from "@/lib/runtime-env";
import { getCatalogKvBinding } from "@/lib/rebrickable-catalog-cache";
import {
	getCachedMinifigureThemesFromKv,
	getCachedMinifiguresByThemeFromKv,
	getCachedMinifigureParts,
} from "@/lib/rebrickable-minifig-cache";
import { normalizeColorName, buildCacheKey, upsertCachedImages } from "@/lib/image-cache-db";
import { normalizeMinifigColorName, upsertMinifigParts } from "@/lib/minifig-parts-db";

const DEFAULT_BATCH_SIZE = 8;

type BackfillBody = {
	offset?: number;
	batch_size?: number;
	set_nums?: string[];
};

function normalizeSetNums(input: unknown) {
	if (!Array.isArray(input)) return [];
	return [...new Set(input.map((value) => String(value ?? "").trim().toUpperCase()).filter(Boolean))];
}

async function getAllSetNumsFromKv() {
	const kv = getCatalogKvBinding();
	if (!kv) return [] as string[];

	const themes = await getCachedMinifigureThemesFromKv(kv);
	const setNums = new Set<string>();

	for (const theme of themes?.results ?? []) {
		const figures = await getCachedMinifiguresByThemeFromKv(theme.id, kv);
		for (const figure of figures?.results ?? []) {
			const setNum = String(figure.setNum ?? "").trim().toUpperCase();
			if (setNum) setNums.add(setNum);
		}
	}

	return [...setNums].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
}

export async function POST(request: Request) {
	let body: BackfillBody = {};
	try {
		body = (await request.json()) as BackfillBody;
	} catch {
		body = {};
	}

	const apiKey = getRuntimeEnvValue("REBRICKABLE_API_KEY");
	if (!apiKey) {
		return NextResponse.json({ error: "Configura REBRICKABLE_API_KEY." }, { status: 500 });
	}

	const explicitSetNums = normalizeSetNums(body.set_nums);
	const allSetNums = explicitSetNums.length > 0 ? explicitSetNums : await getAllSetNumsFromKv();
	const total = allSetNums.length;

	const offset = Math.max(0, Number(body.offset ?? 0) || 0);
	const batchSize = Math.max(1, Math.min(20, Number(body.batch_size ?? DEFAULT_BATCH_SIZE) || DEFAULT_BATCH_SIZE));

	if (total === 0) {
		return NextResponse.json({ ok: true, total: 0, processed: 0, upserted: 0, next_offset: null, done: true });
	}

	if (offset >= total) {
		return NextResponse.json({ ok: true, total, offset, processed: 0, upserted: 0, next_offset: null, done: true });
	}

	const chunk = allSetNums.slice(offset, offset + batchSize);
	const partRows: Array<{
		set_num: string;
		part_num: string;
		name: string;
		quantity: number;
		color_name: string | null;
		color_name_norm: string;
		part_img_url: string | null;
		is_spare: boolean;
	}> = [];
	const imageRows: Array<{
		cache_key: string;
		part_num: string;
		color_name: string;
		color_name_norm: string;
		part_img_url: string | null;
		status: "found" | "missing" | "error";
	}> = [];
	const stats: Array<{ set_num: string; ok: boolean; parts: number; error?: string }> = [];

	for (const setNum of chunk) {
		try {
			const parts = await getCachedMinifigureParts(setNum, apiKey);
			const dedup = new Map<string, { row: (typeof partRows)[number] }>();

			for (const part of parts) {
				const partNum = String(part.part_num ?? "").trim().toUpperCase();
				if (!partNum) continue;
				const colorName = part.color_name?.trim() ? part.color_name.trim() : null;
				const colorNorm = normalizeMinifigColorName(colorName);
				const isSpare = Boolean(part.is_spare);
				const quantity = Math.max(1, Number(part.quantity ?? 1) || 1);
				const key = `${setNum}::${partNum}::${colorNorm}::${isSpare ? 1 : 0}`;

				const current = dedup.get(key)?.row;
				if (current) {
					current.quantity += quantity;
					if (!current.part_img_url && part.part_img_url) current.part_img_url = part.part_img_url;
					continue;
				}

				dedup.set(key, {
					row: {
						set_num: setNum,
						part_num: partNum,
						name: String(part.name ?? partNum),
						quantity,
						color_name: colorName,
						color_name_norm: colorNorm,
						part_img_url: part.part_img_url ?? null,
						is_spare: isSpare,
					},
				});
			}

			const normalized = [...dedup.values()].map((entry) => entry.row);
			partRows.push(...normalized);

			for (const row of normalized) {
				imageRows.push({
					cache_key: buildCacheKey(row.part_num, row.color_name),
					part_num: row.part_num,
					color_name: row.color_name ?? "",
					color_name_norm: normalizeColorName(row.color_name),
					part_img_url: row.part_img_url,
					status: row.part_img_url ? "found" : "missing",
				});
			}

			stats.push({ set_num: setNum, ok: true, parts: normalized.length });
		} catch (error) {
			stats.push({
				set_num: setNum,
				ok: false,
				parts: 0,
				error: error instanceof Error ? error.message : "error",
			});
		}
	}

	if (partRows.length > 0) {
		await upsertMinifigParts(partRows);
	}

	if (imageRows.length > 0) {
		try {
			await upsertCachedImages(imageRows);
		} catch {
			// keep backfill response even if image cache write fails
		}
	}

	const nextOffset = offset + chunk.length;
	return NextResponse.json({
		ok: true,
		total,
		offset,
		processed: chunk.length,
		upserted: partRows.length,
		next_offset: nextOffset < total ? nextOffset : null,
		done: nextOffset >= total,
		stats,
	});
}
