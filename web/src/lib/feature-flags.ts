import type { SupabaseClient } from "@supabase/supabase-js";

export const MASTER_EMAIL = "martindasnoy@gmail.com";

export type ModuleKey = "poolWanted" | "poolSale" | "minifiguras";

export type ModuleFlags = Record<ModuleKey, boolean>;

const DEFAULT_MODULE_FLAGS: ModuleFlags = {
	poolWanted: true,
	poolSale: true,
	minifiguras: true,
};

const MODULE_DB_KEYS: Record<ModuleKey, string> = {
	poolWanted: "pool_wanted",
	poolSale: "pool_sale",
	minifiguras: "minifiguras",
};

type FeatureFlagRow = {
	module_key: string;
	enabled: boolean;
};

export function isMasterEmail(email: string | null | undefined) {
	return String(email ?? "").trim().toLowerCase() === MASTER_EMAIL;
}

export async function loadModuleFlags(supabase: SupabaseClient): Promise<ModuleFlags> {
	const { data, error } = await supabase
		.from("app_feature_flags")
		.select("module_key,enabled")
		.in("module_key", Object.values(MODULE_DB_KEYS));

	if (error) return DEFAULT_MODULE_FLAGS;

	const byKey = new Map<string, FeatureFlagRow>();
	for (const row of (data as FeatureFlagRow[] | null) ?? []) {
		if (!row?.module_key) continue;
		byKey.set(String(row.module_key), row);
	}

	return {
		poolWanted: Boolean(byKey.get(MODULE_DB_KEYS.poolWanted)?.enabled ?? true),
		poolSale: Boolean(byKey.get(MODULE_DB_KEYS.poolSale)?.enabled ?? true),
		minifiguras: Boolean(byKey.get(MODULE_DB_KEYS.minifiguras)?.enabled ?? true),
	};
}

export async function canAccessModule(supabase: SupabaseClient, userEmail: string | null | undefined, moduleKey: ModuleKey) {
	if (isMasterEmail(userEmail)) return true;
	const flags = await loadModuleFlags(supabase);
	return Boolean(flags[moduleKey]);
}
