import { createClient } from "@supabase/supabase-js";

const fallbackSupabaseUrl = "https://etqtoerfzjaewrrlyhfa.supabase.co";
const fallbackSupabaseAnonKey = "sb_publishable_6otEjYUOTkbGjcjHMFCg3g_mS3voCBM";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || fallbackSupabaseUrl;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || fallbackSupabaseAnonKey;

export const supabase =
	supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : null;

export function getSupabaseClient() {
	if (!supabase) {
		throw new Error("ERROR NUEVO: no pude inicializar Supabase en este build.");
	}

	return supabase;
}
