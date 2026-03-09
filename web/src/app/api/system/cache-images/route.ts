import { NextResponse } from "next/server";
import { listCachedImages } from "@/lib/image-cache-db";

export async function GET(request: Request) {
	const { searchParams } = new URL(request.url);
	const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);
	const pageSize = Math.max(1, Math.min(120, Number(searchParams.get("page_size") ?? "60") || 60));

	try {
		const { rows, total } = await listCachedImages(page, pageSize);
		const totalPages = Math.max(1, Math.ceil(total / pageSize));
		const normalizedPage = Math.max(1, Math.min(totalPages, page));

		return NextResponse.json({
			results: rows,
			page: normalizedPage,
			total_pages: totalPages,
			total,
		});
	} catch (error) {
		const detail = error instanceof Error && error.message ? ` (${error.message})` : "";
		return NextResponse.json({ error: `No se pudo leer cache de imagenes desde DB${detail}.` }, { status: 500 });
	}
}
