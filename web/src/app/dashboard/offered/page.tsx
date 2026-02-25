"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabase";
import { getRandomLoadingMessage } from "@/lib/loading-messages";

type OfferedRow = {
	list_item_id: string;
	part_num: string;
	part_name: string;
	color_name: string | null;
	owner_name: string;
	total_quantity: number;
	offers_count: number;
	last_status: "pending" | "accepted" | "rejected" | string;
};

export default function OfferedPage() {
	const router = useRouter();
	const [loading, setLoading] = useState(true);
	const [loadingMessage, setLoadingMessage] = useState("Cargando...");
	const [rows, setRows] = useState<OfferedRow[]>([]);
	const [message, setMessage] = useState<string | null>(null);

	useEffect(() => {
		setLoadingMessage(getRandomLoadingMessage());

		async function loadData() {
			try {
				const supabase = getSupabaseClient();
				const {
					data: { user },
				} = await supabase.auth.getUser();

				if (!user) {
					router.replace("/");
					return;
				}

				const { data, error } = await supabase.rpc("get_my_offered_pieces");
				if (error) {
					setMessage(`No se pudo cargar Piezas ofertadas: ${error.message}. Ejecuta web/supabase/offers_mine_rpc.sql`);
					setRows([]);
					return;
				}

				setRows(((data as OfferedRow[]) ?? []).map((row) => ({ ...row, total_quantity: Number(row.total_quantity ?? 0) })));
			} catch (error) {
				setMessage(error instanceof Error ? error.message : "No se pudo cargar Piezas ofertadas.");
			} finally {
				setLoading(false);
			}
		}

		void loadData();
	}, [router]);

	const totals = useMemo(() => {
		return rows.reduce(
			(acc, row) => {
				acc.lots += 1;
				acc.pieces += Number(row.total_quantity ?? 0);
				return acc;
			},
			{ lots: 0, pieces: 0 },
		);
	}, [rows]);

	const groupedByOwner = useMemo(() => {
		const grouped = new Map<string, { rows: OfferedRow[]; lots: number; pieces: number }>();

		for (const row of rows) {
			const ownerKey = row.owner_name || "Desconocido";
			const current = grouped.get(ownerKey) ?? { rows: [], lots: 0, pieces: 0 };
			current.rows.push(row);
			current.lots += 1;
			current.pieces += Number(row.total_quantity ?? 0);
			grouped.set(ownerKey, current);
		}

		return [...grouped.entries()]
			.sort((a, b) => a[0].localeCompare(b[0], "es", { sensitivity: "base" }))
			.map(([ownerName, data]) => ({ ownerName, ...data }));
	}, [rows]);

	if (loading) {
		return (
			<div className="font-chewy flex min-h-screen items-center justify-center bg-[#006eb2] px-6 text-center text-2xl text-white sm:text-3xl">
				{loadingMessage}
			</div>
		);
	}

	return (
		<div className="min-h-screen bg-[#006eb2] px-6 py-8">
			<main className="mx-auto flex w-full max-w-4xl flex-col gap-6 rounded-2xl bg-white p-6 shadow-xl sm:p-8">
				<header className="border-b border-slate-200 pb-5">
					<div className="flex items-start justify-between gap-3">
						<h1 className="text-3xl font-semibold text-slate-900">Piezas ofertadas</h1>
						<Link href="/dashboard" className="text-sm text-slate-600 hover:underline">
							← Volver
						</Link>
					</div>
					<p className="mt-1 text-sm text-slate-600">Lista automatica: resume todo lo que marcaste con "Yo tengo".</p>
					<p className="mt-1 text-sm text-slate-600">Lotes: {totals.lots} - Piezas: {totals.pieces}</p>
				</header>

				<section className="rounded-xl border border-[#007bb8] bg-[#0093DD] p-4 text-white">
					<p className="text-sm">Esta lista es especial y no permite agregar items manualmente.</p>
				</section>

				<section className="rounded-xl border border-slate-200 p-4 sm:p-5">
					{rows.length === 0 ? (
						<p className="text-sm text-slate-600">Todavia no ofertaste piezas en el pool.</p>
					) : (
						<div className="space-y-4">
							{groupedByOwner.map((group) => (
								<div key={group.ownerName} className="rounded-xl border border-slate-200">
									<div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-100 px-3 py-2">
										<p className="font-semibold text-slate-900">{group.ownerName}</p>
										<p className="text-xs text-slate-600">Lotes: {group.lots} - Piezas: {group.pieces}</p>
									</div>
									<ul className="space-y-2 p-3">
										{group.rows.map((row) => (
											<li key={row.list_item_id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
												<div className="flex flex-wrap items-center justify-between gap-2 text-sm">
													<div>
														<p className="font-semibold text-slate-900">{row.part_name}</p>
														<p className="text-slate-600">
															#{row.part_num} - {row.color_name || "Sin color"}
														</p>
													</div>
													<div className="text-right">
														<p className="font-semibold text-slate-900">x{row.total_quantity}</p>
														<p className="text-xs text-slate-600">Estado: {row.last_status}</p>
													</div>
												</div>
											</li>
										))}
									</ul>
								</div>
							))}
						</div>
					)}
				</section>

				{message ? <p className="text-sm text-slate-700">{message}</p> : null}
			</main>
		</div>
	);
}
