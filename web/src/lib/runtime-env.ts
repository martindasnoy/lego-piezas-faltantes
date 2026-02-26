import { getCloudflareContext } from "@opennextjs/cloudflare";

export function getRuntimeEnvValue(key: string): string {
	const fromProcess = process.env[key];
	if (typeof fromProcess === "string" && fromProcess.trim().length > 0) {
		return fromProcess;
	}

	try {
		const context = getCloudflareContext();
		const value = (context?.env as Record<string, unknown> | undefined)?.[key];
		return typeof value === "string" ? value : "";
	} catch {
		return "";
	}
}
