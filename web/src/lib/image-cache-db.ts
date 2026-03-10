import { createClient } from "@supabase/supabase-js";
import { getRuntimeEnvValue } from "@/lib/runtime-env";

const FALLBACK_SUPABASE_URL = "https://etqtoerfzjaewrrlyhfa.supabase.co";
const FALLBACK_SUPABASE_ANON_KEY = "sb_publishable_6otEjYUOTkbGjcjHMFCg3g_mS3voCBM";

export type PartImageCacheRow = {
	cache_key: string;
	part_num: string;
	color_name: string;
	color_name_norm: string;
	part_img_url: string | null;
	status: "found" | "missing" | "error";
	source: "rebrickable" | "manual";
	updated_at: string;
};

type UpsertCacheInput = {
	cache_key: string;
	part_num: string;
	color_name: string;
	color_name_norm: string;
	part_img_url: string | null;
	status: "found" | "missing" | "error";
	source?: "rebrickable" | "manual";
};

export function normalizeColorName(raw: string | null | undefined): string {
	if (!raw) return "";
	return raw
		.toLowerCase()
		.replace(/grey/g, "gray")
		.replace(/\(chino\)/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

export function buildCacheKey(partNum: string, colorName: string | null | undefined): string {
	return `${partNum.trim().toUpperCase()}::${normalizeColorName(colorName)}`;
}

function getServerSupabaseClient() {
	const supabaseUrl = getRuntimeEnvValue("NEXT_PUBLIC_SUPABASE_URL") || FALLBACK_SUPABASE_URL;
	const supabaseAnonKey = getRuntimeEnvValue("NEXT_PUBLIC_SUPABASE_ANON_KEY") || FALLBACK_SUPABASE_ANON_KEY;

	return createClient(supabaseUrl, supabaseAnonKey, {
		auth: { persistSession: false, autoRefreshToken: false },
	});
}

export async function getCachedImagesByKeys(keys: string[]) {
	if (keys.length === 0) return new Map<string, PartImageCacheRow>();
	const supabase = getServerSupabaseClient();
	const { data, error } = await supabase
		.from("part_image_cache")
		.select("cache_key,part_num,color_name,color_name_norm,part_img_url,status,source,updated_at")
		.in("cache_key", keys);

	if (error) throw new Error(error.message);

	const rows = (data ?? []) as PartImageCacheRow[];
	return new Map(rows.map((row) => [row.cache_key, row]));
}

export async function upsertCachedImages(rows: UpsertCacheInput[]) {
	if (rows.length === 0) return;
	const supabase = getServerSupabaseClient();
	const payload = rows.map((row) => ({
		...row,
		source: row.source ?? "rebrickable",
	}));

	const { error } = await supabase.from("part_image_cache").upsert(payload, { onConflict: "cache_key" });
	if (error) throw new Error(error.message);
}

export async function listCachedImages(page: number, pageSize: number) {
	const supabase = getServerSupabaseClient();
	const start = (page - 1) * pageSize;
	const end = start + pageSize - 1;

	const { data, error, count } = await supabase
		.from("part_image_cache")
		.select("part_num,color_name,part_img_url,updated_at", { count: "exact" })
		.not("part_img_url", "is", null)
		.order("updated_at", { ascending: false })
		.range(start, end);

	if (error) throw new Error(error.message);

	return {
		rows: (data ?? []) as Array<{ part_num: string; color_name: string; part_img_url: string; updated_at: string }>,
		total: Number(count ?? 0),
	};
}

export async function getFallbackImagesByPartNums(partNums: string[]) {
	if (partNums.length === 0) return new Map<string, string>();
	const uniqueNums = [...new Set(partNums.map((num) => num.trim().toUpperCase()).filter(Boolean))];
	if (uniqueNums.length === 0) return new Map<string, string>();

	const supabase = getServerSupabaseClient();
	const { data, error } = await supabase
		.from("part_image_cache")
		.select("part_num,part_img_url,updated_at")
		.in("part_num", uniqueNums)
		.not("part_img_url", "is", null)
		.order("updated_at", { ascending: false });

	if (error) throw new Error(error.message);

	const byPart = new Map<string, string>();
	for (const row of (data ?? []) as Array<{ part_num: string; part_img_url: string | null }>) {
		const key = row.part_num.trim().toUpperCase();
		if (!key || !row.part_img_url) continue;
		if (!byPart.has(key)) {
			byPart.set(key, row.part_img_url);
		}
	}

	return byPart;
}

export async function countPartImageRows() {
	const supabase = getServerSupabaseClient();
	const { count, error } = await supabase.from("part_image_cache").select("cache_key", { count: "exact", head: true });
	if (error) throw new Error(error.message);
	return Number(count ?? 0);
}
