import { createClient } from "@supabase/supabase-js";
import { getRuntimeEnvValue } from "@/lib/runtime-env";

const FALLBACK_SUPABASE_URL = "https://etqtoerfzjaewrrlyhfa.supabase.co";
const FALLBACK_SUPABASE_ANON_KEY = "sb_publishable_6otEjYUOTkbGjcjHMFCg3g_mS3voCBM";

export type PartPopularityRow = {
	part_num: string;
	set_count: number;
	updated_at: string;
};

type UpsertPopularityInput = {
	part_num: string;
	set_count: number;
};

function getServerSupabaseClient() {
	const supabaseUrl = getRuntimeEnvValue("NEXT_PUBLIC_SUPABASE_URL") || FALLBACK_SUPABASE_URL;
	const supabaseAnonKey = getRuntimeEnvValue("NEXT_PUBLIC_SUPABASE_ANON_KEY") || FALLBACK_SUPABASE_ANON_KEY;

	return createClient(supabaseUrl, supabaseAnonKey, {
		auth: { persistSession: false, autoRefreshToken: false },
	});
}

export async function getPopularityByPartNums(partNums: string[]) {
	const unique = [...new Set(partNums.map((partNum) => partNum.trim().toUpperCase()).filter(Boolean))];
	if (unique.length === 0) return new Map<string, PartPopularityRow>();

	const supabase = getServerSupabaseClient();
	const { data, error } = await supabase.from("part_popularity_cache").select("part_num,set_count,updated_at").in("part_num", unique);
	if (error) throw new Error(error.message);

	const rows = (data ?? []) as PartPopularityRow[];
	return new Map(rows.map((row) => [row.part_num, row]));
}

export async function upsertPopularities(rows: UpsertPopularityInput[]) {
	if (rows.length === 0) return;
	const supabase = getServerSupabaseClient();
	const payload = rows.map((row) => ({
		part_num: row.part_num.trim().toUpperCase(),
		set_count: Math.max(0, Number(row.set_count || 0)),
	}));

	const { error } = await supabase.from("part_popularity_cache").upsert(payload, { onConflict: "part_num" });
	if (error) throw new Error(error.message);
}

export async function countPartPopularityRows() {
	const supabase = getServerSupabaseClient();
	const { count, error } = await supabase.from("part_popularity_cache").select("part_num", { count: "exact", head: true });
	if (error) throw new Error(error.message);
	return Number(count ?? 0);
}
