import { NextResponse } from "next/server";
import { getRuntimeEnvValue } from "@/lib/runtime-env";
import { getCachedMinifigureThemes } from "@/lib/rebrickable-minifig-cache";

function normalizeApiKey(value: string) {
	const trimmed = value.trim();
	return trimmed.match(/[A-Za-z0-9_-]{20,}/)?.[0] ?? "";
}

function getApiKeyCandidates() {
	const candidates = [normalizeApiKey(getRuntimeEnvValue("REBRICKABLE_API_KEY")), normalizeApiKey(process.env.REBRICKABLE_API_KEY ?? "")].filter(
		(value) => value.length > 0,
	);
	return [...new Set(candidates)];
}

export async function GET() {
	const apiKeys = getApiKeyCandidates();
	const apiKey = apiKeys[0] ?? "";
	if (!apiKey) {
		return NextResponse.json({ error: "Configura REBRICKABLE_API_KEY." }, { status: 500 });
	}

	try {
		let lastError: Error | null = null;
		for (const candidateKey of apiKeys) {
			try {
				const results = await getCachedMinifigureThemes(candidateKey);
				return NextResponse.json({ results });
			} catch (error) {
				lastError = error instanceof Error ? error : new Error("unknown");
				if (!/403/.test(lastError.message)) break;
			}
		}

		const detail = lastError?.message ? ` (${lastError.message})` : "";
		return NextResponse.json({ error: `No se pudo conectar con Rebrickable${detail}.` }, { status: 500 });
	} catch (error) {
		const detail = error instanceof Error && error.message ? ` (${error.message})` : "";
		return NextResponse.json({ error: `No se pudo conectar con Rebrickable${detail}.` }, { status: 500 });
	}
}
