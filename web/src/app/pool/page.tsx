"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabase";

type PoolLot = {
	id: string;
	list_id: string;
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

export default function PoolPage() {
	const router = useRouter();
	const [loading, setLoading] = useState(true);
	const [message, setMessage] = useState<string | null>(null);
	const [publicLots, setPublicLots] = useState<PoolLot[]>([]);
	const [partImages, setPartImages] = useState<PartImageLookup>({});
	const [currentUserId, setCurrentUserId] = useState<string | null>(null);
	const [offerQtyByLot, setOfferQtyByLot] = useState<Record<string, number>>({});
	const [sendingOfferLotId, setSendingOfferLotId] = useState<string | null>(null);

	useEffect(() => {
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

				const { data: rpcData, error: rpcError } = await supabase.rpc("get_public_pool_lots");
				if (rpcError) {
					setMessage(`Pool no configurado: ${rpcError.message}. Ejecuta web/supabase/pool_public_rpc.sql`);
					setPublicLots([]);
					return;
				}

				const lots = ((rpcData as RpcPoolLot[]) ?? []).map((lot) => ({
					id: lot.id,
					list_id: lot.list_id,
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
	}, [router]);

	async function sendOffer(lot: PoolLot) {
		if (!currentUserId) {
			setMessage("Debes iniciar sesion para ofrecer piezas.");
			return;
		}

		const quantity = Math.max(1, Math.floor(offerQtyByLot[lot.id] ?? 1));
		setSendingOfferLotId(lot.id);
		setMessage(null);

		try {
			const supabase = getSupabaseClient();
			const { error } = await supabase.from("offers").insert({
				list_item_id: lot.id,
				offered_by: currentUserId,
				quantity,
				status: "pending",
			});

			if (error) {
				setMessage(`No se pudo registrar tu oferta: ${error.message}`);
				return;
			}

			setMessage("Oferta enviada. El dueno de la lista ya la ve en su lista.");
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
				const aName = (a.part_name || a.part_num).toLowerCase();
				const bName = (b.part_name || b.part_num).toLowerCase();
				const byName = aName.localeCompare(bName, "es", { sensitivity: "base" });
				if (byName !== 0) return byName;
				return a.part_num.localeCompare(b.part_num, "es", { sensitivity: "base" });
			});
	}, [publicLots]);

	if (loading) {
		return <div className="min-h-screen bg-[#006eb2] p-8 text-white">Cargando pool...</div>;
	}

	return (
		<div className="min-h-screen bg-[#006eb2] px-6 py-8">
			<main className="mx-auto flex w-full max-w-5xl flex-col gap-6 rounded-2xl bg-white p-6 shadow-xl sm:p-8">
				<header className="border-b border-slate-200 pb-5">
					<Link href="/dashboard" className="text-sm text-slate-600 hover:underline">
						← Volver
					</Link>
					<h1 className="mt-2 text-3xl font-semibold text-slate-900">Pool de lotes publicos</h1>
					<p className="mt-1 text-sm text-slate-600">Lotes mezclados de todas las listas publicas, ordenados alfabeticamente.</p>
				</header>

				{lotCards.length === 0 ? (
					<section className="rounded-xl border border-slate-200 p-5 text-sm text-slate-600">
						No hay lotes publicos por ahora. Si ya hay listas publicas, ejecuta `web/supabase/pool_rls.sql` en Supabase.
					</section>
				) : (
					<section className="space-y-2">
						{lotCards.map((lot) => (
							<article key={lot.id} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
								<div className="flex items-center gap-3">
									{partImages[lot.part_num] ? (
										<img
											src={partImages[lot.part_num] ?? undefined}
											alt={lot.part_name || lot.part_num}
											className="h-16 w-16 rounded border border-slate-200 bg-white object-contain"
										/>
									) : (
										<div className="h-16 w-16 rounded border border-slate-200 bg-white" />
									)}

									<p className="min-w-0 flex-1 text-sm font-medium text-slate-900">
										<span className="block overflow-hidden [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">
											{lot.part_name || "Sin nombre"}
										</span>
									</p>

									<p className="w-36 text-sm text-slate-700">{lot.color_name || "Sin color"}</p>
									<p className="w-20 text-sm text-slate-700">x{lot.quantity}</p>
									<p className="font-chewy w-44 truncate text-base text-slate-600">{lot.owner_name || "Desconocido"}</p>
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
											className="quantity-input w-16 rounded border border-slate-300 px-2 py-1 text-center text-sm text-slate-900"
										/>
										<button
											type="button"
											onClick={() => void sendOffer(lot)}
											disabled={sendingOfferLotId === lot.id}
											className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-60"
										>
											Yo tengo
										</button>
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
