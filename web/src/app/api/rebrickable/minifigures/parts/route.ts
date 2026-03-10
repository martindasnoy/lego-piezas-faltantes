import { NextResponse } from "next/server";
import { listMinifigPartsBySetNum } from "@/lib/minifig-parts-db";

export async function GET(request: Request) {
	const { searchParams } = new URL(request.url);
	const setNum = (searchParams.get("set_num") ?? "").trim().toUpperCase();
	if (!setNum) {
		return NextResponse.json({ error: "Falta set_num." }, { status: 400 });
	}

	try {
		const rows = await listMinifigPartsBySetNum(setNum);
		if (rows.length === 0) {
			return NextResponse.json({ error: "Partes de minifigura no disponibles en DB. Ejecuta el backfill de minifiguras." }, { status: 503 });
		}

		const results = rows.map((row) => ({
			part_num: row.part_num,
			name: row.name,
			quantity: Number(row.quantity ?? 1),
			color_name: row.color_name,
			part_img_url: row.part_img_url,
			is_spare: Boolean(row.is_spare),
		}));

		return NextResponse.json({ results, source: "db" });
	} catch {
		return NextResponse.json({ error: "No se pudieron cargar las piezas de la minifigura." }, { status: 500 });
	}
}
