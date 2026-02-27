"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabase";
import { getRandomLoadingMessage } from "@/lib/loading-messages";
import { gobrickColors } from "@/lib/gobrick-colors";

type PoolLot = {
	id: string;
	list_id: string;
	owner_id: string;
	part_num: string;
	part_name: string | null;
	color_name: string | null;
	quantity: number;
	total_offered: number;
	remaining_quantity: number;
	offers_count: number;
	my_pending_quantity: number;
	owner_name?: string | null;
};

type RpcPoolLot = PoolLot & {
	list_name: string | null;
	owner_name: string | null;
};

type PartImageLookup = Record<string, string | null>;
type PartImageRequestItem = { part_num: string; color_name?: string | null };
type ToggleOfferRpcRow = {
	action: "created" | "updated" | "deleted";
	applied_quantity: number;
	total_offered: number;
	remaining_quantity: number;
	offers_count: number;
	my_pending_quantity: number;
};

export default function PoolPage() {
	const router = useRouter();
	const [loadingMessage, setLoadingMessage] = useState("Cargando...");
	const [loading, setLoading] = useState(true);
	const [message, setMessage] = useState<string | null>(null);
	const [publicLots, setPublicLots] = useState<PoolLot[]>([]);
	const [partImages, setPartImages] = useState<PartImageLookup>({});
	const [currentUserId, setCurrentUserId] = useState<string | null>(null);
	const [currentUserName, setCurrentUserName] = useState<string>("Usuario");
	const [offerQtyByLot, setOfferQtyByLot] = useState<Record<string, number>>({});
	const [sendingOfferLotId, setSendingOfferLotId] = useState<string | null>(null);
	const [sortBy, setSortBy] = useState<"pieza" | "usuario">("pieza");
	const imageRequestInFlightRef = useRef<Set<string>>(new Set());

	useEffect(() => {
		setLoadingMessage(getRandomLoadingMessage());

		async function loadPool() {
			try {
				const supabase = getSupabaseClient();
				const {
					data: { user },
				} = await supabase.auth.getUser();

				if (!user) {
					router.replace("/");
					return;
				}

			setCurrentUserId(user.id);
			setCurrentUserName(
				(user.user_metadata?.display_name as string) ||
					(user.user_metadata?.full_name as string) ||
					(user.email?.split("@")[0] ?? "Usuario"),
			);


				const { data: rpcData, error: rpcError } = await supabase.rpc("get_public_pool_lots");
				if (rpcError) {
					setMessage(`Pool no configurado: ${rpcError.message}. Ejecuta scripts segun web/supabase/README.md`);
					setPublicLots([]);
					return;
				}

				const lots = ((rpcData as RpcPoolLot[]) ?? []).map((lot) => ({
					id: lot.id,
					list_id: lot.list_id,
					owner_id: lot.owner_id,
					part_num: lot.part_num,
					part_name: lot.part_name,
					color_name: lot.color_name,
					quantity: Number(lot.quantity ?? 0),
					total_offered: Number(lot.total_offered ?? 0),
					remaining_quantity: Number(lot.remaining_quantity ?? 0),
					offers_count: Number(lot.offers_count ?? 0),
					my_pending_quantity: Number(lot.my_pending_quantity ?? 0),
					owner_name: lot.owner_name,
				}));

				setPublicLots(lots);
				setOfferQtyByLot((current) => {
					const next = { ...current };
					for (const item of lots) {
						next[item.id] = item.my_pending_quantity > 0 ? item.my_pending_quantity : (next[item.id] ?? 1);
					}
					return next;
				});
			} catch (error) {
				const text = error instanceof Error ? error.message : "No se pudo abrir el pool.";
				setMessage(text);
			} finally {
				setLoading(false);
			}
		}

		void loadPool();

		const intervalId = window.setInterval(() => {
			void loadPool();
		}, 7000);

		return () => window.clearInterval(intervalId);
	}, [router]);

	async function sendOffer(lot: PoolLot, options?: { remove?: boolean }) {
		const supabase = getSupabaseClient();
		const {
			data: { user },
		} = await supabase.auth.getUser();

		if (!user) {
			setMessage("Debes iniciar sesion para ofrecer piezas.");
			return;
		}

		if (lot.owner_id === user.id) {
			setMessage("No puedes ofrecer en tu propio lote.");
			return;
		}

		if (lot.remaining_quantity <= 0 && lot.my_pending_quantity <= 0) {
			setMessage("Este lote ya esta completo.");
			return;
		}

		const maxOffer = Math.max(1, lot.remaining_quantity + lot.my_pending_quantity);
		const quantity = options?.remove ? 0 : Math.min(maxOffer, Math.max(1, Math.floor(offerQtyByLot[lot.id] ?? 1)));
		setSendingOfferLotId(lot.id);
		setMessage(null);

		try {
			const { data, error } = await supabase.rpc("toggle_offer_for_lot", {
				p_list_item_id: lot.id,
				p_quantity: quantity,
			});

			if (error) {
				setMessage(`No se pudo registrar tu oferta: ${error.message}. Ejecuta web/supabase/offers_toggle_rpc.sql`);
				return;
			}

			const row = ((data as ToggleOfferRpcRow[]) ?? [])[0];
			if (row) {
				setPublicLots((current) =>
					current.map((item) =>
						item.id === lot.id
							? {
									...item,
									total_offered: Number(row.total_offered ?? item.total_offered),
									remaining_quantity: Number(row.remaining_quantity ?? item.remaining_quantity),
									offers_count: Number(row.offers_count ?? item.offers_count),
									my_pending_quantity: Number(row.my_pending_quantity ?? item.my_pending_quantity),
							  }
							: item,
					),
				);
			}

			setMessage(
				row?.action === "deleted"
					? "Quitaste tu oferta en este lote."
					: row?.action === "updated"
					? "Actualizaste tu cantidad ofrecida."
					: "Oferta enviada. El dueno de la lista ya la ve en su lista.",
			);
			setOfferQtyByLot((current) => ({
				...current,
				[lot.id]: Number(row?.my_pending_quantity ?? 1) > 0 ? Number(row?.my_pending_quantity ?? 1) : 1,
			}));
		} finally {
			setSendingOfferLotId(null);
		}
	}

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
			if (!uniqueByKey.has(key)) {
				uniqueByKey.set(key, item);
			}
		}

		const missingItems = [...uniqueByKey.entries()]
			.filter(([key]) => !(key in partImages) && !imageRequestInFlightRef.current.has(key))
			.map(([, item]) => item);

		if (missingItems.length === 0) return;

		const chunkSize = 100;
		for (let index = 0; index < missingItems.length; index += chunkSize) {
			const chunk = missingItems.slice(index, index + chunkSize);
			const requestedKeys = chunk.map((item) => getPartImageKey(item.part_num, item.color_name));
			for (const key of requestedKeys) imageRequestInFlightRef.current.add(key);

			try {
				const response = await fetch("/api/rebrickable/part-images", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ items: chunk }),
				});
				if (!response.ok) {
					setPartImages((current) => {
						const next = { ...current };
						for (const key of requestedKeys) next[key] = null;
						return next;
					});
					continue;
				}

				const payload = (await response.json()) as {
					results?: Array<{ key: string; part_num: string; part_img_url: string | null }>;
				};

				const additions: PartImageLookup = {};
				for (const part of payload.results ?? []) {
					if (!part.key) continue;
					additions[part.key] = part.part_img_url;
				}

				for (const key of requestedKeys) {
					if (!(key in additions)) additions[key] = null;
				}

				setPartImages((current) => ({ ...current, ...additions }));
			} catch {
				setPartImages((current) => {
					const next = { ...current };
					for (const key of requestedKeys) next[key] = null;
					return next;
				});
			} finally {
				for (const key of requestedKeys) imageRequestInFlightRef.current.delete(key);
			}
		}
	}

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

	useEffect(() => {
		void loadPartImages(
			publicLots.map((lot) => ({
				part_num: lot.part_num,
				color_name: lot.color_name,
			})),
		);
	}, [publicLots]);

	const lotCards = useMemo<PoolLot[]>(() => {
		return [...publicLots]
			.sort((a, b) => {
				if (sortBy === "usuario") {
					const byOwner = (a.owner_name || "").localeCompare(b.owner_name || "", "es", { sensitivity: "base" });
					if (byOwner !== 0) return byOwner;
				}

				const aName = (a.part_name || a.part_num).toLowerCase();
				const bName = (b.part_name || b.part_num).toLowerCase();
				const byPart = aName.localeCompare(bName, "es", { sensitivity: "base" });
				if (byPart !== 0) return byPart;
				return a.part_num.localeCompare(b.part_num, "es", { sensitivity: "base" });
			});
	}, [publicLots, sortBy]);

	if (loading) {
		return (
			<div className="font-chewy flex min-h-screen items-center justify-center bg-[#006eb2] px-6 text-center text-2xl text-white sm:text-3xl">
				{loadingMessage}
			</div>
		);
	}

	return (
		<div className="min-h-screen bg-[#006eb2] px-4 py-6 sm:px-6 sm:py-8">
			<main className="mx-auto flex w-full max-w-5xl flex-col gap-6 rounded-2xl bg-white p-4 shadow-xl sm:p-8">
				<header className="border-b border-slate-200 pb-5">
					<div className="flex flex-col gap-0 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
						<div>
							<div className="flex justify-start">
								<Link href="/dashboard" className="text-sm text-slate-600 hover:underline">
									← Volver
								</Link>
							</div>
							<div className="mt-0 flex items-start justify-between gap-2">
								<div>
									<h1 className="text-3xl font-semibold text-slate-900">
										<span className="sm:hidden">Pool de items deseados</span>
										<span className="hidden sm:inline">Pool de items deseados</span>
									</h1>
									<p className="mt-1 text-sm font-semibold text-slate-700">{currentUserName}</p>
								</div>
								<Image src="/pool-logo.svg" alt="Pool" width={72} height={20} className="shrink-0 sm:hidden" />
							</div>

							<div className="mt-1 flex items-center gap-2 sm:mt-0">
								<label htmlFor="pool-sort" className="text-sm text-slate-700">
									Ordenar por
								</label>
								<select
									id="pool-sort"
									value={sortBy}
									onChange={(event) => setSortBy(event.target.value as "pieza" | "usuario")}
									className="rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-900"
								>
									<option value="pieza">Pieza</option>
									<option value="usuario">Usuario</option>
								</select>
							</div>
						</div>
						<Image src="/pool-logo.svg" alt="Pool" width={120} height={34} className="hidden shrink-0 self-start sm:block sm:self-auto" />
					</div>
				</header>

				{lotCards.length === 0 ? (
					<section className="rounded-xl border border-slate-200 p-5 text-sm text-slate-600">
						No hay lotes publicos por ahora. Si ya hay listas publicas, revisa el orden SQL en `web/supabase/README.md`.
					</section>
				) : (
					<section className="space-y-2">
						{lotCards.map((lot) => (
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
												<span className="leading-none">Sin imagen</span>
											</div>
										)}

										<div className="min-w-0 flex-1">
											<p className="text-sm font-medium text-slate-900">
												<span className="block overflow-hidden [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:3] sm:[-webkit-line-clamp:2]">
													{lot.part_name || "Sin nombre"}
												</span>
											</p>
											<div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-700 sm:hidden">
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
												<p className="font-chewy text-base text-slate-600">{lot.owner_name || "Desconocido"}</p>
											</div>
											<div className="mt-1 hidden flex-wrap gap-x-3 gap-y-1 text-sm text-slate-700 sm:flex">
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
												<p className="font-chewy text-base text-slate-600">{lot.owner_name || "Desconocido"}</p>
											</div>
										</div>
									</div>

									<div className="mt-1 flex w-full items-center justify-end gap-2 sm:ml-3 sm:mt-0 sm:w-auto">
										<div className="flex items-center gap-2">
											{(() => {
												const isOwner = lot.owner_id === currentUserId;
												const isComplete = lot.remaining_quantity <= 0;
												const hasMyPending = lot.my_pending_quantity > 0;
												const disableControls = sendingOfferLotId === lot.id || isOwner || (isComplete && !hasMyPending);
												const maxOffer = Math.max(1, lot.remaining_quantity + lot.my_pending_quantity);
												const buttonLabel = isOwner ? "Tu lote" : hasMyPending ? "Actualizar" : isComplete ? "Completo" : "Yo tengo";

												return (
													<>
											<input
												type="number"
												min={1}
												max={maxOffer}
												value={offerQtyByLot[lot.id] ?? 1}
												onChange={(event) =>
													setOfferQtyByLot((current) => ({
														...current,
														[lot.id]: Math.min(maxOffer, Math.max(1, Number(event.target.value) || 1)),
													}))
												}
												disabled={disableControls}
												className="quantity-input w-16 rounded border border-slate-300 px-2 py-1 text-center text-sm text-slate-900"
											/>
											<button
												type="button"
												onClick={() => void sendOffer(lot)}
												disabled={disableControls}
												className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-60"
											>
												{buttonLabel}
											</button>
											{hasMyPending ? (
												<button
													type="button"
													onClick={() => void sendOffer(lot, { remove: true })}
													disabled={sendingOfferLotId === lot.id || isOwner}
													className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
												>
													Quitar
												</button>
											) : null}
													</>
												);
											})()}
										</div>
									</div>
								</div>
							</article>
						))}
					</section>
				)}

				{message ? <p className="text-sm text-slate-700">{message}</p> : null}
			</main>
		</div>
	);
}
