import { getCloudflareContext } from "@opennextjs/cloudflare";

export function getRuntimeEnvValue(key: string): string {
	const fromProcess = process.env[key];
	if (typeof fromProcess === "string") {
		const normalized = fromProcess.trim();
		if (normalized.length > 0) {
			return normalized;
		}
	}

	try {
		const context = getCloudflareContext();
		const value = (context?.env as Record<string, unknown> | undefined)?.[key];
		if (typeof value !== "string") return "";
		return value.trim();
	} catch {
		return "";
	}
}
