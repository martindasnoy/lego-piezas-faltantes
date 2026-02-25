"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabase";

type UserList = {
	id: string;
	name: string;
	is_public: boolean;
	pieces_count: number;
	lots_count: number;
};

export default function DashboardPage() {
	const router = useRouter();
	const [userEmail, setUserEmail] = useState("");
	const [displayName, setDisplayName] = useState("");
	const [lists, setLists] = useState<UserList[]>([]);
	const [newListName, setNewListName] = useState("");
	const [isPublic, setIsPublic] = useState(false);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [switchingId, setSwitchingId] = useState<string | null>(null);
	const [message, setMessage] = useState<string | null>(null);

	async function loadLists(ownerId: string) {
		const supabase = getSupabaseClient();
		const { data: listRows, error: listError } = await supabase
			.from("lists")
			.select("id,name,is_public")
			.eq("owner_id", ownerId)
			.order("created_at", { ascending: false });

		if (listError) {
			setMessage("No se pudieron cargar las listas. Revisa tabla y permisos de Supabase.");
			setLists([]);
			return;
		}

		const ids = (listRows ?? []).map((list) => list.id as string);
		const countByListId = new Map<string, { lots: number; pieces: number }>();

		if (ids.length > 0) {
			const { data: itemRows } = await supabase
				.from("list_items")
				.select("list_id,quantity")
				.in("list_id", ids);

			for (const row of itemRows ?? []) {
				const listId = row.list_id as string;
				const quantity = Number(row.quantity ?? 0);
				const current = countByListId.get(listId) ?? { lots: 0, pieces: 0 };
				countByListId.set(listId, {
					lots: current.lots + 1,
					pieces: current.pieces + quantity,
				});
			}
		}

		const enriched = (listRows ?? []).map((list) => {
			const counts = countByListId.get(list.id as string) ?? { lots: 0, pieces: 0 };
			return {
				id: list.id as string,
				name: list.name as string,
				is_public: Boolean(list.is_public),
				lots_count: counts.lots,
				pieces_count: counts.pieces,
			};
		});

		setLists(enriched);
	}

	useEffect(() => {
		async function loadDashboard() {
			try {
				const supabase = getSupabaseClient();
				const {
					data: { user },
				} = await supabase.auth.getUser();

				if (!user) {
					router.replace("/");
					return;
				}

				setUserEmail(user.email ?? "");
				setDisplayName((user.user_metadata?.display_name as string) ?? "");
				await loadLists(user.id);
			} catch (error) {
				const text = error instanceof Error ? error.message : "No se pudo abrir el dashboard.";
				setMessage(text);
			} finally {
				setLoading(false);
			}
		}

		void loadDashboard();
	}, [router]);

	async function createList(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setSaving(true);
		setMessage(null);

		try {
			const supabase = getSupabaseClient();
			const {
				data: { user },
			} = await supabase.auth.getUser();

			if (!user) {
				router.replace("/");
				return;
			}

			const name = newListName.trim();
			if (!name) {
				setMessage("Escribe un nombre para la nueva lista.");
				setSaving(false);
				return;
			}

			const { error } = await supabase
				.from("lists")
				.insert({
					owner_id: user.id,
					name,
					is_public: isPublic,
					status: "draft",
				});

			if (error) {
				setMessage(error.message);
			} else {
				setNewListName("");
				setIsPublic(false);
				await loadLists(user.id);
				setMessage("Lista creada correctamente.");
			}
		} catch (error) {
			const text = error instanceof Error ? error.message : "No se pudo crear la lista.";
			setMessage(text);
		} finally {
			setSaving(false);
		}
	}

	async function logout() {
		const supabase = getSupabaseClient();
		await supabase.auth.signOut();
		router.replace("/");
	}

	async function switchVisibility(listId: string, nextIsPublic: boolean) {
		setSwitchingId(listId);
		setMessage(null);

		try {
			const supabase = getSupabaseClient();
			const { error } = await supabase.from("lists").update({ is_public: nextIsPublic }).eq("id", listId);

			if (error) {
				setMessage(error.message);
				return;
			}

			setLists((current) =>
				current.map((list) => (list.id === listId ? { ...list, is_public: nextIsPublic } : list)),
			);
		} finally {
			setSwitchingId(null);
		}
	}

	if (loading) {
		return <div className="min-h-screen bg-[#006eb2] p-8 text-white">Cargando dashboard...</div>;
	}

	return (
		<div className="min-h-screen bg-[#006eb2] px-6 py-8">
			<main className="mx-auto flex w-full max-w-3xl flex-col gap-6 rounded-2xl bg-white p-6 shadow-xl sm:p-8">
				<header className="flex flex-col gap-3 border-b border-slate-200 pb-5 sm:flex-row sm:items-center sm:justify-between">
					<div>
						<h1 className="text-4xl font-semibold text-slate-900 sm:text-5xl">{displayName || userEmail}</h1>
						<p className="text-sm text-slate-500">Email: {userEmail}</p>
					</div>
					<button
						type="button"
						onClick={logout}
						className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
					>
						Cerrar sesion
					</button>
				</header>

				<section className="rounded-xl border border-slate-300 bg-[#f5f5f5] p-4 sm:p-5">
					<h2 className="text-xl font-semibold text-slate-900">Crear nueva lista</h2>
					<form onSubmit={createList} className="mt-4 space-y-4">
						<div>
							<input
								id="listName"
								type="text"
								value={newListName}
								onChange={(event) => setNewListName(event.target.value)}
								placeholder="Ej: Faltantes set 75367"
								className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
							/>
						</div>

						<div className="flex items-center justify-between gap-3 pr-2">
							<label className="flex items-center gap-2 text-sm text-slate-700">
								<input
									type="checkbox"
									checked={isPublic}
									onChange={(event) => setIsPublic(event.target.checked)}
									className="h-4 w-4"
								/>
								Lista publica (visible en el pool)
							</label>

							<button
								type="submit"
								disabled={saving}
								className="rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
							>
								{saving ? "Guardando..." : "Crear lista"}
							</button>
						</div>
					</form>
				</section>

				<section className="grid gap-4 md:grid-cols-3">
					<div className="rounded-xl border border-slate-200 p-4 sm:p-5 md:col-span-2">
						<h2 className="text-xl font-semibold text-slate-900">Tus listas creadas</h2>
						{lists.length === 0 ? (
							<p className="mt-3 text-sm text-slate-600">Todavia no creaste listas.</p>
						) : (
							<ul className="mt-4 space-y-3">
								{lists.map((list) => (
									<li key={list.id} className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
										<div className="flex items-start justify-between gap-3">
											<div>
												<Link href={`/dashboard/lists/${list.id}`} className="text-base font-semibold text-slate-900 hover:underline">
													{list.name}
												</Link>
												<p className="mt-1 text-xs text-slate-500">
													Lotes: {list.lots_count} - Piezas: {list.pieces_count}
												</p>
											</div>
											<div className="flex flex-wrap justify-end gap-2">
												<button
													type="button"
													onClick={() => switchVisibility(list.id, false)}
													disabled={switchingId === list.id || !list.is_public}
													className={`rounded-md px-2.5 py-1 text-xs font-medium ${!list.is_public ? "bg-slate-900 text-white" : "border border-slate-300 text-slate-700"}`}
												>
													Privado
												</button>
												<button
													type="button"
													onClick={() => switchVisibility(list.id, true)}
													disabled={switchingId === list.id || list.is_public}
													className={`rounded-md px-2.5 py-1 text-xs font-medium ${list.is_public ? "bg-slate-900 text-white" : "border border-slate-300 text-slate-700"}`}
												>
													Publico
												</button>
											</div>
										</div>
									</li>
								))}
							</ul>
						)}
					</div>

					<div className="rounded-xl border border-slate-200 p-4 text-center sm:p-5">
						<div className="flex justify-center">
							<Image src="/pool-logo.svg" alt="Pool" width={160} height={44} />
						</div>
						<p className="mt-2 text-sm text-slate-600">Revisa listas publicas de otros usuarios.</p>
						<div className="mt-4 flex justify-center">
							<Link
								href="/pool"
								className="inline-flex h-10 items-center rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-700"
							>
								Entrar al pool
							</Link>
						</div>
					</div>
				</section>

				{message ? <p className="text-sm text-slate-700">{message}</p> : null}
			</main>
		</div>
	);
}
