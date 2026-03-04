"use client";

import { AuthCard } from "@/components/auth-card";
import Image from "next/image";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { enforceSessionTtl } from "@/lib/session-ttl";

export default function Home() {
	const router = useRouter();
	const [checkingSession, setCheckingSession] = useState(true);

	useEffect(() => {
		let cancelled = false;

		async function validateSession() {
			const isValid = await enforceSessionTtl();
			if (cancelled) return;

			if (isValid) {
				router.replace("/dashboard");
				return;
			}

			setCheckingSession(false);
		}

		void validateSession();

		return () => {
			cancelled = true;
		};
	}, [router]);

	if (checkingSession) {
		return <div className="min-h-screen bg-[#006eb2]" />;
	}

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
