"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabase";

export default function ResetPasswordPage() {
	const router = useRouter();
	const [password, setPassword] = useState("");
	const [passwordConfirm, setPasswordConfirm] = useState("");
	const [saving, setSaving] = useState(false);
	const [ready, setReady] = useState(false);
	const [message, setMessage] = useState<string | null>(null);

	useEffect(() => {
		const supabase = getSupabaseClient();

		supabase.auth.getSession().then(({ data }) => {
			if (data.session) {
				setReady(true);
			}
		});

		const {
			data: { subscription },
		} = supabase.auth.onAuthStateChange((event, session) => {
			if (event === "PASSWORD_RECOVERY" || Boolean(session)) {
				setReady(true);
			}
		});

		return () => subscription.unsubscribe();
	}, []);

	async function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setMessage(null);

		const nextPassword = password.trim();
		const nextPasswordConfirm = passwordConfirm.trim();

		if (nextPassword.length < 6) {
			setMessage("La nueva contrasena debe tener al menos 6 caracteres.");
			return;
		}

		if (nextPassword !== nextPasswordConfirm) {
			setMessage("Las contrasenas no coinciden.");
			return;
		}

		setSaving(true);
		try {
			const { error } = await getSupabaseClient().auth.updateUser({ password: nextPassword });
			if (error) {
				setMessage(`No se pudo cambiar la contrasena: ${error.message}`);
				return;
			}

			setMessage("Contrasena actualizada. Ya puedes iniciar sesion.");
			setTimeout(() => router.replace("/"), 1200);
		} finally {
			setSaving(false);
		}
	}

	return (
		<div className="min-h-screen bg-[#006eb2] px-6 py-12">
			<main className="mx-auto w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-lg">
				<h1 className="text-2xl font-semibold text-slate-900">Cambiar contrasena</h1>
				<p className="mt-2 text-sm text-slate-600">
					{ready
						? "Ingresa una contrasena nueva para tu cuenta."
						: "Abre esta pagina desde el enlace que te llega por email para activar el cambio."}
				</p>

				<form onSubmit={onSubmit} className="mt-6 space-y-4">
					<div>
						<label htmlFor="newPassword" className="mb-2 block text-sm font-medium text-slate-800">
							Nueva contrasena
						</label>
						<input
							id="newPassword"
							type="password"
							value={password}
							onChange={(event) => setPassword(event.target.value)}
							className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
						/>
					</div>

					<div>
						<label htmlFor="newPasswordConfirm" className="mb-2 block text-sm font-medium text-slate-800">
							Repetir contrasena nueva
						</label>
						<input
							id="newPasswordConfirm"
							type="password"
							value={passwordConfirm}
							onChange={(event) => setPasswordConfirm(event.target.value)}
							className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
						/>
					</div>

					<button
						type="submit"
						disabled={saving || !ready}
						className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
					>
						{saving ? "Guardando..." : "Guardar nueva contrasena"}
					</button>
				</form>

				{message ? <p className="mt-4 text-sm text-slate-700">{message}</p> : null}

				<p className="mt-6 text-sm text-slate-600">
					<Link href="/" className="font-semibold text-slate-900 hover:underline">
						Volver al login
					</Link>
				</p>
			</main>
		</div>
	);
}
