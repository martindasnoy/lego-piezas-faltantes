import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";

const MAINTENANCE_KEY = "system:maintenance:v1";

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

export async function GET() {
	const kv = getCatalogKv();
	if (!kv) {
		return NextResponse.json({ active: localMaintenanceState.active, message: localMaintenanceState.message, local: true });
	}

	const raw = await kv.get(MAINTENANCE_KEY);
	if (!raw) {
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
		localMaintenanceState = payload;
		return NextResponse.json({ active: payload.active, message: payload.message, local: true });
	}

	try {
		await kv.put(MAINTENANCE_KEY, JSON.stringify(payload));
		return NextResponse.json({ active: payload.active, message: payload.message });
	} catch {
		localMaintenanceState = payload;
		return NextResponse.json({
			active: payload.active,
			message: payload.message,
			local: true,
			warning: "No se pudo guardar en KV. Se aplico modo local temporal.",
		});
	}
}
