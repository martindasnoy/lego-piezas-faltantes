"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabase";

type PoolList = {
	id: string;
	name: string;
	owner_id: string;
};

type PoolLot = {
	id: string;
	list_id: string;
	part_num: string;
	part_name: string | null;
	color_name: string | null;
	quantity: number;
};

type PartImageLookup = Record<string, string | null>;

export default function PoolPage() {
	const router = useRouter();
	const [loading, setLoading] = useState(true);
	const [message, setMessage] = useState<string | null>(null);
	const [publicLots, setPublicLots] = useState<PoolLot[]>([]);
	const [partImages, setPartImages] = useState<PartImageLookup>({});

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

				const { data: listsData, error: listsError } = await supabase
					.from("lists")
					.select("id,name,owner_id")
					.eq("is_public", true)
					.order("created_at", { ascending: false });

				if (listsError) {
					setMessage("No se pudieron cargar listas publicas.");
					setPublicLots([]);
					return;
				}

				const lists = (listsData as PoolList[]) ?? [];

				if (lists.length === 0) {
					setPublicLots([]);
					return;
				}

				const listIds = lists.map((list) => list.id);
				const { data: lotsData, error: lotsError } = await supabase
					.from("list_items")
					.select("id,list_id,part_num,part_name,color_name,quantity")
					.in("list_id", listIds)
					.order("created_at", { ascending: false });

				if (lotsError) {
					setMessage(
						"No se pudieron cargar lotes publicos. Revisa policy SELECT en list_items para listas publicas.",
					);
					setPublicLots([]);
					return;
				}

				setPublicLots((lotsData as PoolLot[]) ?? []);
			} catch (error) {
				const text = error instanceof Error ? error.message : "No se pudo abrir el pool.";
				setMessage(text);
			} finally {
				setLoading(false);
			}
		}

		void loadPool();
	}, [router]);

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
		return publicLots
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
						No hay lotes publicos por ahora.
					</section>
				) : (
					<section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
						{lotCards.map((lot) => (
							<article key={lot.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
								<div className="flex justify-center">
									{partImages[lot.part_num] ? (
										<img
											src={partImages[lot.part_num] ?? undefined}
											alt={lot.part_name || lot.part_num}
											className="h-24 w-24 rounded border border-slate-200 bg-white object-contain"
										/>
									) : (
										<div className="h-24 w-24 rounded border border-slate-200 bg-white" />
									)}
								</div>
								<p className="mt-3 overflow-hidden text-center text-sm font-medium text-slate-800 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">
									{lot.part_name || "Sin nombre"}
								</p>
								<p className="mt-2 text-center text-xs text-slate-600">
									Color: {lot.color_name || "Sin color"} - Cantidad: {lot.quantity}
								</p>
							</article>
						))}
					</section>
				)}

				{message ? <p className="text-sm text-slate-700">{message}</p> : null}
			</main>
		</div>
	);
}
