import { createClient } from "@supabase/supabase-js";
import { getRuntimeEnvValue } from "@/lib/runtime-env";

const FALLBACK_SUPABASE_URL = "https://etqtoerfzjaewrrlyhfa.supabase.co";
const FALLBACK_SUPABASE_ANON_KEY = "sb_publishable_6otEjYUOTkbGjcjHMFCg3g_mS3voCBM";

export type MinifigPartCacheRow = {
	set_num: string;
	part_num: string;
	name: string;
	quantity: number;
	color_name: string | null;
	color_name_norm: string;
	part_img_url: string | null;
	is_spare: boolean;
	updated_at: string;
};

type UpsertMinifigPartInput = {
	set_num: string;
	part_num: string;
	name: string;
	quantity: number;
	color_name: string | null;
	color_name_norm: string;
	part_img_url: string | null;
	is_spare: boolean;
};

function getServerSupabaseClient() {
	const supabaseUrl = getRuntimeEnvValue("NEXT_PUBLIC_SUPABASE_URL") || FALLBACK_SUPABASE_URL;
	const supabaseAnonKey = getRuntimeEnvValue("NEXT_PUBLIC_SUPABASE_ANON_KEY") || FALLBACK_SUPABASE_ANON_KEY;

	return createClient(supabaseUrl, supabaseAnonKey, {
		auth: { persistSession: false, autoRefreshToken: false },
	});
}

export function normalizeMinifigColorName(raw: string | null | undefined): string {
	if (!raw) return "";
	return raw
		.toLowerCase()
		.replace(/grey/g, "gray")
		.replace(/\(chino\)/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

export async function listMinifigPartsBySetNum(setNum: string) {
	const normalized = setNum.trim().toUpperCase();
	if (!normalized) return [];

	const supabase = getServerSupabaseClient();
	const { data, error } = await supabase
		.from("minifig_parts_cache")
		.select("set_num,part_num,name,quantity,color_name,color_name_norm,part_img_url,is_spare,updated_at")
		.eq("set_num", normalized)
		.order("is_spare", { ascending: true })
		.order("part_num", { ascending: true })
		.order("color_name", { ascending: true, nullsFirst: true });

	if (error) throw new Error(error.message);
	return (data ?? []) as MinifigPartCacheRow[];
}

export async function upsertMinifigParts(rows: UpsertMinifigPartInput[]) {
	if (rows.length === 0) return;
	const supabase = getServerSupabaseClient();

	const { error } = await supabase.from("minifig_parts_cache").upsert(rows, {
		onConflict: "set_num,part_num,color_name_norm,is_spare",
	});

	if (error) throw new Error(error.message);
}

export async function countMinifigPartsRows() {
	const supabase = getServerSupabaseClient();
	const { count, error } = await supabase.from("minifig_parts_cache").select("set_num", { count: "exact", head: true });
	if (error) throw new Error(error.message);
	return Number(count ?? 0);
}

export async function listDistinctMinifigPartSetNums() {
	const supabase = getServerSupabaseClient();
	const out = new Set<string>();
	let from = 0;
	const pageSize = 1000;

	while (true) {
		const { data, error } = await supabase.from("minifig_parts_cache").select("set_num").range(from, from + pageSize - 1);
		if (error) throw new Error(error.message);
		if (!data || data.length === 0) break;

		for (const row of data as Array<{ set_num: string | null }>) {
			const setNum = String(row.set_num ?? "").trim().toUpperCase();
			if (setNum) out.add(setNum);
		}

		if (data.length < pageSize) break;
		from += pageSize;
	}

	return [...out].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
}
