"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabase";
import { getRandomLoadingMessage } from "@/lib/loading-messages";
import { gobrickColors } from "@/lib/gobrick-colors";
import { enforceSessionTtl } from "@/lib/session-ttl";
import { canAccessModule } from "@/lib/feature-flags";

type PoolLot = {
	id: string;
	list_id: string;
	list_name?: string | null;
	owner_id: string;
	part_num: string;
	part_name: string | null;
	color_name: string | null;
	quantity: number;
	value: number | null;
	owner_name?: string | null;
};

type RpcPoolLot = PoolLot & {
	list_name: string | null;
	owner_name: string | null;
};

type PartImageLookup = Record<string, string | null>;
type PartImageRequestItem = { part_num: string; color_name?: string | null };

const SALE_LIST_PREFIX = "venta:";

function isSaleListName(listName: string | null | undefined) {
	return String(listName ?? "").trim().toLowerCase().startsWith(SALE_LIST_PREFIX);
}

export default function PoolVentaPage() {
	const router = useRouter();
	const [loadingMessage, setLoadingMessage] = useState("Cargando...");
	const [loading, setLoading] = useState(true);
	const [message, setMessage] = useState<string | null>(null);
	const [publicLots, setPublicLots] = useState<PoolLot[]>([]);
	const [currentUserId, setCurrentUserId] = useState<string | null>(null);
	const [partImages, setPartImages] = useState<PartImageLookup>({});
	const [sortBy, setSortBy] = useState<"pieza" | "usuario" | "valor_asc" | "valor_desc">("pieza");
	const [showOwnLots, setShowOwnLots] = useState(false);
	const [lotsPage, setLotsPage] = useState(1);
	const imageRequestInFlightRef = useRef<Set<string>>(new Set());

	useEffect(() => {
		setLoadingMessage(getRandomLoadingMessage());

		async function loadPool() {
			try {
				const isSessionValid = await enforceSessionTtl();
				if (!isSessionValid) {
					router.replace("/");
					return;
				}

				const supabase = getSupabaseClient();
				const {
					data: { user },
				} = await supabase.auth.getUser();

				if (!user) {
					router.replace("/");
					return;
				}

				setCurrentUserId(user.id);

				const canAccessPoolSale = await canAccessModule(supabase, user.email, "poolSale");
				if (!canAccessPoolSale) {
					router.replace("/dashboard");
					return;
				}

				const { data: rpcData, error: rpcError } = await supabase.rpc("get_public_pool_lots");
				if (rpcError) {
					setMessage(`Pool no configurado: ${rpcError.message}. Ejecuta scripts segun web/supabase/README.md`);
					setPublicLots([]);
					return;
				}

				const lots = ((rpcData as RpcPoolLot[]) ?? [])
					.map((lot) => ({
						id: lot.id,
						list_id: lot.list_id,
						list_name: lot.list_name,
						owner_id: lot.owner_id,
						part_num: lot.part_num,
						part_name: lot.part_name,
						color_name: lot.color_name,
						quantity: Number(lot.quantity ?? 0),
						value: typeof lot.value === "number" ? lot.value : null,
						owner_name: lot.owner_name,
					}))
					.filter((lot) => isSaleListName(lot.list_name));

				setPublicLots(lots);
			} catch (error) {
				const text = error instanceof Error ? error.message : "No se pudo abrir el pool de venta.";
				setMessage(text);
			} finally {
				setLoading(false);
			}
		}

		void loadPool();
		const intervalId = window.setInterval(() => {
			void loadPool();
		}, 10000);

		return () => window.clearInterval(intervalId);
	}, [router]);

	function getPartImageKey(partNum: string, colorName: string | null | undefined) {
		const normalizedColor = (colorName ?? "")
			.replace(/\(chino\)/gi, "")
			.toLowerCase()
			.replace(/\s+/g, " ")
			.trim();
		return `${partNum.trim()}::${normalizedColor}`;
	}

	async function loadPartImages(items: PartImageRequestItem[]) {
		const normalizedItems = items
			.map((item) => ({
				part_num: item.part_num.trim(),
				color_name: item.color_name ?? null,
			}))
			.filter((item) => item.part_num.length > 0);

		if (normalizedItems.length === 0) return;

		const uniqueByKey = new Map<string, PartImageRequestItem>();
		for (const item of normalizedItems) {
			const key = getPartImageKey(item.part_num, item.color_name);
			if (!uniqueByKey.has(key)) uniqueByKey.set(key, item);
		}

		const missingItems = [...uniqueByKey.entries()]
			.filter(([key]) => !(key in partImages) && !imageRequestInFlightRef.current.has(key))
			.map(([, item]) => item);

		if (missingItems.length === 0) return;

		try {
			const requestedKeys = missingItems.map((item) => getPartImageKey(item.part_num, item.color_name));
			for (const key of requestedKeys) imageRequestInFlightRef.current.add(key);

			const response = await fetch("/api/rebrickable/part-images", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ items: missingItems }),
			});

			if (!response.ok) {
				setPartImages((current) => {
					const next = { ...current };
					for (const key of requestedKeys) next[key] = null;
					return next;
				});
				return;
			}

			const payload = (await response.json()) as { results?: Array<{ key: string; part_img_url: string | null }> };
			const additions: PartImageLookup = {};
			for (const row of payload.results ?? []) {
				if (!row.key) continue;
				additions[row.key] = row.part_img_url;
			}
			for (const key of requestedKeys) {
				if (!(key in additions)) additions[key] = null;
			}
			setPartImages((current) => ({ ...current, ...additions }));
		} finally {
			for (const item of missingItems) {
				imageRequestInFlightRef.current.delete(getPartImageKey(item.part_num, item.color_name));
			}
		}
	}

	const lotCards = useMemo<PoolLot[]>(() => {
		return [...publicLots]
			.filter((lot) => {
				if (!showOwnLots && currentUserId && lot.owner_id === currentUserId) return false;
				return true;
			})
			.sort((a, b) => {
			if (sortBy === "valor_asc") {
				const aValue = a.value ?? Number.POSITIVE_INFINITY;
				const bValue = b.value ?? Number.POSITIVE_INFINITY;
				if (aValue !== bValue) return aValue - bValue;
				return (a.part_name || a.part_num).localeCompare(b.part_name || b.part_num, "es", { sensitivity: "base" });
			}

			if (sortBy === "valor_desc") {
				const aValue = a.value ?? Number.NEGATIVE_INFINITY;
				const bValue = b.value ?? Number.NEGATIVE_INFINITY;
				if (aValue !== bValue) return bValue - aValue;
				return (a.part_name || a.part_num).localeCompare(b.part_name || b.part_num, "es", { sensitivity: "base" });
			}

			if (sortBy === "usuario") {
				const byOwner = (a.owner_name || "").localeCompare(b.owner_name || "", "es", { sensitivity: "base" });
				if (byOwner !== 0) return byOwner;
			}
			return (a.part_name || a.part_num).localeCompare(b.part_name || b.part_num, "es", { sensitivity: "base" });
		});
	}, [publicLots, sortBy, showOwnLots, currentUserId]);

	const LOTS_PER_PAGE = 40;
	const totalLotsPages = Math.max(1, Math.ceil(lotCards.length / LOTS_PER_PAGE));
	const paginatedLotCards = useMemo(() => {
		const start = (lotsPage - 1) * LOTS_PER_PAGE;
		return lotCards.slice(start, start + LOTS_PER_PAGE);
	}, [lotCards, lotsPage]);

	useEffect(() => {
		if (lotsPage > totalLotsPages) {
			setLotsPage(totalLotsPages);
		}
	}, [lotsPage, totalLotsPages]);

	useEffect(() => {
		setLotsPage(1);
	}, [sortBy, showOwnLots]);

	useEffect(() => {
		void loadPartImages(paginatedLotCards.map((lot) => ({ part_num: lot.part_num, color_name: lot.color_name })));
	}, [paginatedLotCards]);

	useEffect(() => {
		const visibleKeys = new Set(paginatedLotCards.map((lot) => getPartImageKey(lot.part_num, lot.color_name)));
		const deferredItems = lotCards
			.filter((lot) => !visibleKeys.has(getPartImageKey(lot.part_num, lot.color_name)))
			.map((lot) => ({ part_num: lot.part_num, color_name: lot.color_name }));

		if (deferredItems.length === 0) return;

		const timeoutId = window.setTimeout(() => {
			void loadPartImages(deferredItems);
		}, 250);

		return () => window.clearTimeout(timeoutId);
	}, [lotCards, paginatedLotCards]);

	useEffect(() => {
		setLotsPage(1);
	}, [sortBy]);

	function getColorHexFromName(colorName: string | null) {
		if (!colorName) return "#d1d5db";
		const normalized = colorName.replace("(Chino)", "").trim().toLowerCase();
		const match = gobrickColors.find((color) => color.name.toLowerCase() === normalized || (color.blName ?? "").trim().toLowerCase() === normalized);
		return match?.hex ?? "#d1d5db";
	}

	function getTextColorForBackground(hex: string) {
		const normalized = hex.replace("#", "").trim();
		if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return "#111827";
		const r = Number.parseInt(normalized.slice(0, 2), 16);
		const g = Number.parseInt(normalized.slice(2, 4), 16);
		const b = Number.parseInt(normalized.slice(4, 6), 16);
		const brightness = (r * 299 + g * 587 + b * 114) / 1000;
		return brightness > 150 ? "#111827" : "#ffffff";
	}

	if (loading) {
		return (
			<div className="bg-lego-tile font-chewy flex min-h-screen items-center justify-center px-6 text-center text-2xl text-white sm:text-3xl">
				{loadingMessage}
			</div>
		);
	}

	return (
		<div className="bg-lego-tile min-h-screen px-4 py-6 sm:px-6 sm:py-8">
			<main className="mx-auto flex w-full max-w-5xl flex-col gap-6 rounded-2xl bg-white p-4 shadow-xl sm:p-8">
				<header className="border-b border-slate-200 pb-5">
					<div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
						<Link href="/dashboard" className="order-1 self-end text-sm text-slate-600 hover:underline sm:order-2 sm:self-auto">
							← Volver
						</Link>
						<div>
							<h1 className="text-3xl font-semibold text-slate-900">Pool de items a la venta</h1>
							<div className="mt-2 flex items-center gap-2">
								<label htmlFor="pool-venta-sort" className="text-sm text-slate-700">
									Ordenar por
								</label>
								<select
									id="pool-venta-sort"
									value={sortBy}
									onChange={(event) => setSortBy(event.target.value as "pieza" | "usuario" | "valor_asc" | "valor_desc")}
									className="rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-900"
								>
									<option value="pieza">Pieza</option>
									<option value="usuario">Usuario</option>
									<option value="valor_asc">De menor a mayor valor</option>
									<option value="valor_desc">De mayor a menor valor</option>
								</select>
								<label className="ml-1 inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700">
									<input type="checkbox" checked={showOwnLots} onChange={(event) => setShowOwnLots(event.target.checked)} />
									<span>Mostrar items propios</span>
								</label>
							</div>
						</div>
						<Image src="/pool-logo.svg" alt="Pool" width={120} height={34} className="hidden shrink-0 self-start sm:block sm:self-auto" />
					</div>
				</header>

				{lotCards.length === 0 ? (
					<section className="rounded-xl border border-slate-200 p-5 text-sm text-slate-600">No hay items publicos a la venta por ahora.</section>
				) : (
					<section className="space-y-2">
						<div className="mb-2 flex items-center justify-center gap-2 text-xs text-slate-600">
							<button
								type="button"
								onClick={() => setLotsPage((current) => Math.max(1, current - 1))}
								disabled={lotsPage <= 1}
								className="rounded-md border border-slate-300 px-2 py-1 disabled:opacity-40"
							>
								Anterior
							</button>
							<span>
								Pagina {lotsPage} de {totalLotsPages}
							</span>
							<button
								type="button"
								onClick={() => setLotsPage((current) => Math.min(totalLotsPages, current + 1))}
								disabled={lotsPage >= totalLotsPages}
								className="rounded-md border border-slate-300 px-2 py-1 disabled:opacity-40"
							>
								Siguiente
							</button>
						</div>
						{paginatedLotCards.map((lot) => (
							<article key={lot.id} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
								<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
									<div className="flex items-start gap-3 sm:min-w-0 sm:flex-1">
										{partImages[getPartImageKey(lot.part_num, lot.color_name)] ? (
											<img
												src={partImages[getPartImageKey(lot.part_num, lot.color_name)] ?? undefined}
												alt={lot.part_name || lot.part_num}
												loading="lazy"
												decoding="async"
												className="h-16 w-16 rounded border border-slate-200 bg-white object-contain"
											/>
										) : (
											<div className="flex h-16 w-16 flex-col items-center justify-center rounded border border-slate-200 bg-slate-100 text-[9px] text-slate-500">
												<span className="leading-none">IMG</span>
											<span className="leading-none">Imagen sin cache</span>
											</div>
										)}

										<div className="min-w-0 flex-1">
											<p className="text-sm font-medium text-slate-900">{lot.part_name || "Sin nombre"}</p>
											<div className="mt-1 flex flex-wrap items-start justify-between gap-3 text-sm text-slate-700">
												<div className="flex flex-wrap items-center gap-3">
												<span
													className="inline-flex w-20 items-center rounded-md border border-slate-300 px-2 py-1 text-[11px] font-semibold"
													style={{
														backgroundColor: getColorHexFromName(lot.color_name),
														color: getTextColorForBackground(getColorHexFromName(lot.color_name)),
													}}
												>
													<span className="block w-full truncate text-left">{lot.color_name || "Sin color"}</span>
												</span>
												<p>x{lot.quantity}</p>
												</div>
												<div className="ml-auto flex flex-col items-end gap-1 text-right">
													<p className="font-chewy text-base text-slate-600">{lot.owner_name || "Desconocido"}</p>
												{lot.value != null ? (
													<p className="rounded-md border border-[#005f9a] bg-[#006eb2] px-2 py-0.5 text-xs font-bold text-white">${lot.value}</p>
												) : null}
												</div>
											</div>
										</div>
									</div>
								</div>
							</article>
						))}
						<div className="mt-2 flex items-center justify-center gap-2 text-xs text-slate-600">
							<button
								type="button"
								onClick={() => setLotsPage((current) => Math.max(1, current - 1))}
								disabled={lotsPage <= 1}
								className="rounded-md border border-slate-300 px-2 py-1 disabled:opacity-40"
							>
								Anterior
							</button>
							<span>
								Pagina {lotsPage} de {totalLotsPages}
							</span>
							<button
								type="button"
								onClick={() => setLotsPage((current) => Math.min(totalLotsPages, current + 1))}
								disabled={lotsPage >= totalLotsPages}
								className="rounded-md border border-slate-300 px-2 py-1 disabled:opacity-40"
							>
								Siguiente
							</button>
						</div>
					</section>
				)}

				{message ? <p className="text-sm text-slate-700">{message}</p> : null}
			</main>
		</div>
	);
}
