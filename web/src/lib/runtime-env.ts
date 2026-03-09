import { getCloudflareContext } from "@opennextjs/cloudflare";

function normalizeEnvValue(value: string) {
	let normalized = value.trim();
	normalized = normalized.replace(/[\r\n\t]/g, "");
	if (
		normalized.length >= 2 &&
		((normalized.startsWith('"') && normalized.endsWith('"')) ||
			(normalized.startsWith("'") && normalized.endsWith("'")))
	) {
		normalized = normalized.slice(1, -1).trim();
	}
	return normalized;
}

export function getRuntimeEnvValue(key: string): string {
	try {
		const context = getCloudflareContext();
		const value = (context?.env as Record<string, unknown> | undefined)?.[key];
		if (typeof value === "string") {
			const normalized = normalizeEnvValue(value);
			if (normalized.length > 0) {
				return normalized;
			}
		}
	} catch {
		// fallback below
	}

	const fromProcess = process.env[key];
	if (typeof fromProcess === "string") {
		const normalized = normalizeEnvValue(fromProcess);
		if (normalized.length > 0) {
			return normalized;
		}
	}

	return "";
}
