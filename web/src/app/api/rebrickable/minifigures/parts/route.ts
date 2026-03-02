import { NextResponse } from "next/server";
import { getRuntimeEnvValue } from "@/lib/runtime-env";

const REBRICKABLE_SET_PARTS_API = "https://rebrickable.com/api/v3/lego/sets/";

type RebrickableSetPart = {
	quantity: number;
	part?: {
		part_num: string;
		name: string;
		part_img_url?: string | null;
	} | null;
	color?: {
		name: string;
	} | null;
	is_spare?: boolean;
};

function normalizeSetNum(value: string) {
	return value.trim().toUpperCase();
}

export async function GET(request: Request) {
	const { searchParams } = new URL(request.url);
	const setNum = normalizeSetNum(searchParams.get("set_num") ?? "");
	const apiKey = getRuntimeEnvValue("REBRICKABLE_API_KEY");

	if (!apiKey) {
		return NextResponse.json({ error: "Configura REBRICKABLE_API_KEY." }, { status: 500 });
	}

	if (!setNum) {
		return NextResponse.json({ error: "Falta set_num." }, { status: 400 });
	}

	const url = new URL(`${REBRICKABLE_SET_PARTS_API}${encodeURIComponent(setNum)}/parts/`);
	url.searchParams.set("page_size", "1000");
	url.searchParams.set("inc_minifig_parts", "1");
	url.searchParams.set("inc_spares", "1");
	url.searchParams.set("key", apiKey);

	try {
		const response = await fetch(url.toString(), {
			headers: { Accept: "application/json" },
			next: { revalidate: 86400 },
		});

		if (!response.ok) {
			const detail = response.status === 429 ? "Limite de Rebrickable alcanzado." : "No se pudo obtener piezas.";
			return NextResponse.json({ error: detail }, { status: response.status });
		}

		const payload = (await response.json()) as { results?: RebrickableSetPart[] };
		const results = (payload.results ?? [])
			.filter((item) => item.part?.part_num && item.part?.name)
			.map((item) => ({
				part_num: item.part?.part_num ?? "",
				name: item.part?.name ?? "",
				quantity: item.quantity,
				color_name: item.color?.name ?? null,
				part_img_url: item.part?.part_img_url ?? null,
				is_spare: Boolean(item.is_spare),
			}));

		return NextResponse.json({ results });
	} catch {
		return NextResponse.json({ error: "No se pudo conectar con Rebrickable." }, { status: 500 });
	}
}
