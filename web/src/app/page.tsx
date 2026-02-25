import { AuthCard } from "@/components/auth-card";
import Image from "next/image";

export default function Home() {
	return (
		<div className="min-h-screen bg-[#006eb2] px-6 py-12">
			<main className="mx-auto w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-lg">
				<div className="flex justify-center">
					<Image src="/pool-logo.svg" alt="Logo" width={220} height={60} priority />
				</div>
				<AuthCard />
			</main>
		</div>
	);
}
