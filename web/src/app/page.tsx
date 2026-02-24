import { AuthCard } from "@/components/auth-card";
import { Playfair_Display } from "next/font/google";

const titleFont = Playfair_Display({
	subsets: ["latin"],
	weight: ["700"],
});

export default function Home() {
	return (
		<div className="min-h-screen bg-[#006eb2] px-6 py-12">
			<main className="mx-auto w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-lg">
				<h1 className={`${titleFont.className} text-center text-4xl text-slate-900`}>Faltantes</h1>
				<AuthCard />
			</main>
		</div>
	);
}
