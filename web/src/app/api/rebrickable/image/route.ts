import { NextResponse } from "next/server";
import { isAllowedRebrickableImageUrl } from "@/lib/rebrickable-image-proxy";

const IMAGE_CACHE_SECONDS = 60 * 60 * 24 * 30;
const IMAGE_STALE_SECONDS = 60 * 60 * 24 * 7;

export async function GET(request: Request) {
	const { searchParams } = new URL(request.url);
	const src = (searchParams.get("src") ?? "").trim();

	if (!src) {
		return NextResponse.json({ error: "Falta src." }, { status: 400 });
	}

	if (!isAllowedRebrickableImageUrl(src)) {
		return NextResponse.json({ error: "URL de imagen no permitida." }, { status: 400 });
	}

	try {
		const upstream = await fetch(src, {
			headers: { Accept: "image/*" },
		});

		if (!upstream.ok || !upstream.body) {
			return NextResponse.json({ error: "No se pudo obtener imagen." }, { status: upstream.status || 502 });
		}

		const contentType = upstream.headers.get("content-type") ?? "image/jpeg";
		const contentLength = upstream.headers.get("content-length") ?? "";

		const headers = new Headers();
		headers.set("content-type", contentType);
		if (contentLength) headers.set("content-length", contentLength);
		headers.set("cache-control", `public, max-age=${IMAGE_CACHE_SECONDS}, s-maxage=${IMAGE_CACHE_SECONDS}, stale-while-revalidate=${IMAGE_STALE_SECONDS}`);

		return new Response(upstream.body, {
			status: 200,
			headers,
		});
	} catch {
		return NextResponse.json({ error: "No se pudo obtener imagen." }, { status: 500 });
	}
}
