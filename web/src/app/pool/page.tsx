"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabase";
import { getRandomLoadingMessage } from "@/lib/loading-messages";

type PoolLot = {
	id: string;
	list_id: string;
	owner_id: string;
	claimed_by_id?: string | null;
	claimed_by_name?: string | null;
	claimed_status?: string | null;
	part_num: string;
	part_name: string | null;
	color_name: string | null;
	quantity: number;
	owner_name?: string | null;
};

type RpcPoolLot = PoolLot & {
	list_name: string | null;
	owner_name: string | null;
};

type PartImageLookup = Record<string, string | null>;
type ToggleOfferRpcRow = {
	action: "created" | "deleted";
	claimed_by_id: string | null;
	claimed_by_name: string | null;
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
					claimed_by_id: lot.claimed_by_id,
					claimed_by_name: lot.claimed_by_name,
					claimed_status: lot.claimed_status,
					part_num: lot.part_num,
					part_name: lot.part_name,
					color_name: lot.color_name,
					quantity: Number(lot.quantity ?? 0),
					owner_name: lot.owner_name,
				}));

				setPublicLots(lots);
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

	async function sendOffer(lot: PoolLot) {
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

		if (lot.claimed_by_id && lot.claimed_by_id !== user.id) {
			setMessage("Este lote ya fue marcado por otro usuario.");
			return;
		}

		if (lot.claimed_status === "accepted") {
			setMessage("Esta oferta ya fue aceptada y no se puede cambiar desde el pool.");
			return;
		}

		const quantity = Math.max(1, Math.floor(offerQtyByLot[lot.id] ?? 1));
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
			const wasDeleted = row?.action === "deleted";

			setPublicLots((current) =>
				current.map((item) =>
					item.id === lot.id
						? {
								...item,
								claimed_by_id: wasDeleted ? null : (row?.claimed_by_id ?? user.id),
								claimed_by_name: wasDeleted ? null : (row?.claimed_by_name ?? currentUserName),
								claimed_status: wasDeleted ? null : "pending",
						  }
						: item,
				),
			);

			setMessage(
				wasDeleted
					? "Quitaste tu Yo tengo en este lote."
					: "Oferta enviada. El dueno de la lista ya la ve en su lista.",
			);
		} finally {
			setSendingOfferLotId(null);
		}
	}

	async function loadPartImages(partNums: string[]) {
		const uniqueNums = [...new Set(partNums.map((num) => num.trim()).filter(Boolean))];
		if (uniqueNums.length === 0) return;

		const missingNums = uniqueNums.filter((num) => !(num in partImages));
		if (missingNums.length === 0) return;

		try {
			const response = await fetch(`/api/rebrickable/parts-by-num?nums=${encodeURIComponent(missingNums.join(","))}`);
			if (!response.ok) return;

			const payload = (await response.json()) as {
				results?: Array<{ part_num: string; part_img_url: string | null }>;
			};

			const additions: PartImageLookup = {};
			for (const part of payload.results ?? []) {
				additions[part.part_num] = part.part_img_url;
			}

			if (Object.keys(additions).length > 0) {
				setPartImages((current) => ({ ...current, ...additions }));
			}
		} catch {
			// No bloquea render del pool
		}
	}

	useEffect(() => {
		void loadPartImages(publicLots.map((lot) => lot.part_num));
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
								<h1 className="text-3xl font-semibold text-slate-900">
									<span className="sm:hidden">Pool de lotes</span>
									<span className="hidden sm:inline">Pool de lotes publicos</span>
								</h1>
								<Image src="/pool-logo.svg" alt="Pool" width={72} height={20} className="shrink-0 sm:hidden" />
							</div>

							<div className="-mt-6 flex items-center gap-2 sm:mt-0">
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
								<div className="flex flex-col gap-3 sm:flex-row sm:items-start">
									<div className="flex items-start gap-3 sm:min-w-0 sm:flex-1">
										{partImages[lot.part_num] ? (
											<img
												src={partImages[lot.part_num] ?? undefined}
												alt={lot.part_name || lot.part_num}
												className="h-20 w-20 rounded border border-slate-200 bg-white object-contain sm:h-16 sm:w-16"
											/>
										) : (
											<div className="h-20 w-20 rounded border border-slate-200 bg-white sm:h-16 sm:w-16" />
										)}

										<div className="min-w-0 flex-1">
											<p className="text-sm font-medium text-slate-900">
												<span className="block overflow-hidden [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:3] sm:[-webkit-line-clamp:2]">
													{lot.part_name || "Sin nombre"}
												</span>
											</p>
										<div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-slate-700 sm:hidden">
											<p>{lot.color_name || "Sin color"}</p>
											<p>x{lot.quantity}</p>
										</div>
											<div className="mt-1 hidden flex-wrap gap-x-3 gap-y-1 text-sm text-slate-700 sm:flex">
												<p>{lot.color_name || "Sin color"}</p>
												<p>x{lot.quantity}</p>
												<p className="font-chewy text-base text-slate-600">{lot.owner_name || "Desconocido"}</p>
											</div>
										</div>
									</div>

									<div className="mt-1 flex w-full items-center justify-between gap-2 sm:ml-auto sm:mt-0 sm:w-auto sm:justify-end">
										<p className="font-chewy min-w-0 truncate text-base text-slate-600 sm:hidden">{lot.owner_name || "Desconocido"}</p>
										<div className="flex items-center gap-2">
											<input
												type="number"
												min={1}
												value={offerQtyByLot[lot.id] ?? 1}
												onChange={(event) =>
													setOfferQtyByLot((current) => ({
														...current,
														[lot.id]: Math.max(1, Number(event.target.value) || 1),
													}))
												}
												disabled={(Boolean(lot.claimed_by_id) && lot.claimed_by_id !== currentUserId) || lot.owner_id === currentUserId || lot.claimed_status === "accepted"}
												className="quantity-input w-16 rounded border border-slate-300 px-2 py-1 text-center text-sm text-slate-900"
											/>
											<button
												type="button"
												onClick={() => void sendOffer(lot)}
												disabled={sendingOfferLotId === lot.id || lot.owner_id === currentUserId || (Boolean(lot.claimed_by_id) && lot.claimed_by_id !== currentUserId) || lot.claimed_status === "accepted"}
												className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-60"
											>
												{lot.owner_id === currentUserId
													? "Tu lote"
													: lot.claimed_by_name?.trim() || (lot.claimed_by_id ? "Reservado" : "Yo tengo")}
											</button>
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
