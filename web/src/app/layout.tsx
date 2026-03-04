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
	title: "LEGO Piezas Faltantes",
	description: "Gestiona deseos, ventas y matches de piezas LEGO.",
	openGraph: {
		title: "LEGO Piezas Faltantes",
		description: "Gestiona deseos, ventas y matches de piezas LEGO.",
		url: siteUrl,
		type: "website",
		locale: "es_AR",
		siteName: "LEGO Piezas Faltantes",
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
		title: "LEGO Piezas Faltantes",
		description: "Gestiona deseos, ventas y matches de piezas LEGO.",
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
			<body className={`${geistSans.variable} ${geistMono.variable} ${chewy.variable} antialiased`}>{children}</body>
		</html>
	);
}
