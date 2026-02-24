"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { signInUser, signUpUser } from "@/lib/auth";

type Mode = "login" | "register";

export function AuthCard() {
	const router = useRouter();
	const [mode, setMode] = useState<Mode>("login");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [displayName, setDisplayName] = useState("");
	const [loading, setLoading] = useState(false);
	const [message, setMessage] = useState<string | null>(null);

	const isLogin = mode === "login";

	async function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setLoading(true);
		setMessage(null);

		const cleanEmail = email.trim().toLowerCase();
		const cleanPassword = password.trim();

		if (!cleanEmail || !cleanPassword) {
			setMessage("Completa email y contrasena.");
			setLoading(false);
			return;
		}

		if (!isLogin && cleanPassword.length < 6) {
			setMessage("La contrasena debe tener al menos 6 caracteres.");
			setLoading(false);
			return;
		}

		const result = isLogin
			? await signInUser({ email: cleanEmail, password: cleanPassword })
			: await signUpUser({
					email: cleanEmail,
					password: cleanPassword,
					displayName: displayName.trim(),
			  });

		setMessage(result.message);

		if (result.ok && isLogin) {
			router.push("/dashboard");
		}

		setLoading(false);
	}

	return (
		<>
			<h2 className="mt-4 text-2xl font-semibold text-slate-900">{isLogin ? "Iniciar sesion" : "Crear cuenta"}</h2>
			<p className="mt-2 text-sm text-slate-600">
				{isLogin
					? "Accede para crear y publicar tus listas de piezas faltantes."
					: "Crea tu usuario para empezar a cargar listas y compartirlas."}
			</p>

			<form onSubmit={onSubmit} className="mt-8 space-y-5">
				{!isLogin && (
					<div>
						<label htmlFor="displayName" className="mb-2 block text-sm font-medium text-slate-800">
							Nombre
						</label>
						<input
							id="displayName"
							type="text"
							value={displayName}
							onChange={(event) => setDisplayName(event.target.value)}
							placeholder="Tu nombre"
							className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
						/>
					</div>
				)}

				<div>
					<label htmlFor="email" className="mb-2 block text-sm font-medium text-slate-800">
						Email
					</label>
					<input
						id="email"
						type="email"
						value={email}
						onChange={(event) => setEmail(event.target.value)}
						placeholder="tuemail@ejemplo.com"
						className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
					/>
				</div>

				<div>
					<div className="mb-2 flex items-center justify-between">
						<label htmlFor="password" className="block text-sm font-medium text-slate-800">
							Contrasena
						</label>
						{isLogin ? (
							<span className="text-xs font-medium text-slate-500">Minimo 6 caracteres</span>
						) : null}
					</div>
					<input
						id="password"
						type="password"
						value={password}
						onChange={(event) => setPassword(event.target.value)}
						placeholder="********"
						className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
					/>
				</div>

				<button
					type="submit"
					disabled={loading}
					className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
				>
					{loading ? "Procesando..." : isLogin ? "Entrar" : "Crear cuenta"}
				</button>

				{message ? <p className="text-sm text-slate-700">{message}</p> : null}
			</form>

			<p className="mt-6 text-center text-sm text-slate-600">
				{isLogin ? "No tenes cuenta?" : "Ya tenes cuenta?"}{" "}
				<button
					type="button"
					onClick={() => {
						setMode(isLogin ? "register" : "login");
						setMessage(null);
					}}
					className="font-semibold text-slate-900 hover:underline"
				>
					{isLogin ? "Crear cuenta" : "Iniciar sesion"}
				</button>
			</p>
		</>
	);
}
