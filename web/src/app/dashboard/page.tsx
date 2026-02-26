"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabase";
import { getRandomLoadingMessage } from "@/lib/loading-messages";

type UserList = {
	id: string;
	name: string;
	is_public: boolean;
	pieces_count: number;
	lots_count: number;
};

export default function DashboardPage() {
	const router = useRouter();
	const [loadingMessage, setLoadingMessage] = useState("Cargando...");
	const [userEmail, setUserEmail] = useState("");
	const [displayName, setDisplayName] = useState("");
	const [lists, setLists] = useState<UserList[]>([]);
	const [newListName, setNewListName] = useState("");
	const [isPublic, setIsPublic] = useState(false);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [switchingId, setSwitchingId] = useState<string | null>(null);
	const [deletingListId, setDeletingListId] = useState<string | null>(null);
	const [deleteTarget, setDeleteTarget] = useState<UserList | null>(null);
	const [showUserSettings, setShowUserSettings] = useState(false);
	const [settingsNameInput, setSettingsNameInput] = useState("");
	const [settingsEmailInput, setSettingsEmailInput] = useState("");
	const [showPasswordModal, setShowPasswordModal] = useState(false);
	const [currentPasswordInput, setCurrentPasswordInput] = useState("");
	const [newPasswordInput, setNewPasswordInput] = useState("");
	const [newPasswordConfirmInput, setNewPasswordConfirmInput] = useState("");
	const [settingsSaving, setSettingsSaving] = useState(false);
	const [passwordSaving, setPasswordSaving] = useState(false);
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
		setLoadingMessage(getRandomLoadingMessage());

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

	async function confirmDeleteList() {
		if (!deleteTarget) return;

		setDeletingListId(deleteTarget.id);
		setMessage(null);

		try {
			const supabase = getSupabaseClient();

			const { error: deleteItemsError } = await supabase.from("list_items").delete().eq("list_id", deleteTarget.id);

			if (deleteItemsError) {
				setMessage(`No se pudieron borrar los items de la lista: ${deleteItemsError.message}`);
				return;
			}

			const { error: deleteListError } = await supabase.from("lists").delete().eq("id", deleteTarget.id);

			if (deleteListError) {
				setMessage(`No se pudo eliminar la lista: ${deleteListError.message}`);
				return;
			}

			setLists((current) => current.filter((list) => list.id !== deleteTarget.id));
			setDeleteTarget(null);
			setMessage("Lista eliminada correctamente.");
		} finally {
			setDeletingListId(null);
		}
	}

	function openUserSettings() {
		setSettingsNameInput(displayName || "");
		setSettingsEmailInput(userEmail || "");
		setShowPasswordModal(false);
		setCurrentPasswordInput("");
		setNewPasswordInput("");
		setNewPasswordConfirmInput("");
		setShowUserSettings(true);
	}

	function openPasswordSettings() {
		setCurrentPasswordInput("");
		setNewPasswordInput("");
		setNewPasswordConfirmInput("");
		setShowPasswordModal(true);
	}

	async function saveUserSettings() {
		setSettingsSaving(true);
		setMessage(null);

		try {
			const supabase = getSupabaseClient();
			const nextName = settingsNameInput.trim();
			const nextEmail = settingsEmailInput.trim().toLowerCase();

			const updatePayload: {
				data: { display_name: string };
				email?: string;
			} = {
				data: {
					display_name: nextName,
				},
			};

			if (nextEmail && nextEmail !== userEmail.toLowerCase()) {
				updatePayload.email = nextEmail;
			}

			const { error } = await supabase.auth.updateUser(updatePayload);

			if (error) {
				setMessage(`No se pudo actualizar usuario: ${error.message}`);
				return;
			}

			setDisplayName(nextName);
			if (nextEmail) {
				setUserEmail(nextEmail);
			}
			setShowPasswordModal(false);
			setShowUserSettings(false);
			setMessage(updatePayload.email ? "Usuario actualizado. Revisa tu correo para confirmar el nuevo email." : "Usuario actualizado.");
		} finally {
			setSettingsSaving(false);
		}
	}

	async function savePasswordSettings() {
		setPasswordSaving(true);
		setMessage(null);

		try {
			const supabase = getSupabaseClient();
			const oldPassword = currentPasswordInput.trim();
			const nextPassword = newPasswordInput.trim();
			const nextPasswordConfirm = newPasswordConfirmInput.trim();

			if (!oldPassword) {
				setMessage("Completa la contrasena vieja.");
				return;
			}

			if (nextPassword.length < 6) {
				setMessage("La nueva contrasena debe tener al menos 6 caracteres.");
				return;
			}

			if (nextPassword !== nextPasswordConfirm) {
				setMessage("Las contrasenas nuevas no coinciden.");
				return;
			}

			const { error: verifyError } = await supabase.auth.signInWithPassword({
				email: userEmail,
				password: oldPassword,
			});

			if (verifyError) {
				setMessage("La contrasena vieja no coincide.");
				return;
			}

			const { error: updateError } = await supabase.auth.updateUser({ password: nextPassword });
			if (updateError) {
				setMessage(`No se pudo actualizar la contrasena: ${updateError.message}`);
				return;
			}

			setShowPasswordModal(false);
			setCurrentPasswordInput("");
			setNewPasswordInput("");
			setNewPasswordConfirmInput("");
			setMessage("Contrasena actualizada correctamente.");
		} finally {
			setPasswordSaving(false);
		}
	}

	if (loading) {
		return (
			<div className="font-chewy flex min-h-screen items-center justify-center bg-[#006eb2] px-6 text-center text-2xl text-white sm:text-3xl">
				{loadingMessage}
			</div>
		);
	}

	return (
		<div className="min-h-screen bg-[#006eb2] px-4 py-6 sm:px-6 sm:py-8">
			<main className="mx-auto flex w-full max-w-3xl flex-col gap-6 rounded-2xl bg-white p-4 shadow-xl sm:p-8">
				<header className="border-b border-slate-200 pb-5">
					<div>
						<div className="flex items-center gap-2">
							<h1 className="break-all text-3xl font-semibold text-slate-900 sm:text-5xl">{displayName || userEmail}</h1>
							<button
								type="button"
								onClick={openUserSettings}
								className="rounded-md border border-slate-300 p-1.5 text-slate-700 hover:bg-slate-50"
								aria-label="Configuracion de usuario"
							>
								<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
									<path d="M12 8.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7Z" />
									<path d="m19.4 13.5.1-3-1.9-.5a6 6 0 0 0-.6-1.4l1-1.7-2.1-2.1-1.7 1a6 6 0 0 0-1.4-.6L12.5 3h-3l-.5 1.9a6 6 0 0 0-1.4.6l-1.7-1-2.1 2.1 1 1.7a6 6 0 0 0-.6 1.4L3 10.5v3l1.9.5a6 6 0 0 0 .6 1.4l-1 1.7 2.1 2.1 1.7-1a6 6 0 0 0 1.4.6l.5 1.9h3l.5-1.9a6 6 0 0 0 1.4-.6l1.7 1 2.1-2.1-1-1.7a6 6 0 0 0 .6-1.4l1.9-.5Z" />
								</svg>
							</button>
						</div>
					</div>
				</header>

				<section className="rounded-xl border border-slate-300 bg-[#f5f5f5] p-3 sm:p-4">
					<h2 className="text-xl font-semibold text-slate-900">Crear nueva lista</h2>
					<form onSubmit={createList} className="mt-3 space-y-3">
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

						<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:pr-2">
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
								className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
							>
								{saving ? "Guardando..." : "Crear lista"}
							</button>
						</div>
					</form>
				</section>

				<section className="grid gap-4 md:grid-cols-3">
					<div className="rounded-xl border border-slate-200 p-4 sm:p-5 md:col-span-2">
						<h2 className="text-xl font-semibold text-slate-900">Tus listas creadas</h2>
						<ul className="mt-4 space-y-3">
							{lists.length === 0 ? (
								<li className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
									Todavia no creaste listas.
								</li>
							) : (
								lists.map((list) => (
									<li key={list.id} className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
										<div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
											<div>
												<Link href={`/dashboard/lists/${list.id}`} className="text-base font-semibold text-slate-900 hover:underline">
													{list.name}
												</Link>
												<p className="mt-1 text-xs text-slate-500">
													<span className="sm:hidden">Lotes: {list.lots_count} - Piezas: {list.pieces_count}</span>
													<span className="hidden sm:inline">Lotes: {list.lots_count} - Piezas: {list.pieces_count}</span>
												</p>
											</div>
										<div className="w-full md:w-auto">
											<div className="flex flex-wrap items-center justify-between gap-2 md:flex-col md:items-end md:justify-start">
												<div className="flex items-center gap-2">
													<button
														type="button"
														onClick={() => switchVisibility(list.id, false)}
														disabled={switchingId === list.id || !list.is_public || deletingListId === list.id}
														className={`rounded-md px-2.5 py-1 text-xs font-medium ${!list.is_public ? "bg-slate-900 text-white" : "border border-slate-300 text-slate-700"}`}
													>
														Privado
													</button>
													<button
														type="button"
														onClick={() => switchVisibility(list.id, true)}
														disabled={switchingId === list.id || list.is_public || deletingListId === list.id}
														className={`rounded-md px-2.5 py-1 text-xs font-medium ${list.is_public ? "bg-slate-900 text-white" : "border border-slate-300 text-slate-700"}`}
													>
														Publico
													</button>
												</div>
												<button
													type="button"
													onClick={() => setDeleteTarget(list)}
													disabled={switchingId === list.id || deletingListId === list.id}
													className="rounded-md border border-red-200 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
												>
													Eliminar lista
												</button>
											</div>
										</div>
										</div>
									</li>
								))
							)}

							<li className="rounded-lg border border-[#007bb8] bg-[#0093DD] px-4 py-3 text-white">
								<div className="flex items-start justify-between gap-3">
									<div>
										<Link href="/dashboard/offered" className="text-base font-semibold hover:underline">
											Piezas ofertadas
										</Link>
										<p className="mt-1 text-xs text-white/90">Lista automatica. Resume tus "Yo tengo".</p>
									</div>
								</div>
							</li>
						</ul>
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

				{deleteTarget ? (
					<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
						<div className="w-full max-w-xs rounded-xl bg-white p-5 shadow-xl">
							<div className="flex flex-col items-center text-center">
								<Image src="/LEGO-ICON_A.svg" alt="Lego icon" width={128} height={128} />
								<div className="mt-3">
									<p className="text-base font-medium text-slate-700">Esta lista va a ser desarmada</p>
									<h3 className="mt-1 text-2xl text-slate-900">{deleteTarget.name}</h3>
								</div>
								<div className="mt-5 flex items-center gap-2">
									<button
										type="button"
										onClick={confirmDeleteList}
										disabled={deletingListId === deleteTarget.id}
										className="rounded-md bg-[#006eb2] px-4 py-2 text-sm font-semibold text-white hover:bg-[#005f9a] disabled:opacity-50"
									>
										Si
									</button>
									<button
										type="button"
										onClick={() => setDeleteTarget(null)}
										disabled={deletingListId === deleteTarget.id}
										className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
									>
										No
									</button>
								</div>
							</div>
						</div>
					</div>
				) : null}

				{showUserSettings ? (
					<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
						<div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
							<h3 className="text-xl text-slate-900">Configuracion de usuario</h3>
							<label className="mt-4 block text-sm text-slate-700" htmlFor="settingsDisplayName">
								Nombre
							</label>
							<input
								id="settingsDisplayName"
								type="text"
								value={settingsNameInput}
								onChange={(event) => setSettingsNameInput(event.target.value)}
								className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-slate-500"
							/>
							<label className="mt-3 block text-sm text-slate-700" htmlFor="settingsEmail">
								Email
							</label>
							<input
								id="settingsEmail"
								type="email"
								value={settingsEmailInput}
								onChange={(event) => setSettingsEmailInput(event.target.value)}
								className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-slate-500"
							/>
							<button
								type="button"
								onClick={openPasswordSettings}
								className="mt-3 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
							>
								Cambiar contrasena
							</button>
							<div className="mt-4 flex justify-end gap-2">
								<button
									type="button"
									onClick={() => {
										setShowPasswordModal(false);
										setShowUserSettings(false);
									}}
									disabled={settingsSaving}
									className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
								>
									Cancelar
								</button>
								<button
									type="button"
									onClick={saveUserSettings}
									disabled={settingsSaving}
									className="rounded-md bg-[#006eb2] px-4 py-2 text-sm font-semibold text-white hover:bg-[#005f9a] disabled:opacity-50"
								>
									{settingsSaving ? "Guardando..." : "Guardar"}
								</button>
							</div>
						</div>
					</div>
				) : null}

				{showPasswordModal ? (
					<div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/55 p-4">
						<div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
							<h3 className="text-xl text-slate-900">Cambiar contrasena</h3>
							<label className="mt-4 block text-sm text-slate-700" htmlFor="currentPassword">
								Contrasena vieja
							</label>
							<input
								id="currentPassword"
								type="password"
								value={currentPasswordInput}
								onChange={(event) => setCurrentPasswordInput(event.target.value)}
								className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-slate-500"
							/>
							<label className="mt-3 block text-sm text-slate-700" htmlFor="newPassword">
								Contrasena nueva
							</label>
							<input
								id="newPassword"
								type="password"
								value={newPasswordInput}
								onChange={(event) => setNewPasswordInput(event.target.value)}
								className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-slate-500"
							/>
							<label className="mt-3 block text-sm text-slate-700" htmlFor="newPasswordConfirm">
								Repetir contrasena nueva
							</label>
							<input
								id="newPasswordConfirm"
								type="password"
								value={newPasswordConfirmInput}
								onChange={(event) => setNewPasswordConfirmInput(event.target.value)}
								className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-slate-500"
							/>
							<div className="mt-4 flex justify-end gap-2">
								<button
									type="button"
									onClick={() => setShowPasswordModal(false)}
									disabled={passwordSaving}
									className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
								>
									Cancelar
								</button>
								<button
									type="button"
									onClick={savePasswordSettings}
									disabled={passwordSaving}
									className="rounded-md bg-[#006eb2] px-4 py-2 text-sm font-semibold text-white hover:bg-[#005f9a] disabled:opacity-50"
								>
									{passwordSaving ? "Guardando..." : "Guardar"}
								</button>
							</div>
						</div>
					</div>
				) : null}

				<div className="border-t border-slate-200 pt-2">
					<button
						type="button"
						onClick={logout}
						className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
					>
						Cerrar sesion
					</button>
				</div>
			</main>
		</div>
	);
}
