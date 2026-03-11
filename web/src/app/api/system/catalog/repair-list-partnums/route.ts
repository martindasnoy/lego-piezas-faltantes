import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";
import { getCachedCategories, getCachedCategoryAllParts } from "@/lib/rebrickable-catalog-cache";
import { staticRebrickableCategories } from "@/lib/rebrickable-categories-static";

const DEFAULT_BATCH_SIZE = 200;
const MAX_BATCH_SIZE = 500;
const CATALOG_CACHE_TTL_MS = 10 * 60 * 1000;

type Body = {
	offset?: number;
	batch_size?: number;
};

type CatalogDoc = {
	part_num: string;
	name: string;
	normalized_name: string;
	normalized_num: string;
	tokens: string[];
};

type CatalogIndex = {
	loadedAt: number;
	docs: CatalogDoc[];
	byNormalizedName: Map<string, CatalogDoc>;
	byNormalizedNum: Map<string, CatalogDoc>;
	byToken: Map<string, CatalogDoc[]>;
};

let catalogIndexCache: CatalogIndex | null = null;

function normalizeText(value: string | null | undefined) {
	return String(value ?? "")
		.toLowerCase()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/\b\d+(?:\s*(?:x|×|\*|by)\s*\d+)+\b/g, (sizeExpr) => sizeExpr.replace(/\s*(?:x|×|\*|by)\s*/g, "x"))
		.replace(/[^a-z0-9]+/g, " ")
		.trim()
		.replace(/\s+/g, " ");
}

function compactText(value: string | null | undefined) {
	return normalizeText(value).replace(/\s+/g, "");
}

function isProbablyInvalidPartNum(partNum: string | null | undefined) {
	const value = String(partNum ?? "").trim();
	if (!value) return true;
	if (value.startsWith("#")) return true;
	if (/\s/.test(value)) return true;
	if (/[^A-Za-z0-9._-]/.test(value)) return true;
	if (!/\d/.test(value)) return true;
	if (value.length > 28) return true;
	return false;
}

function buildTargetText(partNum: string | null | undefined, partName: string | null | undefined) {
	const cleanedNum = normalizeText(String(partNum ?? "").replace(/^#+\s*/, ""));
	const cleanedName = normalizeText(partName);
	if (cleanedName.length >= cleanedNum.length) return cleanedName;
	return cleanedName || cleanedNum;
}

function tokenOverlap(a: string[], b: string[]) {
	if (a.length === 0 || b.length === 0) return 0;
	const aSet = new Set(a);
	let common = 0;
	for (const token of b) {
		if (aSet.has(token)) common += 1;
	}
	return common / Math.max(aSet.size, b.length);
}

function scoreCandidate(target: string, targetTokens: string[], doc: CatalogDoc) {
	let score = 0;
	if (doc.normalized_name === target) score += 10000;
	if (doc.normalized_name.startsWith(target)) score += 4500;
	if (doc.normalized_name.includes(target)) score += 2600;
	if (target.includes(doc.normalized_name)) score += 1200;
	score += tokenOverlap(doc.tokens, targetTokens) * 1800;

	const targetSizes = target.match(/\b\d+(?:x\d+)+\b/g) ?? [];
	for (const sizeToken of targetSizes) {
		if (new RegExp(`\\b${sizeToken}\\b`).test(doc.normalized_name)) score += 1200;
	}

	score -= Math.abs(doc.normalized_name.length - target.length) * 2;
	return score;
}

async function loadCatalogIndex() {
	const now = Date.now();
	if (catalogIndexCache && now - catalogIndexCache.loadedAt < CATALOG_CACHE_TTL_MS) {
		return catalogIndexCache;
	}

	const categories = (await getCachedCategories())?.categories ?? staticRebrickableCategories;
	const byPartNum = new Map<string, { part_num: string; name: string }>();

	for (const category of categories) {
		const rows = (await getCachedCategoryAllParts(String(category.id)))?.parts ?? [];
		for (const row of rows) {
			const partNum = String(row.part_num ?? "").trim().toUpperCase();
			if (!partNum) continue;
			if (!byPartNum.has(partNum)) {
				byPartNum.set(partNum, {
					part_num: partNum,
					name: String(row.name ?? "").trim() || partNum,
				});
			}
		}
	}

	const docs: CatalogDoc[] = [...byPartNum.values()].map((row) => {
		const normalizedName = normalizeText(row.name);
		return {
			part_num: row.part_num,
			name: row.name,
			normalized_name: normalizedName,
			normalized_num: compactText(row.part_num),
			tokens: normalizedName.split(" ").filter((token) => token.length >= 2),
		};
	});

	const byNormalizedName = new Map<string, CatalogDoc>();
	const byNormalizedNum = new Map<string, CatalogDoc>();
	const byToken = new Map<string, CatalogDoc[]>();

	for (const doc of docs) {
		if (!byNormalizedName.has(doc.normalized_name)) byNormalizedName.set(doc.normalized_name, doc);
		byNormalizedNum.set(doc.normalized_num, doc);
		for (const token of doc.tokens) {
			const list = byToken.get(token) ?? [];
			list.push(doc);
			byToken.set(token, list);
		}
	}

	catalogIndexCache = {
		loadedAt: now,
		docs,
		byNormalizedName,
		byNormalizedNum,
		byToken,
	};

	return catalogIndexCache;
}

function findBestMatch(partNum: string | null | undefined, partName: string | null | undefined, index: CatalogIndex) {
	const normalizedNum = compactText(String(partNum ?? "").replace(/^#+\s*/, ""));
	if (normalizedNum) {
		const exactNum = index.byNormalizedNum.get(normalizedNum);
		if (exactNum) return exactNum;
	}

	const target = buildTargetText(partNum, partName);
	if (!target) return null;

	const exactName = index.byNormalizedName.get(target);
	if (exactName) return exactName;

	const targetTokens = target.split(" ").filter((token) => token.length >= 2);
	const candidates = new Map<string, CatalogDoc>();

	for (const token of targetTokens.slice(0, 3)) {
		for (const doc of index.byToken.get(token) ?? []) {
			candidates.set(doc.part_num, doc);
		}
	}

	if (candidates.size === 0) {
		for (const doc of index.docs) {
			if (doc.normalized_name.includes(target) || target.includes(doc.normalized_name)) {
				candidates.set(doc.part_num, doc);
			}
			if (candidates.size >= 350) break;
		}
	}

	let best: CatalogDoc | null = null;
	let bestScore = Number.NEGATIVE_INFINITY;

	for (const doc of candidates.values()) {
		const score = scoreCandidate(target, targetTokens, doc);
		if (score > bestScore) {
			bestScore = score;
			best = doc;
		}
	}

	if (!best || bestScore < 1600) return null;
	return best;
}

export async function POST(request: Request) {
	let body: Body = {};
	try {
		body = (await request.json()) as Body;
	} catch {
		body = {};
	}

	const offset = Math.max(0, Number(body.offset ?? 0) || 0);
	const batchSize = Math.max(1, Math.min(MAX_BATCH_SIZE, Number(body.batch_size ?? DEFAULT_BATCH_SIZE) || DEFAULT_BATCH_SIZE));

	try {
		const supabase = getSupabaseAdminClient();
		const { data, error, count } = await supabase
			.from("list_items")
			.select("id,part_num,part_name", { count: "exact" })
			.order("id", { ascending: true })
			.range(offset, offset + batchSize - 1);

		if (error) {
			return NextResponse.json({ error: error.message }, { status: 500 });
		}

		const rows = (data ?? []) as Array<{ id: string; part_num: string | null; part_name: string | null }>;
		if (rows.length === 0) {
			return NextResponse.json({ ok: true, total: Number(count ?? 0), offset, scanned: 0, repaired: 0, unmatched: 0, next_offset: null, done: true });
		}

		const index = await loadCatalogIndex();
		let scanned = 0;
		let repaired = 0;
		let unmatched = 0;
		const samples: Array<{ id: string; before: string; after: string }> = [];

		for (const row of rows) {
			if (!isProbablyInvalidPartNum(row.part_num)) continue;
			scanned += 1;
			const match = findBestMatch(row.part_num, row.part_name, index);
			if (!match) {
				unmatched += 1;
				continue;
			}

			const nextPartNum = match.part_num;
			const nextPartName = match.name;
			const beforePartNum = String(row.part_num ?? "").trim();
			if (beforePartNum.toUpperCase() === nextPartNum.toUpperCase()) continue;

			const { error: updateError } = await supabase
				.from("list_items")
				.update({ part_num: nextPartNum, part_name: nextPartName })
				.eq("id", row.id);

			if (updateError) {
				unmatched += 1;
				continue;
			}

			repaired += 1;
			if (samples.length < 20) {
				samples.push({ id: row.id, before: beforePartNum, after: nextPartNum });
			}
		}

		const nextOffset = offset + rows.length;
		const total = Number(count ?? 0);
		return NextResponse.json({
			ok: true,
			total,
			offset,
			scanned,
			repaired,
			unmatched,
			next_offset: nextOffset < total ? nextOffset : null,
			done: nextOffset >= total,
			samples,
		});
	} catch (error) {
		const detail = error instanceof Error ? error.message : "error";
		return NextResponse.json({ error: `No se pudo reparar part_num de listas (${detail}).` }, { status: 500 });
	}
}
