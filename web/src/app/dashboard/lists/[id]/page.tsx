"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabase";

type ListInfo = {
	id: string;
	name: string;
	is_public: boolean;
};

type Lot = {
	id: string;
	part_name: string | null;
	part_num: string;
	color_name: string | null;
	quantity: number;
};

export default function ListDetailPage() {
	const params = useParams<{ id: string }>();
	const router = useRouter();
	const listId = params.id;

	const [list, setList] = useState<ListInfo | null>(null);
	const [lots, setLots] = useState<Lot[]>([]);
	const [partInput, setPartInput] = useState("");
	const [colorInput, setColorInput] = useState("");
	const [quantityInput, setQuantityInput] = useState(1);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [message, setMessage] = useState<string | null>(null);

	const totals = useMemo(() => {
		return lots.reduce(
			(acc, lot) => {
				acc.pieces += Number(lot.quantity ?? 0);
				acc.lots += 1;
				return acc;
			},
			{ pieces: 0, lots: 0 },
		);
	}, [lots]);

	useEffect(() => {
		async function loadDetail() {
			try {
				const supabase = getSupabaseClient();
				const {
					data: { user },
				} = await supabase.auth.getUser();

				if (!user) {
					router.replace("/");
					return;
				}

				const { data: listData, error: listError } = await supabase
					.from("lists")
					.select("id,name,is_public")
					.eq("id", listId)
					.eq("owner_id", user.id)
					.single();

				if (listError || !listData) {
					setMessage("No se pudo abrir esta lista.");
					setLoading(false);
					return;
				}

				setList(listData as ListInfo);

				const { data: lotRows, error: lotError } = await supabase
					.from("list_items")
					.select("id,part_name,part_num,color_name,quantity")
					.eq("list_id", listId)
					.order("created_at", { ascending: false });

				if (lotError) {
					setMessage("No se pudieron cargar los lotes de esta lista.");
				} else {
					setLots((lotRows as Lot[]) ?? []);
				}
			} catch (error) {
				const text = error instanceof Error ? error.message : "No se pudo abrir la lista.";
				setMessage(text);
			} finally {
				setLoading(false);
			}
		}

		void loadDetail();
	}, [listId, router]);

	async function createLot(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setSaving(true);
		setMessage(null);

		try {
			const supabase = getSupabaseClient();
			const piece = partInput.trim();
			const color = colorInput.trim();
			const quantity = Number(quantityInput);

			if (!piece) {
				setMessage("Escribe la pieza para crear el lote.");
				setSaving(false);
				return;
			}

			if (!Number.isFinite(quantity) || quantity <= 0) {
				setMessage("La cantidad debe ser mayor a 0.");
				setSaving(false);
				return;
			}

			const { data, error } = await supabase
				.from("list_items")
				.insert({
					list_id: listId,
					part_num: piece,
					part_name: piece,
					color_name: color || null,
					quantity,
				})
				.select("id,part_name,part_num,color_name,quantity")
				.single();

			if (error) {
				setMessage(error.message);
				setSaving(false);
				return;
			}

			setLots((current) => [data as Lot, ...current]);
			setPartInput("");
			setColorInput("");
			setQuantityInput(1);
		} catch (error) {
			const text = error instanceof Error ? error.message : "No se pudo crear el lote.";
			setMessage(text);
		} finally {
			setSaving(false);
		}
	}

	if (loading) {
		return <div className="min-h-screen bg-[#006eb2] p-8 text-white">Cargando lista...</div>;
	}

	if (!list) {
		return (
			<div className="min-h-screen bg-[#006eb2] p-8 text-white">
				<p>No encontramos esa lista.</p>
				<Link href="/dashboard" className="mt-4 inline-block underline">
					Volver al dashboard
				</Link>
			</div>
		);
	}

	return (
		<div className="min-h-screen bg-[#006eb2] px-6 py-8">
			<main className="mx-auto flex w-full max-w-3xl flex-col gap-6 rounded-2xl bg-white p-6 shadow-xl sm:p-8">
				<header className="border-b border-slate-200 pb-5">
					<Link href="/dashboard" className="text-sm text-slate-600 hover:underline">
						← Volver
					</Link>
					<h1 className="mt-2 text-3xl font-semibold text-slate-900">{list.name}</h1>
					<p className="mt-1 text-sm text-slate-600">
						Visibilidad: {list.is_public ? "Publica" : "Privada"} - Lotes: {totals.lots} - Piezas: {totals.pieces}
					</p>
				</header>

				<section className="rounded-xl border border-slate-200 p-4 sm:p-5">
					<h2 className="text-xl font-semibold text-slate-900">Nuevo lote</h2>
					<form onSubmit={createLot} className="mt-4 grid gap-4 sm:grid-cols-3">
						<input
							type="text"
							value={partInput}
							onChange={(event) => setPartInput(event.target.value)}
							placeholder="Pieza (codigo o nombre)"
							className="rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
						/>
						<input
							type="text"
							value={colorInput}
							onChange={(event) => setColorInput(event.target.value)}
							placeholder="Color"
							className="rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
						/>
						<input
							type="number"
							min={1}
							value={quantityInput}
							onChange={(event) => setQuantityInput(Number(event.target.value))}
							className="rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
						/>
						<button
							type="submit"
							disabled={saving}
							className="sm:col-span-3 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
						>
							{saving ? "Guardando..." : "Agregar lote"}
						</button>
					</form>
				</section>

				<section className="rounded-xl border border-slate-200 p-4 sm:p-5">
					<h2 className="text-xl font-semibold text-slate-900">Lotes de la lista</h2>
					{lots.length === 0 ? (
						<p className="mt-3 text-sm text-slate-600">Todavia no agregaste lotes.</p>
					) : (
						<ul className="mt-4 space-y-3">
							{lots.map((lot) => (
								<li key={lot.id} className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
									<p className="font-medium text-slate-900">{lot.part_name || lot.part_num}</p>
									<p className="mt-1 text-sm text-slate-600">
										Color: {lot.color_name || "Sin color"} - Cantidad: {lot.quantity}
									</p>
								</li>
							))}
						</ul>
					)}
				</section>

				{message ? <p className="text-sm text-slate-700">{message}</p> : null}
			</main>
		</div>
	);
}
