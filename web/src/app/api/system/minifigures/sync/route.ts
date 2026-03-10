import { NextResponse } from "next/server";
import { getRuntimeEnvValue } from "@/lib/runtime-env";
import { getCatalogKvBinding } from "@/lib/rebrickable-catalog-cache";
import {
	getCachedMinifigureThemes,
	getCachedMinifigureThemesFromKv,
	getCachedMinifiguresByTheme,
	setCachedMinifigureThemesToKv,
	setCachedMinifiguresByThemeToKv,
} from "@/lib/rebrickable-minifig-cache";

const DEFAULT_BATCH_SIZE = 4;

export async function POST(request: Request) {
	let body: { offset?: number; batch_size?: number; sync_themes?: boolean } = {};
	try {
		body = (await request.json()) as { offset?: number; batch_size?: number; sync_themes?: boolean };
	} catch {
		body = {};
	}

	const offset = Math.max(0, Number(body.offset ?? 0) || 0);
	const batchSize = Math.max(1, Math.min(12, Number(body.batch_size ?? DEFAULT_BATCH_SIZE) || DEFAULT_BATCH_SIZE));
	const syncThemes = Boolean(body.sync_themes);

	const kv = getCatalogKvBinding();
	if (!kv) {
		return NextResponse.json({ error: "CATALOG_CACHE binding missing." }, { status: 500 });
	}

	const apiKey = getRuntimeEnvValue("REBRICKABLE_API_KEY");
	if (!apiKey) {
		return NextResponse.json({ error: "Configura REBRICKABLE_API_KEY." }, { status: 500 });
	}

	try {
		if (syncThemes) {
			const themes = await getCachedMinifigureThemes(apiKey);
			await setCachedMinifigureThemesToKv(themes, kv);
		}

		const cachedThemes = await getCachedMinifigureThemesFromKv(kv);
		const allThemes = cachedThemes?.results ?? [];
		const total = allThemes.length;

		if (total === 0) {
			return NextResponse.json({ ok: true, total: 0, processed: 0, next_offset: null, done: true });
		}

		const chunk = allThemes.slice(offset, offset + batchSize);
		const stats: Array<{ theme_id: number; ok: boolean; figures: number; error?: string }> = [];

		for (const theme of chunk) {
			try {
				const figures = await getCachedMinifiguresByTheme(theme.id, apiKey);
				await setCachedMinifiguresByThemeToKv(theme.id, figures, kv);
				stats.push({ theme_id: theme.id, ok: true, figures: figures.length });
			} catch (error) {
				stats.push({
					theme_id: theme.id,
					ok: false,
					figures: 0,
					error: error instanceof Error ? error.message : "error",
				});
			}
		}

		const nextOffset = offset + chunk.length;
		return NextResponse.json({
			ok: true,
			total,
			offset,
			processed: chunk.length,
			next_offset: nextOffset < total ? nextOffset : null,
			done: nextOffset >= total,
			stats,
		});
	} catch (error) {
		const detail = error instanceof Error ? error.message : "error";
		return NextResponse.json({ error: `No se pudo sincronizar minifiguras (${detail}).` }, { status: 500 });
	}
}
