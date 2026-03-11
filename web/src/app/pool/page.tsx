"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabase";
import { getRandomLoadingMessage } from "@/lib/loading-messages";
import { gobrickColors } from "@/lib/gobrick-colors";
import { enforceSessionTtl } from "@/lib/session-ttl";
import { canAccessModule } from "@/lib/feature-flags";

const AUTO_MINIFIG_LIST_NAMES = [
	"Piezas Faltantes de Minifiguras",
	"Pares Faltantes de Minifcuras",
	"Faltantes Minifiguras",
];
const SALE_LIST_PREFIX = "venta:";
const MASTER_EMAIL = "martindasnoy@gmail.com";

type PoolLot = {
	id: string;
	list_id: string;
	list_name?: string | null;
	owner_id: string;
	part_num: string;
	part_name: string | null;
	color_name: string | null;
	quantity: number;
	total_offered: number;
	remaining_quantity: number;
	offers_count: number;
	my_pending_quantity: number;
	owner_name?: string | null;
};

type RpcPoolLot = PoolLot & {
	list_name: string | null;
	owner_name: string | null;
};

type PartImageLookup = Record<string, string | null>;
type PartImageRequestItem = { part_num: string; color_name?: string | null };
type PartSuggestion = { part_num: string; name: string; part_img_url: string | null };
type ToggleOfferRpcRow = {
	action: "created" | "updated" | "deleted";
	applied_quantity: number;
	total_offered: number;
	remaining_quantity: number;
	offers_count: number;
	my_pending_quantity: number;
};

export default function PoolPage() {
	const router = useRouter();
	const [loadingMessage, setLoadingMessage] = useState("Cargando...");
	const [loading, setLoading] = useState(true);
	const [message, setMessage] = useState<string | null>(null);
	const [publicLots, setPublicLots] = useState<PoolLot[]>([]);
	const [partImages, setPartImages] = useState<PartImageLookup>({});
	const [currentUserId, setCurrentUserId] = useState<string | null>(null);
	const [currentUserName, setCurrentUserName] = useState<string>("Usuario");
	const [isMasterUser, setIsMasterUser] = useState(false);
	const [currentLugLogoUrl, setCurrentLugLogoUrl] = useState("");
	const [offerQtyByLot, setOfferQtyByLot] = useState<Record<string, number>>({});
	const [sendingOfferLotId, setSendingOfferLotId] = useState<string | null>(null);
	const [sortBy, setSortBy] = useState<"pieza" | "usuario">("pieza");
	const [showPiecesLots, setShowPiecesLots] = useState(true);
	const [showMinifigurePartsLots, setShowMinifigurePartsLots] = useState(true);
	const [showOwnLots, setShowOwnLots] = useState(false);
	const [lotsPage, setLotsPage] = useState(1);
	const [editingLotId, setEditingLotId] = useState<string | null>(null);
	const [editingPartNumInput, setEditingPartNumInput] = useState("");
	const [editingPartNameInput, setEditingPartNameInput] = useState("");
	const [editingSearchInput, setEditingSearchInput] = useState("");
	const [editingSearchLoading, setEditingSearchLoading] = useState(false);
	const [editingSearchSuggestions, setEditingSearchSuggestions] = useState<PartSuggestion[]>([]);
	const [savingLotEditId, setSavingLotEditId] = useState<string | null>(null);
	const imageRequestInFlightRef = useRef<Set<string>>(new Set());

	function normalizePartCodeInput(raw: string) {
		return String(raw ?? "")
			.trim()
			.replace(/^#+\s*/, "")
			.toUpperCase();
	}

	function startEditLot(lot: PoolLot) {
		if (!isMasterUser) return;
		setEditingLotId(lot.id);
		setEditingPartNumInput(lot.part_num || "");
		setEditingPartNameInput(lot.part_name || "");
		setEditingSearchInput("");
		setEditingSearchSuggestions([]);
	}

	function cancelEditLot() {
		setEditingLotId(null);
		setEditingPartNumInput("");
		setEditingPartNameInput("");
		setEditingSearchInput("");
		setEditingSearchSuggestions([]);
	}

	function pickEditingSuggestion(part: PartSuggestion) {
		setEditingPartNumInput(part.part_num);
		setEditingPartNameInput(part.name);
		setEditingSearchInput(`${part.part_num} - ${part.name}`);
		setEditingSearchSuggestions([]);
	}

	function isMinifigurePartsListName(listName: string | null | undefined) {
		const normalized = String(listName ?? "").trim();
		return AUTO_MINIFIG_LIST_NAMES.includes(normalized);
	}

	function isSaleListName(listName: string | null | undefined) {
		const normalized = String(listName ?? "").trim().toLowerCase();
		return normalized.startsWith(SALE_LIST_PREFIX);
	}

	async function loadCurrentLugLogo(userId: string) {
		if (!userId) {
			setCurrentLugLogoUrl("");
			return;
		}

		try {
			const supabase = getSupabaseClient();
			const { data: memberships, error: membershipsError } = await supabase
				.from("lug_memberships")
				.select("lug_id,role,joined_at")
				.eq("user_id", userId)
				.order("joined_at", { ascending: true });

			if (membershipsError) {
				setCurrentLugLogoUrl("");
				return;
			}

			const rows = ((memberships as Array<{ lug_id: string; role: string }> | null) ?? []).filter((row) => row.lug_id);
			if (rows.length === 0) {
				setCurrentLugLogoUrl("");
				return;
			}

			const selected = rows.find((row) => row.role === "admin") ?? rows[0];
			const { data: lug, error: lugError } = await supabase.from("lugs").select("logo_url").eq("id", selected.lug_id).maybeSingle();
			if (lugError) {
				setCurrentLugLogoUrl("");
				return;
			}

			setCurrentLugLogoUrl(String((lug as Record<string, unknown> | null)?.logo_url ?? "").trim());
		} catch {
			setCurrentLugLogoUrl("");
		}
	}

	useEffect(() => {
		setLoadingMessage(getRandomLoadingMessage());

		async function loadPool() {
			try {
				const isSessionValid = await enforceSessionTtl();
				if (!isSessionValid) {
					router.replace("/");
					return;
				}

				const supabase = getSupabaseClient();
				const {
					data: { user },
				} = await supabase.auth.getUser();

				if (!user) {
					router.replace("/");
					return;
				}

				const canAccessPoolWanted = await canAccessModule(supabase, user.email, "poolWanted");
				if (!canAccessPoolWanted) {
					router.replace("/dashboard");
					return;
				}

			setCurrentUserId(user.id);
			const resolvedEmail = String(user.email ?? "").trim().toLowerCase();
			setIsMasterUser(resolvedEmail === MASTER_EMAIL);
			setCurrentUserName(
				(user.user_metadata?.display_name as string) ||
					(user.user_metadata?.full_name as string) ||
					(user.email?.split("@")[0] ?? "Usuario"),
			);
			await loadCurrentLugLogo(user.id);


				const { data: rpcData, error: rpcError } = await supabase.rpc("get_public_pool_lots");
				if (rpcError) {
					setMessage(`Pool no configurado: ${rpcError.message}. Ejecuta scripts segun web/supabase/README.md`);
					setPublicLots([]);
					return;
				}

				const lots = ((rpcData as RpcPoolLot[]) ?? []).map((lot) => ({
					id: lot.id,
					list_id: lot.list_id,
					list_name: lot.list_name,
					owner_id: lot.owner_id,
					part_num: lot.part_num,
					part_name: lot.part_name,
					color_name: lot.color_name,
					quantity: Number(lot.quantity ?? 0),
					total_offered: Number(lot.total_offered ?? 0),
					remaining_quantity: Number(lot.remaining_quantity ?? 0),
					offers_count: Number(lot.offers_count ?? 0),
					my_pending_quantity: Number(lot.my_pending_quantity ?? 0),
					owner_name: lot.owner_name,
				}));

				setPublicLots(lots);
				setOfferQtyByLot((current) => {
					const next = { ...current };
					for (const item of lots) {
						next[item.id] = item.my_pending_quantity > 0 ? item.my_pending_quantity : (next[item.id] ?? 1);
					}
					return next;
				});
			} catch (error) {
				const text = error instanceof Error ? error.message : "No se pudo abrir el pool.";
				setMessage(text);
			} finally {
				setLoading(false);
			}
		}

		void loadPool();

		const intervalId = window.setInterval(() => {
			void loadPool();
		}, 7000);

		return () => window.clearInterval(intervalId);
	}, [router]);

	async function sendOffer(lot: PoolLot, options?: { remove?: boolean }) {
		const supabase = getSupabaseClient();
		const {
			data: { user },
		} = await supabase.auth.getUser();

		if (!user) {
			setMessage("Debes iniciar sesion para ofrecer piezas.");
			return;
		}

		if (lot.owner_id === user.id) {
			setMessage("No puedes ofrecer en tu propio lote.");
			return;
		}

		if (lot.remaining_quantity <= 0 && lot.my_pending_quantity <= 0) {
			setMessage("Este lote ya esta completo.");
			return;
		}

		const maxOffer = Math.max(1, lot.remaining_quantity + lot.my_pending_quantity);
		const quantity = options?.remove ? 0 : Math.min(maxOffer, Math.max(1, Math.floor(offerQtyByLot[lot.id] ?? 1)));
		setSendingOfferLotId(lot.id);
		setMessage(null);

		try {
			const { data, error } = await supabase.rpc("toggle_offer_for_lot", {
				p_list_item_id: lot.id,
				p_quantity: quantity,
			});

			if (error) {
				setMessage(`No se pudo registrar tu oferta: ${error.message}. Ejecuta web/supabase/offers_toggle_rpc.sql`);
				return;
			}

			const row = ((data as ToggleOfferRpcRow[]) ?? [])[0];
			if (row) {
				setPublicLots((current) =>
					current.map((item) =>
						item.id === lot.id
							? {
									...item,
									total_offered: Number(row.total_offered ?? item.total_offered),
									remaining_quantity: Number(row.remaining_quantity ?? item.remaining_quantity),
									offers_count: Number(row.offers_count ?? item.offers_count),
									my_pending_quantity: Number(row.my_pending_quantity ?? item.my_pending_quantity),
							  }
							: item,
					),
				);
			}

			setMessage(
				row?.action === "deleted"
					? "Quitaste tu oferta en este lote."
					: row?.action === "updated"
					? "Actualizaste tu cantidad ofrecida."
					: "Oferta enviada. El dueno de la lista ya la ve en su lista.",
			);
			setOfferQtyByLot((current) => ({
				...current,
				[lot.id]: Number(row?.my_pending_quantity ?? 1) > 0 ? Number(row?.my_pending_quantity ?? 1) : 1,
			}));
		} finally {
			setSendingOfferLotId(null);
		}
	}

	async function saveLotEdit(lot: PoolLot) {
		if (!isMasterUser) return;

		const nextPartNum = normalizePartCodeInput(editingPartNumInput);
		const nextPartName = editingPartNameInput.trim();
		if (!nextPartNum || !nextPartName) {
			setMessage("Part num y nombre son obligatorios.");
			return;
		}

		setSavingLotEditId(lot.id);
		setMessage(null);
		try {
			const supabase = getSupabaseClient();
			let {
				data: { session },
			} = await supabase.auth.getSession();
			if (!session?.access_token) {
				const refreshed = await supabase.auth.refreshSession();
				session = refreshed.data.session;
			}
			if (!session?.access_token) {
				setMessage("Sesion invalida para editar.");
				return;
			}

			const response = await fetch("/api/system/master/list-items/update", {
				method: "POST",
				headers: {
					"content-type": "application/json",
					Authorization: `Bearer ${session.access_token}`,
				},
				body: JSON.stringify({
					list_id: lot.list_id,
					list_item_id: lot.id,
					part_num: nextPartNum,
					part_name: nextPartName,
				}),
			});
			let payload: { error?: string } = {};
			try {
				payload = (await response.json()) as { error?: string };
			} catch {
				payload = {};
			}
			if (!response.ok) {
				setMessage(payload.error ?? "No se pudo guardar cambios.");
				return;
			}

			setPublicLots((current) =>
				current.map((item) =>
					item.id === lot.id
						? {
								...item,
								part_num: nextPartNum,
								part_name: nextPartName,
							}
						: item,
				),
			);
			void loadPartImages([{ part_num: nextPartNum, color_name: lot.color_name }]);
			cancelEditLot();
			setMessage("Part num y nombre actualizados.");
		} catch (error) {
			setMessage(error instanceof Error ? error.message : "No se pudo guardar cambios.");
		} finally {
			setSavingLotEditId(null);
		}
	}

	useEffect(() => {
		if (!editingLotId) return;
		const query = editingSearchInput.trim();
		if (query.length < 2) {
			setEditingSearchSuggestions([]);
			setEditingSearchLoading(false);
			return;
		}

		const timer = window.setTimeout(async () => {
			setEditingSearchLoading(true);
			try {
				const response = await fetch(`/api/rebrickable/parts?q=${encodeURIComponent(query)}&offset=0&limit=15`);
				const payload = (await response.json()) as { results?: PartSuggestion[] };
				if (!response.ok) {
					setEditingSearchSuggestions([]);
					return;
				}
				setEditingSearchSuggestions(payload.results ?? []);
			} catch {
				setEditingSearchSuggestions([]);
			} finally {
				setEditingSearchLoading(false);
			}
		}, 350);

		return () => window.clearTimeout(timer);
	}, [editingLotId, editingSearchInput]);

	function getPartImageKey(partNum: string, colorName: string | null | undefined) {
		const normalizedColor = (colorName ?? "")
			.replace(/\(chino\)/gi, "")
			.toLowerCase()
			.replace(/\s+/g, " ")
			.trim();
		return `${partNum.trim()}::${normalizedColor}`;
	}

	function getBestPartImageUrl(partNum: string, colorName: string | null | undefined) {
		const byColor = partImages[getPartImageKey(partNum, colorName)];
		if (byColor) return byColor;
		return partImages[getPartImageKey(partNum, null)] ?? null;
	}

	async function loadPartImages(items: PartImageRequestItem[]) {
		const normalizedItems = items
			.map((item) => ({
				part_num: item.part_num.trim(),
				color_name: item.color_name ?? null,
			}))
			.filter((item) => item.part_num.length > 0);

		const expandedItems: Array<{ part_num: string; color_name: string | null }> = [];
		for (const item of normalizedItems) {
			expandedItems.push(item);
			expandedItems.push({ part_num: item.part_num, color_name: null });
		}

		if (expandedItems.length === 0) return;

		const uniqueByKey = new Map<string, PartImageRequestItem>();
		for (const item of expandedItems) {
			const key = getPartImageKey(item.part_num, item.color_name);
			if (!uniqueByKey.has(key)) {
				uniqueByKey.set(key, item);
			}
		}

		const missingItems = [...uniqueByKey.entries()]
			.filter(([key]) => !(key in partImages) && !imageRequestInFlightRef.current.has(key))
			.map(([, item]) => item);

		if (missingItems.length === 0) return;

		const chunkSize = 100;
		for (let index = 0; index < missingItems.length; index += chunkSize) {
			const chunk = missingItems.slice(index, index + chunkSize);
			const requestedKeys = chunk.map((item) => getPartImageKey(item.part_num, item.color_name));
			for (const key of requestedKeys) imageRequestInFlightRef.current.add(key);

			try {
				const response = await fetch("/api/rebrickable/part-images", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ items: chunk }),
				});
				if (!response.ok) {
					setPartImages((current) => {
						const next = { ...current };
						for (const key of requestedKeys) next[key] = null;
						return next;
					});
					continue;
				}

				const payload = (await response.json()) as {
					results?: Array<{ key: string; part_num: string; part_img_url: string | null }>;
				};

				const additions: PartImageLookup = {};
				for (const part of payload.results ?? []) {
					if (!part.key) continue;
					additions[part.key] = part.part_img_url;
				}

				for (const key of requestedKeys) {
					if (!(key in additions)) additions[key] = null;
				}

				setPartImages((current) => ({ ...current, ...additions }));
			} catch {
				setPartImages((current) => {
					const next = { ...current };
					for (const key of requestedKeys) next[key] = null;
					return next;
				});
			} finally {
				for (const key of requestedKeys) imageRequestInFlightRef.current.delete(key);
			}
		}
	}

	function getColorHexFromName(colorName: string | null) {
		if (!colorName) return "#d1d5db";
		const normalized = colorName.replace("(Chino)", "").trim().toLowerCase();
		const match = gobrickColors.find((color) => color.name.toLowerCase() === normalized || (color.blName ?? "").trim().toLowerCase() === normalized);
		return match?.hex ?? "#d1d5db";
	}

	function getTextColorForBackground(hex: string) {
		const normalized = hex.replace("#", "").trim();
		if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return "#111827";
		const r = Number.parseInt(normalized.slice(0, 2), 16);
		const g = Number.parseInt(normalized.slice(2, 4), 16);
		const b = Number.parseInt(normalized.slice(4, 6), 16);
		const brightness = (r * 299 + g * 587 + b * 114) / 1000;
		return brightness > 150 ? "#111827" : "#ffffff";
	}

	const filteredLots = useMemo<PoolLot[]>(() => {
		return publicLots.filter((lot) => {
			if (isSaleListName(lot.list_name)) return false;
			if (!showOwnLots && currentUserId && lot.owner_id === currentUserId) return false;
			const isMinifigLot = isMinifigurePartsListName(lot.list_name);
			if (isMinifigLot && !showMinifigurePartsLots) return false;
			if (!isMinifigLot && !showPiecesLots) return false;
			return true;
		});
	}, [publicLots, showPiecesLots, showMinifigurePartsLots, showOwnLots, currentUserId]);

	const lotCards = useMemo<PoolLot[]>(() => {
		return [...filteredLots]
			.sort((a, b) => {
				if (sortBy === "usuario") {
					const byOwner = (a.owner_name || "").localeCompare(b.owner_name || "", "es", { sensitivity: "base" });
					if (byOwner !== 0) return byOwner;
				}

				const aName = (a.part_name || a.part_num).toLowerCase();
				const bName = (b.part_name || b.part_num).toLowerCase();
				const byPart = aName.localeCompare(bName, "es", { sensitivity: "base" });
				if (byPart !== 0) return byPart;
				return a.part_num.localeCompare(b.part_num, "es", { sensitivity: "base" });
			});
	}, [filteredLots, sortBy]);

	const LOTS_PER_PAGE = 40;
	const totalLotsPages = Math.max(1, Math.ceil(lotCards.length / LOTS_PER_PAGE));
	const paginatedLotCards = useMemo(() => {
		const start = (lotsPage - 1) * LOTS_PER_PAGE;
		return lotCards.slice(start, start + LOTS_PER_PAGE);
	}, [lotCards, lotsPage]);

	useEffect(() => {
		if (lotsPage > totalLotsPages) {
			setLotsPage(totalLotsPages);
		}
	}, [lotsPage, totalLotsPages]);

	useEffect(() => {
		setLotsPage(1);
	}, [sortBy, showPiecesLots, showMinifigurePartsLots, showOwnLots]);

	useEffect(() => {
		void loadPartImages(
			paginatedLotCards.map((lot) => ({
				part_num: lot.part_num,
				color_name: lot.color_name,
			})),
		);
	}, [paginatedLotCards]);

	useEffect(() => {
		const visibleKeys = new Set(paginatedLotCards.map((lot) => getPartImageKey(lot.part_num, lot.color_name)));
		const deferredItems = lotCards
			.filter((lot) => !visibleKeys.has(getPartImageKey(lot.part_num, lot.color_name)))
			.map((lot) => ({ part_num: lot.part_num, color_name: lot.color_name }));

		if (deferredItems.length === 0) return;

		const timeoutId = window.setTimeout(() => {
			void loadPartImages(deferredItems);
		}, 250);

		return () => window.clearTimeout(timeoutId);
	}, [lotCards, paginatedLotCards]);

	if (loading) {
		return (
			<div className="bg-lego-tile font-chewy flex min-h-screen items-center justify-center px-6 text-center text-2xl text-white sm:text-3xl">
				{loadingMessage}
			</div>
		);
	}

	return (
		<div className="bg-lego-tile min-h-screen px-4 py-6 sm:px-6 sm:py-8">
			<main className="mx-auto flex w-full max-w-5xl flex-col gap-6 rounded-2xl bg-white p-4 shadow-xl sm:p-8">
				<header className="border-b border-slate-200 pb-5">
					<div className="flex flex-col gap-0 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
						<div>
							<div className="flex justify-start">
								<Link href="/dashboard" className="text-sm text-slate-600 hover:underline">
									← Volver
								</Link>
							</div>
							<div className="mt-0 flex items-start justify-between gap-2">
								<div>
									<h1 className="text-3xl font-semibold text-slate-900">
										<span className="sm:hidden">Pool de items deseados</span>
										<span className="hidden sm:inline">Pool de items deseados</span>
									</h1>
									<p className="mt-1 text-sm font-semibold text-slate-700">{currentUserName}</p>
								</div>
								{currentLugLogoUrl ? <img src={currentLugLogoUrl} alt="Logo LUG" className="h-16 w-auto max-w-[192px] shrink-0 object-contain sm:hidden" /> : null}
							</div>

							<div className="mt-1 flex items-center gap-2 sm:mt-0">
								<label htmlFor="pool-sort" className="text-sm text-slate-700">
									Ordenar por
								</label>
								<select
									id="pool-sort"
									value={sortBy}
									onChange={(event) => setSortBy(event.target.value as "pieza" | "usuario")}
									className="rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-900"
								>
									<option value="pieza">Pieza</option>
									<option value="usuario">Usuario</option>
								</select>
								<button
									type="button"
									onClick={() => setShowPiecesLots((current) => !current)}
									className={`rounded-md border px-2 py-1 text-xs font-semibold ${showPiecesLots ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 text-slate-700 hover:bg-slate-100"}`}
								>
									Piezas
								</button>
								<button
									type="button"
									onClick={() => setShowMinifigurePartsLots((current) => !current)}
									className={`rounded-md border px-2 py-1 text-xs font-semibold ${showMinifigurePartsLots ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 text-slate-700 hover:bg-slate-100"}`}
								>
									Partes Minifiguras
								</button>
								<label className="ml-1 inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700">
									<input type="checkbox" checked={showOwnLots} onChange={(event) => setShowOwnLots(event.target.checked)} />
									<span>Mostrar items propios</span>
								</label>
							</div>
						</div>
						{currentLugLogoUrl ? <img src={currentLugLogoUrl} alt="Logo LUG" className="hidden h-24 w-auto max-w-[440px] shrink-0 self-start object-contain sm:block sm:self-auto" /> : null}
					</div>
				</header>

				{lotCards.length === 0 ? (
					<section className="rounded-xl border border-slate-200 p-5 text-sm text-slate-600">
						{publicLots.length === 0
							? "No hay lotes publicos por ahora. Si ya hay listas publicas, revisa el orden SQL en `web/supabase/README.md`."
							: "No hay lotes con los filtros actuales. Activa Piezas y/o Partes Minifiguras."}
					</section>
				) : (
					<section className="space-y-2">
						<div className="mb-2 flex items-center justify-center gap-2 text-xs text-slate-600">
							<button
								type="button"
								onClick={() => setLotsPage((current) => Math.max(1, current - 1))}
								disabled={lotsPage <= 1}
								className="rounded-md border border-slate-300 px-2 py-1 disabled:opacity-40"
							>
								Anterior
							</button>
							<span>
								Pagina {lotsPage} de {totalLotsPages}
							</span>
							<button
								type="button"
								onClick={() => setLotsPage((current) => Math.min(totalLotsPages, current + 1))}
								disabled={lotsPage >= totalLotsPages}
								className="rounded-md border border-slate-300 px-2 py-1 disabled:opacity-40"
							>
								Siguiente
							</button>
						</div>
						{paginatedLotCards.map((lot) => (
							<article key={lot.id} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
								<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
									<div className="flex items-start gap-3 sm:min-w-0 sm:flex-1">
										{getBestPartImageUrl(lot.part_num, lot.color_name) ? (
											<img
												src={getBestPartImageUrl(lot.part_num, lot.color_name) ?? undefined}
												alt={lot.part_name || lot.part_num}
												loading="lazy"
												decoding="async"
												className="h-16 w-16 rounded border border-slate-200 bg-white object-contain"
											/>
										) : (
											<div className="flex h-16 w-16 flex-col items-center justify-center rounded border border-slate-200 bg-slate-100 text-[9px] text-slate-500">
												<span className="leading-none">IMG</span>
											<span className="leading-none">Imagen sin cache</span>
											</div>
										)}

										<div className="min-w-0 flex-1">
											<p className="text-sm font-medium text-slate-900">
												<span className="block overflow-hidden [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:3] sm:[-webkit-line-clamp:2]">
													{lot.part_name || "Sin nombre"}
												</span>
											</p>
											<div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-700 sm:hidden">
												<span
													className="inline-flex w-20 items-center rounded-md border border-slate-300 px-2 py-1 text-[11px] font-semibold"
													style={{
														backgroundColor: getColorHexFromName(lot.color_name),
														color: getTextColorForBackground(getColorHexFromName(lot.color_name)),
													}}
												>
													<span className="block w-full truncate text-left">{lot.color_name || "Sin color"}</span>
												</span>
												<p>x{lot.quantity}</p>
												<p className="font-chewy text-base text-slate-600">{lot.owner_name || "Desconocido"}</p>
											</div>
										<div className="mt-1 hidden flex-wrap gap-x-3 gap-y-1 text-sm text-slate-700 sm:flex">
												<span
													className="inline-flex w-20 items-center rounded-md border border-slate-300 px-2 py-1 text-[11px] font-semibold"
													style={{
														backgroundColor: getColorHexFromName(lot.color_name),
														color: getTextColorForBackground(getColorHexFromName(lot.color_name)),
													}}
												>
													<span className="block w-full truncate text-left">{lot.color_name || "Sin color"}</span>
												</span>
												<p>x{lot.quantity}</p>
												<p className="font-chewy text-base text-slate-600">{lot.owner_name || "Desconocido"}</p>
											</div>
											{isMasterUser ? (
												<button
													type="button"
													onClick={() => startEditLot(lot)}
													className="mt-2 rounded-md border border-amber-500 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-100"
												>
													Editar cod/nombre
												</button>
											) : null}
											{isMasterUser && editingLotId === lot.id ? (
												<div className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2">
													<div className="relative mb-2">
														<input
															type="text"
															value={editingSearchInput}
															onChange={(event) => setEditingSearchInput(event.target.value)}
															placeholder="Buscar pieza para reemplazar"
															className="w-full rounded border border-amber-300 bg-white px-2 py-1 text-xs text-slate-900"
														/>
														{editingSearchLoading ? <p className="mt-1 text-[11px] text-slate-500">Buscando...</p> : null}
														{editingSearchSuggestions.length > 0 ? (
															<ul className="absolute z-20 mt-1 max-h-52 w-full overflow-auto rounded border border-amber-200 bg-white text-xs shadow">
																{editingSearchSuggestions.map((part) => (
																	<li key={part.part_num}>
																		<button
																			type="button"
																			onClick={() => pickEditingSuggestion(part)}
																			className="w-full px-2 py-1 text-left hover:bg-amber-50"
																		>
																			<span className="font-semibold text-slate-800">{part.part_num}</span>
																			<span className="ml-1 text-slate-600">{part.name}</span>
																		</button>
																	</li>
																))}
															</ul>
														) : null}
													</div>
													<div className="grid gap-2 sm:grid-cols-2">
														<input
															type="text"
															value={editingPartNumInput}
															onChange={(event) => setEditingPartNumInput(event.target.value)}
															placeholder="part_num"
															className="w-full rounded border border-amber-300 bg-white px-2 py-1 text-xs text-slate-900"
														/>
														<input
															type="text"
															value={editingPartNameInput}
															onChange={(event) => setEditingPartNameInput(event.target.value)}
															placeholder="part_name"
															className="w-full rounded border border-amber-300 bg-white px-2 py-1 text-xs text-slate-900"
														/>
													</div>
													<div className="mt-2 flex justify-end gap-2">
														<button
															type="button"
															onClick={cancelEditLot}
															className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
														>
															Cancelar
														</button>
														<button
															type="button"
															onClick={() => void saveLotEdit(lot)}
															disabled={savingLotEditId === lot.id}
															className="rounded border border-amber-700 bg-amber-700 px-2 py-1 text-xs font-semibold text-white hover:bg-amber-800 disabled:opacity-50"
														>
															{savingLotEditId === lot.id ? "Guardando..." : "Guardar"}
														</button>
													</div>
												</div>
											) : null}
										</div>
									</div>

									<div className="mt-1 flex w-full items-center justify-end gap-2 sm:ml-3 sm:mt-0 sm:w-auto">
										<div className="flex items-center gap-2">
											{(() => {
												const isOwner = lot.owner_id === currentUserId;
												const isComplete = lot.remaining_quantity <= 0;
												const hasMyPending = lot.my_pending_quantity > 0;
												const disableControls = sendingOfferLotId === lot.id || isOwner || (isComplete && !hasMyPending);
												const maxOffer = Math.max(1, lot.remaining_quantity + lot.my_pending_quantity);
												const buttonLabel = isOwner ? "Tu lote" : hasMyPending ? "Actualizar" : isComplete ? "Completo" : "Yo tengo";

												return (
													<>
											<input
												type="number"
												min={1}
												max={maxOffer}
												value={offerQtyByLot[lot.id] ?? 1}
												onChange={(event) =>
													setOfferQtyByLot((current) => ({
														...current,
														[lot.id]: Math.min(maxOffer, Math.max(1, Number(event.target.value) || 1)),
													}))
												}
												disabled={disableControls}
												className="quantity-input w-16 rounded border border-slate-300 px-2 py-1 text-center text-sm text-slate-900"
											/>
											<button
												type="button"
												onClick={() => void sendOffer(lot)}
												disabled={disableControls}
												className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-60"
											>
												{buttonLabel}
											</button>
											{hasMyPending ? (
												<button
													type="button"
													onClick={() => void sendOffer(lot, { remove: true })}
													disabled={sendingOfferLotId === lot.id || isOwner}
													className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
												>
													Quitar
												</button>
											) : null}
													</>
												);
											})()}
										</div>
									</div>
								</div>
							</article>
						))}
						<div className="mt-2 flex items-center justify-center gap-2 text-xs text-slate-600">
							<button
								type="button"
								onClick={() => setLotsPage((current) => Math.max(1, current - 1))}
								disabled={lotsPage <= 1}
								className="rounded-md border border-slate-300 px-2 py-1 disabled:opacity-40"
							>
								Anterior
							</button>
							<span>
								Pagina {lotsPage} de {totalLotsPages}
							</span>
							<button
								type="button"
								onClick={() => setLotsPage((current) => Math.min(totalLotsPages, current + 1))}
								disabled={lotsPage >= totalLotsPages}
								className="rounded-md border border-slate-300 px-2 py-1 disabled:opacity-40"
							>
								Siguiente
							</button>
						</div>
					</section>
				)}

				{message ? <p className="text-sm text-slate-700">{message}</p> : null}
			</main>
		</div>
	);
}
