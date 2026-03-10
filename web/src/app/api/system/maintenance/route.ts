import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";

const MAINTENANCE_KEY = "system:maintenance:v1";
const MAINTENANCE_CACHE_URL = "https://internal/maintenance/state";

type MaintenancePayload = {
	active: boolean;
	message: string;
	updatedAt: string;
};

let localMaintenanceState: MaintenancePayload = {
	active: false,
	message: "",
	updatedAt: new Date(0).toISOString(),
};

function getCatalogKv() {
	try {
		const env = getCloudflareContext()?.env as Record<string, unknown> | undefined;
		const kv = env?.CATALOG_CACHE;
		if (!kv || typeof kv !== "object") return null;
		return kv as KVNamespace;
	} catch {
		return null;
	}
}

async function getCachedMaintenanceState() {
	try {
		if (typeof caches === "undefined") return null;
		const cache = await caches.open("maintenance-state");
		const cached = await cache.match(MAINTENANCE_CACHE_URL);
		if (!cached) return null;
		const parsed = (await cached.json()) as MaintenancePayload;
		return {
			active: Boolean(parsed.active),
			message: String(parsed.message ?? ""),
			updatedAt: String(parsed.updatedAt ?? new Date(0).toISOString()),
		};
	} catch {
		return null;
	}
}

async function setCachedMaintenanceState(payload: MaintenancePayload) {
	try {
		if (typeof caches === "undefined") return false;
		const cache = await caches.open("maintenance-state");
		const response = new Response(JSON.stringify(payload), {
			headers: {
				"content-type": "application/json",
				"cache-control": "public, max-age=600",
			},
		});
		await cache.put(MAINTENANCE_CACHE_URL, response);
		return true;
	} catch {
		return false;
	}
}

export async function GET() {
	const kv = getCatalogKv();
	if (!kv) {
		const cached = await getCachedMaintenanceState();
		if (cached) {
			return NextResponse.json({ active: cached.active, message: cached.message, cache: true });
		}
		return NextResponse.json({ active: localMaintenanceState.active, message: localMaintenanceState.message, local: true });
	}

	const raw = await kv.get(MAINTENANCE_KEY);
	if (!raw) {
		const cached = await getCachedMaintenanceState();
		if (cached) {
			return NextResponse.json({ active: cached.active, message: cached.message, cache: true });
		}
		return NextResponse.json({ active: false, message: "" });
	}

	try {
		const parsed = JSON.parse(raw) as MaintenancePayload;
		return NextResponse.json({ active: Boolean(parsed.active), message: String(parsed.message ?? "") });
	} catch {
		return NextResponse.json({ active: false, message: "" });
	}
}

export async function POST(request: Request) {
	const kv = getCatalogKv();

	let body: Partial<MaintenancePayload>;
	try {
		body = (await request.json()) as Partial<MaintenancePayload>;
	} catch {
		return NextResponse.json({ error: "Body invalido." }, { status: 400 });
	}

	const payload: MaintenancePayload = {
		active: Boolean(body.active),
		message: String(body.message ?? "").trim(),
		updatedAt: new Date().toISOString(),
	};

	if (!kv) {
		await setCachedMaintenanceState(payload);
		localMaintenanceState = payload;
		return NextResponse.json({ active: payload.active, message: payload.message, local: true, cache: true });
	}

	try {
		await kv.put(MAINTENANCE_KEY, JSON.stringify(payload));
		await setCachedMaintenanceState(payload);
		return NextResponse.json({ active: payload.active, message: payload.message });
	} catch {
		const cacheOk = await setCachedMaintenanceState(payload);
		localMaintenanceState = payload;
		return NextResponse.json({
			active: payload.active,
			message: payload.message,
			local: true,
			cache: cacheOk,
			warning: cacheOk
				? "No se pudo guardar en KV. Se aplico mantenimiento con cache de borde."
				: "No se pudo guardar en KV. Se aplico modo local temporal.",
		});
	}
}
