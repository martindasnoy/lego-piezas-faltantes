import { AuthCard } from "@/components/auth-card";

export default function Home() {
	return (
		<div className="min-h-screen bg-[#006eb2] px-6 py-12">
			<main className="mx-auto w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-lg">
				<h1 className="text-center text-4xl text-slate-900">Faltantes</h1>
				<AuthCard />
			</main>
		</div>
	);
}
