"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import Lottie from "lottie-react";
import { getSupabaseClient } from "@/lib/supabase";
import { gobrickColors, type GobrickColor } from "@/lib/gobrick-colors";
import { getRandomLoadingMessage } from "@/lib/loading-messages";
import { categoryMatchesFilter, type CatalogFilter } from "@/lib/rebrickable-category-flags";
import { enforceSessionTtl } from "@/lib/session-ttl";
import { canAccessModule } from "@/lib/feature-flags";
import matchIconAnimation from "@/lib/match-icon.json";

const AUTO_MINIFIG_LIST_NAME = "Piezas Faltantes de Minifiguras";
const LEGACY_AUTO_MINIFIG_LIST_NAMES = ["Pares Faltantes de Minifcuras", "Faltantes Minifiguras"];
const SALE_LIST_PREFIX = "venta:";

type ListInfo = {
	id: string;
	name: string;
	is_public: boolean;
};

type Lot = {
	id: string;
	part_name: string | null;
	part_num: string;
	color_name: string | null;
	quantity: number;
	value: number | null;
};

type PartSuggestion = {
	part_num: string;
	name: string;
	part_img_url: string | null;
};

type PartImageLookup = Record<string, string | null>;
type PartImageRequestItem = { part_num: string; color_name?: string | null };
type OfferSummaryByLot = Record<
	string,
	{ offers: number; pieces: number; byUser: Array<{ name: string; pieces: number }> }
>;

type OfferRpcRow = {
	list_item_id: string;
	offered_by_name: string | null;
	quantity: number;
	status: string;
};

type MatchSummaryByLot = Record<
	string,
	{
		matches: number;
		pieces: number;
		byUser: Array<{
			matchListItemId: string;
			name: string;
			pieces: number;
			value: number | null;
			myReservedQuantity: number;
			totalReservedQuantity: number;
			reservableQuantity: number;
		}>;
	}
>;

type MatchRpcRow = {
	list_item_id: string;
	matched_list_item_id: string;
	matched_owner_name: string | null;
	matched_quantity: number;
	matched_value: number | null;
	my_reserved_quantity: number;
	total_reserved_quantity: number;
	reservable_quantity: number;
};

type CatalogCategory = {
	id: number;
	name: string;
	part_count: number;
};

type CatalogPart = {
	part_num: string;
	name: string;
	part_img_url: string | null;
	is_printed: boolean;
};

type RegisteredUserLookupRow = {
	user_id: string;
	display_name: string;
	email: string;
};

export default function ListDetailPage() {
	const params = useParams<{ id: string }>();
	const router = useRouter();
	const [loadingMessage, setLoadingMessage] = useState("Cargando...");
	const listId = params.id;

	const [list, setList] = useState<ListInfo | null>(null);
	const [lots, setLots] = useState<Lot[]>([]);
	const [partInput, setPartInput] = useState("");
	const [selectedPart, setSelectedPart] = useState<PartSuggestion | null>(null);
	const [suggestions, setSuggestions] = useState<PartSuggestion[]>([]);
	const [partImages, setPartImages] = useState<PartImageLookup>({});
	const [loadingSuggestions, setLoadingSuggestions] = useState(false);
	const [colorInput, setColorInput] = useState("");
	const [availableColors, setAvailableColors] = useState<GobrickColor[]>(gobrickColors);
	const [selectedColor, setSelectedColor] = useState<GobrickColor | null>(null);
	const [showColorSuggestions, setShowColorSuggestions] = useState(false);
	const [useBricklinkNomenclature, setUseBricklinkNomenclature] = useState(true);
	const [quantityInput, setQuantityInput] = useState(1);
	const [valueInput, setValueInput] = useState("");
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [updatingLotId, setUpdatingLotId] = useState<string | null>(null);
	const [updatingLotValueId, setUpdatingLotValueId] = useState<string | null>(null);
	const [updatingLotColorId, setUpdatingLotColorId] = useState<string | null>(null);
	const [colorPickerLotId, setColorPickerLotId] = useState<string | null>(null);
	const [colorPickerSearch, setColorPickerSearch] = useState("");
	const [deletingLotId, setDeletingLotId] = useState<string | null>(null);
	const [offersByLot, setOffersByLot] = useState<OfferSummaryByLot>({});
	const [matchesByLot, setMatchesByLot] = useState<MatchSummaryByLot>({});
	const [offerDetailsLotId, setOfferDetailsLotId] = useState<string | null>(null);
	const [matchDetailsLotId, setMatchDetailsLotId] = useState<string | null>(null);
	const [reserveQtyByMatchedLot, setReserveQtyByMatchedLot] = useState<Record<string, number>>({});
	const [reservingMatchLotId, setReservingMatchLotId] = useState<string | null>(null);
	const [message, setMessage] = useState<string | null>(null);
	const [currentUserName, setCurrentUserName] = useState("");
	const [currentUserEmail, setCurrentUserEmail] = useState("");
	const [showCatalogModal, setShowCatalogModal] = useState(false);
	const [showImportExportModal, setShowImportExportModal] = useState(false);
	const [importExportMode, setImportExportMode] = useState<"import" | "export">("export");
	const [importSource, setImportSource] = useState("");
	const [importRawInput, setImportRawInput] = useState("");
	const [importExportBusy, setImportExportBusy] = useState(false);
	const [catalogLoading, setCatalogLoading] = useState(false);
	const [catalogError, setCatalogError] = useState<string | null>(null);
	const [catalogCategories, setCatalogCategories] = useState<CatalogCategory[]>([]);
	const [catalogFilter, setCatalogFilter] = useState<CatalogFilter>("popular");
	const [catalogView, setCatalogView] = useState<"categories" | "parts">("categories");
	const [catalogSelectedCategory, setCatalogSelectedCategory] = useState<CatalogCategory | null>(null);
	const [catalogParts, setCatalogParts] = useState<CatalogPart[]>([]);
	const [selectedCatalogPart, setSelectedCatalogPart] = useState<CatalogPart | null>(null);
	const [catalogPartsPage, setCatalogPartsPage] = useState(1);
	const [catalogPartsTotalPages, setCatalogPartsTotalPages] = useState(1);
	const [catalogPageInput, setCatalogPageInput] = useState("1");
	const [catalogShowPrinted, setCatalogShowPrinted] = useState(false);
	const [catalogShowNonPrinted, setCatalogShowNonPrinted] = useState(true);
	const [catalogPartsLoading, setCatalogPartsLoading] = useState(false);
	const [catalogPartsError, setCatalogPartsError] = useState<string | null>(null);
	const colorDropdownRef = useRef<HTMLDivElement | null>(null);
	const imageRequestInFlightRef = useRef<Set<string>>(new Set());
	const importExportSites = [
		"Lego PAB (pick a brick)",
		"Bricklink",
		"Rebricable",
		"Brickset",
		"X1",
		"X2",
		"X3",
	] as const;

	const totals = useMemo(() => {
		return lots.reduce(
			(acc, lot) => {
				acc.pieces += Number(lot.quantity ?? 0);
				acc.lots += 1;
				return acc;
			},
			{ pieces: 0, lots: 0 },
		);
	}, [lots]);

	const filteredColors = useMemo(() => {
		const query = colorInput.trim().toLowerCase();
		const visibleName = (color: GobrickColor) => {
			if (useBricklinkNomenclature) {
				return color.blName?.trim() || color.name;
			}
			return color.name;
		};

		if (!query) return availableColors;

		return availableColors
			.filter((color) => {
				const legoName = color.name.toLowerCase();
				const blName = (color.blName ?? "").toLowerCase();
				return (
					visibleName(color).toLowerCase().includes(query) ||
					legoName.includes(query) ||
					blName.includes(query) ||
					String(color.id).includes(query)
				);
			})
			;
	}, [availableColors, colorInput, useBricklinkNomenclature]);

	const activeColorPickerLot = useMemo(() => {
		if (!colorPickerLotId) return null;
		return lots.find((lot) => lot.id === colorPickerLotId) ?? null;
	}, [colorPickerLotId, lots]);

	const filteredLotColorOptions = useMemo(() => {
		const query = colorPickerSearch.trim().toLowerCase();
		if (!query) return availableColors;

		return availableColors.filter((color) => {
			const storedName = getStoredColorName(color).toLowerCase();
			const legoName = color.name.toLowerCase();
			const blName = (color.blName ?? "").trim().toLowerCase();
			return storedName.includes(query) || legoName.includes(query) || blName.includes(query);
		});
	}, [availableColors, colorPickerSearch]);

	const activeOfferDetailsLot = useMemo(() => {
		if (!offerDetailsLotId) return null;
		return lots.find((lot) => lot.id === offerDetailsLotId) ?? null;
	}, [offerDetailsLotId, lots]);

	const activeOfferDetailsSummary = useMemo(() => {
		if (!offerDetailsLotId) return null;
		return offersByLot[offerDetailsLotId] ?? null;
	}, [offerDetailsLotId, offersByLot]);

	const activeMatchDetailsLot = useMemo(() => {
		if (!matchDetailsLotId) return null;
		return lots.find((lot) => lot.id === matchDetailsLotId) ?? null;
	}, [matchDetailsLotId, lots]);

	const activeMatchDetailsSummary = useMemo(() => {
		if (!matchDetailsLotId) return null;
		return matchesByLot[matchDetailsLotId] ?? null;
	}, [matchDetailsLotId, matchesByLot]);

	useEffect(() => {
		if (!activeMatchDetailsSummary) return;
		setReserveQtyByMatchedLot((current) => {
			const next = { ...current };
			for (const row of activeMatchDetailsSummary.byUser) {
				if (!row.matchListItemId) continue;
				if (next[row.matchListItemId] == null) {
					next[row.matchListItemId] = row.myReservedQuantity > 0 ? row.myReservedQuantity : row.reservableQuantity;
				}
			}
			return next;
		});
	}, [activeMatchDetailsSummary]);

	function normalizePartCodeInput(raw: string) {
		const trimmed = raw.trim();
		if (!trimmed) return "";
		const firstToken = trimmed.split(" - ")[0]?.trim() ?? "";
		return firstToken.replace(/^#+\s*/, "").trim().toUpperCase();
	}

	function isSaleListName(listName: string | null | undefined) {
		return String(listName ?? "").trim().toLowerCase().startsWith(SALE_LIST_PREFIX);
	}

	function getDisplayListName(listName: string | null | undefined) {
		const raw = String(listName ?? "");
		if (!isSaleListName(raw)) return raw;
		return raw.replace(/^venta:\s*/i, "").trim();
	}

	function parseValueInput(raw: string) {
		const normalized = raw.trim().replace(/,/g, ".");
		if (!normalized) return null;
		const parsed = Number(normalized);
		if (!Number.isFinite(parsed) || parsed < 0) return null;
		return Math.round(parsed);
	}

	const filteredCatalogCategories = useMemo(() => {
		const byName = (a: CatalogCategory, b: CatalogCategory) =>
			a.name.localeCompare(b.name, "en", { sensitivity: "base" });

		if (catalogFilter === "all") return [...catalogCategories].sort(byName);

		if (catalogFilter === "popular") {
			return catalogCategories.filter((category) => categoryMatchesFilter(category.id, "popular")).sort(byName);
		}

		return catalogCategories
			.filter((category) => categoryMatchesFilter(category.id, catalogFilter))
			.sort(byName);
	}, [catalogCategories, catalogFilter]);

	const filteredCatalogParts = useMemo(() => {
		return catalogParts.filter((part) => {
			if (part.is_printed && !catalogShowPrinted) return false;
			if (!part.is_printed && !catalogShowNonPrinted) return false;
			return true;
		});
	}, [catalogParts, catalogShowPrinted, catalogShowNonPrinted]);

	useEffect(() => {
		if (!selectedCatalogPart) return;
		const stillVisible = filteredCatalogParts.some((part) => part.part_num === selectedCatalogPart.part_num);
		if (!stillVisible) {
			setSelectedCatalogPart(null);
		}
	}, [filteredCatalogParts, selectedCatalogPart]);

	useEffect(() => {
		if (selectedPart) {
			setSuggestions([]);
			setLoadingSuggestions(false);
			return;
		}

		const query = partInput.trim().replace(/^#+\s*/, "");
		if (query.length < 2) {
			setSuggestions([]);
			setLoadingSuggestions(false);
			return;
		}

		const timer = setTimeout(async () => {
			setLoadingSuggestions(true);
			try {
				const response = await fetch(`/api/rebrickable/parts?q=${encodeURIComponent(query)}`);
				const payload = (await response.json()) as {
					results?: PartSuggestion[];
					error?: string;
				};

				if (!response.ok) {
					setSuggestions([]);
					setMessage(payload.error ?? "No se pudo buscar en Rebrickable.");
					return;
				}

				setSuggestions(payload.results ?? []);
			} catch {
				setSuggestions([]);
			} finally {
				setLoadingSuggestions(false);
			}
		}, 650);

		return () => clearTimeout(timer);
	}, [partInput, selectedPart]);

	useEffect(() => {
		setLoadingMessage(getRandomLoadingMessage());

		async function loadDetail() {
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

				const possibleNameValues = [
					user.user_metadata?.display_name,
					user.user_metadata?.displayName,
					user.user_metadata?.username,
					user.user_metadata?.user_name,
					user.user_metadata?.preferred_username,
					user.user_metadata?.nick_name,
					user.user_metadata?.full_name,
					user.user_metadata?.name,
				];
				const metadataName = possibleNameValues.find((value) => typeof value === "string" && value.trim().length > 0);
				let resolvedUserName = typeof metadataName === "string" ? metadataName.trim() : "";

				if (!resolvedUserName) {
					const { data: registeredUsers } = await supabase.rpc("get_registered_users_master");
					const rows = (registeredUsers as RegisteredUserLookupRow[] | null) ?? [];
					const byId = rows.find((row) => String(row.user_id) === String(user.id));
					const byEmail = rows.find((row) => String(row.email).trim().toLowerCase() === String(user.email ?? "").trim().toLowerCase());
					const row = byId ?? byEmail;
					if (row?.display_name?.trim()) {
						resolvedUserName = row.display_name.trim();
					}
				}

				setCurrentUserName(resolvedUserName);
				setCurrentUserEmail((user.email ?? "").trim());

				const { data: listData, error: listError } = await supabase
					.from("lists")
					.select("id,name,is_public")
					.eq("id", listId)
					.eq("owner_id", user.id)
					.single();

				if (listError || !listData) {
					setMessage("No se pudo abrir esta lista.");
					setLoading(false);
					return;
				}

				const listNameNormalized = String((listData as ListInfo).name ?? "").trim();
				const isSaleTargetList = listNameNormalized.toLowerCase().startsWith(SALE_LIST_PREFIX);
				const isAutoMinifigTargetList = [AUTO_MINIFIG_LIST_NAME, ...LEGACY_AUTO_MINIFIG_LIST_NAMES].includes(listNameNormalized);

				if (isSaleTargetList) {
					const canAccessPoolSale = await canAccessModule(supabase, user.email, "poolSale");
					if (!canAccessPoolSale) {
						router.replace("/dashboard");
						return;
					}
				}

				if (isAutoMinifigTargetList) {
					const canAccessMinifiguras = await canAccessModule(supabase, user.email, "minifiguras");
					if (!canAccessMinifiguras) {
						router.replace("/dashboard");
						return;
					}
				}

				setList(listData as ListInfo);

				let lotRows: Array<Partial<Lot>> | null = null;
				let lotError: { message?: string } | null = null;

				const withValue = await supabase
					.from("list_items")
					.select("id,part_name,part_num,color_name,quantity,value")
					.eq("list_id", listId)
					.order("created_at", { ascending: false });

				lotRows = (withValue.data as Array<Partial<Lot>> | null) ?? null;
				lotError = withValue.error;

				if (lotError && /value/i.test(lotError.message ?? "")) {
					const fallback = await supabase
						.from("list_items")
						.select("id,part_name,part_num,color_name,quantity")
						.eq("list_id", listId)
						.order("created_at", { ascending: false });
					lotRows = (fallback.data as Array<Partial<Lot>> | null) ?? null;
					lotError = fallback.error;
				}

				if (lotError) {
					setMessage("No se pudieron cargar los lotes de esta lista.");
				} else {
					const loadedLots = ((lotRows as Array<Partial<Lot>>) ?? []).map((lot) => ({
						id: String(lot.id ?? ""),
						part_name: typeof lot.part_name === "string" ? lot.part_name : null,
						part_num: String(lot.part_num ?? ""),
						color_name: typeof lot.color_name === "string" ? lot.color_name : null,
						quantity: Number(lot.quantity ?? 0),
						value: typeof lot.value === "number" ? lot.value : null,
					}));
					setLots(loadedLots);
					void loadPartImages(
						loadedLots.map((lot) => ({
							part_num: lot.part_num,
							color_name: lot.color_name,
						})),
					);
					void loadOffersForLots(loadedLots.map((lot) => String(lot.id)));
					void loadMatchesForLots(loadedLots.map((lot) => String(lot.id)));
				}
			} catch (error) {
				const text = error instanceof Error ? error.message : "No se pudo abrir la lista.";
				setMessage(text);
			} finally {
				setLoading(false);
			}
		}

		void loadDetail();
	}, [listId, router]);

	useEffect(() => {
		async function loadColors() {
			try {
				const supabase = getSupabaseClient();
				const { data, error } = await supabase
					.from("gobrick_colors")
					.select("id,name,bl_name,lego_available,hex")
					.order("id", { ascending: true });

				if (error || !data || data.length === 0) {
					return;
				}

				function normalizeHex(value: unknown) {
					if (typeof value !== "string") return "#d1d5db";
					const raw = value.trim().replace(/^#/, "");
					if (/^[0-9a-fA-F]{3}$/.test(raw)) {
						return `#${raw
							.split("")
							.map((char) => `${char}${char}`)
							.join("")
							.toLowerCase()}`;
					}
					if (/^[0-9a-fA-F]{6}$/.test(raw)) return `#${raw.toLowerCase()}`;
					if (/^[0-9a-fA-F]{8}$/.test(raw)) return `#${raw.slice(0, 6).toLowerCase()}`;
					return "#d1d5db";
				}

				const mapped: GobrickColor[] = data
					.map((row) => ({
						id: Number(row.id),
						name: String(row.name),
						blName: typeof row.bl_name === "string" ? row.bl_name : "",
						hex: normalizeHex(row.hex),
						uniqueFlag: !Boolean(row.lego_available) || !String(row.bl_name ?? "").trim(),
					}))
					.filter((row) => Number.isFinite(row.id) && row.name.length > 0);

				if (mapped.length > 0) {
					setAvailableColors(mapped);
				}
			} catch {
				// Si no existe la tabla aun, se usa fallback local.
			}
		}

		void loadColors();
	}, []);

	useEffect(() => {
		function handleOutsideClick(event: MouseEvent) {
			if (!showColorSuggestions) return;
			if (!colorDropdownRef.current) return;

			const target = event.target as Node;
			if (!colorDropdownRef.current.contains(target)) {
				setShowColorSuggestions(false);
			}
		}

		document.addEventListener("mousedown", handleOutsideClick);
		return () => document.removeEventListener("mousedown", handleOutsideClick);
	}, [showColorSuggestions]);

	function getPartImageKey(partNum: string, colorName: string | null | undefined) {
		const normalizedColor = (colorName ?? "")
			.replace(/\(chino\)/gi, "")
			.toLowerCase()
			.replace(/\s+/g, " ")
			.trim();
		return `${partNum.trim()}::${normalizedColor}`;
	}

	async function loadPartImages(items: PartImageRequestItem[]) {
		const normalizedItems = items
			.map((item) => ({
				part_num: item.part_num.trim(),
				color_name: item.color_name ?? null,
			}))
			.filter((item) => item.part_num.length > 0);

		if (normalizedItems.length === 0) return;

		const uniqueByKey = new Map<string, PartImageRequestItem>();
		for (const item of normalizedItems) {
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
			for (const key of requestedKeys) {
				imageRequestInFlightRef.current.add(key);
			}

			try {
				const response = await fetch("/api/rebrickable/part-images", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ items: chunk }),
				});

				if (!response.ok) {
					setPartImages((current) => {
						const next = { ...current };
						for (const key of requestedKeys) {
							next[key] = null;
						}
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
					if (!(key in additions)) {
						additions[key] = null;
					}
				}

				setPartImages((current) => ({ ...current, ...additions }));
			} catch {
				setPartImages((current) => {
					const next = { ...current };
					for (const key of requestedKeys) {
						next[key] = null;
					}
					return next;
				});
			} finally {
				for (const key of requestedKeys) {
					imageRequestInFlightRef.current.delete(key);
				}
			}
		}
	}

	async function loadOffersForLots(lotIds: string[]) {
		if (lotIds.length === 0) {
			setOffersByLot({});
			return;
		}

		try {
			const supabase = getSupabaseClient();
			const { data, error } = await supabase.rpc("get_offers_for_owner_list", {
				p_list_id: String(listId),
			});

			if (error) {
				setOffersByLot({});
				return;
			}

			const summary: OfferSummaryByLot = {};
			for (const row of (data as OfferRpcRow[]) ?? []) {
				if (!(row.status === "pending" || row.status === "accepted")) continue;
				if (!lotIds.includes(String(row.list_item_id))) continue;

				const key = String(row.list_item_id);
				const current = summary[key] ?? { offers: 0, pieces: 0, byUser: [] };
				const userName = row.offered_by_name?.trim() || "Usuario";
				const existing = current.byUser.find((u) => u.name === userName);
				if (existing) {
					existing.pieces += Number(row.quantity ?? 0);
				} else {
					current.byUser.push({ name: userName, pieces: Number(row.quantity ?? 0) });
				}

				summary[key] = {
					offers: current.offers + 1,
					pieces: current.pieces + Number(row.quantity ?? 0),
					byUser: current.byUser,
				};
			}

			setOffersByLot(summary);
		} catch {
			setOffersByLot({});
		}
	}

	async function loadMatchesForLots(lotIds: string[]) {
		if (lotIds.length === 0) {
			setMatchesByLot({});
			return;
		}

		try {
			const supabase = getSupabaseClient();
			const { data, error } = await supabase.rpc("get_matches_for_owner_list", {
				p_list_id: String(listId),
			});

			if (error) {
				console.error("get_matches_for_owner_list error", error);
				setMatchesByLot({});
				return;
			}

			const summary: MatchSummaryByLot = {};
			for (const row of (data as MatchRpcRow[]) ?? []) {
				const key = String(row.list_item_id);
				if (!lotIds.includes(key)) continue;

				const current = summary[key] ?? { matches: 0, pieces: 0, byUser: [] };
				const userName = row.matched_owner_name?.trim() || "Usuario";
				current.byUser.push({
					matchListItemId: String(row.matched_list_item_id ?? ""),
					name: userName,
					pieces: Number(row.matched_quantity ?? 0),
					value: typeof row.matched_value === "number" ? row.matched_value : null,
					myReservedQuantity: Number(row.my_reserved_quantity ?? 0),
					totalReservedQuantity: Number(row.total_reserved_quantity ?? 0),
					reservableQuantity: Number(row.reservable_quantity ?? 0),
				});

				summary[key] = {
					matches: current.matches + 1,
					pieces: current.pieces + Number(row.matched_quantity ?? 0),
					byUser: current.byUser,
				};
			}

			setMatchesByLot(summary);
		} catch (error) {
			console.error("loadMatchesForLots error", error);
			setMatchesByLot({});
		}
	}

	async function reserveMatchedLot(matchedListItemId: string, maxAllowed: number) {
		const desiredRaw = reserveQtyByMatchedLot[matchedListItemId];
		const parsed = Math.floor(Number(desiredRaw));
		if (!Number.isFinite(parsed) || parsed < 1) {
			setMessage("La reserva debe ser mayor a 0.");
			return;
		}

		const quantity = Math.min(parsed, Math.max(0, Math.floor(maxAllowed)));
		if (quantity < 1) {
			setMessage("No hay stock disponible para reservar en este momento.");
			return;
		}

		setReservingMatchLotId(matchedListItemId);
		setMessage(null);

		try {
			const supabase = getSupabaseClient();
			const { error } = await supabase.rpc("toggle_offer_for_lot", {
				p_list_item_id: matchedListItemId,
				p_quantity: quantity,
			});

			if (error) {
				setMessage(error.message);
				return;
			}

			const currentLotIds = lots.map((lot) => String(lot.id));
			void loadMatchesForLots(currentLotIds);
			setMessage("Reserva actualizada.");
		} finally {
			setReservingMatchLotId(null);
		}
	}

	async function clearReserveForMatchedLot(matchedListItemId: string) {
		setReservingMatchLotId(matchedListItemId);
		setMessage(null);

		try {
			const supabase = getSupabaseClient();
			const { error } = await supabase.rpc("toggle_offer_for_lot", {
				p_list_item_id: matchedListItemId,
				p_quantity: 0,
			});

			if (error) {
				setMessage(error.message);
				return;
			}

			const currentLotIds = lots.map((lot) => String(lot.id));
			void loadMatchesForLots(currentLotIds);
			void loadOffersForLots(currentLotIds);
			setReserveQtyByMatchedLot((current) => ({
				...current,
				[matchedListItemId]: 0,
			}));
			setMessage("Reserva quitada.");
		} finally {
			setReservingMatchLotId(null);
		}
	}

	useEffect(() => {
		if (loading || !list) return;

		const lotIds = lots.map((lot) => String(lot.id));
		if (lotIds.length === 0) {
			setOffersByLot({});
			setMatchesByLot({});
			return;
		}

		void loadOffersForLots(lotIds);
		void loadMatchesForLots(lotIds);

		const intervalId = window.setInterval(() => {
			void loadOffersForLots(lotIds);
			void loadMatchesForLots(lotIds);
		}, 6000);

		function onFocus() {
			void loadOffersForLots(lotIds);
			void loadMatchesForLots(lotIds);
		}

		window.addEventListener("focus", onFocus);

		return () => {
			window.clearInterval(intervalId);
			window.removeEventListener("focus", onFocus);
		};
	}, [loading, list, lots, listId]);

	async function createLot(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setSaving(true);
		setMessage(null);

		try {
			const supabase = getSupabaseClient();
			const piece = normalizePartCodeInput(partInput);
			const partNum = selectedPart?.part_num || piece;
			const partName = selectedPart?.name || partNum;
			const isSaleList = isSaleListName(list?.name);
			const value = parseValueInput(valueInput);
			const selectedColorName = selectedColor
				? useBricklinkNomenclature
					? selectedColor.blName?.trim() || selectedColor.name
					: selectedColor.name
				: "";

			const color = selectedColor
				? `${selectedColorName}${selectedColor.uniqueFlag ? " (Chino)" : ""}`
				: colorInput.trim();
			const quantity = Number(quantityInput);

			if (!partNum) {
				setMessage("Escribe la pieza para crear el lote.");
				setSaving(false);
				return;
			}

			if (!Number.isFinite(quantity) || quantity <= 0) {
				setMessage("La cantidad debe ser mayor a 0.");
				setSaving(false);
				return;
			}

			if (isSaleList && value === null) {
				setMessage("El valor debe ser un numero mayor o igual a 0.");
				setSaving(false);
				return;
			}

			const { data, error } = await supabase
				.from("list_items")
				.insert({
					list_id: listId,
					part_num: partNum,
					part_name: partName,
					color_name: color || null,
					quantity,
					value: isSaleList ? value : null,
				})
				.select("id,part_name,part_num,color_name,quantity,value")
				.single();

			if (error) {
				setMessage(error.message);
				setSaving(false);
				return;
			}

			setLots((current) => [data as Lot, ...current]);
			if (selectedPart?.part_img_url) {
				setPartImages((current) => ({
					...current,
					[getPartImageKey(partNum, color || null)]: selectedPart.part_img_url,
				}));
			} else {
				void loadPartImages([{ part_num: partNum, color_name: color || null }]);
			}
			void loadOffersForLots([...(lots.map((lot) => String(lot.id))), String((data as Lot).id)]);
			void loadMatchesForLots([...(lots.map((lot) => String(lot.id))), String((data as Lot).id)]);
			setPartInput("");
			setSelectedPart(null);
			setSuggestions([]);
			setColorInput("");
			setSelectedColor(null);
			setShowColorSuggestions(false);
			setQuantityInput(1);
			setValueInput("");
		} catch (error) {
			const text = error instanceof Error ? error.message : "No se pudo crear el lote.";
			setMessage(text);
		} finally {
			setSaving(false);
		}
	}

	async function openCatalogModal() {
		setShowCatalogModal(true);
		setCatalogView("categories");
		setCatalogSelectedCategory(null);
		setCatalogParts([]);
		setSelectedCatalogPart(null);
		setCatalogPartsPage(1);
		setCatalogPartsTotalPages(1);
		setCatalogPageInput("1");
		setCatalogShowPrinted(false);
		setCatalogShowNonPrinted(true);
		setCatalogPartsError(null);
		setCatalogError(null);
		setCatalogFilter("popular");

		if (catalogCategories.length > 0) {
			return;
		}

		setCatalogLoading(true);
		try {
			const response = await fetch("/api/rebrickable/categories");
			const payload = (await response.json()) as {
				results?: CatalogCategory[];
				error?: string;
			};

			if (!response.ok) {
				setCatalogError(payload.error ?? "No se pudieron cargar categorias.");
				return;
			}

			setCatalogCategories(payload.results ?? []);
		} catch {
			setCatalogError("No se pudieron cargar categorias.");
		} finally {
			setCatalogLoading(false);
		}
	}

	function closeCatalogModal() {
		setShowCatalogModal(false);
		setCatalogView("categories");
		setCatalogSelectedCategory(null);
		setCatalogParts([]);
		setSelectedCatalogPart(null);
		setCatalogPartsError(null);
		setCatalogPartsPage(1);
		setCatalogPartsTotalPages(1);
		setCatalogPageInput("1");
		setCatalogShowPrinted(false);
		setCatalogShowNonPrinted(true);
	}

	async function openCategoryParts(
		category: CatalogCategory,
		page = 1,
		overrides?: { includePrinted?: boolean; includeNonPrinted?: boolean },
	) {
		setCatalogView("parts");
		setCatalogSelectedCategory(category);
		setSelectedCatalogPart(null);
		setCatalogPartsLoading(true);
		setCatalogPartsError(null);
		const includePrinted = overrides?.includePrinted ?? catalogShowPrinted;
		const includeNonPrinted = overrides?.includeNonPrinted ?? catalogShowNonPrinted;

		try {
			const response = await fetch(
				`/api/rebrickable/parts-by-category?category_id=${category.id}&page=${page}&page_size=20&include_printed=${includePrinted}&include_non_printed=${includeNonPrinted}`,
			);
			const payload = (await response.json()) as {
				results?: CatalogPart[];
				page?: number;
				total_pages?: number;
				error?: string;
			};

			if (!response.ok) {
				setCatalogPartsError(payload.error ?? "No se pudieron cargar piezas de esta categoria.");
				setCatalogParts([]);
				return;
			}

			setCatalogParts(payload.results ?? []);
			const nextPage = Number(payload.page ?? page);
			setCatalogPartsPage(nextPage);
			setCatalogPartsTotalPages(Number(payload.total_pages ?? 1));
			setCatalogPageInput(String(nextPage));
		} catch {
			setCatalogPartsError("No se pudieron cargar piezas de esta categoria.");
			setCatalogParts([]);
		} finally {
			setCatalogPartsLoading(false);
		}
	}

	function goToCatalogPage() {
		if (!catalogSelectedCategory) return;
		const parsed = Number(catalogPageInput);
		if (!Number.isFinite(parsed)) return;
		const targetPage = Math.max(1, Math.min(catalogPartsTotalPages, Math.floor(parsed)));
		setCatalogPageInput(String(targetPage));
		void openCategoryParts(catalogSelectedCategory, targetPage);
	}

	function addSelectedCatalogPart() {
		if (!selectedCatalogPart) return;

	setSelectedPart({
		part_num: selectedCatalogPart.part_num,
		name: selectedCatalogPart.name,
		part_img_url: selectedCatalogPart.part_img_url,
	});
	setPartInput(selectedCatalogPart.name || selectedCatalogPart.part_num);
		setSuggestions([]);

		if (selectedCatalogPart.part_img_url) {
			setPartImages((current) => ({
				...current,
				[getPartImageKey(selectedCatalogPart.part_num, null)]: selectedCatalogPart.part_img_url,
			}));
		}

		closeCatalogModal();
	}

	function getColorHexFromName(colorName: string | null) {
		if (!colorName) return "#d1d5db";

		const normalized = colorName.replace("(Chino)", "").trim().toLowerCase();
		const match = availableColors.find((color) => {
			const lego = color.name.toLowerCase();
			const bl = (color.blName ?? "").trim().toLowerCase();
			return normalized === lego || (bl.length > 0 && normalized === bl);
		});

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

	function getStoredColorName(color: GobrickColor) {
		const baseName = color.blName?.trim() || color.name;
		return `${baseName}${color.uniqueFlag ? " (Chino)" : ""}`;
	}

	function openLotColorPicker(lotId: string) {
		setColorPickerLotId(lotId);
		setColorPickerSearch("");
	}

	function closeLotColorPicker() {
		setColorPickerLotId(null);
		setColorPickerSearch("");
	}

	function chooseLotColor(nextColorName: string | null) {
		if (!colorPickerLotId) return;
		const lotId = colorPickerLotId;
		closeLotColorPicker();
		void persistLotColor(lotId, nextColorName);
	}

	function getBricklinkColorName(colorIdRaw: string) {
		const colorId = Number(colorIdRaw);
		const known: Record<number, string> = {
			0: "Sin color",
			1: "White",
			3: "Yellow",
			4: "Orange",
			5: "Red",
			6: "Green",
			7: "Blue",
			9: "Light Gray",
			10: "Dark Gray",
			11: "Black",
			13: "Trans Clear",
			14: "Trans Black",
			85: "Dark Bluish Gray",
			86: "Light Bluish Gray",
			110: "Bright Light Orange",
		};
		return known[colorId] ?? `BL ${colorIdRaw}`;
	}

	function parseBricklinkInventoryXml(raw: string) {
		const itemBlocks = [...raw.matchAll(/<ITEM>([\s\S]*?)<\/ITEM>/gi)];
		const rows: Array<{ part_num: string; part_name: string; color_name: string | null; quantity: number }> = [];

		for (const match of itemBlocks) {
			const block = match[1] ?? "";
			const readTag = (tag: string) => {
				const found = block.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"));
				return (found?.[1] ?? "").trim();
			};

			const itemType = readTag("ITEMTYPE");
			if (itemType && itemType.toUpperCase() !== "P") continue;

			const partNum = readTag("ITEMID").toUpperCase();
			if (!partNum) continue;

			const colorId = readTag("COLOR");
			const minQty = Number(readTag("MINQTY") || "1");
			const quantity = Number.isFinite(minQty) && minQty > 0 ? Math.floor(minQty) : 1;

			rows.push({
				part_num: partNum,
				part_name: partNum,
				color_name: colorId ? getBricklinkColorName(colorId) : null,
				quantity,
			});
		}

		return rows;
	}

	async function getPartNameMap(partNums: string[]) {
		const map: Record<string, string> = {};
		const unique = [...new Set(partNums.map((num) => num.trim().toUpperCase()).filter(Boolean))];
		const chunkSize = 100;

		for (let i = 0; i < unique.length; i += chunkSize) {
			const chunk = unique.slice(i, i + chunkSize);
			const response = await fetch(`/api/rebrickable/parts-by-num?nums=${encodeURIComponent(chunk.join(","))}`);
			if (!response.ok) continue;

			const payload = (await response.json()) as {
				results?: Array<{ part_num: string; name?: string | null }>;
			};

			for (const row of payload.results ?? []) {
				const key = row.part_num?.trim().toUpperCase();
				if (!key) continue;
				if (row.name?.trim()) {
					map[key] = row.name.trim();
				}
			}
		}

		return map;
	}

	function escapeHtml(value: string) {
		return value
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/\"/g, "&quot;")
			.replace(/'/g, "&#39;");
	}

	async function openPdfExportPrint() {
		const title = `${isSaleList ? "Lista de venta" : "Lista de deseo"} ${displayListName}`;
		const exportDateTime = new Date().toLocaleString("es-AR", {
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
		});
		const exportUserLabel = currentUserName || "Sin nombre";
		const exportEmailLabel = currentUserEmail || "Sin mail";
		const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const pdfImagesByKey: PartImageLookup = { ...partImages };
		const missingImageItems = lots
			.map((lot) => ({ part_num: lot.part_num, color_name: lot.color_name }))
			.filter((item, index, array) => {
				const key = getPartImageKey(item.part_num, item.color_name);
				if (pdfImagesByKey[key] !== undefined) return false;
				return array.findIndex((candidate) => getPartImageKey(candidate.part_num, candidate.color_name) === key) === index;
			});

		if (missingImageItems.length > 0) {
			try {
				const response = await fetch("/api/rebrickable/part-images", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ items: missingImageItems }),
				});

				if (response.ok) {
					const payload = (await response.json()) as {
						results?: Array<{ key: string; part_num: string; part_img_url: string | null }>;
					};
					for (const part of payload.results ?? []) {
						const key = part.key || getPartImageKey(part.part_num, null);
						pdfImagesByKey[key] = part.part_img_url;
					}
				}
			} catch {}
		}

		const rowsHtml = lots
			.map((lot) => {
				const rawName = (lot.part_name || lot.part_num).trim();
				const normalizedPartNum = lot.part_num.trim();
				const cleanedName = rawName
					.replace(new RegExp(`^#?\\s*${escapeRegex(normalizedPartNum)}\\s*-\\s*`, "i"), "")
					.trim();
				const name = escapeHtml(cleanedName || rawName);
				const colorLabel = escapeHtml(lot.color_name || "Sin color");
				const colorHex = getColorHexFromName(lot.color_name);
				const colorText = getTextColorForBackground(colorHex);
				const qty = Math.max(1, Number(lot.quantity || 1));
				const imageKey = getPartImageKey(lot.part_num, lot.color_name);
				const imageUrl = pdfImagesByKey[imageKey];
				const imageCell = imageUrl
					? `<img src="${escapeHtml(imageUrl)}" alt="${name}" class="part-image"/>`
					: `<div class="part-image empty">Sin imagen</div>`;
				const priceCell = isSaleList ? `<td>${lot.value == null ? "" : `$${escapeHtml(String(lot.value))}`}</td>` : "";

				return `<tr><td>${imageCell}</td><td>${name}</td><td class="color-cell" style="background:${colorHex};color:${colorText};">${colorLabel}</td><td>${qty}</td>${priceCell}</tr>`;
			})
			.join("");
		const priceHeader = isSaleList ? "<th>Precio</th>" : "";

		const html = `<!doctype html><html><head><meta charset="utf-8"/><title>${escapeHtml(title)}</title><style>body{font-family:Arial,sans-serif;padding:24px;color:#111}h1{margin:0 0 16px 0;font-size:22px}.meta{margin:0 0 16px 0;font-size:12px;line-height:1.5}table{width:100%;border-collapse:collapse}th,td{border:1px solid #d1d5db;padding:8px;font-size:12px;text-align:left;vertical-align:middle}th{background:#f3f4f6}.part-image{width:56px;height:56px;object-fit:contain;display:block;margin:0 auto}.part-image.empty{width:56px;height:56px;border:1px dashed #cbd5e1;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:9px;color:#64748b;background:#f8fafc}.color-cell{font-weight:700;-webkit-print-color-adjust:exact;print-color-adjust:exact}</style></head><body><p class="meta"><strong>Usuario:</strong> ${escapeHtml(exportUserLabel)}<br/><strong>Mail:</strong> ${escapeHtml(exportEmailLabel)}<br/><strong>Fecha:</strong> ${escapeHtml(exportDateTime)}</p><h1>${escapeHtml(title)}</h1><table><thead><tr><th>Imagen</th><th>Nombre</th><th>Color</th><th>Cantidad</th>${priceHeader}</tr></thead><tbody>${rowsHtml}</tbody></table></body></html>`;

		const popup = window.open("", "_blank", "width=960,height=720");
		if (!popup) {
			setMessage("No se pudo abrir la ventana para exportar PDF.");
			return;
		}

		popup.document.open();
		popup.document.write(html);
		popup.document.close();
		popup.focus();
		popup.print();
	}

	async function handleImportExportAction() {
		if (importExportMode === "export") {
			if (lots.length === 0) {
				setMessage("No hay items para exportar en esta lista.");
				return;
			}

			await openPdfExportPrint();
			setMessage("Exportacion PDF lista para imprimir/guardar.");
			return;
		}

		if (!importSource) {
			setMessage("Selecciona una opcion para importar.");
			return;
		}

		if (importSource !== "Bricklink") {
			setMessage(`Importador para ${importSource} disponible pronto. Empezamos por Bricklink.`);
			return;
		}

		const raw = importRawInput.trim();
		if (!raw) {
			setMessage("Pega el XML de Bricklink para importar.");
			return;
		}

		const parsedRows = parseBricklinkInventoryXml(raw);
		if (parsedRows.length === 0) {
			setMessage("No se encontraron items validos en el XML de Bricklink.");
			return;
		}

		setImportExportBusy(true);
		setMessage(null);

		try {
			const partNameMap = await getPartNameMap(parsedRows.map((row) => row.part_num));
			const enrichedRows = parsedRows.map((row) => ({
				...row,
				part_num: row.part_num.toUpperCase(),
				part_name: partNameMap[row.part_num.toUpperCase()] || row.part_num.toUpperCase(),
			}));

			const supabase = getSupabaseClient();
			const { data, error } = await supabase
				.from("list_items")
				.insert(
					enrichedRows.map((row) => ({
						list_id: listId,
						part_num: row.part_num,
						part_name: row.part_name,
						color_name: row.color_name,
						quantity: row.quantity,
						value: null,
					})),
				)
				.select("id,part_name,part_num,color_name,quantity,value");

			if (error) {
				setMessage(error.message);
				return;
			}

			const importedLots = (data as Lot[]) ?? [];
			if (importedLots.length > 0) {
				setLots((current) => [...importedLots, ...current]);
				void loadPartImages(
					importedLots.map((lot) => ({
						part_num: lot.part_num,
						color_name: lot.color_name,
					})),
				);
				void loadOffersForLots([...(lots.map((lot) => String(lot.id))), ...importedLots.map((lot) => String(lot.id))]);
				void loadMatchesForLots([...(lots.map((lot) => String(lot.id))), ...importedLots.map((lot) => String(lot.id))]);
			}

			setImportRawInput("");
			setShowImportExportModal(false);
			setMessage(`Se importaron ${importedLots.length} items desde Bricklink.`);
		} catch (error) {
			setMessage(error instanceof Error ? error.message : "No se pudo importar la lista.");
		} finally {
			setImportExportBusy(false);
		}
	}

	function setLocalLotQuantity(lotId: string, nextQuantity: number) {
		setLots((current) =>
			current.map((lot) => (lot.id === lotId ? { ...lot, quantity: Number.isFinite(nextQuantity) ? nextQuantity : lot.quantity } : lot)),
		);
	}

	function setLocalLotValue(lotId: string, nextValue: number | null) {
		setLots((current) => current.map((lot) => (lot.id === lotId ? { ...lot, value: nextValue } : lot)));
	}

	function setLocalLotColor(lotId: string, nextColorName: string | null) {
		setLots((current) => current.map((lot) => (lot.id === lotId ? { ...lot, color_name: nextColorName } : lot)));
	}

	async function persistLotQuantity(lotId: string, nextQuantity: number) {
		const quantity = Math.max(1, Math.floor(nextQuantity));
		setUpdatingLotId(lotId);
		setMessage(null);

		try {
			const supabase = getSupabaseClient();
			const { error } = await supabase.from("list_items").update({ quantity }).eq("id", lotId);

			if (error) {
				setMessage(error.message);
				return;
			}

			setLocalLotQuantity(lotId, quantity);
		} finally {
			setUpdatingLotId(null);
		}
	}

	async function persistLotValue(lotId: string, nextValueRaw: string) {
		const parsed = parseValueInput(nextValueRaw);
		if (parsed === null) {
			setMessage("El valor debe ser un numero mayor o igual a 0.");
			return;
		}

		setUpdatingLotValueId(lotId);
		setMessage(null);

		try {
			const supabase = getSupabaseClient();
			const { error } = await supabase.from("list_items").update({ value: parsed }).eq("id", lotId);

			if (error) {
				setMessage(error.message);
				return;
			}

			setLocalLotValue(lotId, parsed);
		} finally {
			setUpdatingLotValueId(null);
		}
	}

	async function persistLotColor(lotId: string, nextColorName: string | null) {
		const colorName = nextColorName?.trim() ? nextColorName.trim() : null;
		setUpdatingLotColorId(lotId);
		setMessage(null);

		try {
			const targetLot = lots.find((lot) => lot.id === lotId) ?? null;
			const supabase = getSupabaseClient();
			const { error } = await supabase.from("list_items").update({ color_name: colorName }).eq("id", lotId);

			if (error) {
				setMessage(error.message);
				return;
			}

			setLocalLotColor(lotId, colorName);

			if (targetLot) {
				void loadPartImages([
					{
						part_num: targetLot.part_num,
						color_name: colorName,
					},
				]);
			}

			void loadMatchesForLots(lots.map((lot) => String(lot.id)));
		} finally {
			setUpdatingLotColorId(null);
		}
	}

	async function deleteLot(lotId: string) {
		setDeletingLotId(lotId);
		setMessage(null);

		try {
			const supabase = getSupabaseClient();
			const { data, error } = await supabase.from("list_items").delete().eq("id", lotId).select("id");

			if (error) {
				setMessage(error.message);
				return;
			}

			if (!data || data.length === 0) {
				setMessage("No se pudo eliminar en base de datos. Revisa permisos RLS de DELETE.");
				return;
			}

			setLots((current) => current.filter((lot) => lot.id !== lotId));
			setOffersByLot((current) => {
				const next = { ...current };
				delete next[lotId];
				return next;
			});
			setMatchesByLot((current) => {
				const next = { ...current };
				delete next[lotId];
				return next;
			});
		} finally {
			setDeletingLotId(null);
		}
	}

	if (loading) {
		return (
			<div className="bg-lego-tile font-chewy flex min-h-screen items-center justify-center px-6 text-center text-2xl text-white sm:text-3xl">
				{loadingMessage}
			</div>
		);
	}

	if (!list) {
		return (
			<div className="bg-lego-tile min-h-screen p-8 text-white">
				<p>No encontramos esa lista.</p>
				<Link href="/dashboard" className="mt-4 inline-block underline">
					Volver al dashboard
				</Link>
			</div>
		);
	}

	const isAutoMinifigList = [AUTO_MINIFIG_LIST_NAME, ...LEGACY_AUTO_MINIFIG_LIST_NAMES].includes(list.name.trim());
	const isSaleList = isSaleListName(list.name);
	const displayListName = getDisplayListName(list.name);

	return (
		<div className="bg-lego-tile min-h-screen px-4 py-6 sm:px-6 sm:py-8">
			<main className="mx-auto flex w-full max-w-3xl flex-col gap-6 rounded-2xl bg-white p-4 shadow-xl sm:p-8">
				<header className="border-b border-slate-200 pb-5">
					<div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
						<Link href="/dashboard" className="order-1 self-end text-sm text-slate-600 hover:underline sm:order-2 sm:self-auto">
							← Volver
						</Link>
						<div className="order-2 sm:order-1">
							<h1 className="text-2xl font-semibold text-slate-900 sm:text-3xl">{isSaleList ? "Lista de venta" : "Lista de deseo"} {displayListName.toLocaleUpperCase("es-AR")}</h1>
							<div className="mt-2 hidden justify-start">
								<button
									type="button"
									onClick={() => setShowImportExportModal(true)}
									className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
								>
									Import/Export
								</button>
							</div>
						</div>
					</div>
					<p className="mt-1 text-sm text-slate-600">
						<span className="sm:hidden">
							Visibilidad: {list.is_public ? "Publica" : "Privada"} - L: {totals.lots} - P: {totals.pieces}
						</span>
						<span className="hidden sm:inline">
							Visibilidad: {list.is_public ? "Publica" : "Privada"} - Lotes: {totals.lots} - Piezas: {totals.pieces}
						</span>
					</p>
				</header>

				{!isAutoMinifigList ? (
				<section className="rounded-xl border border-slate-200 p-4 sm:p-5">
					<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
						<h2 className="text-2xl font-semibold text-slate-900">Agregar item</h2>
						<div className="group relative">
							<button
								type="button"
								onClick={() => void openCatalogModal()}
								className="w-full rounded-md bg-[#006eb2] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#005f9a] sm:w-auto"
							>
								Por Catálogo
							</button>
							<div className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 w-64 -translate-x-1/2 scale-95 rounded-[4px] border border-slate-300 bg-slate-100 px-3 py-2 text-center text-[11px] font-normal text-slate-900 opacity-0 shadow-lg transition-all duration-200 ease-out group-hover:delay-[1000ms] group-hover:scale-100 group-hover:opacity-100 group-focus-within:delay-[1000ms] group-focus-within:scale-100 group-focus-within:opacity-100">
								Busca en el catalogo de Rebrickable para encontrar tu pieza.
							</div>
						</div>
					</div>
					<form onSubmit={createLot} className="mt-4 space-y-4">
						<div className="relative sm:col-span-3">
							<input
								type="text"
								value={partInput}
								onChange={(event) => {
									setPartInput(event.target.value);
									setSelectedPart(null);
								}}
								placeholder="Buscar como Brick 1x1 o #3005"
								className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
							/>
							{loadingSuggestions ? (
								<p className="mt-1 text-xs text-slate-500">Buscando en Rebrickable...</p>
							) : null}
							{suggestions.length > 0 ? (
								<ul className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-slate-300 bg-white">
									{suggestions.map((part) => (
										<li key={part.part_num}>
											<button
												type="button"
												onClick={() => {
													setSelectedPart(part);
													setPartInput(`${part.part_num} - ${part.name}`);
													setSuggestions([]);
												}}
												className="flex w-full items-center gap-3 border-b border-slate-100 px-3 py-2 text-left hover:bg-slate-50"
											>
												{part.part_img_url ? (
													<img src={part.part_img_url} alt={part.name} className="h-9 w-9 rounded object-contain" />
												) : (
													<div className="h-9 w-9 rounded bg-slate-100" />
												)}
												<span className="flex flex-col">
													<span className="text-sm font-semibold text-slate-900">{part.name}</span>
													<span className="text-xs text-slate-600">{part.part_num}</span>
												</span>
											</button>
										</li>
									))}
								</ul>
							) : null}
						</div>

						<div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px] md:items-start">
							<div ref={colorDropdownRef} className="relative">
								<input
									type="text"
									value={colorInput}
									onFocus={() => setShowColorSuggestions(true)}
									onChange={(event) => {
										setColorInput(event.target.value);
										setSelectedColor(null);
										setShowColorSuggestions(true);
									}}
									placeholder={
										useBricklinkNomenclature ? "Color BrickLink (nombre)" : "Color LEGO (nombre)"
									}
									className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
								/>
								{showColorSuggestions && filteredColors.length > 0 ? (
									<ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-slate-300 bg-white">
										{filteredColors.map((color) => (
											<li key={color.id}>
												<button
													type="button"
													onClick={() => {
														setSelectedColor(color);
														const displayName = useBricklinkNomenclature
															? color.blName?.trim() || color.name
															: color.name;
														setColorInput(displayName);
														setShowColorSuggestions(false);
													}}
													className="flex w-full items-center gap-2 border-b border-slate-100 px-3 py-2 text-left hover:bg-slate-50"
												>
													<span className="h-4 w-4 rounded border border-slate-300" style={{ backgroundColor: color.hex }} />
													<span className="text-sm text-slate-900">
														{useBricklinkNomenclature ? color.blName?.trim() || color.name : color.name}
													</span>
													{color.uniqueFlag ? (
														<span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
															Chino
														</span>
													) : null}
												</button>
											</li>
										))}
									</ul>
								) : null}
								<div className="group relative mt-2 flex gap-2">
									<button
										type="button"
										onClick={() => {
											setUseBricklinkNomenclature(true);
											setSelectedColor(null);
											setColorInput("");
										}}
										className={`h-7 w-20 rounded-md px-2 py-1 text-[10px] font-medium ${useBricklinkNomenclature ? "bg-slate-900 text-white" : "border border-slate-300 text-slate-700"}`}
									>
										Color BL
									</button>
									<button
										type="button"
										onClick={() => {
											setUseBricklinkNomenclature(false);
											setSelectedColor(null);
											setColorInput("");
										}}
										className={`h-7 w-20 rounded-md px-2 py-1 text-[10px] font-medium ${!useBricklinkNomenclature ? "bg-slate-900 text-white" : "border border-slate-300 text-slate-700"}`}
									>
										Color LEGO
									</button>
									<div className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 w-64 -translate-x-1/2 scale-95 rounded-[4px] border border-slate-300 bg-slate-100 px-3 py-2 text-center text-[11px] font-normal text-slate-900 opacity-0 shadow-lg transition-all duration-200 ease-out group-hover:delay-[1000ms] group-hover:scale-100 group-hover:opacity-100 group-focus-within:delay-[1000ms] group-focus-within:scale-100 group-focus-within:opacity-100">
										Elegi el estilo de nomenclatura para el color.
									</div>
								</div>
							</div>

							<div className="flex flex-col items-end gap-2">
								<div className="flex w-full items-center justify-end gap-2">
									{isSaleList ? (
										<div className="relative w-24">
											<span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-sm font-bold text-white">$</span>
											<input
												type="number"
												min={0}
												step={1}
												inputMode="numeric"
												value={valueInput}
												onChange={(event) => setValueInput(event.target.value)}
												placeholder="0"
												className="w-full rounded-lg border border-[#005f9a] bg-[#006eb2] py-2 pl-5 pr-2 text-center font-bold text-white outline-none transition focus:border-[#006eb2] focus:ring-2 focus:ring-blue-200 placeholder:text-white/70"
											/>
										</div>
									) : null}
									<div className="w-24">
										<input
											type="number"
											min={1}
											step={1}
											value={quantityInput}
											onChange={(event) => setQuantityInput(Number(event.target.value))}
											className="quantity-input w-full appearance-auto rounded-lg border border-slate-300 px-2 py-2 text-center text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
										/>
									</div>
								</div>
								<button
									type="submit"
									disabled={saving}
									className="h-11 w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
								>
									{saving ? "Guardando..." : "Agregar item"}
								</button>
							</div>
						</div>
					</form>
				</section>
				) : null}

				<button
					type="button"
					onClick={() => {
						setImportExportMode("export");
						setShowImportExportModal(true);
					}}
					className="w-full rounded-xl border border-[#006eb2] bg-[#006eb2] px-4 py-3 text-sm font-semibold text-white hover:bg-[#005f9a]"
				>
					Exportar
				</button>

				<section className="rounded-xl border border-slate-200 p-4 sm:p-5">
					{lots.length === 0 ? (
						<p className="mt-3 text-sm text-slate-600">Todavia no agregaste lotes.</p>
					) : (
						<ul className="mt-4 space-y-3">
							{lots.map((lot) => (
								<li
									key={lot.id}
									className={`rounded-lg border px-3 py-2 ${matchesByLot[String(lot.id)] ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-slate-50"}`}
								>
									<div className="flex items-start gap-3 text-sm text-slate-800">
										{matchesByLot[String(lot.id)] ? (
											<button
												type="button"
												onClick={() => setMatchDetailsLotId(String(lot.id))}
												className="hidden h-7 w-7 shrink-0 items-center justify-center self-center rounded-md border border-black bg-black p-0.5 hover:bg-slate-800 sm:inline-flex"
												title="Hay match"
											>
												<Lottie animationData={matchIconAnimation} loop className="h-5 w-5" style={{ filter: "sepia(1) saturate(8) hue-rotate(340deg) brightness(1.15)" }} />
											</button>
										) : null}
										<div className="flex w-16 shrink-0 flex-col items-center gap-1">
											{partImages[getPartImageKey(lot.part_num, lot.color_name)] ? (
												<img
													src={partImages[getPartImageKey(lot.part_num, lot.color_name)] ?? undefined}
													alt={lot.part_name || lot.part_num}
													loading="lazy"
													decoding="async"
													className="h-16 w-16 rounded border border-slate-200 bg-white object-contain"
												/>
											) : (
												<div className="flex h-16 w-16 flex-col items-center justify-center rounded border border-slate-200 bg-slate-100 text-[9px] text-slate-500">
													<span className="leading-none">IMG</span>
													<span className="leading-none">Sin imagen</span>
												</div>
											)}
											{matchesByLot[String(lot.id)] ? (
												<button
													type="button"
													onClick={() => setMatchDetailsLotId(String(lot.id))}
													className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-black bg-black p-0.5 hover:bg-slate-800 sm:hidden"
													title="Hay match"
												>
													<Lottie animationData={matchIconAnimation} loop className="h-5 w-5" style={{ filter: "sepia(1) saturate(8) hue-rotate(340deg) brightness(1.15)" }} />
												</button>
											) : null}
										</div>

										<div className="min-w-0 flex-1">
											<div className="flex items-start justify-between gap-2">
												<p className="overflow-hidden text-slate-900 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] sm:max-w-[520px]">
													{lot.part_name || "Sin nombre"}
												</p>
											<div className="flex items-center gap-2">
											{offersByLot[String(lot.id)] ? (
													<div className="group relative">
														<button
															type="button"
															onClick={() => setOfferDetailsLotId(String(lot.id))}
															className="w-fit max-w-full rounded-md bg-emerald-100 px-3 py-1 text-xs text-emerald-800 hover:bg-emerald-200"
														>
															{isSaleList ? "Ya en venta" : "Ya tuviste ofertas"}
														</button>
														<div className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 w-56 -translate-x-1/2 scale-95 rounded-[4px] border border-slate-300 bg-slate-100 px-3 py-2 text-center text-[11px] font-normal text-slate-900 opacity-0 shadow-lg transition-all duration-200 ease-out group-hover:delay-[1000ms] group-hover:scale-100 group-hover:opacity-100 group-focus-within:delay-[1000ms] group-focus-within:scale-100 group-focus-within:opacity-100">
															Bravo! se encontraron piezas!
														</div>
														</div>
												) : (
													<div className="group relative">
														<div className="w-fit max-w-full rounded-md bg-slate-200 px-3 py-1 text-xs text-slate-600">
															{isSaleList ? "Sin venta" : "Sin ofertas"}
														</div>
														<div className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 w-56 -translate-x-1/2 scale-95 rounded-[4px] border border-slate-300 bg-slate-100 px-3 py-2 text-center text-[11px] font-normal text-slate-900 opacity-0 shadow-lg transition-all duration-200 ease-out group-hover:delay-[1000ms] group-hover:scale-100 group-hover:opacity-100 group-focus-within:delay-[1000ms] group-focus-within:scale-100 group-focus-within:opacity-100">
															Todavia nadie encontro esta pieza
														</div>
													</div>
												)}
											</div>
										</div>

									<div className="mt-2 flex items-start justify-between gap-2">
										<div className="flex flex-col gap-2">
											<div className="flex items-center gap-2">
											<button
												type="button"
												onClick={() => openLotColorPicker(lot.id)}
												disabled={updatingLotColorId === lot.id}
												className="inline-flex w-20 items-center rounded-md border border-slate-300 px-2 py-1 text-[11px] font-semibold disabled:opacity-50"
												style={{
													backgroundColor: getColorHexFromName(lot.color_name),
													color: getTextColorForBackground(getColorHexFromName(lot.color_name)),
												}}
												title="Cambiar color"
											>
												<span className="block w-full truncate text-left">{lot.color_name || "Sin color"}</span>
											</button>
											<span className="font-semibold text-slate-900">#{lot.part_num}</span>
											<div className="hidden items-center gap-2 sm:flex">
											<input
												type="number"
												min={1}
												value={lot.quantity}
												onChange={(event) => {
													const parsed = Number(event.target.value);
													if (!Number.isFinite(parsed)) return;
													setLocalLotQuantity(lot.id, Math.max(1, parsed));
												}}
												onBlur={(event) => {
													const parsed = Number(event.target.value);
													void persistLotQuantity(lot.id, Number.isFinite(parsed) ? parsed : lot.quantity);
												}}
												disabled={updatingLotId === lot.id}
												className="quantity-input w-10 appearance-auto rounded border border-slate-300 px-1 py-0.5 text-center text-xs disabled:opacity-50 sm:w-16 sm:px-2 sm:py-1 sm:text-sm"
											/>
											{isSaleList ? (
												<div className="relative w-16 sm:w-24">
													<span className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-[11px] font-bold text-white sm:left-2 sm:text-xs">$</span>
													<input
														type="number"
														min={0}
														step={1}
														inputMode="numeric"
														value={lot.value ?? ""}
														onChange={(event) => {
															const next = parseValueInput(event.target.value);
															if (next !== null || event.target.value.trim() === "") {
																setLocalLotValue(lot.id, next);
															}
														}}
														onBlur={(event) => {
															const raw = event.target.value;
															if (!raw.trim()) return;
															void persistLotValue(lot.id, raw);
														}}
														disabled={updatingLotValueId === lot.id}
														placeholder="0"
														className="w-full rounded border border-[#005f9a] bg-[#006eb2] py-0.5 pl-4 pr-1 text-center text-xs font-bold text-white disabled:opacity-50 sm:px-2 sm:py-1 sm:pl-5 sm:text-sm placeholder:text-white/70"
													/>
												</div>
											) : null}
											</div>
											</div>

											<div className="flex items-center gap-2 sm:hidden">
												<input
													type="number"
													min={1}
													value={lot.quantity}
													onChange={(event) => {
														const parsed = Number(event.target.value);
														if (!Number.isFinite(parsed)) return;
														setLocalLotQuantity(lot.id, Math.max(1, parsed));
													}}
													onBlur={(event) => {
														const parsed = Number(event.target.value);
														void persistLotQuantity(lot.id, Number.isFinite(parsed) ? parsed : lot.quantity);
													}}
													disabled={updatingLotId === lot.id}
													className="quantity-input w-16 appearance-auto rounded border border-slate-300 px-2 py-1 text-center text-sm disabled:opacity-50"
												/>
												{isSaleList ? (
													<div className="relative w-24">
														<span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs font-bold text-white">$</span>
														<input
															type="number"
															min={0}
															step={1}
															inputMode="numeric"
															value={lot.value ?? ""}
															onChange={(event) => {
																const next = parseValueInput(event.target.value);
																if (next !== null || event.target.value.trim() === "") {
																	setLocalLotValue(lot.id, next);
																}
															}}
															onBlur={(event) => {
																const raw = event.target.value;
																if (!raw.trim()) return;
																void persistLotValue(lot.id, raw);
															}}
															disabled={updatingLotValueId === lot.id}
															placeholder="0"
															className="w-full rounded border border-[#005f9a] bg-[#006eb2] py-1 pl-5 pr-2 text-center text-sm font-bold text-white disabled:opacity-50 placeholder:text-white/70"
														/>
													</div>
												) : null}
											</div>
										</div>

										<div className="flex items-center gap-1">
											<button
												type="button"
												onClick={() => deleteLot(lot.id)}
												disabled={deletingLotId === lot.id}
												className="rounded-md border border-red-200 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 sm:px-3"
											>
												<span className="sm:hidden" aria-hidden="true">
													🗑
												</span>
												<span className="hidden sm:inline">Eliminar</span>
											</button>
										</div>
										</div>

										</div>
									</div>
								</li>
							))}
						</ul>
					)}
				</section>

				{activeColorPickerLot ? (
					<div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/45 p-4" onClick={closeLotColorPicker}>
						<div
							className="w-full max-w-md rounded-xl bg-white p-4 shadow-xl"
							onClick={(event) => event.stopPropagation()}
						>
							<div className="flex items-center justify-between gap-2 border-b border-slate-200 pb-2">
								<h3 className="text-lg font-semibold text-slate-900">Elegir color</h3>
								<button
									type="button"
									onClick={closeLotColorPicker}
									className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
								>
									Cerrar
								</button>
							</div>

							<p className="mt-2 text-xs text-slate-600">Doble click para seleccionar color.</p>

							<input
								type="text"
								value={colorPickerSearch}
								onChange={(event) => setColorPickerSearch(event.target.value)}
								placeholder="Buscar color..."
								className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-500"
							/>

							<ul className="mt-3 max-h-72 space-y-1 overflow-y-auto rounded-md border border-slate-200 p-2">
								<li>
									<button
										type="button"
										onDoubleClick={() => chooseLotColor(null)}
										className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-slate-50"
									>
										<span className="h-4 w-4 rounded border border-slate-300 bg-white" />
										<span className="text-sm text-slate-900">Sin color</span>
									</button>
								</li>
								{filteredLotColorOptions.map((color) => {
									const storedName = getStoredColorName(color);
									const isCurrent = (activeColorPickerLot.color_name || "") === storedName;
									return (
										<li key={color.id}>
											<button
												type="button"
												onDoubleClick={() => chooseLotColor(storedName)}
												className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-slate-50 ${isCurrent ? "bg-slate-100" : ""}`}
											>
												<span className="h-4 w-4 rounded border border-slate-300" style={{ backgroundColor: color.hex }} />
												<span className="text-sm text-slate-900">{storedName}</span>
											</button>
										</li>
									);
								})}
							</ul>
						</div>
					</div>
				) : null}

				{activeOfferDetailsLot && activeOfferDetailsSummary ? (
					<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4" onClick={() => setOfferDetailsLotId(null)}>
						<div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl" onClick={(event) => event.stopPropagation()}>
							<div className="flex items-center justify-between gap-2 border-b border-slate-200 pb-2">
								<h3 className="text-lg font-semibold text-slate-900">{isSaleList ? "Venta" : "Ofertas recibidas"}</h3>
								<button
									type="button"
									onClick={() => setOfferDetailsLotId(null)}
									className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
								>
									Cerrar
								</button>
							</div>

							<p className="mt-2 text-sm text-slate-700">{activeOfferDetailsLot.part_name || activeOfferDetailsLot.part_num}</p>
							<ul className="mt-3 space-y-2">
								{activeOfferDetailsSummary.byUser.map((userRow) => (
									<li key={userRow.name} className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
										<span className="text-slate-900">{userRow.name}</span>
										<span className="font-semibold text-black">{userRow.pieces} piezas</span>
									</li>
								))}
							</ul>
						</div>
					</div>
				) : null}

				{activeMatchDetailsLot && activeMatchDetailsSummary ? (
					<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4" onClick={() => setMatchDetailsLotId(null)}>
						<div className="w-full max-w-2xl rounded-xl bg-white p-5 shadow-xl" onClick={(event) => event.stopPropagation()}>
							<div className="flex items-end justify-between gap-3 border-b border-slate-200 pb-2">
								<h3 className="text-3xl font-semibold text-slate-900">Hay match!</h3>
								<img src="/MrGold.png" alt="Mr Gold" className="h-[12.5rem] w-[12.5rem] object-contain" />
							</div>

							<p className="mt-2 text-sm text-slate-700">
								{activeMatchDetailsLot.part_name || activeMatchDetailsLot.part_num}
							</p>
							<p className="mt-1 text-xs text-slate-600">
								Se encontro coincidencia con {activeMatchDetailsSummary.matches} usuario{activeMatchDetailsSummary.matches === 1 ? "" : "s"}.
							</p>
							<ul className="mt-3 space-y-2">
								{activeMatchDetailsSummary.byUser.map((userRow) => (
									<li key={userRow.matchListItemId || userRow.name} className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
										{!isSaleList ? (
											<p className="font-chewy text-xl text-slate-900">
												{userRow.name} vende {userRow.pieces} piezas{typeof userRow.value === "number" ? ` * $${userRow.value}` : ""}
											</p>
										) : (
											<p className="font-chewy text-xl text-slate-900">
												{userRow.name} necesita {userRow.pieces} piezas. Pidio {offersByLot[String(activeMatchDetailsLot.id)]?.byUser.find((offerUser) => offerUser.name === userRow.name)?.pieces ?? 0}
											</p>
										)}

										{!isSaleList ? (
											<>
												<div className="mt-2 flex items-center justify-start gap-2">
													<button
														type="button"
														onClick={() => void reserveMatchedLot(userRow.matchListItemId, userRow.reservableQuantity)}
														disabled={reservingMatchLotId === userRow.matchListItemId || userRow.reservableQuantity < 1}
														className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
													>
														Reservo
													</button>
													<input
														type="number"
														min={0}
														max={Math.max(0, userRow.reservableQuantity)}
														step={1}
														value={Math.max(
															0,
															Math.min(
																Math.floor(
																	Number(
																		reserveQtyByMatchedLot[userRow.matchListItemId] ?? Math.max(Number(userRow.pieces ?? 0), Number(activeMatchDetailsLot.quantity ?? 0)),
																	),
																),
																Math.max(0, userRow.reservableQuantity),
															),
														)}
														onChange={(event) => {
															const parsed = Math.floor(Number(event.target.value));
															if (!Number.isFinite(parsed)) return;
															setReserveQtyByMatchedLot((current) => ({
																...current,
																[userRow.matchListItemId]: Math.max(
																	0,
																	Math.min(parsed, Math.max(0, userRow.reservableQuantity)),
																),
															}));
														}}
														className="w-20 rounded border border-slate-300 bg-white px-2 py-1 text-right text-sm font-semibold text-black"
													/>
													{userRow.myReservedQuantity > 0 ? (
														<button
															type="button"
															onClick={() => void clearReserveForMatchedLot(userRow.matchListItemId)}
															disabled={reservingMatchLotId === userRow.matchListItemId}
															className="rounded-md border border-black bg-white px-3 py-1.5 text-xs font-semibold text-black hover:bg-slate-100 disabled:opacity-50"
														>
															Quitar reserva
														</button>
													) : null}
												</div>
											</>
										) : null}
									</li>
								))}
							</ul>

							{isSaleList ? (
								<p className="mt-3 text-base font-semibold text-slate-900">
									Quedan {Math.max(Number(activeMatchDetailsLot.quantity ?? 0) - Number(offersByLot[String(activeMatchDetailsLot.id)]?.pieces ?? 0), 0)} cantidad de piezas
								</p>
							) : null}

							<div className="mt-4 flex justify-center">
								<button
									type="button"
									onClick={() => setMatchDetailsLotId(null)}
									className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
								>
									Cerrar
								</button>
							</div>
						</div>
					</div>
				) : null}

				{showImportExportModal ? (
					<div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/45 p-4" onClick={() => setShowImportExportModal(false)}>
						<div
							className="w-full max-w-md rounded-xl bg-white p-4 shadow-xl"
							onClick={(event) => event.stopPropagation()}
						>
							<div className="flex items-center justify-between gap-2">
							<h3 className="text-xl font-semibold text-slate-900">Exportar lista</h3>
								<button
									type="button"
									onClick={() => setShowImportExportModal(false)}
									className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
								>
									Cerrar
								</button>
							</div>

							<div className="mt-3 space-y-3">
								{importExportMode === "import" ? (
									<div className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700">
										<div className="flex items-center justify-between gap-2">
											<select
												value={importSource}
												onChange={(event) => setImportSource(event.target.value)}
												className="w-full bg-transparent text-sm text-slate-700 outline-none"
											>
												<option value="" disabled>
													Seleccionar una opcion
												</option>
												{importExportSites.map((site) => (
													<option key={site} value={site}>
														{site}
													</option>
												))}
											</select>
										</div>
									</div>
								) : (
									<div className="rounded-md border border-sky-300 bg-sky-100 px-3 py-2 text-sm font-semibold text-slate-800">
										{`${isSaleList ? "Lista de ventas" : "Lista de deseos"} ${displayListName}`}
									</div>
								)}

								<div className="flex justify-center text-slate-600">
									<img src="/Flecha.svg" alt="Flecha" className="h-11 w-11 object-contain" />
								</div>

								{importExportMode === "import" ? (
									<div className="rounded-md border border-sky-300 bg-sky-100 px-3 py-2 text-sm font-semibold text-slate-800">
										{`${isSaleList ? "Lista de ventas" : "Lista de deseos"} ${displayListName}`}
									</div>
								) : (
									<div className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700">PDF</div>
								)}

								{importExportMode === "import" && importSource === "Bricklink" ? (
									<textarea
										value={importRawInput}
										onChange={(event) => setImportRawInput(event.target.value)}
										placeholder="Pega aqui el XML de Bricklink..."
										className="min-h-32 w-full rounded-md border border-slate-300 px-3 py-2 text-xs text-slate-700 outline-none focus:border-slate-500"
									/>
								) : null}
							</div>

							<button
								type="button"
								onClick={() => void handleImportExportAction()}
								disabled={importExportBusy}
								className="mt-4 w-full rounded-md border border-slate-900 bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700"
							>
								{importExportBusy ? "Procesando..." : "Exportar"}
							</button>
						</div>
					</div>
				) : null}

				{showCatalogModal ? (
					<div className="fixed inset-0 z-50 flex items-stretch justify-center bg-slate-900/45 p-0 sm:items-center sm:p-4">
						<div className="flex h-[100dvh] w-full flex-col bg-white p-4 shadow-xl sm:h-auto sm:max-h-[90vh] sm:max-w-2xl sm:rounded-xl sm:p-5">
							<div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
								{catalogView === "categories" ? (
									<div className="flex flex-wrap items-center gap-2">
										<h3 className="mr-1 text-2xl text-slate-900">Categorias</h3>
										<button
											type="button"
											onClick={() => setCatalogFilter("popular")}
											className={`rounded-md border px-2.5 py-1 text-xs font-semibold ${catalogFilter === "popular" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-800"}`}
										>
											Popular
										</button>
										<button
											type="button"
											onClick={() => setCatalogFilter("minifigs")}
											className={`rounded-md border px-2.5 py-1 text-xs font-semibold ${catalogFilter === "minifigs" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-800"}`}
										>
											Minifigs
										</button>
										<button
											type="button"
											onClick={() => setCatalogFilter("technic")}
											className={`rounded-md border px-2.5 py-1 text-xs font-semibold ${catalogFilter === "technic" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-800"}`}
										>
											Technic
										</button>
										<button
											type="button"
											onClick={() => setCatalogFilter("others")}
											className={`rounded-md border px-2.5 py-1 text-xs font-semibold ${catalogFilter === "others" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-800"}`}
										>
											Others
										</button>
										<button
											type="button"
											onClick={() => setCatalogFilter("all")}
											className={`rounded-md border px-2.5 py-1 text-xs font-semibold ${catalogFilter === "all" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-800"}`}
										>
											All
										</button>
									</div>
								) : (
									<div className="flex flex-col gap-1">
										<div className="flex items-center gap-2">
											<button
												type="button"
												onClick={() => {
													setCatalogView("categories");
													setCatalogPartsError(null);
												}}
												className="rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-700 hover:bg-slate-50"
											>
												←
											</button>
											<h3 className="text-xl text-slate-900">{catalogSelectedCategory?.name ?? "Piezas"}</h3>
										</div>
										<div className="flex items-center gap-1">
											<button
												type="button"
												onClick={() => {
													const next = !catalogShowNonPrinted;
													setCatalogShowNonPrinted(next);
													if (catalogSelectedCategory) {
														void openCategoryParts(catalogSelectedCategory, 1, {
															includePrinted: catalogShowPrinted,
															includeNonPrinted: next,
														});
													}
												}}
												className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold ${catalogShowNonPrinted ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-700"}`}
											>
												No impresas
											</button>
											<button
												type="button"
												onClick={() => {
													const next = !catalogShowPrinted;
													setCatalogShowPrinted(next);
													if (catalogSelectedCategory) {
														void openCategoryParts(catalogSelectedCategory, 1, {
															includePrinted: next,
															includeNonPrinted: catalogShowNonPrinted,
														});
													}
												}}
												className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold ${catalogShowPrinted ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-700"}`}
											>
												Impresas
											</button>
										</div>
									</div>
								)}

								<div className="flex items-center gap-2">
									{catalogView === "parts" ? (
										<>
											<div className="flex items-center gap-2">
													<button
														type="button"
														onClick={() => {
															if (!catalogSelectedCategory || catalogPartsPage <= 1) return;
															void openCategoryParts(catalogSelectedCategory, catalogPartsPage - 1);
														}}
														disabled={catalogPartsLoading || catalogPartsPage <= 1}
														className="rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
													>
														←
													</button>
													<span className="rounded-md border border-slate-300 px-1.5 py-1 text-xs text-slate-700">
														<input
															type="text"
															inputMode="numeric"
															value={catalogPageInput}
															onChange={(event) => setCatalogPageInput(event.target.value.replace(/\D/g, ""))}
															onKeyDown={(event) => {
																if (event.key === "Enter") {
																	event.preventDefault();
																	goToCatalogPage();
																}
															}}
															disabled={catalogPartsLoading}
															className="w-8 border-none bg-transparent text-center text-xs text-slate-800 outline-none disabled:opacity-50"
														/>
														/{catalogPartsTotalPages}
													</span>
													<button
														type="button"
														onClick={() => {
															if (!catalogSelectedCategory || catalogPartsPage >= catalogPartsTotalPages) return;
															void openCategoryParts(catalogSelectedCategory, catalogPartsPage + 1);
														}}
														disabled={catalogPartsLoading || catalogPartsPage >= catalogPartsTotalPages}
														className="rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
													>
														→
													</button>
												</div>
										</>
									) : null}
									<button
										type="button"
										onClick={closeCatalogModal}
										className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
									>
										Cerrar
									</button>
								</div>
							</div>

							<div className="min-h-0 flex-1 overflow-y-auto pr-1">
							{catalogView === "categories" ? (
								<>
									{catalogLoading ? <p className="mt-4 text-sm text-slate-600">Cargando categorias...</p> : null}
									{catalogError ? <p className="mt-4 text-sm text-red-700">{catalogError}</p> : null}

									{!catalogLoading && !catalogError ? (
										<ul className="mt-3 space-y-2">
											{filteredCatalogCategories.map((category) => (
												<li key={category.id}>
												<button
													type="button"
													onClick={() => {
														setCatalogShowPrinted(false);
														setCatalogShowNonPrinted(true);
														void openCategoryParts(category, 1, {
															includePrinted: false,
															includeNonPrinted: true,
														});
													}}
													className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-left text-sm text-slate-900 hover:bg-slate-100"
												>
														<span className="font-medium">{category.name}</span>
														<span className="ml-2 text-xs text-slate-500">({category.part_count} parts)</span>
													</button>
												</li>
											))}
										</ul>
									) : null}
								</>
							) : (
								<>
									{catalogPartsLoading ? <p className="mt-4 text-sm text-slate-600">Cargando piezas...</p> : null}
									{catalogPartsError ? <p className="mt-4 text-sm text-red-700">{catalogPartsError}</p> : null}
									{!catalogPartsLoading && !catalogPartsError ? (
										<div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-5">
											{filteredCatalogParts.map((part) => (
												<button
													key={part.part_num}
													type="button"
													onClick={() => setSelectedCatalogPart(part)}
													className={`rounded-lg border p-2 text-left transition duration-200 ${selectedCatalogPart?.part_num === part.part_num ? "z-10 scale-110 border-[#006eb2] bg-white shadow-lg" : "border-slate-200 bg-slate-50 hover:scale-105 hover:bg-white"}`}
												>
													<div className="flex h-20 items-center justify-center rounded bg-white">
														{part.part_img_url ? (
															<img src={part.part_img_url} alt={part.part_num} className="h-16 w-16 object-contain" />
														) : (
															<div className="h-16 w-16 rounded bg-slate-100" />
														)}
													</div>
													<p className="mt-2 text-center text-xs font-semibold text-slate-800">{part.part_num}</p>
												</button>
											))}
										</div>
									) : null}

									{!catalogPartsLoading && !catalogPartsError && filteredCatalogParts.length === 0 ? (
										<p className="mt-4 text-center text-sm text-slate-600">No hay piezas con ese filtro en esta pagina.</p>
									) : null}

									{!catalogPartsLoading && !catalogPartsError ? (
										<div className="mt-4 flex justify-center">
											<button
												type="button"
												onClick={addSelectedCatalogPart}
												disabled={!selectedCatalogPart}
												className="rounded-md bg-[#006eb2] px-5 py-2 text-sm font-semibold text-white hover:bg-[#005f9a] disabled:cursor-not-allowed disabled:opacity-50"
											>
												Agregar
											</button>
										</div>
									) : null}
								</>
							)}
							</div>
						</div>
					</div>
				) : null}

				{message ? <p className="text-sm text-slate-700">{message}</p> : null}
			</main>
		</div>
	);
}
