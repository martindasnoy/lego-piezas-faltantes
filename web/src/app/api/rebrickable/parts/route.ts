import { NextResponse } from "next/server";
import lunr from "lunr";
import { getRuntimeEnvValue } from "@/lib/runtime-env";
import { staticRebrickableCategories } from "@/lib/rebrickable-categories-static";
import { getCachedCategories, getCachedCategoryAllParts } from "@/lib/rebrickable-catalog-cache";

const REMOTE_FALLBACK_BASE_URL = "https://lego-piezas-faltantes.martindasnoy.workers.dev";
const SEARCH_RESULTS_LIMIT = 16;
const REBRICKABLE_PAGE_SIZE = 50;
const REBRICKABLE_MAX_CANDIDATES = 600;

type RebrickablePart = {
	part_num: string;
	name: string;
	part_img_url?: string | null;
	part_cat_id?: number | null;
};

type RebrickablePartsPayload = {
	results?: RebrickablePart[];
	next?: string | null;
};

type CatalogPartLite = {
	part_num: string;
	name: string;
	part_img_url: string | null;
};

type CatalogFetchedPart = CatalogPartLite & {
	part_cat_id: number | null;
};

type CatalogSearchDoc = {
	id: string;
	part_num: string;
	name: string;
	part_img_url: string | null;
	category_ids: number[];
	category_names_normalized: string;
	part_num_normalized: string;
	name_normalized: string;
	combined_normalized: string;
};

type CatalogSearchCache = {
	loadedAt: number;
	parts: CatalogPartLite[];
	docsById: Map<string, CatalogSearchDoc>;
	categoryNamesById: Map<number, string>;
	index: lunr.Index;
};

let kvCatalogCache: CatalogSearchCache | null = null;
const KV_CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;

function normalizeSearchText(value: string) {
	return String(value ?? "")
		.toLowerCase()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/\b\d+(?:\s*(?:x|×|\*|by)\s*\d+)+\b/g, (sizeExpr) => sizeExpr.replace(/\s*(?:x|×|\*|by)\s*/g, "x"))
		.replace(/[^a-z0-9]+/g, " ")
		.trim()
		.replace(/\s+/g, " ");
}

function compactNormalized(value: string) {
	return value.replace(/\s+/g, "");
}

function escapeRegExp(value: string) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractSizeTokens(value: string) {
	const matches = value.match(/\b\d+(?:x\d+)+\b/g) ?? [];
	return [...new Set(matches)];
}

const SEMANTIC_TOKEN_GROUPS = [
	["tile", "tiles", "baldosa", "baldosas", "azulejo", "azulejos"],
	["plate", "plates", "placa", "placas"],
	["brick", "bricks", "ladrillo", "ladrillos", "bloque", "bloques"],
	["slope", "sloped", "curved", "curvo", "curva", "wedge", "wedged"],
	["round", "rounded", "circular", "dish", "dishes", "disco", "discos"],
	["technic", "axle", "axles", "pin", "pins", "gear", "gears", "beam", "beams", "bush", "bushes", "connector", "connectors"],
	["minifig", "minifigs", "minifigure", "minifigures", "minifigura", "minifiguras"],
	["wheel", "wheels", "tyre", "tyres", "tire", "tires", "rueda", "ruedas"],
	["window", "windows", "door", "doors", "ventana", "ventanas", "puerta", "puertas"],
];

const SEMANTIC_TOKEN_MAP = (() => {
	const map = new Map<string, string[]>();
	for (const group of SEMANTIC_TOKEN_GROUPS) {
		const normalizedGroup = [...new Set(group.map((token) => normalizeSearchText(token)).filter((token) => token.length >= 2))];
		for (const token of normalizedGroup) {
			map.set(
				token,
				normalizedGroup.filter((candidate) => candidate !== token),
			);
		}
	}
	return map;
})();

function getSemanticTokenVariants(token: string) {
	const variants = new Set<string>([...getCategoryTokenVariants(token), ...(SEMANTIC_TOKEN_MAP.get(token) ?? [])]);
	for (const alias of SEMANTIC_TOKEN_MAP.get(token) ?? []) {
		for (const inflected of getCategoryTokenVariants(alias)) {
			variants.add(inflected);
		}
	}
	return [...variants].filter((value) => value.length >= 2);
}

function buildQueryTokenSpecs(tokens: string[]) {
	const seen = new Set<string>();
	const specs: Array<{ token: string; semantic: boolean }> = [];

	for (const token of tokens) {
		if (seen.has(token)) continue;
		seen.add(token);
		specs.push({ token, semantic: false });
	}

	for (const token of tokens) {
		if (token.length < 3 || /^\d+(?:x\d+)+$/.test(token)) continue;
		for (const expanded of getSemanticTokenVariants(token)) {
			if (seen.has(expanded)) continue;
			seen.add(expanded);
			specs.push({ token: expanded, semantic: true });
		}
	}

	return specs;
}

function tokenMatchesNormalizedText(token: string, text: string) {
	if (/^\d+(?:x\d+)+$/.test(token)) {
		return new RegExp(`\\b${escapeRegExp(token)}\\b`).test(text);
	}
	return text.includes(token);
}

function getCategoryTokenVariants(token: string) {
	const variants = new Set<string>([token]);
	if (token.endsWith("ies") && token.length > 4) variants.add(`${token.slice(0, -3)}y`);
	if (token.endsWith("y") && token.length > 2) variants.add(`${token.slice(0, -1)}ies`);
	if (token.endsWith("es") && token.length > 3) variants.add(token.slice(0, -2));
	if (token.endsWith("s") && token.length > 2) variants.add(token.slice(0, -1));
	if (!token.endsWith("s")) variants.add(`${token}s`);
	return [...variants].filter((value) => value.length >= 2);
}

function getMatchedCategoryIds(tokens: string[], categoryNamesById: Map<number, string>) {
	if (tokens.length === 0 || categoryNamesById.size === 0) return new Set<number>();
	const matched = new Set<number>();
	for (const [categoryId, categoryName] of categoryNamesById.entries()) {
		for (const token of tokens) {
			const variants = getSemanticTokenVariants(token);
			const tokenMatched = variants.some((variant) => {
				const tokenRegex = new RegExp(`\\b${escapeRegExp(variant)}[a-z0-9]*\\b`);
				return tokenRegex.test(categoryName);
			});
			if (tokenMatched) {
				matched.add(categoryId);
				break;
			}
		}
	}
	return matched;
}

async function getCatalogSearchCacheFromKv(): Promise<CatalogSearchCache> {
	const now = Date.now();
	if (kvCatalogCache && now - kvCatalogCache.loadedAt < KV_CATALOG_CACHE_TTL_MS) {
		return kvCatalogCache;
	}

	const categories = (await getCachedCategories())?.categories ?? staticRebrickableCategories;
 	const categoryNamesById = new Map<number, string>();
 	for (const category of categories) {
		categoryNamesById.set(Number(category.id), normalizeSearchText(String(category.name ?? "")));
	}

	const byPartNum = new Map<string, CatalogPartLite>();
	const categoryIdsByPart = new Map<string, Set<number>>();
	await Promise.all(
		categories.map(async (category) => {
			const categoryId = Number(category.id);
			const cached = await getCachedCategoryAllParts(String(category.id));
			for (const row of cached?.parts ?? []) {
				const partNum = String(row.part_num ?? "").trim().toUpperCase();
				if (!partNum) continue;
				const name = String(row.name ?? "").trim() || partNum;
				const partImg = row.part_img_url ?? null;

				const existing = byPartNum.get(partNum);
				if (!existing) {
					byPartNum.set(partNum, { part_num: partNum, name, part_img_url: partImg });
				} else if (!existing.part_img_url && partImg) {
					existing.part_img_url = partImg;
				}

				if (Number.isFinite(categoryId) && categoryId > 0) {
					let categoryIds = categoryIdsByPart.get(partNum);
					if (!categoryIds) {
						categoryIds = new Set<number>();
						categoryIdsByPart.set(partNum, categoryIds);
					}
					categoryIds.add(categoryId);
				}
			}
		}),
	);

	const parts = [...byPartNum.values()];
	const docs: CatalogSearchDoc[] = parts.map((part) => ({
		id: part.part_num,
		part_num: part.part_num,
		name: part.name,
		part_img_url: part.part_img_url,
		category_ids: [...(categoryIdsByPart.get(part.part_num) ?? new Set<number>())],
		category_names_normalized: [...(categoryIdsByPart.get(part.part_num) ?? new Set<number>())]
			.map((categoryId) => categoryNamesById.get(categoryId) ?? "")
			.filter((categoryName) => categoryName.length > 0)
			.join(" "),
		part_num_normalized: normalizeSearchText(part.part_num),
		name_normalized: normalizeSearchText(part.name),
		combined_normalized: `${normalizeSearchText(part.part_num)} ${normalizeSearchText(part.name)}`.trim(),
	}));

	const docsById = new Map<string, CatalogSearchDoc>();
	for (const doc of docs) {
		docsById.set(doc.id, doc);
	}

	const index = lunr(function (this: lunr.Builder) {
		this.ref("id");
		this.field("combined_normalized", { boost: 6 });
		this.field("part_num_normalized", { boost: 10 });
		this.field("name_normalized", { boost: 4 });
		this.pipeline.remove(lunr.stemmer);
		this.searchPipeline.remove(lunr.stemmer);
		for (const doc of docs) {
			this.add(doc);
		}
	});

	kvCatalogCache = {
		loadedAt: now,
		parts,
		docsById,
		categoryNamesById,
		index,
	};
	return kvCatalogCache;
}

function searchWithLunr(
	index: lunr.Index,
	docsById: Map<string, CatalogSearchDoc>,
	categoryNamesById: Map<number, string>,
	normalizedQuery: string,
	offset = 0,
	limit = SEARCH_RESULTS_LIMIT,
) {
	const tokens = normalizedQuery.split(" ").filter((token) => token.length > 0);
	if (tokens.length === 0) {
		return { results: [] as CatalogPartLite[], hasMore: false };
	}
	const tokenSpecs = buildQueryTokenSpecs(tokens);
	const semanticOnlyTokens = tokenSpecs.filter((spec) => spec.semantic).map((spec) => spec.token);
	const normalizedQueryCompact = compactNormalized(normalizedQuery);
	const querySizeTokens = extractSizeTokens(normalizedQuery);
	const categoryIntentTokens = tokenSpecs
		.map((spec) => spec.token)
		.filter((token) => /[a-z]/.test(token) && token.length >= 3 && !/^\d+(?:x\d+)+$/.test(token));
	const matchedCategoryIds = getMatchedCategoryIds(categoryIntentTokens, categoryNamesById);

	const rawScores = new Map<string, number>();
	const addScore = (ref: string, value: number) => {
		const previous = rawScores.get(ref) ?? Number.NEGATIVE_INFINITY;
		if (value > previous) rawScores.set(ref, value);
	};

	const runQuery = (requiredOnCombined: boolean, scoreMultiplier: number) => {
		const found = index.query((query: lunr.Query) => {
			for (const tokenSpec of tokenSpecs) {
				const token = tokenSpec.token;
				const hasDigits = /\d/.test(token);
				const wildcardMode = hasDigits ? lunr.Query.wildcard.NONE : lunr.Query.wildcard.TRAILING;
				const typoTolerance = tokenSpec.semantic ? 0 : token.length >= 6 ? 1 : 0;
				const presence = requiredOnCombined && !tokenSpec.semantic ? lunr.Query.presence.REQUIRED : lunr.Query.presence.OPTIONAL;
				const boostFactor = tokenSpec.semantic ? 0.55 : 1;

				query.term(token, {
					fields: ["combined_normalized"],
					boost: 10 * boostFactor,
					wildcard: wildcardMode,
					editDistance: typoTolerance,
					presence,
				});
				query.term(token, {
					fields: ["part_num_normalized"],
					boost: 20 * boostFactor,
					wildcard: wildcardMode,
					editDistance: typoTolerance,
					presence: lunr.Query.presence.OPTIONAL,
				});
				query.term(token, {
					fields: ["name_normalized"],
					boost: 8 * boostFactor,
					wildcard: wildcardMode,
					editDistance: typoTolerance,
					presence: lunr.Query.presence.OPTIONAL,
				});
			}
		});

		for (const match of found) {
			addScore(String(match.ref ?? "").toUpperCase(), Number(match.score ?? 0) * scoreMultiplier);
		}
	};

	runQuery(true, 2.2);
	runQuery(false, 1.0);

	if (rawScores.size === 0) {
		for (const [docId, doc] of docsById.entries()) {
			if (tokens.every((token) => tokenMatchesNormalizedText(token, doc.combined_normalized))) {
				addScore(docId, 0.01);
			}
		}
	}

	const scored = [...rawScores.entries()]
		.map(([docId, lunrScore]) => {
			const doc = docsById.get(docId);
			if (!doc) return null;
			const firstThreeWords = doc.name_normalized.split(" ").filter(Boolean).slice(0, 3);
			const docSizeTokens = extractSizeTokens(doc.name_normalized);
			const exactSizeHits = querySizeTokens.filter((size) => docSizeTokens.includes(size)).length;
			const partialSizeHits = querySizeTokens.filter((size) => docSizeTokens.some((docSize) => docSize.startsWith(`${size}x`))).length;
			const categoryHitCount = doc.category_ids.filter((categoryId) => matchedCategoryIds.has(categoryId)).length;
			const categoryPriority = matchedCategoryIds.size > 0 && categoryHitCount > 0 ? 1 : 0;
			const semanticNameHits = semanticOnlyTokens.reduce((count, token) => count + (doc.name_normalized.includes(token) ? 1 : 0), 0);
			const semanticCategoryHits = semanticOnlyTokens.reduce(
				(count, token) => count + (doc.category_names_normalized.includes(token) ? 1 : 0),
				0,
			);
			const leadingWordHits = tokens.reduce((count, token) => {
				if (token.length < 2) return count;
				const hit = firstThreeWords.some((word) => word === token || word.startsWith(token) || token.startsWith(word));
				return count + (hit ? 1 : 0);
			}, 0);

			const partNumCompact = compactNormalized(doc.part_num_normalized);
			const exactPartNum = partNumCompact === normalizedQueryCompact ? 1 : 0;
			const startsWithPartNum = !exactPartNum && partNumCompact.startsWith(normalizedQueryCompact) ? 1 : 0;
			const exactName = doc.name_normalized === normalizedQuery ? 1 : 0;
			const startsWithName = !exactName && doc.name_normalized.startsWith(normalizedQuery) ? 1 : 0;
			const allInName = tokens.every((token) => tokenMatchesNormalizedText(token, doc.name_normalized)) ? 1 : 0;
			const allInCombined = tokens.every((token) => tokenMatchesNormalizedText(token, doc.combined_normalized)) ? 1 : 0;
			const boundaryHits = tokens.reduce((count, token) => {
				const tokenRegex = new RegExp(`\\b${escapeRegExp(token)}`);
				return count + (tokenRegex.test(doc.name_normalized) ? 1 : 0);
			}, 0);
			const printPenalty = /\bprint(ed)?\b/.test(doc.name_normalized) ? 350 : 0;

			const heuristic =
				lunrScore * 100 +
				categoryHitCount * 9000 +
				leadingWordHits * 2600 +
				semanticCategoryHits * 2800 +
				semanticNameHits * 1200 +
				exactSizeHits * 6500 +
				partialSizeHits * 2500 +
				exactPartNum * 10000 +
				startsWithPartNum * 6500 +
				exactName * 3000 +
				startsWithName * 1800 +
				allInName * 900 +
				allInCombined * 700 +
				boundaryHits * 120 -
				printPenalty -
				doc.name_normalized.length * 0.4;

			return {
				part: {
					part_num: doc.part_num,
					name: doc.name,
					part_img_url: doc.part_img_url,
				},
				categoryPriority,
				heuristic,
			};
		})
		.filter((row): row is { part: CatalogPartLite; categoryPriority: number; heuristic: number } => row !== null)
		.sort((a, b) => {
			if (a.categoryPriority !== b.categoryPriority) return b.categoryPriority - a.categoryPriority;
			const aNameLength = a.part.name.trim().length;
			const bNameLength = b.part.name.trim().length;
			if (aNameLength !== bNameLength) return aNameLength - bNameLength;
			if (a.heuristic !== b.heuristic) return b.heuristic - a.heuristic;
			return a.part.part_num.localeCompare(b.part.part_num);
		});

	const ranked = scored.map((row) => row.part);
	const safeOffset = Math.max(0, Math.trunc(offset));
	const safeLimit = Math.max(1, Math.trunc(limit));
	const results = ranked.slice(safeOffset, safeOffset + safeLimit);
	const hasMore = safeOffset + safeLimit < ranked.length;

	return { results, hasMore };
}

async function fetchRebrickableMatches(query: string, apiKey: string): Promise<CatalogFetchedPart[]> {
	const byPartNum = new Map<string, CatalogFetchedPart>();
	let nextUrl: string | null = "https://rebrickable.com/api/v3/lego/parts/";

	while (nextUrl && byPartNum.size < REBRICKABLE_MAX_CANDIDATES) {
		const url = new URL(nextUrl);
		if (!url.searchParams.has("search")) url.searchParams.set("search", query);
		if (!url.searchParams.has("page_size")) url.searchParams.set("page_size", String(REBRICKABLE_PAGE_SIZE));
		if (!url.searchParams.has("inc_part_details")) url.searchParams.set("inc_part_details", "1");
		url.searchParams.set("key", apiKey);

		const response = await fetch(url.toString(), {
			headers: {
				Accept: "application/json",
				Authorization: `key ${apiKey}`,
				"User-Agent": "lego-piezas-faltantes/1.0",
			},
			next: { revalidate: 300 },
		});

		if (!response.ok) {
			throw new Error(`REBRICKABLE_STATUS_${response.status}`);
		}

		const payload = (await response.json()) as RebrickablePartsPayload;
		for (const part of payload.results ?? []) {
			const partNum = String(part.part_num ?? "").trim().toUpperCase();
			if (!partNum) continue;
			const categoryId = Number(part.part_cat_id ?? 0);
			const normalizedCategoryId = Number.isFinite(categoryId) && categoryId > 0 ? categoryId : null;
			const existing = byPartNum.get(partNum);
			if (!existing) {
				byPartNum.set(partNum, {
					part_num: partNum,
					name: String(part.name ?? "").trim() || partNum,
					part_img_url: part.part_img_url ?? null,
					part_cat_id: normalizedCategoryId,
				});
			} else if (existing.part_cat_id == null && normalizedCategoryId != null) {
				existing.part_cat_id = normalizedCategoryId;
			}
			if (byPartNum.size >= REBRICKABLE_MAX_CANDIDATES) break;
		}

		nextUrl = payload.next ?? null;
	}

	return [...byPartNum.values()];
}

export async function GET(request: Request) {
	const { searchParams } = new URL(request.url);
	const query = (searchParams.get("q") ?? "").trim();
	const offset = Number(searchParams.get("offset") ?? "0");
	const limit = Number(searchParams.get("limit") ?? String(SEARCH_RESULTS_LIMIT));
	const debugMode = searchParams.get("debug") === "1";
	const requestUrl = new URL(request.url);
	const skipRemoteFallback = searchParams.get("skip_remote_fallback") === "1";
  	const safeOffset = Number.isFinite(offset) ? Math.max(0, Math.trunc(offset)) : 0;
	const safeLimit = Number.isFinite(limit) ? Math.min(50, Math.max(1, Math.trunc(limit))) : SEARCH_RESULTS_LIMIT;

	if (query.length < 2) {
		const response = NextResponse.json({ results: [], engine: "lunr", has_more: false });
		response.headers.set("x-search-engine", "lunr");
		return response;
	}

	try {
		const normalizedQuery = normalizeSearchText(query);
		const { parts, docsById, categoryNamesById, index } = await getCatalogSearchCacheFromKv();

		if (parts.length > 0) {
			const { results, hasMore } = searchWithLunr(index, docsById, categoryNamesById, normalizedQuery, safeOffset, safeLimit);
			const body = debugMode
				? {
					results,
					has_more: hasMore,
					engine: "lunr",
					debug: {
						normalized_query: normalizedQuery,
						cache_source: "kv",
						matched_categories: [...getMatchedCategoryIds(
							normalizedQuery
								.split(" ")
								.filter((token) => /[a-z]/.test(token) && token.length >= 3 && !/^\d+(?:x\d+)+$/.test(token)),
							categoryNamesById,
						)],
					},
				}
				: { results, has_more: hasMore, engine: "lunr" };
			const out = NextResponse.json(body);
			out.headers.set("x-search-engine", "lunr");
			return out;
		}

		const remoteUrl = new URL(`${REMOTE_FALLBACK_BASE_URL}/api/rebrickable/parts`);
		const isSameWorkerOrigin = remoteUrl.origin === requestUrl.origin;
		if (!skipRemoteFallback && !isSameWorkerOrigin) {
			remoteUrl.searchParams.set("q", query);
			remoteUrl.searchParams.set("skip_remote_fallback", "1");
			if (debugMode) remoteUrl.searchParams.set("debug", "1");
			try {
				const remoteResponse = await fetch(remoteUrl.toString(), { cache: "no-store" });
				if (remoteResponse.ok) {
					const remotePayload = (await remoteResponse.json()) as {
						results?: CatalogPartLite[];
						has_more?: boolean;
						engine?: string;
						debug?: Record<string, unknown>;
					};
					if (Array.isArray(remotePayload.results) && remotePayload.results.length > 0) {
						const sliced = remotePayload.results.slice(safeOffset, safeOffset + safeLimit);
						const hasMore =
							typeof remotePayload.has_more === "boolean"
								? remotePayload.has_more
								: safeOffset + safeLimit < remotePayload.results.length;
						const body = debugMode
							? {
								results: sliced,
								has_more: hasMore,
								engine: "lunr",
								debug: {
									normalized_query: normalizedQuery,
									cache_source: "remote-fallback",
									remote_engine: remotePayload.engine ?? "unknown",
								},
							}
							: { results: sliced, has_more: hasMore, engine: "lunr" };
						const out = NextResponse.json(body);
						out.headers.set("x-search-engine", "lunr");
						return out;
					}
				}
			} catch {
				// Continue to local API fallback below.
			}
		}

		const apiKey = getRuntimeEnvValue("REBRICKABLE_API_KEY");
		if (!apiKey) {
			return NextResponse.json({ error: "No hay cache KV cargado y falta REBRICKABLE_API_KEY." }, { status: 500 });
		}

		const base = await fetchRebrickableMatches(query, apiKey);
		const fallbackCategories = (await getCachedCategories())?.categories ?? staticRebrickableCategories;
		const fallbackCategoryNamesById = new Map<number, string>();
		for (const category of fallbackCategories) {
			fallbackCategoryNamesById.set(Number(category.id), normalizeSearchText(String(category.name ?? "")));
		}

		const docs = base.map((part) => ({
			id: part.part_num.trim().toUpperCase(),
			part_num: part.part_num,
			name: part.name,
			part_img_url: part.part_img_url,
			category_ids: part.part_cat_id != null ? [part.part_cat_id] : [],
			category_names_normalized:
				part.part_cat_id != null ? (fallbackCategoryNamesById.get(part.part_cat_id) ?? "") : "",
			part_num_normalized: normalizeSearchText(part.part_num),
			name_normalized: normalizeSearchText(part.name),
			combined_normalized: `${normalizeSearchText(part.part_num)} ${normalizeSearchText(part.name)}`.trim(),
		}));
		const fallbackDocsById = new Map<string, CatalogSearchDoc>();
		for (const doc of docs) {
			fallbackDocsById.set(doc.id, doc);
		}
		const fallbackIndex = lunr(function (this: lunr.Builder) {
			this.ref("id");
			this.field("combined_normalized", { boost: 6 });
			this.field("part_num_normalized", { boost: 10 });
			this.field("name_normalized", { boost: 4 });
			this.pipeline.remove(lunr.stemmer);
			this.searchPipeline.remove(lunr.stemmer);
			for (const doc of docs) {
				this.add(doc);
			}
		});

		const { results, hasMore } = searchWithLunr(fallbackIndex, fallbackDocsById, fallbackCategoryNamesById, normalizedQuery, safeOffset, safeLimit);

		const body = debugMode
			? {
				results,
				has_more: hasMore,
				engine: "lunr",
				debug: {
					normalized_query: normalizedQuery,
					cache_source: "api-fallback",
				},
			}
			: { results, has_more: hasMore, engine: "lunr" };
		const out = NextResponse.json(body);
		out.headers.set("x-search-engine", "lunr");
		return out;
	} catch {
		return NextResponse.json({ error: "No se pudo buscar en catalogo." }, { status: 500 });
	}
}
