import { NextResponse } from "next/server";
import { getRuntimeEnvValue } from "@/lib/runtime-env";

const REBRICKABLE_SETS_API = "https://rebrickable.com/api/v3/lego/sets/";

type RebrickableSet = {
	set_num: string;
	name: string;
	set_img_url?: string | null;
};

type MinifigureEntry = {
	name: string;
	imageUrl: string | null;
	setNum: string;
};

function pickMinifigureName(setName: string) {
	const dashIndex = setName.indexOf(" - ");
	if (dashIndex >= 0) {
		return setName.slice(dashIndex + 3).trim();
	}
	return setName.trim();
}

function shouldExcludeEntry(name: string) {
	const normalized = name.trim().toLowerCase();
	if (/\b(pack|complete|box|bag)\b/.test(normalized)) return true;
	if (/^[0-9]{5,}[a-z0-9]*-[0-9]+$/i.test(normalized)) return true;
	return false;
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
	const apiKey = getRuntimeEnvValue("REBRICKABLE_API_KEY");
	if (!apiKey) {
		return NextResponse.json({ error: "Configura REBRICKABLE_API_KEY." }, { status: 500 });
	}

	const { id } = await params;
	const themeId = Number(id);
	if (!Number.isFinite(themeId) || themeId <= 0) {
		return NextResponse.json({ error: "Theme invalido." }, { status: 400 });
	}

	const url = new URL(REBRICKABLE_SETS_API);
	url.searchParams.set("theme_id", String(themeId));
	url.searchParams.set("page_size", "500");
	url.searchParams.set("key", apiKey);

	try {
		const response = await fetch(url.toString(), {
			headers: { Accept: "application/json" },
			next: { revalidate: 86400 },
		});

		if (!response.ok) {
			const detail = response.status === 429 ? "Limite de Rebrickable alcanzado." : "No se pudo obtener minifiguras.";
			return NextResponse.json({ error: detail }, { status: response.status });
		}

		const payload = (await response.json()) as { results?: RebrickableSet[] };
		const byName = new Map<string, MinifigureEntry>();

		for (const set of payload.results ?? []) {
			const name = pickMinifigureName(set.name);
			if (!name || shouldExcludeEntry(name)) continue;

			const existing = byName.get(name);
			const nextImage = set.set_img_url ?? null;

			if (!existing) {
				byName.set(name, { name, imageUrl: nextImage, setNum: set.set_num });
				continue;
			}

			if ((!existing.imageUrl && nextImage) || !existing.setNum) {
				byName.set(name, { ...existing, imageUrl: existing.imageUrl ?? nextImage, setNum: existing.setNum || set.set_num });
			}
		}

		const results = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" }));

		return NextResponse.json({ results });
	} catch {
		return NextResponse.json({ error: "No se pudo conectar con Rebrickable." }, { status: 500 });
	}
}
