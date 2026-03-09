import { createClient } from "@supabase/supabase-js";
import { getRuntimeEnvValue } from "@/lib/runtime-env";

const FALLBACK_SUPABASE_URL = "https://etqtoerfzjaewrrlyhfa.supabase.co";

export function getSupabaseAdminClient() {
	const url = getRuntimeEnvValue("NEXT_PUBLIC_SUPABASE_URL") || FALLBACK_SUPABASE_URL;
	const serviceRoleKey = getRuntimeEnvValue("SUPABASE_SERVICE_ROLE_KEY");

	if (!serviceRoleKey) {
		throw new Error("Configura SUPABASE_SERVICE_ROLE_KEY para backfill global.");
	}

	return createClient(url, serviceRoleKey, {
		auth: { persistSession: false, autoRefreshToken: false },
	});
}
