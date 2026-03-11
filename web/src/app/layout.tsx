import type { Metadata } from "next";
import { Chewy, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
	variable: "--font-geist-sans",
	subsets: ["latin"],
});

const geistMono = Geist_Mono({
	variable: "--font-geist-mono",
	subsets: ["latin"],
});

const chewy = Chewy({
	variable: "--font-chewy",
	weight: "400",
	subsets: ["latin"],
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://lego-piezas-faltantes.martindasnoy.workers.dev";
const shareImagePath = "/share-cover.jpg?v=3";

export const metadata: Metadata = {
	metadataBase: new URL(siteUrl),
	title: "BALUG App 1.0",
	description: "una App para que la comunidad de Lego crezca. Gestiona tus listas de deseos, Minifiguras y muchas cosas mas",
	openGraph: {
		title: "BALUG App 1.0",
		description: "una App para que la comunidad de Lego crezca. Gestiona tus listas de deseos, Minifiguras y muchas cosas mas",
		url: siteUrl,
		type: "website",
		locale: "es_AR",
		siteName: "by Martin Dasnoy",
		images: [
			{
				url: shareImagePath,
				width: 1200,
				height: 630,
				alt: "LEGO Piezas Faltantes",
			},
		],
	},
	twitter: {
		card: "summary_large_image",
		title: "BALUG App 1.0",
		description: "una App para que la comunidad de Lego crezca. Gestiona tus listas de deseos, Minifiguras y muchas cosas mas",
		images: [shareImagePath],
	},
};

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html lang="en">
			<head>
				<link rel="icon" href="/favicon.svg" type="image/svg+xml"></link>
			</head>
			<body className={`${geistSans.variable} ${geistMono.variable} ${chewy.variable} flex min-h-screen flex-col antialiased`}>
				<div className="flex-1">{children}</div>
				<footer className="bg-lego-tile flex justify-center px-3 py-2">
					<p className="text-[11px] font-semibold tracking-wide text-white/95 drop-shadow-[0_1px_2px_rgba(0,0,0,0.7)]">By Martin Dasnoy</p>
				</footer>
			</body>
		</html>
	);
}
