"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabase";
import { getHiddenSearchTagsForMinifigure } from "@/lib/minifigure-search-tags";
import { canAccessModule } from "@/lib/feature-flags";

const MINIFIGURAS_THEME_IDS_KEY = "minifiguras_theme_ids";
const MINIFIGURAS_FAVORITE_THEME_IDS_KEY = "minifiguras_favorite_theme_ids";
const MINIFIGURAS_FAVORITE_FIGURES_KEY = "minifiguras_favorite_figures";
const MINIFIGURAS_OWNED_KEY = "minifiguras_owned";
const MINIFIGURAS_PARTS_UNCHECKED_KEY = "minifiguras_parts_unchecked";
const MINIFIGURAS_MISSING_PARTS_KEY = "minifiguras_missing_parts";
const AUTO_MINIFIG_LIST_NAME = "Piezas Faltantes de Minifiguras";
const LEGACY_AUTO_MINIFIG_LIST_NAMES = ["Pares Faltantes de Minifcuras", "Faltantes Minifiguras"];

type MinifigureTheme = {
	id: number;
	name: string;
	year?: number | null;
	itemCount?: number | null;
};

type MinifigureEntry = {
	name: string;
	imageUrl: string | null;
	setNum: string;
};

type MinifigurePart = {
	part_num: string;
	name: string;
	quantity: number;
	color_name: string | null;
	part_img_url: string | null;
	is_spare: boolean;
};

type MissingPartEntry = {
	part_num: string;
	name: string;
	color_name: string | null;
};

type PartImageLookup = Record<string, string | null>;
type PartImageRequestItem = { part_num: string; color_name?: string | null };

type FigureViewMode = "all" | "missing" | "complete";

const SEARCH_SYNONYMS: Record<string, string[]> = {
	porrista: ["cheerleader", "cheer", "animadora"],
	animadora: ["cheerleader", "cheer", "porrista"],
	alentadora: ["cheerleader", "cheer", "porrista"],
	bailarina: ["cheerleader", "dancer"],
	"hombre de las cavernas": ["caveman", "cave"],
	cavernicola: ["caveman", "cave"],
	payaso: ["clown", "circus"],
	enfermera: ["nurse", "hospital", "medic"],
	luchador: ["wrestler", "wrestling"],
	vaquero: ["cowboy", "western"],
	buzo: ["deep sea diver", "diver"],
	mago: ["magician", "wizard"],
	ninja: ["ninja", "samurai"],
	zombie: ["zombie", "undead"],
	robot: ["robot", "android"],
	astronauta: ["spaceman", "space"],
	extraterrestre: ["alien", "spaceman", "space"],
	patinador: ["skater", "skate"],
};

function normalizeSearchText(input: string) {
	return input
		.toLowerCase()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/[^a-z0-9\s]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function tokenizeNormalized(input: string) {
	if (!input) return [] as string[];
	return input.split(" ").filter((token) => token.length > 1);
}

function isEditDistanceAtMostOne(a: string, b: string) {
	if (a === b) return true;
	if (Math.abs(a.length - b.length) > 1) return false;

	let i = 0;
	let j = 0;
	let diffs = 0;

	while (i < a.length && j < b.length) {
		if (a[i] === b[j]) {
			i += 1;
			j += 1;
			continue;
		}

		diffs += 1;
		if (diffs > 1) return false;

		if (a.length > b.length) {
			i += 1;
		} else if (b.length > a.length) {
			j += 1;
		} else {
			i += 1;
			j += 1;
		}
	}

	if (i < a.length || j < b.length) diffs += 1;
	return diffs <= 1;
}

function buildExpandedSearchTerms(query: string) {
	const normalized = normalizeSearchText(query);
	if (!normalized) return [] as string[];

	const terms = new Set<string>();
	terms.add(normalized);

	const tokens = tokenizeNormalized(normalized);
	for (const token of tokens) terms.add(token);

	const direct = SEARCH_SYNONYMS[normalized] ?? [];
	for (const value of direct) terms.add(normalizeSearchText(value));

	for (const token of tokens) {
		const mapped = SEARCH_SYNONYMS[token] ?? [];
		for (const value of mapped) {
			const normalizedValue = normalizeSearchText(value);
			terms.add(normalizedValue);
			for (const childToken of tokenizeNormalized(normalizedValue)) terms.add(childToken);
		}
	}

	return [...terms].filter((term) => term.length > 0);
}

function matchesSearchTerms(input: string, terms: string[]) {
	if (terms.length === 0) return true;

	const normalizedInput = normalizeSearchText(input);
	if (!normalizedInput) return false;
	const words = tokenizeNormalized(normalizedInput);

	for (const term of terms) {
		if (normalizedInput.includes(term)) return true;
		for (const word of words) {
			if (word.startsWith(term) || term.startsWith(word)) return true;
			if (term.length >= 4 && word.length >= 4 && isEditDistanceAtMostOne(term, word)) return true;
		}
	}

	return false;
}

export default function MinifigurasPage() {
	const router = useRouter();
	const [showFilterModal, setShowFilterModal] = useState(false);
	const [searchInput, setSearchInput] = useState("");
	const [viewMode, setViewMode] = useState<FigureViewMode>("all");
	const [missingSeriesFilterThemeId, setMissingSeriesFilterThemeId] = useState<number | null>(null);
	const [themes, setThemes] = useState<MinifigureTheme[]>([]);
	const [selectedThemeIds, setSelectedThemeIds] = useState<number[]>([]);
	const [favoriteThemeIds, setFavoriteThemeIds] = useState<number[]>([]);
	const [showOnlyFavoriteThemes, setShowOnlyFavoriteThemes] = useState(false);
	const [loadingThemes, setLoadingThemes] = useState(false);
	const [themeError, setThemeError] = useState<string | null>(null);
	const [selectionStatus, setSelectionStatus] = useState<string | null>(null);
	const [favoriteStatus, setFavoriteStatus] = useState<string | null>(null);
	const [ownedStatus, setOwnedStatus] = useState<string | null>(null);
	const [expandedThemeIds, setExpandedThemeIds] = useState<number[]>([]);
	const [figuresByThemeId, setFiguresByThemeId] = useState<Record<number, MinifigureEntry[]>>({});
	const [loadingFiguresByThemeId, setLoadingFiguresByThemeId] = useState<Record<number, boolean>>({});
	const [showPartsModal, setShowPartsModal] = useState(false);
	const [showResetConfirmModal, setShowResetConfirmModal] = useState(false);
	const [resettingCollection, setResettingCollection] = useState(false);
	const [zoomImageUrl, setZoomImageUrl] = useState<string | null>(null);
	const [zoomImageName, setZoomImageName] = useState("");
	const [partsModalTitle, setPartsModalTitle] = useState("");
	const [partsModalSetNum, setPartsModalSetNum] = useState("");
	const [partsModalFigureKey, setPartsModalFigureKey] = useState("");
	const [partsLoading, setPartsLoading] = useState(false);
	const [partsError, setPartsError] = useState<string | null>(null);
	const [partsSaveStatus, setPartsSaveStatus] = useState<string | null>(null);
	const [partsRows, setPartsRows] = useState<MinifigurePart[]>([]);
	const [partsCheckedByKey, setPartsCheckedByKey] = useState<Record<string, boolean>>({});
	const [missingPartsByFigureKey, setMissingPartsByFigureKey] = useState<Record<string, MissingPartEntry[]>>({});
	const [ownedByFigureKey, setOwnedByFigureKey] = useState<Record<string, boolean>>({});
	const [favoriteByFigureKey, setFavoriteByFigureKey] = useState<Record<string, boolean>>({});
	const [missingPartImages, setMissingPartImages] = useState<PartImageLookup>({});
	const [showOnlyFavoriteFigures, setShowOnlyFavoriteFigures] = useState(false);
	const userMetadataRef = useRef<Record<string, unknown>>({});
	const missingPartImageInFlightRef = useRef<Set<string>>(new Set());
	const partsUncheckedRef = useRef<Record<string, string[]>>({});
	const missingPartsRef = useRef<Record<string, MissingPartEntry[]>>({});
	const partsPersistQueueRef = useRef<Promise<void>>(Promise.resolve());
	const allFiguresLoadedForSearchRef = useRef(false);
	const [loadingAllFiguresForSearch, setLoadingAllFiguresForSearch] = useState(false);

	function getFigureKey(themeId: number, figureName: string) {
		return `${themeId}:${figureName.trim().toLowerCase()}`;
	}

	function getPartRowKey(part: MinifigurePart, index: number) {
		return `${part.part_num}:${part.color_name ?? "sin-color"}:${part.is_spare ? "extra" : "normal"}:${index}`;
	}

	function getPartImageKey(partNum: string, colorName: string | null | undefined) {
		const normalizedColor = (colorName ?? "")
			.replace(/\(chino\)/gi, "")
			.toLowerCase()
			.replace(/\s+/g, " ")
			.trim();
		return `${partNum.trim()}::${normalizedColor}`;
	}

	async function loadMissingPartImages(items: PartImageRequestItem[]) {
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
			if (!uniqueByKey.has(key)) uniqueByKey.set(key, item);
		}

		const missingItems = [...uniqueByKey.entries()]
			.filter(([key]) => !(key in missingPartImages) && !missingPartImageInFlightRef.current.has(key))
			.map(([, item]) => item);

		if (missingItems.length === 0) return;

		const chunkSize = 80;
		for (let index = 0; index < missingItems.length; index += chunkSize) {
			const chunk = missingItems.slice(index, index + chunkSize);
			const requestedKeys = chunk.map((item) => getPartImageKey(item.part_num, item.color_name));
			for (const key of requestedKeys) missingPartImageInFlightRef.current.add(key);

			try {
				const response = await fetch("/api/rebrickable/part-images", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ items: chunk }),
				});

				if (!response.ok) continue;

				const payload = (await response.json()) as {
					results?: Array<{ key: string; part_img_url: string | null }>;
				};

				const additions: PartImageLookup = {};
				for (const row of payload.results ?? []) {
					if (!row.key) continue;
					additions[row.key] = row.part_img_url;
				}

				for (const key of requestedKeys) {
					if (!(key in additions)) additions[key] = null;
				}

				setMissingPartImages((current) => ({ ...current, ...additions }));
			} finally {
				for (const key of requestedKeys) missingPartImageInFlightRef.current.delete(key);
			}
		}
	}

	useEffect(() => {
		if (selectedThemeIds.length === 0) return;
		if (themes.length === 0) {
			void loadThemes();
		}
		for (const themeId of selectedThemeIds) {
			void loadFiguresForTheme(themeId);
		}
	}, [selectedThemeIds, themes.length]);

	useEffect(() => {
		const normalizedSearch = normalizeSearchText(searchInput);
		if (!normalizedSearch || allFiguresLoadedForSearchRef.current) return;

		let cancelled = false;

		void (async () => {
			setLoadingAllFiguresForSearch(true);
			const themeSource = themes.length > 0 ? themes : await loadThemes();
			for (const theme of themeSource) {
				if (cancelled) break;
				await loadFiguresForTheme(theme.id);
			}
			if (!cancelled) {
				allFiguresLoadedForSearchRef.current = true;
			}
		})().finally(() => {
			if (!cancelled) {
				setLoadingAllFiguresForSearch(false);
			}
		});

		return () => {
			cancelled = true;
		};
	}, [searchInput, themes]);

	useEffect(() => {
		let mounted = true;

		void (async () => {
			try {
				const supabase = getSupabaseClient();
				const {
					data: { user },
				} = await supabase.auth.getUser();

				if (!mounted || !user) return;

				const canAccessMinifiguras = await canAccessModule(supabase, user.email, "minifiguras");
				if (!canAccessMinifiguras) {
					router.replace("/dashboard");
					return;
				}

				const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;
				userMetadataRef.current = metadata;

				const saved = metadata[MINIFIGURAS_THEME_IDS_KEY];
				const parsed = Array.isArray(saved)
					? saved
							.map((value) => Number(value))
							.filter((value) => Number.isFinite(value) && value > 0)
					: [];

				setSelectedThemeIds([...new Set(parsed)]);

				const favoritesSaved = metadata[MINIFIGURAS_FAVORITE_THEME_IDS_KEY];
				const parsedFavorites = Array.isArray(favoritesSaved)
					? favoritesSaved
							.map((value) => Number(value))
							.filter((value) => Number.isFinite(value) && value > 0)
					: [];
				setFavoriteThemeIds([...new Set(parsedFavorites)]);

				const ownedRaw = metadata[MINIFIGURAS_OWNED_KEY];
				if (ownedRaw && typeof ownedRaw === "object" && !Array.isArray(ownedRaw)) {
					const nextOwned: Record<string, boolean> = {};
					for (const [key, value] of Object.entries(ownedRaw)) {
						if (value === true) nextOwned[key] = true;
					}
					setOwnedByFigureKey(nextOwned);
				}

				const favoriteFiguresRaw = metadata[MINIFIGURAS_FAVORITE_FIGURES_KEY];
				if (favoriteFiguresRaw && typeof favoriteFiguresRaw === "object" && !Array.isArray(favoriteFiguresRaw)) {
					const nextFavorites: Record<string, boolean> = {};
					for (const [key, value] of Object.entries(favoriteFiguresRaw)) {
						if (value === true) nextFavorites[key] = true;
					}
					setFavoriteByFigureKey(nextFavorites);
				}

				const partsUncheckedRaw = metadata[MINIFIGURAS_PARTS_UNCHECKED_KEY];
				if (partsUncheckedRaw && typeof partsUncheckedRaw === "object" && !Array.isArray(partsUncheckedRaw)) {
					const nextUnchecked: Record<string, string[]> = {};
					for (const [figureKey, value] of Object.entries(partsUncheckedRaw)) {
						if (!Array.isArray(value)) continue;
						nextUnchecked[figureKey] = value.filter((item): item is string => typeof item === "string");
					}
					partsUncheckedRef.current = nextUnchecked;
				}

				const missingPartsRaw = metadata[MINIFIGURAS_MISSING_PARTS_KEY];
				if (missingPartsRaw && typeof missingPartsRaw === "object" && !Array.isArray(missingPartsRaw)) {
					const nextMissing: Record<string, MissingPartEntry[]> = {};
					for (const [figureKey, value] of Object.entries(missingPartsRaw)) {
						if (!Array.isArray(value)) continue;
						const parsed = value
							.map((item) => {
								if (!item || typeof item !== "object") return null;
								const partNum = typeof item.part_num === "string" ? item.part_num.trim().toUpperCase() : "";
								const name = typeof item.name === "string" ? item.name.trim() : "";
								const color = typeof item.color_name === "string" ? item.color_name.trim() : null;
								if (!partNum || !name) return null;
								return { part_num: partNum, name, color_name: color || null };
							})
							.filter((item): item is MissingPartEntry => Boolean(item));

						if (parsed.length > 0) {
							nextMissing[figureKey] = parsed;
						}
					}
					missingPartsRef.current = nextMissing;
					setMissingPartsByFigureKey(nextMissing);
					void syncMissingPartsList(user.id, nextMissing).catch(() => undefined);
				}
			} catch {
				if (mounted) {
					setSelectionStatus("No se pudo cargar tu seleccion guardada.");
				}
			}
		})();

		return () => {
			mounted = false;
		};
	}, [router]);

	async function loadThemes() {
		if (themes.length > 0) return themes;
		setLoadingThemes(true);
		setThemeError(null);

		try {
			const response = await fetch("/api/rebrickable/minifigures/themes", { cache: "no-store" });
			const payload = (await response.json()) as { results?: MinifigureTheme[]; error?: string };

			if (!response.ok) {
				setThemeError(payload.error ?? "No se pudo cargar la lista de minifiguras.");
				return [];
			}

			const loaded = payload.results ?? [];
			setThemes(loaded);
			setExpandedThemeIds([]);
			return loaded;
		} catch {
			setThemeError("No se pudo cargar la lista de minifiguras.");
			return [];
		} finally {
			setLoadingThemes(false);
		}
	}

	async function saveFavoriteThemes(themeIds: number[]) {
		try {
			setFavoriteStatus("Guardando favoritas...");
			const supabase = getSupabaseClient();
			const {
				data: { user },
			} = await supabase.auth.getUser();

			if (!user) {
				setFavoriteStatus("Inicia sesion para guardar favoritas.");
				return;
			}

			const baseMetadata = {
				...((user.user_metadata ?? {}) as Record<string, unknown>),
				...userMetadataRef.current,
			};

			const nextMetadata = {
				...baseMetadata,
				[MINIFIGURAS_FAVORITE_THEME_IDS_KEY]: themeIds,
			};
			userMetadataRef.current = nextMetadata;

			const { data, error } = await supabase.auth.updateUser({ data: nextMetadata });
			if (error) {
				setFavoriteStatus("No se pudo guardar favoritas.");
				return;
			}

			userMetadataRef.current = (data.user?.user_metadata ?? nextMetadata) as Record<string, unknown>;
			setFavoriteStatus("Favoritas guardadas.");
		} catch {
			setFavoriteStatus("No se pudo guardar favoritas.");
		}
	}

	function toggleFavoriteTheme(themeId: number) {
		setFavoriteThemeIds((current) => {
			const next = current.includes(themeId) ? current.filter((id) => id !== themeId) : [...current, themeId];
			void saveFavoriteThemes(next);
			return next;
		});
	}

	function openFilterModal() {
		setShowFilterModal(true);
		void loadThemes();
	}

	function toggleTheme(themeId: number) {
		setSelectedThemeIds((current) => {
			const next = current.includes(themeId) ? current.filter((id) => id !== themeId) : [...current, themeId];
			void saveThemeSelection(next);
			return next;
		});
	}

	function selectAllVisibleThemes(themeIds: number[]) {
		setSelectedThemeIds((current) => {
			const next = [...new Set([...current, ...themeIds])];
			void saveThemeSelection(next);
			return next;
		});
	}

	function deselectAllVisibleThemes(themeIds: number[]) {
		const idsToRemove = new Set(themeIds);
		setSelectedThemeIds((current) => {
			const next = current.filter((id) => !idsToRemove.has(id));
			void saveThemeSelection(next);
			return next;
		});
	}

	async function saveThemeSelection(themeIds: number[]) {
		try {
			setSelectionStatus("Guardando seleccion...");
			const supabase = getSupabaseClient();
			const {
				data: { user },
			} = await supabase.auth.getUser();

			if (!user) {
				setSelectionStatus("Inicia sesion para guardar la seleccion.");
				return;
			}

			const baseMetadata = {
				...((user.user_metadata ?? {}) as Record<string, unknown>),
				...userMetadataRef.current,
			};

			const nextMetadata = {
				...baseMetadata,
				[MINIFIGURAS_THEME_IDS_KEY]: themeIds,
			};
			userMetadataRef.current = nextMetadata;

			const { data, error } = await supabase.auth.updateUser({ data: nextMetadata });
			if (error) {
				setSelectionStatus("No se pudo guardar la seleccion.");
				return;
			}

			userMetadataRef.current = (data.user?.user_metadata ?? nextMetadata) as Record<string, unknown>;
			setSelectionStatus("Seleccion guardada.");
		} catch {
			setSelectionStatus("No se pudo guardar la seleccion.");
		}
	}

	async function saveOwnedMap(nextOwnedMap: Record<string, boolean>) {
		try {
			setOwnedStatus("Guardando 'Lo tengo'...");
			const supabase = getSupabaseClient();
			const {
				data: { user },
			} = await supabase.auth.getUser();

			if (!user) {
				setOwnedStatus("Inicia sesion para guardar 'Lo tengo'.");
				return;
			}

			const baseMetadata = {
				...((user.user_metadata ?? {}) as Record<string, unknown>),
				...userMetadataRef.current,
			};

			const nextMetadata = {
				...baseMetadata,
				[MINIFIGURAS_OWNED_KEY]: nextOwnedMap,
			};
			userMetadataRef.current = nextMetadata;

			const { data, error } = await supabase.auth.updateUser({ data: nextMetadata });
			if (error) {
				setOwnedStatus("No se pudo guardar 'Lo tengo'.");
				return;
			}

			userMetadataRef.current = (data.user?.user_metadata ?? nextMetadata) as Record<string, unknown>;
			setOwnedStatus("Guardado.");
		} catch {
			setOwnedStatus("No se pudo guardar 'Lo tengo'.");
		}
	}

	async function saveFavoriteFiguresMap(nextFavoriteMap: Record<string, boolean>) {
		try {
			const supabase = getSupabaseClient();
			const {
				data: { user },
			} = await supabase.auth.getUser();

			if (!user) return;

			const baseMetadata = {
				...((user.user_metadata ?? {}) as Record<string, unknown>),
				...userMetadataRef.current,
			};

			const nextMetadata = {
				...baseMetadata,
				[MINIFIGURAS_FAVORITE_FIGURES_KEY]: nextFavoriteMap,
			};
			userMetadataRef.current = nextMetadata;

			const { data } = await supabase.auth.updateUser({ data: nextMetadata });
			userMetadataRef.current = (data.user?.user_metadata ?? nextMetadata) as Record<string, unknown>;
		} catch {}
	}

	function toggleOwned(themeId: number, figureName: string) {
		const figureKey = getFigureKey(themeId, figureName);
		setOwnedByFigureKey((current) => {
			const next = { ...current };
			if (next[figureKey]) {
				delete next[figureKey];
			} else {
				next[figureKey] = true;
			}
			void saveOwnedMap(next);
			return next;
		});
	}

	function toggleFavoriteFigure(themeId: number, figureName: string) {
		const figureKey = getFigureKey(themeId, figureName);
		setFavoriteByFigureKey((current) => {
			const next = { ...current };
			if (next[figureKey]) {
				delete next[figureKey];
			} else {
				next[figureKey] = true;
			}
			void saveFavoriteFiguresMap(next);
			return next;
		});
	}

	function buildAggregatedMissingItems(missingMap: Record<string, MissingPartEntry[]>) {
		const byKey = new Map<string, { part_num: string; part_name: string; color_name: string | null; quantity: number }>();

		for (const entries of Object.values(missingMap)) {
			for (const entry of entries) {
				const partNum = entry.part_num.trim().toUpperCase();
				if (!partNum) continue;
				const colorName = entry.color_name?.trim() ? entry.color_name.trim() : null;
				const aggregateKey = `${partNum}::${(colorName ?? "").toLowerCase()}`;
				const current = byKey.get(aggregateKey);

				if (!current) {
					byKey.set(aggregateKey, {
						part_num: partNum,
						part_name: entry.name,
						color_name: colorName,
						quantity: 1,
					});
					continue;
				}

				byKey.set(aggregateKey, {
					...current,
					quantity: current.quantity + 1,
				});
			}
		}

		return [...byKey.values()].sort((a, b) => {
			const byPart = a.part_num.localeCompare(b.part_num, "es", { sensitivity: "base" });
			if (byPart !== 0) return byPart;
			return (a.color_name ?? "").localeCompare(b.color_name ?? "", "es", { sensitivity: "base" });
		});
	}

	async function ensureAutoMissingList(ownerId: string) {
		const supabase = getSupabaseClient();
		const { data: existingRows, error: existingError } = await supabase
			.from("lists")
			.select("id,is_public")
			.eq("owner_id", ownerId)
			.in("name", [AUTO_MINIFIG_LIST_NAME, ...LEGACY_AUTO_MINIFIG_LIST_NAMES])
			.order("created_at", { ascending: true });

		if (existingError) {
			throw new Error(existingError.message);
		}

		const existingId = (existingRows?.[0]?.id as string | undefined) ?? null;
		if (existingId) {
			const extras = (existingRows ?? []).slice(1).map((row) => String(row.id));
			for (const extraId of extras) {
				await supabase.from("list_items").delete().eq("list_id", extraId);
				await supabase.from("lists").delete().eq("id", extraId);
			}

			await supabase.from("lists").update({ name: AUTO_MINIFIG_LIST_NAME }).eq("id", existingId);
			return existingId;
		}

		const { data: createdRow, error: createError } = await supabase
			.from("lists")
			.insert({
				owner_id: ownerId,
				name: AUTO_MINIFIG_LIST_NAME,
				is_public: false,
				status: "draft",
			})
			.select("id")
			.single();

		if (createError || !createdRow?.id) {
			throw new Error(createError?.message ?? "No se pudo crear lista automatica de minifiguras.");
		}

		return createdRow.id as string;
	}

	function queuePersistPartsState(nextUncheckedMap: Record<string, string[]>, nextMissingMap: Record<string, MissingPartEntry[]>) {
		const uncheckedSnapshot: Record<string, string[]> = {};
		for (const [figureKey, values] of Object.entries(nextUncheckedMap)) {
			uncheckedSnapshot[figureKey] = [...values];
		}

		const missingSnapshot: Record<string, MissingPartEntry[]> = {};
		for (const [figureKey, values] of Object.entries(nextMissingMap)) {
			missingSnapshot[figureKey] = values.map((value) => ({ ...value }));
		}

		partsPersistQueueRef.current = partsPersistQueueRef.current
			.catch(() => undefined)
			.then(() => persistPartsState(uncheckedSnapshot, missingSnapshot));
	}

	async function syncMissingPartsList(ownerId: string, missingMap: Record<string, MissingPartEntry[]>) {
		const supabase = getSupabaseClient();
		const items = buildAggregatedMissingItems(missingMap);

		if (items.length === 0) {
			const { data: existingRows } = await supabase
				.from("lists")
				.select("id")
				.eq("owner_id", ownerId)
				.in("name", [AUTO_MINIFIG_LIST_NAME, ...LEGACY_AUTO_MINIFIG_LIST_NAMES]);

			const existingIds = (existingRows ?? []).map((row) => String(row.id));
			if (existingIds.length > 0) {
				await supabase.from("list_items").delete().in("list_id", existingIds);
			}

			await supabase
				.from("lists")
				.delete()
				.eq("owner_id", ownerId)
				.in("name", [AUTO_MINIFIG_LIST_NAME, ...LEGACY_AUTO_MINIFIG_LIST_NAMES]);

			return;
		}

		const listId = await ensureAutoMissingList(ownerId);

		const { error: deleteError } = await supabase.from("list_items").delete().eq("list_id", listId);
		if (deleteError) {
			throw new Error(deleteError.message);
		}

		const { error: insertError } = await supabase.from("list_items").insert(
			items.map((item) => ({
				list_id: listId,
				part_num: item.part_num,
				part_name: item.part_name,
				color_name: item.color_name,
				quantity: item.quantity,
			})),
		);

		if (insertError) {
			throw new Error(insertError.message);
		}
	}

	async function persistPartsState(nextUncheckedMap: Record<string, string[]>, nextMissingMap: Record<string, MissingPartEntry[]>) {
		try {
			setPartsSaveStatus("Guardando piezas...");
			const supabase = getSupabaseClient();
			const {
				data: { user },
			} = await supabase.auth.getUser();

			if (!user) {
				setPartsSaveStatus("Inicia sesion para guardar piezas.");
				return;
			}

			const baseMetadata = {
				...((user.user_metadata ?? {}) as Record<string, unknown>),
				...userMetadataRef.current,
			};

			const nextMetadata = {
				...baseMetadata,
				[MINIFIGURAS_PARTS_UNCHECKED_KEY]: nextUncheckedMap,
				[MINIFIGURAS_MISSING_PARTS_KEY]: nextMissingMap,
			};
			userMetadataRef.current = nextMetadata;

			const updateResult = await supabase.auth.updateUser({ data: nextMetadata });
			const metadataError = updateResult.error;

			let syncError: Error | null = null;
			try {
				await syncMissingPartsList(user.id, nextMissingMap);
			} catch (error) {
				syncError = error instanceof Error ? error : new Error("sync-missing-list-failed");
			}

			if (metadataError || syncError) {
				setPartsSaveStatus("No se pudo guardar piezas.");
				return;
			}

			userMetadataRef.current = (updateResult.data.user?.user_metadata ?? nextMetadata) as Record<string, unknown>;
			setPartsSaveStatus("Piezas guardadas.");
		} catch {
			setPartsSaveStatus("No se pudo guardar piezas.");
		}
	}

	async function openPartsModal(figure: { name: string; setNum: string; figureKey: string }) {
		setShowPartsModal(true);
		setPartsModalTitle(figure.name);
		setPartsModalSetNum(figure.setNum);
		setPartsModalFigureKey(figure.figureKey);
		setPartsError(null);
		setPartsSaveStatus(null);
		setPartsRows([]);
		setPartsCheckedByKey({});
		setPartsLoading(true);

		try {
			const response = await fetch(`/api/rebrickable/minifigures/parts?set_num=${encodeURIComponent(figure.setNum)}`, {
				cache: "no-store",
			});
			const payload = (await response.json()) as { results?: MinifigurePart[]; error?: string };
			if (!response.ok) {
				setPartsError(payload.error ?? "No se pudieron cargar las piezas.");
				return;
			}
			const rows = payload.results ?? [];
			const expandedRows = rows.flatMap((part) => {
				const copies = Number.isFinite(part.quantity) && part.quantity > 0 ? Math.floor(part.quantity) : 1;
				return Array.from({ length: copies }, () => ({ ...part, quantity: 1 }));
			});
			setPartsRows(expandedRows);
			const uncheckedForFigure = new Set(partsUncheckedRef.current[figure.figureKey] ?? []);
			const defaults: Record<string, boolean> = {};
			expandedRows.forEach((part, index) => {
				const rowKey = getPartRowKey(part, index);
				defaults[rowKey] = !uncheckedForFigure.has(rowKey);
			});
			setPartsCheckedByKey(defaults);
		} catch {
			setPartsError("No se pudieron cargar las piezas.");
		} finally {
			setPartsLoading(false);
		}
	}

	function persistPartsSelection(nextChecked: Record<string, boolean>) {
		if (!partsModalFigureKey) return;

		const uncheckedRows = Object.entries(nextChecked)
			.filter(([, checked]) => checked === false)
			.map(([key]) => key);

		const missingEntries = partsRows.flatMap((row, rowIndex) => {
			const currentRowKey = getPartRowKey(row, rowIndex);
			if (nextChecked[currentRowKey] !== false) return [];
			return [
				{
					part_num: row.part_num.trim().toUpperCase(),
					name: row.name,
					color_name: row.color_name,
				},
			];
		});

		const nextUnchecked = { ...partsUncheckedRef.current };
		if (uncheckedRows.length > 0) {
			nextUnchecked[partsModalFigureKey] = uncheckedRows;
		} else {
			delete nextUnchecked[partsModalFigureKey];
		}
		partsUncheckedRef.current = nextUnchecked;

		const nextMissing = { ...missingPartsRef.current };
		if (missingEntries.length > 0) {
			nextMissing[partsModalFigureKey] = missingEntries;
		} else {
			delete nextMissing[partsModalFigureKey];
		}
		missingPartsRef.current = nextMissing;
		setMissingPartsByFigureKey(nextMissing);

		queuePersistPartsState(nextUnchecked, nextMissing);
	}

	function togglePartChecked(part: MinifigurePart, index: number) {
		const rowKey = getPartRowKey(part, index);
		setPartsCheckedByKey((current) => {
			const nextChecked = {
				...current,
				[rowKey]: !(current[rowKey] ?? true),
			};

			persistPartsSelection(nextChecked);

			return nextChecked;
		});
	}

	function markAllPartsInModal() {
		const nextChecked: Record<string, boolean> = {};
		partsRows.forEach((part, index) => {
			nextChecked[getPartRowKey(part, index)] = true;
		});
		setPartsCheckedByKey(nextChecked);
		persistPartsSelection(nextChecked);
	}

	function unmarkAllPartsInModal() {
		const nextChecked: Record<string, boolean> = {};
		partsRows.forEach((part, index) => {
			nextChecked[getPartRowKey(part, index)] = false;
		});
		setPartsCheckedByKey(nextChecked);
		persistPartsSelection(nextChecked);
	}

	function resetPartsInModal() {
		markAllPartsInModal();
	}

	function openImageZoom(imageUrl: string, name: string) {
		setZoomImageUrl(imageUrl);
		setZoomImageName(name);
	}

	async function resetMinifigureCollection() {
		setResettingCollection(true);
		setSelectionStatus(null);
		setOwnedStatus(null);
		setFavoriteStatus(null);
		setPartsSaveStatus(null);

		try {
			const supabase = getSupabaseClient();
			const {
				data: { user },
			} = await supabase.auth.getUser();

			if (!user) {
				setSelectionStatus("Inicia sesion para reiniciar la coleccion.");
				return;
			}

			const baseMetadata = {
				...((user.user_metadata ?? {}) as Record<string, unknown>),
				...userMetadataRef.current,
			};

			const nextMetadata = {
				...baseMetadata,
				[MINIFIGURAS_THEME_IDS_KEY]: [],
				[MINIFIGURAS_FAVORITE_THEME_IDS_KEY]: [],
				[MINIFIGURAS_FAVORITE_FIGURES_KEY]: {},
				[MINIFIGURAS_OWNED_KEY]: {},
				[MINIFIGURAS_PARTS_UNCHECKED_KEY]: {},
				[MINIFIGURAS_MISSING_PARTS_KEY]: {},
			};
			userMetadataRef.current = nextMetadata;

			const { data, error } = await supabase.auth.updateUser({ data: nextMetadata });
			if (error) {
				setSelectionStatus("No se pudo reiniciar la coleccion de minifiguras.");
				return;
			}

			await syncMissingPartsList(user.id, {});

			userMetadataRef.current = (data.user?.user_metadata ?? nextMetadata) as Record<string, unknown>;
			partsUncheckedRef.current = {};
			missingPartsRef.current = {};
			allFiguresLoadedForSearchRef.current = false;
			setSelectedThemeIds([]);
			setFavoriteThemeIds([]);
			setOwnedByFigureKey({});
			setFavoriteByFigureKey({});
			setMissingPartsByFigureKey({});
			setPartsCheckedByKey({});
			setPartsRows([]);
			setFiguresByThemeId({});
			setLoadingFiguresByThemeId({});
			setExpandedThemeIds([]);
			setSearchInput("");
			setShowOnlyFavoriteThemes(false);
			setShowOnlyFavoriteFigures(false);
			setViewMode("all");
			setMissingSeriesFilterThemeId(null);
			setShowFilterModal(false);
			setShowPartsModal(false);
			setZoomImageUrl(null);
			setZoomImageName("");
			setShowResetConfirmModal(false);
			setSelectionStatus("Coleccion de minifiguras reiniciada.");
		} catch {
			setSelectionStatus("No se pudo reiniciar la coleccion de minifiguras.");
		} finally {
			setResettingCollection(false);
		}
	}

	async function loadFiguresForTheme(themeId: number): Promise<MinifigureEntry[]> {
		if (figuresByThemeId[themeId]) return figuresByThemeId[themeId] ?? [];
		if (loadingFiguresByThemeId[themeId]) return figuresByThemeId[themeId] ?? [];

		setLoadingFiguresByThemeId((current) => ({ ...current, [themeId]: true }));
		try {
			const response = await fetch(`/api/rebrickable/minifigures/themes/${themeId}/figures`, { cache: "no-store" });
			const payload = (await response.json()) as { results?: MinifigureEntry[] };
			if (!response.ok) return [];
			const rows = payload.results ?? [];
			setFiguresByThemeId((current) => ({ ...current, [themeId]: rows }));
			return rows;
		} catch {
			return [];
		} finally {
			setLoadingFiguresByThemeId((current) => ({ ...current, [themeId]: false }));
		}
	}

	function toggleExpandedTheme(themeId: number) {
		setExpandedThemeIds((current) => {
			if (current.includes(themeId)) return current.filter((id) => id !== themeId);
			return [...current, themeId];
		});

		void loadFiguresForTheme(themeId);
	}

	async function applyOwnedToTheme(themeId: number, shouldOwn: boolean) {
		const figures = await loadFiguresForTheme(themeId);
		if (figures.length === 0) return;

		setOwnedByFigureKey((current) => {
			const next = { ...current };
			for (const figure of figures) {
				const figureKey = getFigureKey(themeId, figure.name);
				if (shouldOwn) {
					next[figureKey] = true;
				} else {
					delete next[figureKey];
				}
			}
			void saveOwnedMap(next);
			return next;
		});

		setSelectedThemeIds((current) => {
			if (current.includes(themeId)) return current;
			const next = [...current, themeId];
			void saveThemeSelection(next);
			return next;
		});
	}

	function showOnlyMissingFromTheme(themeId: number) {
		setSelectedThemeIds((current) => {
			if (current.includes(themeId)) return current;
			const next = [...current, themeId];
			void saveThemeSelection(next);
			return next;
		});
		void loadFiguresForTheme(themeId);
		setViewMode("missing");
		setMissingSeriesFilterThemeId(themeId);
		setShowFilterModal(false);
	}

	function countOwnedInTheme(themeId: number) {
		const prefix = `${themeId}:`;
		let count = 0;
		for (const [key, isOwned] of Object.entries(ownedByFigureKey)) {
			if (!isOwned) continue;
			if (key.startsWith(prefix)) count += 1;
		}
		return count;
	}

	const selectedThemeCards = selectedThemeIds.flatMap((themeId) => {
		const figures = figuresByThemeId[themeId] ?? [];
		const themeName = themes.find((theme) => theme.id === themeId)?.name ?? `Serie ${themeId}`;
		return figures.map((figure) => ({ ...figure, themeName, themeId, figureKey: getFigureKey(themeId, figure.name) }));
	});

	const allThemeCards = themes.flatMap((theme) => {
		const figures = figuresByThemeId[theme.id] ?? [];
		return figures.map((figure) => ({ ...figure, themeName: theme.name, themeId: theme.id, figureKey: getFigureKey(theme.id, figure.name) }));
	});

	const normalizedSearch = normalizeSearchText(searchInput);
	const expandedSearchTerms = buildExpandedSearchTerms(searchInput);
	const ownedFigureKeys = Object.entries(ownedByFigureKey)
		.filter(([, isOwned]) => isOwned)
		.map(([figureKey]) => figureKey);
	const favoriteTotal = Object.values(favoriteByFigureKey).filter(Boolean).length;
	const ownedTotal = ownedFigureKeys.length;
	const ownedWithMissing = ownedFigureKeys.filter((figureKey) => (missingPartsByFigureKey[figureKey]?.length ?? 0) > 0).length;
	const ownedComplete = Math.max(0, ownedTotal - ownedWithMissing);
	const baseCards = normalizedSearch
		? allThemeCards.filter((figure) => {
			const inName = matchesSearchTerms(figure.name, expandedSearchTerms);
			const inTheme = matchesSearchTerms(figure.themeName, expandedSearchTerms);
			const hiddenTags = getHiddenSearchTagsForMinifigure(figure.setNum, figure.name, figure.themeName);
			const inHiddenTags = hiddenTags.length > 0 ? matchesSearchTerms(hiddenTags.join(" "), expandedSearchTerms) : false;
			return inName || inTheme || inHiddenTags;
		})
		: selectedThemeCards;

	const visibleCards = baseCards.filter((figure) => {
		const isOwned = ownedByFigureKey[figure.figureKey] === true;
		const hasMissingPieces = (missingPartsByFigureKey[figure.figureKey]?.length ?? 0) > 0;
		const isFavoriteFigure = favoriteByFigureKey[figure.figureKey] === true;

		if (showOnlyFavoriteFigures && !isFavoriteFigure) return false;

		if (missingSeriesFilterThemeId !== null) {
			if (figure.themeId !== missingSeriesFilterThemeId) return false;
			if (!(isOwned && hasMissingPieces)) return false;
		}

		if (viewMode === "missing") return isOwned && hasMissingPieces;
		if (viewMode === "complete") return isOwned && !hasMissingPieces;
		return true;
	});

	const sortedThemes = [...themes].sort((a, b) => {
		const yearA = typeof a.year === "number" ? a.year : Number.POSITIVE_INFINITY;
		const yearB = typeof b.year === "number" ? b.year : Number.POSITIVE_INFINITY;
		if (yearA !== yearB) return yearA - yearB;

		return a.name.localeCompare(b.name, "es", { sensitivity: "base" });
	});

	const visibleThemesInFilter = showOnlyFavoriteThemes
		? sortedThemes.filter((theme) => favoriteThemeIds.includes(theme.id))
		: sortedThemes;
    const visibleThemeIdsInFilter = visibleThemesInFilter.map((theme) => theme.id);

	const missingSeriesThemeName =
		missingSeriesFilterThemeId !== null
			? themes.find((theme) => theme.id === missingSeriesFilterThemeId)?.name ?? `Serie ${missingSeriesFilterThemeId}`
			: "";

	useEffect(() => {
		const previewItems: PartImageRequestItem[] = [];
		for (const figure of visibleCards) {
			const missing = (missingPartsByFigureKey[figure.figureKey] ?? []).slice(0, 3);
			for (const part of missing) {
				previewItems.push({ part_num: part.part_num, color_name: part.color_name });
			}
		}
		void loadMissingPartImages(previewItems);
	}, [visibleCards, missingPartsByFigureKey]);

	const renderFigureCard = (figure: (typeof visibleCards)[number]) => {
		const isOwned = ownedByFigureKey[figure.figureKey] === true;
		const isFavoriteFigure = favoriteByFigureKey[figure.figureKey] === true;
		const totalMissingCount = missingPartsByFigureKey[figure.figureKey]?.length ?? 0;
		const hasMissingPieces = totalMissingCount > 0;
		const missingPreview = (missingPartsByFigureKey[figure.figureKey] ?? []).slice(0, 3);
		const shouldShowMissingCountTile = totalMissingCount > 3;
		const imagePreviewParts = shouldShowMissingCountTile ? missingPreview.slice(0, 2) : missingPreview;
		const cardTone = !isOwned ? "base" : hasMissingPieces ? "owned-light" : "owned-dark";
		const imageContainerClass = hasMissingPieces
			? "relative h-[160px] overflow-hidden rounded-md bg-white"
			: "relative aspect-square overflow-hidden rounded-md bg-white";
		const favoriteButtonClass = hasMissingPieces
			? "absolute right-1 top-1 z-10 inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/90 shadow"
			: "absolute right-1 top-1 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/90 shadow";
		const favoriteIconClass = hasMissingPieces
			? `h-5 w-5 ${isFavoriteFigure ? "text-rose-500" : "text-slate-400"}`
			: `h-7 w-7 ${isFavoriteFigure ? "text-rose-500" : "text-slate-400"}`;
		const mainImageClass = hasMissingPieces ? "h-full w-full object-contain p-1" : "h-full w-full object-contain";

		return (
			<article
				key={`${figure.themeId}:${figure.name}`}
				className={`rounded-lg border p-1 ${
					cardTone === "owned-dark"
						? "border-[#025080] bg-[#025080]"
						: cardTone === "owned-light"
							? "border-[#5aa5d3] bg-[#5aa5d3]"
							: "border-slate-200 bg-white"
				}`}
			>
				<div className={imageContainerClass}>
					<button
						type="button"
						onClick={() => toggleFavoriteFigure(figure.themeId, figure.name)}
						className={favoriteButtonClass}
						title={isFavoriteFigure ? "Quitar favorita" : "Marcar favorita"}
					>
						<svg
							viewBox="0 0 24 24"
							className={favoriteIconClass}
							fill={isFavoriteFigure ? "currentColor" : "none"}
							stroke="currentColor"
							strokeWidth="1.7"
							aria-hidden="true"
						>
							<path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09A5.98 5.98 0 0 1 16.5 3C19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
						</svg>
					</button>
					{figure.imageUrl ? (
						<button
							type="button"
							onClick={() => openImageZoom(figure.imageUrl ?? "", figure.name)}
							className="block h-full w-full"
							title="Ver imagen ampliada"
						>
							<img src={figure.imageUrl} alt={figure.name} loading="lazy" className={mainImageClass} />
						</button>
					) : (
						<div className="flex h-full w-full items-center justify-center text-[11px] text-slate-400">Sin imagen</div>
					)}
				</div>
				<p className={`mt-1 line-clamp-2 text-[10px] font-medium ${cardTone === "base" ? "text-slate-900" : "text-blue-50"}`}>{figure.name}</p>
				<p className={`mt-0.5 text-[9px] ${cardTone === "base" ? "text-slate-500" : "text-blue-200"}`}>{figure.themeName}</p>
				{hasMissingPieces && missingPreview.length > 0 ? (
					<div className="mt-1 grid grid-cols-3 gap-1">
						{imagePreviewParts.map((part, index) => {
							const partKey = getPartImageKey(part.part_num, part.color_name);
							const partImageUrl = missingPartImages[partKey] ?? null;
							return (
								<div key={`${figure.figureKey}:${part.part_num}:${part.color_name ?? "sin-color"}:${index}`} className="overflow-hidden rounded border border-slate-300 bg-white">
									{partImageUrl ? (
										<button
											type="button"
											onClick={() => openImageZoom(partImageUrl, `${part.name} (${part.part_num})`)}
											title={`${part.name} (${part.part_num})`}
											className="block h-9 w-full"
										>
											<img src={partImageUrl} alt={`${part.name} ${part.part_num}`} loading="lazy" className="h-full w-full object-contain p-0.5" />
										</button>
									) : (
										<div className="flex h-9 w-full items-center justify-center text-[8px] text-slate-500">{part.part_num}</div>
									)}
								</div>
							);
						})}
						{shouldShowMissingCountTile ? (
							<div className="flex h-9 w-full flex-col items-center justify-center rounded border border-slate-300 bg-white px-1 text-center text-slate-700">
								<span className="text-sm font-bold leading-none">{totalMissingCount}</span>
								<span className="text-[7px] font-semibold uppercase tracking-wide leading-none">faltantes</span>
							</div>
						) : null}
					</div>
				) : null}
				<div className="mt-1 flex items-center justify-between gap-1">
					<label className={`flex cursor-pointer items-center gap-1 text-[10px] ${cardTone === "base" ? "text-slate-700" : "text-blue-50"}`}>
						<input type="checkbox" checked={isOwned} onChange={() => toggleOwned(figure.themeId, figure.name)} className="h-3 w-3 rounded border-slate-300" />
						<span>Lo tengo</span>
					</label>
					<button
						type="button"
						onClick={() => void openPartsModal({ name: figure.name, setNum: figure.setNum, figureKey: figure.figureKey })}
						disabled={!figure.setNum}
						className={`rounded-md border px-1 py-0.5 text-[9px] font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${cardTone === "base" ? "border-slate-300 text-slate-700 hover:bg-slate-100" : "border-blue-300 text-blue-50 hover:bg-blue-800"}`}
					>
						Piezas
					</button>
				</div>
			</article>
		);
	};

	return (
		<div className="bg-lego-tile min-h-screen px-3 py-5 sm:px-5 sm:py-7">
			<main className="mx-auto w-full max-w-6xl rounded-2xl bg-white p-4 shadow-xl sm:p-6">
				<div className="border-b border-slate-200 pb-4">
					<div className="flex items-center justify-between gap-3">
						<h1 className="text-2xl font-semibold text-slate-900 sm:text-3xl">Minifiguras</h1>
						<div className="flex items-center">
							<Link href="/dashboard" className="text-sm text-slate-600 hover:underline">
								← Volver
							</Link>
						</div>
					</div>
					<div className="mt-2 space-y-1 text-xs text-slate-700">
						<p>Completas: {ownedComplete}</p>
						<p>Con faltantes: {ownedWithMissing}</p>
						<p>Total: {ownedTotal}</p>
						<p>Favoritas: {favoriteTotal}</p>
					</div>
					<div className="mt-2 flex items-center gap-2">
						<button
							type="button"
							onClick={openFilterModal}
							className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
						>
							Filtro
						</button>
						<input
							type="text"
							value={searchInput}
							onChange={(event) => setSearchInput(event.target.value)}
							placeholder="Buscar minifigura..."
							className="w-full max-w-xs rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-900 outline-none focus:border-slate-500"
						/>
					</div>
					<div className="mt-2 flex flex-wrap items-center gap-2">
						<button
							type="button"
							onClick={() => setViewMode("all")}
							className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold ${viewMode === "all" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 text-slate-700 hover:bg-slate-100"}`}
						>
							Todas
						</button>
						<button
							type="button"
							onClick={() => setViewMode("missing")}
							className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold ${viewMode === "missing" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 text-slate-700 hover:bg-slate-100"}`}
						>
							Solo con faltantes
						</button>
						<button
							type="button"
							onClick={() => setViewMode("complete")}
							className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold ${viewMode === "complete" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 text-slate-700 hover:bg-slate-100"}`}
						>
							Solo completas
						</button>
						<button
							type="button"
							onClick={() => setShowOnlyFavoriteFigures((current) => !current)}
							className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold ${showOnlyFavoriteFigures ? "border-rose-600 bg-rose-600 text-white" : "border-slate-300 text-slate-700 hover:bg-slate-100"}`}
						>
							Favoritas
						</button>
						{missingSeriesFilterThemeId !== null ? (
							<button
								type="button"
								onClick={() => setMissingSeriesFilterThemeId(null)}
								className="rounded-md border border-[#025080] bg-[#e6f3fa] px-2.5 py-1 text-[11px] font-semibold text-[#025080] hover:bg-[#d7ebf7]"
							>
								Serie filtrada: {missingSeriesThemeName} (limpiar)
							</button>
						) : null}
					</div>
				</div>
				<div className="mt-4">
					{ownedStatus ? <p className="mb-2 text-xs text-slate-600">{ownedStatus}</p> : null}
					{normalizedSearch ? (
						loadingAllFiguresForSearch && visibleCards.length === 0 ? (
							<p className="text-sm text-slate-700">Buscando en todas las minifiguras...</p>
						) : visibleCards.length === 0 ? (
							<p className="text-sm text-slate-700">No se encontraron minifiguras para "{searchInput.trim()}".</p>
						) : (
							<div className="grid grid-cols-3 gap-1.5 sm:grid-cols-3 sm:gap-2 md:grid-cols-5">
								{visibleCards.map((figure) => renderFigureCard(figure))}
							</div>
						)
					) : selectedThemeIds.length === 0 ? (
						<p className="text-sm text-slate-700">Selecciona una serie en Filtro para ver sus minifiguras.</p>
					) : visibleCards.length === 0 ? (
						<p className="text-sm text-slate-700">Cargando minifiguras seleccionadas...</p>
					) : (
						<div className="grid grid-cols-3 gap-1.5 sm:grid-cols-3 sm:gap-2 md:grid-cols-5">
							{visibleCards.map((figure) => renderFigureCard(figure))}
						</div>
					)}
				</div>

				<div className="mt-6 flex justify-end">
					<button
						type="button"
						onClick={() => setShowResetConfirmModal(true)}
						className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50"
					>
						Reset
					</button>
				</div>
			</main>

			{showResetConfirmModal ? (
				<div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/50 p-4" onClick={() => !resettingCollection && setShowResetConfirmModal(false)}>
					<div className="w-full max-w-xs rounded-xl bg-white p-5 shadow-xl" onClick={(event) => event.stopPropagation()}>
						<div className="flex flex-col items-center text-center">
							<img src="/LEGO-ICON_A.svg" alt="Lego icon" className="h-28 w-28 object-contain" />
							<p className="mt-3 text-base font-bold text-slate-700">Estas seguro de querer desarmar tu coleccion de minifiguras?</p>
							<p className="mt-1 text-sm text-slate-700">Si lo haces vas a volver a empezar esta seccion.</p>
							<div className="mt-5 flex items-center gap-2">
								<button
									type="button"
									onClick={() => void resetMinifigureCollection()}
									disabled={resettingCollection}
									className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
								>
									{resettingCollection ? "Reiniciando..." : "Si"}
								</button>
							<button
								type="button"
								onClick={() => setShowResetConfirmModal(false)}
								autoFocus
								disabled={resettingCollection}
								className="rounded-md bg-[#006eb2] px-4 py-2 text-sm font-semibold text-white hover:bg-[#005f9a] disabled:opacity-50"
							>
								No
							</button>
							</div>
						</div>
					</div>
				</div>
			) : null}

			{zoomImageUrl ? (
				<div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/85 p-4" onClick={() => setZoomImageUrl(null)}>
					<div className="relative w-full max-w-5xl" onClick={(event) => event.stopPropagation()}>
						<button
							type="button"
							onClick={() => setZoomImageUrl(null)}
							className="absolute right-0 top-0 z-10 rounded-md border border-white/40 bg-slate-900/60 px-2 py-1 text-xs text-white hover:bg-slate-800"
						>
							Cerrar
						</button>
						<div className="flex max-h-[90vh] items-center justify-center">
							<img src={zoomImageUrl} alt={zoomImageName} className="max-h-[90vh] w-auto max-w-full rounded-lg bg-white object-contain p-2" />
						</div>
					</div>
				</div>
			) : null}

			{showPartsModal ? (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setShowPartsModal(false)}>
					<div className="w-full max-w-2xl rounded-xl bg-white p-4 shadow-xl" onClick={(event) => event.stopPropagation()}>
						<div className="flex items-start justify-between gap-3 border-b border-slate-200 pb-2">
							<div>
								<p className="text-sm font-semibold text-slate-900">Piezas de {partsModalTitle}</p>
								<p className="text-xs text-slate-500">Set {partsModalSetNum}</p>
							</div>
							<button
								type="button"
								onClick={() => setShowPartsModal(false)}
								className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
							>
								Cerrar
							</button>
						</div>

						<div className="mt-3 flex flex-wrap items-center gap-2">
							<button
								type="button"
								onClick={markAllPartsInModal}
								disabled={partsRows.length === 0 || partsLoading}
								className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
							>
								Marcar todas
							</button>
							<button
								type="button"
								onClick={unmarkAllPartsInModal}
								disabled={partsRows.length === 0 || partsLoading}
								className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
							>
								Desmarcar todas
							</button>
							<button
								type="button"
								onClick={resetPartsInModal}
								disabled={partsRows.length === 0 || partsLoading}
								className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
							>
								Reiniciar
							</button>
						</div>

						{partsLoading ? <p className="mt-3 text-sm text-slate-600">Cargando piezas...</p> : null}
						{partsError ? <p className="mt-3 text-sm text-red-600">{partsError}</p> : null}
						{partsSaveStatus ? <p className="mt-3 text-xs text-slate-600">{partsSaveStatus}</p> : null}

						{!partsLoading && !partsError ? (
							<div className="mt-3 max-h-[60vh] space-y-2 overflow-y-auto pr-1">
								{partsRows.length === 0 ? (
									<p className="text-sm text-slate-600">No hay piezas disponibles.</p>
								) : (
									partsRows.map((part, index) => (
										<div key={getPartRowKey(part, index)} className="flex items-center gap-3 rounded-md border border-slate-200 p-2">
											<div className="h-14 w-14 flex-shrink-0 overflow-hidden rounded-md bg-slate-100">
												{part.part_img_url ? (
													<img src={part.part_img_url} alt={part.name} loading="lazy" className="h-full w-full object-contain" />
												) : (
													<div className="flex h-full w-full items-center justify-center text-[10px] text-slate-400">Sin imagen</div>
												)}
											</div>
											<div className="min-w-0 flex-1">
												<p className="truncate text-sm font-medium text-slate-900">{part.name}</p>
												<p className="text-xs text-slate-500">
													{part.part_num}
													{part.color_name ? ` - ${part.color_name}` : ""}
													{part.is_spare ? " - Extra" : ""}
												</p>
											</div>
											<label className="ml-2 flex items-center text-xs text-slate-700">
												<input
													type="checkbox"
													checked={partsCheckedByKey[getPartRowKey(part, index)] ?? true}
													onChange={() => togglePartChecked(part, index)}
													className="h-4 w-4 rounded border-slate-300"
												/>
											</label>
										</div>
									))
								)}
							</div>
						) : null}
					</div>
				</div>
			) : null}

			{showFilterModal ? (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4" onClick={() => setShowFilterModal(false)}>
					<div
						className="w-full max-w-lg rounded-xl bg-white p-4 shadow-xl"
						onClick={(event) => event.stopPropagation()}
					>
						<div className="flex items-center justify-between border-b border-slate-200 pb-2">
							<div>
								<div className="flex items-center gap-3">
									<p className="text-sm font-semibold text-slate-900">Colecciones de Serie</p>
									<button
										type="button"
										onClick={() => setShowOnlyFavoriteThemes((current) => !current)}
										className={`text-xl leading-none ${showOnlyFavoriteThemes ? "text-yellow-500" : "text-slate-500 hover:text-slate-700"}`}
										title="Mostrar solo favoritas"
									>
										{showOnlyFavoriteThemes ? "★" : "☆"}
									</button>
								</div>
								<div className="mt-2 flex items-center gap-2">
									<button
										type="button"
										onClick={() => selectAllVisibleThemes(visibleThemeIdsInFilter)}
										disabled={visibleThemeIdsInFilter.length === 0}
										className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
									>
										Seleccionar todos
									</button>
									<button
										type="button"
										onClick={() => deselectAllVisibleThemes(visibleThemeIdsInFilter)}
										disabled={visibleThemeIdsInFilter.length === 0}
										className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
									>
										Deseleccionar todos
									</button>
								</div>
							</div>
							<button
								type="button"
								onClick={() => setShowFilterModal(false)}
								className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
							>
								Cerrar
							</button>
						</div>

						{loadingThemes ? <p className="mt-3 text-sm text-slate-600">Cargando series...</p> : null}
						{themeError ? <p className="mt-3 text-sm text-red-600">{themeError}</p> : null}
						{selectionStatus ? <p className="mt-3 text-xs text-slate-600">{selectionStatus}</p> : null}
						{favoriteStatus ? <p className="mt-1 text-xs text-slate-600">{favoriteStatus}</p> : null}

						{!loadingThemes && !themeError ? (
							<ul className="mt-3 max-h-80 space-y-1 overflow-y-auto rounded-md border border-slate-200 p-2">
								{visibleThemesInFilter.length === 0 ? (
									<li className="rounded-md border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-500">
										No hay series favoritas.
									</li>
								) : null}
								{visibleThemesInFilter.map((theme) => {
									const selected = selectedThemeIds.includes(theme.id);
									const isFavorite = favoriteThemeIds.includes(theme.id);
									const expanded = expandedThemeIds.includes(theme.id);
									const fallbackTotal = (figuresByThemeId[theme.id] ?? []).length;
									const totalInTheme = typeof theme.itemCount === "number" && theme.itemCount > 0 ? theme.itemCount : fallbackTotal;
									const ownedInTheme = countOwnedInTheme(theme.id);
									const isCompletedTheme = totalInTheme > 0 && ownedInTheme >= totalInTheme;
									const progressLabel = `${ownedInTheme}/${totalInTheme}${isCompletedTheme ? " completa" : ""}`;
									const headerLabel = `${theme.year ?? "----"} - ${theme.name} - ${progressLabel}`;
									const completionRatio = totalInTheme > 0 ? Math.min(100, Math.round((ownedInTheme / totalInTheme) * 100)) : 0;
									return (
										<li key={theme.id} className="rounded-md border border-slate-200">
											<div className="flex items-center justify-between gap-2 px-2 py-1.5">
												<button
													type="button"
													onClick={() => toggleTheme(theme.id)}
													className={`flex min-w-0 flex-1 items-start gap-2 rounded-md px-1 py-1 text-left text-sm ${
														isCompletedTheme
															? "bg-[#025080] text-white"
															: selected
																? "bg-slate-100 text-slate-900"
																: "text-slate-700 hover:bg-slate-50"
													}`}
												>
													<span
														className={`inline-flex h-5 w-5 items-center justify-center rounded border text-xs ${
															isCompletedTheme
																? "border-white/60 bg-white/20 text-white"
																: selected
																	? "border-slate-900 bg-slate-900 text-white"
																	: "border-slate-300 text-slate-400"
														}`}
													>
														{selected ? "✓" : ""}
													</span>
													<div className="min-w-0 flex-1">
														<span className="truncate">
															{headerLabel}
														</span>
														<div className={`mt-1 h-1.5 w-full overflow-hidden rounded-full ${isCompletedTheme ? "bg-white/25" : "bg-slate-200"}`}>
															<div
																className={`h-full rounded-full ${isCompletedTheme ? "bg-white" : "bg-[#025080]"}`}
																style={{ width: `${completionRatio}%` }}
															/>
														</div>
													</div>
												</button>
												<div className="flex items-center gap-1">
													<button
														type="button"
														onClick={() => toggleFavoriteTheme(theme.id)}
														className={`text-lg leading-none ${isFavorite ? "text-yellow-500" : "text-slate-500 hover:text-slate-700"}`}
														title={isFavorite ? "Quitar de favoritas" : "Marcar como favorita"}
													>
														{isFavorite ? "★" : "☆"}
													</button>
													<button
														type="button"
														onClick={() => toggleExpandedTheme(theme.id)}
														className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
													>
														{expanded ? "▾" : "▸"}
													</button>
												</div>
											</div>
											{expanded ? (
												<div className="border-t border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
													{loadingFiguresByThemeId[theme.id]
														? "Cargando minifiguras..."
														: (figuresByThemeId[theme.id] ?? []).length > 0
															? (figuresByThemeId[theme.id] ?? []).map((figure) => figure.name).join(" / ")
															: "Sin minifiguras disponibles."}
												</div>
											) : null}
										</li>
									);
								})}
							</ul>
						) : null}
					</div>
				</div>
			) : null}
		</div>
	);
}
