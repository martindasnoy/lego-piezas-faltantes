import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://etqtoerfzjaewrrlyhfa.supabase.co";
const supabaseAnonKey = "sb_publishable_6otEjYUOTkbGjcjHMFCg3g_mS3voCBM";

export const supabase =
	supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : null;

export function getSupabaseClient() {
	if (!supabase) {
		throw new Error("ERROR NUEVO: no pude inicializar Supabase en este build.");
	}

	return supabase;
}
