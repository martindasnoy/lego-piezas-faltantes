import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { isAllowedRebrickableImageUrl } from "@/lib/rebrickable-image-proxy";

const IMAGE_CACHE_SECONDS = 60 * 60 * 24 * 30;
const IMAGE_STALE_SECONDS = 60 * 60 * 24 * 7;
const R2_BINDING_CANDIDATES = ["PART_IMAGES_CACHE", "R2_PART_IMAGES", "PART_IMAGES_R2"] as const;

type R2ObjectLike = {
	body: ReadableStream<Uint8Array> | null;
	httpMetadata?: {
		contentType?: string;
		cacheControl?: string;
	};
	customMetadata?: Record<string, string>;
};

type R2BucketLike = {
	get(key: string): Promise<R2ObjectLike | null>;
	put(
		key: string,
		value: ArrayBuffer,
		options?: {
			httpMetadata?: {
				contentType?: string;
				cacheControl?: string;
			};
			customMetadata?: Record<string, string>;
		},
	): Promise<void>;
};

function getImageCacheBucket(): R2BucketLike | null {
	try {
		const context = getCloudflareContext();
		const env = (context?.env ?? {}) as Record<string, unknown>;

		for (const name of R2_BINDING_CANDIDATES) {
			const candidate = env[name] as R2BucketLike | undefined;
			if (candidate && typeof candidate.get === "function" && typeof candidate.put === "function") {
				return candidate;
			}
		}

		return null;
	} catch {
		return null;
	}
}

function getImageCacheKey(src: string): string {
	const parsed = new URL(src);
	const normalized = `${parsed.hostname.toLowerCase()}${parsed.pathname}${parsed.search}`;
	return `rebrickable/${encodeURIComponent(normalized)}`;
}

export async function GET(request: Request) {
	const { searchParams } = new URL(request.url);
	const src = (searchParams.get("src") ?? "").trim();

	if (!src) {
		return NextResponse.json({ error: "Falta src." }, { status: 400 });
	}

	if (!isAllowedRebrickableImageUrl(src)) {
		return NextResponse.json({ error: "URL de imagen no permitida." }, { status: 400 });
	}

	const bucket = getImageCacheBucket();
	const cacheKey = getImageCacheKey(src);

	if (bucket) {
		try {
			const cached = await bucket.get(cacheKey);
			if (cached?.body) {
				const headers = new Headers();
				headers.set("content-type", cached.httpMetadata?.contentType ?? "image/jpeg");
				headers.set(
					"cache-control",
					cached.httpMetadata?.cacheControl ??
						`public, max-age=${IMAGE_CACHE_SECONDS}, s-maxage=${IMAGE_CACHE_SECONDS}, stale-while-revalidate=${IMAGE_STALE_SECONDS}`,
				);
				headers.set("x-image-cache", "r2-hit");
				return new Response(cached.body, { status: 200, headers });
			}
		} catch {
			// Continue with upstream fetch if R2 read fails.
		}
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

		const cacheControl = `public, max-age=${IMAGE_CACHE_SECONDS}, s-maxage=${IMAGE_CACHE_SECONDS}, stale-while-revalidate=${IMAGE_STALE_SECONDS}`;

		if (!bucket) {
			const headers = new Headers();
			headers.set("content-type", contentType);
			if (contentLength) headers.set("content-length", contentLength);
			headers.set("cache-control", cacheControl);
			headers.set("x-image-cache", "edge-only");
			return new Response(upstream.body, {
				status: 200,
				headers,
			});
		}

		const bytes = await upstream.arrayBuffer();

		try {
			await bucket.put(cacheKey, bytes, {
				httpMetadata: {
					contentType,
					cacheControl,
				},
				customMetadata: {
					source: src,
				},
			});
		} catch {
			// If store fails, still return the fetched image.
		}

		const headers = new Headers();
		headers.set("content-type", contentType);
		headers.set("cache-control", cacheControl);
		headers.set("x-image-cache", "r2-miss");
		return new Response(bytes, {
			status: 200,
			headers,
		});
	} catch {
		return NextResponse.json({ error: "No se pudo obtener imagen." }, { status: 500 });
	}
}
