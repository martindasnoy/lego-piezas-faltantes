"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import constructorImage from "../../../Imagenes/Constructor.png";
import { getSupabaseClient } from "@/lib/supabase";
import { getRandomLoadingMessage } from "@/lib/loading-messages";
import { clearSessionStart, enforceSessionTtl } from "@/lib/session-ttl";

const AUTO_MINIFIG_LIST_NAME = "Piezas Faltantes de Minifiguras";
const LEGACY_AUTO_MINIFIG_LIST_NAMES = ["Pares Faltantes de Minifcuras", "Faltantes Minifiguras"];
const SALE_LIST_PREFIX = "Venta: ";
const MASTER_EMAIL = "martindasnoy@gmail.com";
const FACE_TOTAL = 20;
const CMF_CHECK_HISTORY_KEY = "master_cmf_update_checks_v1";

type MasterModuleKey = "poolWanted" | "poolSale" | "minifiguras";
type MasterModules = Record<MasterModuleKey, boolean>;

type FeatureFlagRow = {
	module_key: string;
	enabled: boolean;
};

type RegisteredUserRow = {
	user_id: string;
	display_name: string;
	email: string;
	created_at: string;
};

const DEFAULT_MASTER_MODULES: MasterModules = {
	poolWanted: true,
	poolSale: true,
	minifiguras: true,
};

const MODULE_DB_KEYS: Record<MasterModuleKey, string> = {
	poolWanted: "pool_wanted",
	poolSale: "pool_sale",
	minifiguras: "minifiguras",
};

function isSaleListName(listName: string) {
	return listName.trim().toLowerCase().startsWith("venta:");
}

function getDisplayListName(listName: string) {
	if (!isSaleListName(listName)) return listName;
	return listName.replace(/^venta:\s*/i, "").trim();
}

function normalizeFaceValue(face: number) {
	return Number.isFinite(face) && face >= 1 && face <= FACE_TOTAL ? face : 1;
}

function getFaceImagePath(face: number) {
	const normalized = normalizeFaceValue(face);
	return `/Cabeza_${String(normalized).padStart(2, "0")}.png`;
}

function SocialIcon({ platform, className = "h-8 w-8" }: { platform: "instagram" | "facebook"; className?: string }) {
	if (platform === "facebook") {
		return (
			<svg viewBox="0 0 24 24" className={`${className} text-[#1877F2]`} fill="currentColor" aria-hidden="true">
				<path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073c0 6.02 4.388 11.01 10.125 11.927v-8.437H7.078v-3.49h3.047V9.412c0-3.021 1.792-4.689 4.533-4.689 1.313 0 2.686.236 2.686.236v2.966h-1.514c-1.492 0-1.956.93-1.956 1.885v2.263h3.328l-.532 3.49h-2.796V24C19.612 23.083 24 18.093 24 12.073z" />
			</svg>
		);
	}

	return (
		<svg viewBox="0 0 24 24" className={className} aria-hidden="true">
			<rect x="2" y="2" width="20" height="20" rx="5" fill="#E1306C" />
			<circle cx="12" cy="12" r="4.2" fill="white" />
			<circle cx="12" cy="12" r="2.2" fill="#E1306C" />
			<circle cx="17.2" cy="6.8" r="1.3" fill="white" />
		</svg>
	);
}

type BalugMemberRow = {
	display_name: string;
	social_platform: "instagram" | "facebook" | null;
	social_handle: string | null;
	created_at: string;
};

type UserList = {
	id: string;
	name: string;
	is_public: boolean;
	pieces_count: number;
	lots_count: number;
	is_auto_generated: boolean;
};

type CachedImageRow = {
	part_num: string;
	color_name: string;
	part_img_url: string;
	updated_at: string;
};

type MinifigStatsPayload = {
	themes_count: number;
	figures_count: number;
	parts_count: number;
	checked_at: string;
};

type CmfCheckLog = {
	id: string;
	created_at: string;
	new_series: number;
	new_minifigures: number;
	new_parts: number;
	total_series: number;
	total_minifigures: number;
	total_parts: number;
	label: "initial" | "check";
};

export default function DashboardPage() {
	const router = useRouter();
	const [loadingMessage, setLoadingMessage] = useState("Cargando...");
	const [userEmail, setUserEmail] = useState("");
	const [displayName, setDisplayName] = useState("");
	const [socialPlatform, setSocialPlatform] = useState<"instagram" | "facebook" | "">("instagram");
	const [socialHandle, setSocialHandle] = useState("");
	const [isMasterUser, setIsMasterUser] = useState(false);
	const [showMasterModal, setShowMasterModal] = useState(false);
	const [showMasterUsersModal, setShowMasterUsersModal] = useState(false);
	const [showCacheImagesModal, setShowCacheImagesModal] = useState(false);
	const [showUpdatesModal, setShowUpdatesModal] = useState(false);
	const [cacheImages, setCacheImages] = useState<CachedImageRow[]>([]);
	const [cacheImagesLoading, setCacheImagesLoading] = useState(false);
	const [cacheImagesError, setCacheImagesError] = useState<string | null>(null);
	const [cacheImagesPage, setCacheImagesPage] = useState(1);
	const [cacheImagesTotalPages, setCacheImagesTotalPages] = useState(1);
	const [checkingNewThings, setCheckingNewThings] = useState(false);
	const [checkProgressText, setCheckProgressText] = useState("");
	const [cmfCheckLogs, setCmfCheckLogs] = useState<CmfCheckLog[]>([]);
	const [showMaintenanceModal, setShowMaintenanceModal] = useState(false);
	const [maintenanceText, setMaintenanceText] = useState("");
	const [maintenanceActive, setMaintenanceActive] = useState(false);
	const [maintenanceSaving, setMaintenanceSaving] = useState(false);
	const [masterModules, setMasterModules] = useState<MasterModules>(DEFAULT_MASTER_MODULES);
	const [registeredUsers, setRegisteredUsers] = useState<RegisteredUserRow[]>([]);
	const [loadingRegisteredUsers, setLoadingRegisteredUsers] = useState(false);
	const [masterUsersSort, setMasterUsersSort] = useState<"created" | "alpha">("created");
	const [showBalugMembersModal, setShowBalugMembersModal] = useState(false);
	const [loadingBalugMembers, setLoadingBalugMembers] = useState(false);
	const [balugMembers, setBalugMembers] = useState<BalugMemberRow[]>([]);
	const [lists, setLists] = useState<UserList[]>([]);
	const [newListName, setNewListName] = useState("");
	const [isPublic, setIsPublic] = useState(false);
	const [createListKind, setCreateListKind] = useState<"wish" | "sale">("wish");
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [switchingId, setSwitchingId] = useState<string | null>(null);
	const [editingListId, setEditingListId] = useState<string | null>(null);
	const [editingListNameInput, setEditingListNameInput] = useState("");
	const [renamingListId, setRenamingListId] = useState<string | null>(null);
	const [deletingListId, setDeletingListId] = useState<string | null>(null);
	const [deleteTarget, setDeleteTarget] = useState<UserList | null>(null);
	const [showUserSettings, setShowUserSettings] = useState(false);
	const [settingsNameInput, setSettingsNameInput] = useState("");
	const [settingsEmailInput, setSettingsEmailInput] = useState("");
	const [settingsSocialPlatform, setSettingsSocialPlatform] = useState<"instagram" | "facebook" | "">("instagram");
	const [settingsSocialHandle, setSettingsSocialHandle] = useState("");
	const [selectedFace, setSelectedFace] = useState(1);
	const [showPasswordModal, setShowPasswordModal] = useState(false);
	const [currentPasswordInput, setCurrentPasswordInput] = useState("");
	const [newPasswordInput, setNewPasswordInput] = useState("");
	const [newPasswordConfirmInput, setNewPasswordConfirmInput] = useState("");
	const [settingsSaving, setSettingsSaving] = useState(false);
	const [passwordSaving, setPasswordSaving] = useState(false);
	const [message, setMessage] = useState<string | null>(null);

	async function loadMasterModules() {
		const supabase = getSupabaseClient();
		const { data, error } = await supabase
			.from("app_feature_flags")
			.select("module_key,enabled")
			.in("module_key", Object.values(MODULE_DB_KEYS));

		if (error) {
			setMasterModules(DEFAULT_MASTER_MODULES);
			return;
		}

		const byKey = new Map<string, FeatureFlagRow>();
		for (const row of (data as FeatureFlagRow[] | null) ?? []) {
			if (!row?.module_key) continue;
			byKey.set(String(row.module_key), row);
		}
		setMasterModules({
			poolWanted: Boolean(byKey.get(MODULE_DB_KEYS.poolWanted)?.enabled ?? true),
			poolSale: Boolean(byKey.get(MODULE_DB_KEYS.poolSale)?.enabled ?? true),
			minifiguras: Boolean(byKey.get(MODULE_DB_KEYS.minifiguras)?.enabled ?? true),
		});
	}

	async function loadMaintenanceConfig() {
		try {
			const response = await fetch("/api/system/maintenance", { cache: "no-store" });
			if (!response.ok) return;
			const payload = (await response.json()) as { active?: boolean; message?: string };
			setMaintenanceActive(Boolean(payload.active));
			setMaintenanceText(String(payload.message ?? ""));
		} catch {
			// no-op
		}
	}

	async function loadLists(ownerId: string) {
		const supabase = getSupabaseClient();
		const { data: listRows, error: listError } = await supabase
			.from("lists")
			.select("id,name,is_public")
			.eq("owner_id", ownerId)
			.order("created_at", { ascending: false });

		if (listError) {
			setMessage("No se pudieron cargar las listas. Revisa tabla y permisos de Supabase.");
			setLists([]);
			return;
		}

		const ids = (listRows ?? []).map((list) => list.id as string);
		const countByListId = new Map<string, { lots: number; pieces: number }>();

		if (ids.length > 0) {
			const { data: itemRows } = await supabase
				.from("list_items")
				.select("list_id,quantity")
				.in("list_id", ids);

			for (const row of itemRows ?? []) {
				const listId = row.list_id as string;
				const quantity = Number(row.quantity ?? 0);
				const current = countByListId.get(listId) ?? { lots: 0, pieces: 0 };
				countByListId.set(listId, {
					lots: current.lots + 1,
					pieces: current.pieces + quantity,
				});
			}
		}

		const enriched = (listRows ?? []).map((list) => {
			const counts = countByListId.get(list.id as string) ?? { lots: 0, pieces: 0 };
			return {
				id: list.id as string,
				name: list.name as string,
				is_public: Boolean(list.is_public),
				lots_count: counts.lots,
				pieces_count: counts.pieces,
				is_auto_generated: [AUTO_MINIFIG_LIST_NAME, ...LEGACY_AUTO_MINIFIG_LIST_NAMES].includes(String(list.name ?? "").trim()),
			};
		});

		const autoLists = enriched.filter((list) => list.is_auto_generated);
		const manualLists = enriched.filter((list) => !list.is_auto_generated);
		const nonEmptyAutoLists = autoLists.filter((list) => list.lots_count > 0 || list.pieces_count > 0);

		if (nonEmptyAutoLists.length === 0) {
			setLists(manualLists);
			return;
		}

		const mergedAuto = nonEmptyAutoLists.reduce((acc, list) => ({
			...acc,
			id: acc.id || list.id,
			name: AUTO_MINIFIG_LIST_NAME,
			is_public: acc.is_public || list.is_public,
			is_auto_generated: true,
			lots_count: acc.lots_count + list.lots_count,
			pieces_count: acc.pieces_count + list.pieces_count,
		}), {
			id: "",
			name: AUTO_MINIFIG_LIST_NAME,
			is_public: false,
			is_auto_generated: true,
			lots_count: 0,
			pieces_count: 0,
		});

		setLists([...manualLists, mergedAuto]);
	}

	useEffect(() => {
		setLoadingMessage(getRandomLoadingMessage());

		async function loadDashboard() {
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

				setUserEmail(user.email ?? "");
				const normalizedEmail = (user.email ?? "").trim().toLowerCase();
				const isMaster = normalizedEmail === MASTER_EMAIL;
				setIsMasterUser(isMaster);
				await loadMasterModules();
				await loadMaintenanceConfig();

				setDisplayName((user.user_metadata?.display_name as string) ?? "");
				const metadataSocialPlatform = String(user.user_metadata?.social_platform ?? "").toLowerCase();
				const metadataSocialHandle = String(user.user_metadata?.social_handle ?? "").trim();
				setSocialPlatform(metadataSocialPlatform === "instagram" || metadataSocialPlatform === "facebook" ? metadataSocialPlatform : "instagram");
				setSocialHandle(metadataSocialHandle);
				const storedFace = Number(user.user_metadata?.minifig_face ?? 1);
				setSelectedFace(normalizeFaceValue(storedFace));
				await loadLists(user.id);
			} catch (error) {
				const text = error instanceof Error ? error.message : "No se pudo abrir el dashboard.";
				setMessage(text);
			} finally {
				setLoading(false);
			}
		}

		void loadDashboard();
		const intervalId = window.setInterval(() => {
			void loadMasterModules();
			void loadMaintenanceConfig();
		}, 10000);

		return () => window.clearInterval(intervalId);
	}, [router]);

	async function toggleMasterModule(moduleKey: MasterModuleKey) {
		if (!isMasterUser) return;

		const previous = masterModules[moduleKey];
		const nextValue = !previous;
		setMasterModules((current) => ({ ...current, [moduleKey]: nextValue }));

		const supabase = getSupabaseClient();
		const { error } = await supabase.from("app_feature_flags").upsert(
			{
				module_key: MODULE_DB_KEYS[moduleKey],
				enabled: nextValue,
			},
			{ onConflict: "module_key" },
		);

		if (error) {
			setMasterModules((current) => ({ ...current, [moduleKey]: previous }));
			setMessage(error.message);
		}
	}

	async function openMasterUsersModal() {
		if (!isMasterUser) return;
		setShowMasterUsersModal(true);
		setLoadingRegisteredUsers(true);
		setMessage(null);

		try {
			const supabase = getSupabaseClient();
			const { data, error } = await supabase.rpc("get_registered_users_master");
			if (error) {
				setMessage(error.message);
				setRegisteredUsers([]);
				return;
			}

			setRegisteredUsers((data as RegisteredUserRow[] | null) ?? []);
		} finally {
			setLoadingRegisteredUsers(false);
		}
	}

	async function setMaintenanceState(nextActive: boolean) {
		if (!isMasterUser) return;
		setMaintenanceSaving(true);
		setMessage(null);

		try {
			const response = await fetch("/api/system/maintenance", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ active: nextActive, message: maintenanceText }),
			});

			const payload = (await response.json()) as { active?: boolean; message?: string; error?: string; warning?: string };
			if (!response.ok) {
				setMessage(payload.error ?? "No se pudo actualizar mantenimiento.");
				return;
			}

			setMaintenanceActive(Boolean(payload.active));
			setMaintenanceText(String(payload.message ?? ""));
			setMessage(payload.warning ?? (nextActive ? "Mantenimiento activado." : "Mantenimiento desactivado."));
		} catch {
			setMessage("No se pudo actualizar mantenimiento.");
		} finally {
			setMaintenanceSaving(false);
		}
	}

	async function openBalugMembersModal() {
		setShowBalugMembersModal(true);
		setLoadingBalugMembers(true);
		setMessage(null);

		try {
			const supabase = getSupabaseClient();
			const { data, error } = await supabase.rpc("get_balug_members_public");

			if (error) {
				setMessage(error.message);
				setBalugMembers([]);
				return;
			}

			setBalugMembers((data as BalugMemberRow[] | null) ?? []);
		} finally {
			setLoadingBalugMembers(false);
		}
	}

	async function loadCacheImages(page: number) {
		setCacheImagesLoading(true);
		setCacheImagesError(null);
		try {
			const response = await fetch(`/api/system/cache-images?page=${page}&page_size=60`, { cache: "no-store" });
			const payload = (await response.json()) as {
				results?: CachedImageRow[];
				page?: number;
				total_pages?: number;
				error?: string;
			};

			if (!response.ok) {
				setCacheImagesError(payload.error ?? "No se pudo cargar el cache de imagenes.");
				setCacheImages([]);
				return;
			}

			setCacheImages(payload.results ?? []);
			setCacheImagesPage(Number(payload.page ?? page));
			setCacheImagesTotalPages(Number(payload.total_pages ?? 1));
		} catch {
			setCacheImagesError("No se pudo cargar el cache de imagenes.");
			setCacheImages([]);
		} finally {
			setCacheImagesLoading(false);
		}
	}

	async function fetchMinifigStats() {
		const response = await fetch("/api/system/minifigures/stats", { cache: "no-store" });
		const payload = (await response.json()) as MinifigStatsPayload & { error?: string };
		if (!response.ok) throw new Error(payload.error ?? "No se pudieron leer estadisticas CMF.");
		return payload;
	}

	function persistCmfCheckLogs(nextLogs: CmfCheckLog[]) {
		setCmfCheckLogs(nextLogs);
		if (typeof window === "undefined") return;
		window.localStorage.setItem(CMF_CHECK_HISTORY_KEY, JSON.stringify(nextLogs));
	}

	async function loadCmfChecks() {
		if (!isMasterUser) return;
		const stats = await fetchMinifigStats();

		let stored: CmfCheckLog[] = [];
		if (typeof window !== "undefined") {
			try {
				const raw = window.localStorage.getItem(CMF_CHECK_HISTORY_KEY);
				if (raw) {
					const parsed = JSON.parse(raw) as CmfCheckLog[];
					if (Array.isArray(parsed)) stored = parsed;
				}
			} catch {
				stored = [];
			}
		}

		if (stored.length === 0) {
			const initial: CmfCheckLog = {
				id: `initial-${Date.now()}`,
				created_at: stats.checked_at,
				new_series: Number(stats.themes_count ?? 0),
				new_minifigures: Number(stats.figures_count ?? 0),
				new_parts: Number(stats.parts_count ?? 0),
				total_series: Number(stats.themes_count ?? 0),
				total_minifigures: Number(stats.figures_count ?? 0),
				total_parts: Number(stats.parts_count ?? 0),
				label: "initial",
			};
			persistCmfCheckLogs([initial]);
			return;
		}

		persistCmfCheckLogs(stored);
	}

	function formatCheckDate(value: string) {
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return "Fecha desconocida";
		return date.toLocaleString("es-AR", {
			year: "2-digit",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
		});
	}

	async function checkNewThings() {
		if (!isMasterUser || checkingNewThings) return;
		setCheckingNewThings(true);
		setCheckProgressText("Leyendo estado inicial...");
		setMessage(null);

		try {
			const before = await fetchMinifigStats();

			setCheckProgressText("Actualizando series y minifiguras (KV)...");
			let syncOffset = 0;
			for (let i = 0; i < 400; i += 1) {
				const syncResponse = await fetch("/api/system/minifigures/sync", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ sync_themes: syncOffset === 0, offset: syncOffset, batch_size: 1 }),
				});
				const syncPayload = (await syncResponse.json()) as {
					error?: string;
					next_offset?: number | null;
					done?: boolean;
				};

				if (!syncResponse.ok) {
					throw new Error(syncPayload.error ?? "No se pudo actualizar KV de minifiguras.");
				}

				if (syncPayload.done) break;
				syncOffset = Number(syncPayload.next_offset ?? syncOffset + 1);
			}

			setCheckProgressText("Buscando minifiguras nuevas para backfill...");
			const missingResponse = await fetch("/api/system/minifigures/missing-set-nums?limit=5000", { cache: "no-store" });
			const missingPayload = (await missingResponse.json()) as {
				error?: string;
				missing_set_nums?: string[];
			};
			if (!missingResponse.ok) {
				throw new Error(missingPayload.error ?? "No se pudo calcular faltantes de partes CMF.");
			}

			const missingSetNums = (missingPayload.missing_set_nums ?? []).filter(Boolean);
			for (let index = 0; index < missingSetNums.length; index += 2) {
				const chunk = missingSetNums.slice(index, index + 2);
				setCheckProgressText(`Backfill lento de partes nuevas (${index + chunk.length}/${missingSetNums.length})...`);

				const backfillResponse = await fetch("/api/system/minifigures/parts/backfill", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ set_nums: chunk, batch_size: chunk.length }),
				});
				const backfillPayload = (await backfillResponse.json()) as { error?: string };
				if (!backfillResponse.ok) {
					throw new Error(backfillPayload.error ?? "No se pudo completar el backfill de partes CMF.");
				}
			}

			setCheckProgressText("Calculando diferencias...");
			const after = await fetchMinifigStats();
			const newSeries = Math.max(0, Number(after.themes_count ?? 0) - Number(before.themes_count ?? 0));
			const newMinifigures = Math.max(0, Number(after.figures_count ?? 0) - Number(before.figures_count ?? 0));
			const newParts = Math.max(0, Number(after.parts_count ?? 0) - Number(before.parts_count ?? 0));

			const entry: CmfCheckLog = {
				id: `check-${Date.now()}`,
				created_at: after.checked_at,
				new_series: newSeries,
				new_minifigures: newMinifigures,
				new_parts: newParts,
				total_series: Number(after.themes_count ?? 0),
				total_minifigures: Number(after.figures_count ?? 0),
				total_parts: Number(after.parts_count ?? 0),
				label: "check",
			};

			const nextLogs = [entry, ...cmfCheckLogs].slice(0, 30);
			persistCmfCheckLogs(nextLogs);
			setMessage(`Check new things OK: +${newSeries} series, +${newMinifigures} minifiguras, +${newParts} partes.`);
		} catch (error) {
			const text = error instanceof Error ? error.message : "No se pudo ejecutar Check new things.";
			setMessage(text);
		} finally {
			setCheckProgressText("");
			setCheckingNewThings(false);
		}
	}

	useEffect(() => {
		if (!showCacheImagesModal) return;
		void loadCacheImages(cacheImagesPage);
	}, [showCacheImagesModal, cacheImagesPage]);

	useEffect(() => {
		if (!showUpdatesModal) return;
		void loadCmfChecks();
	}, [showUpdatesModal]);

	const sortedRegisteredUsers = useMemo(() => {
		const users = [...registeredUsers];
		if (masterUsersSort === "alpha") {
			users.sort((a, b) => a.display_name.localeCompare(b.display_name, "es", { sensitivity: "base" }));
			return users;
		}

		users.sort((a, b) => {
			const aTime = Date.parse(a.created_at ?? "");
			const bTime = Date.parse(b.created_at ?? "");
			if (!Number.isFinite(aTime) && !Number.isFinite(bTime)) return 0;
			if (!Number.isFinite(aTime)) return 1;
			if (!Number.isFinite(bTime)) return -1;
			return bTime - aTime;
		});
		return users;
	}, [registeredUsers, masterUsersSort]);

	function formatCacheDate(value: string) {
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return "Fecha desconocida";
		return date.toLocaleString("es-AR", {
			year: "2-digit",
			month: "2-digit",
			day: "2-digit",
		});
	}

	async function createList(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setSaving(true);
		setMessage(null);

		try {
			const supabase = getSupabaseClient();
			const {
				data: { user },
			} = await supabase.auth.getUser();

			if (!user) {
				router.replace("/");
				return;
			}

			const rawName = newListName.trim();
			const canUseSaleLists = isMasterUser || masterModules.poolSale;
			const effectiveCreateListKind = createListKind === "sale" && canUseSaleLists ? "sale" : "wish";
			const name = effectiveCreateListKind === "sale" && rawName ? (rawName.startsWith(SALE_LIST_PREFIX) ? rawName : `${SALE_LIST_PREFIX}${rawName}`) : rawName;
			if (!name) {
				setMessage("Escribe un nombre para la nueva lista.");
				setSaving(false);
				return;
			}

			const nextIsPublic = effectiveCreateListKind === "sale" ? true : isPublic;

			const { error } = await supabase
				.from("lists")
				.insert({
					owner_id: user.id,
					name,
					is_public: nextIsPublic,
					status: "draft",
				});

			if (error) {
				setMessage(error.message);
			} else {
				setNewListName("");
				setIsPublic(false);
				setCreateListKind("wish");
				await loadLists(user.id);
				setMessage("Lista creada correctamente.");
			}
		} catch (error) {
			const text = error instanceof Error ? error.message : "No se pudo crear la lista.";
			setMessage(text);
		} finally {
			setSaving(false);
		}
	}

	async function logout() {
		const supabase = getSupabaseClient();
		await supabase.auth.signOut();
		clearSessionStart();
		router.replace("/");
	}

	async function switchVisibility(listId: string, nextIsPublic: boolean) {
		setSwitchingId(listId);
		setMessage(null);

		try {
			const supabase = getSupabaseClient();
			const { error } = await supabase.from("lists").update({ is_public: nextIsPublic }).eq("id", listId);

			if (error) {
				setMessage(error.message);
				return;
			}

			setLists((current) =>
				current.map((list) => (list.id === listId ? { ...list, is_public: nextIsPublic } : list)),
			);
		} finally {
			setSwitchingId(null);
		}
	}

	function openRenameList(list: UserList) {
		setEditingListId(list.id);
		setEditingListNameInput(getDisplayListName(list.name));
	}

	function cancelRenameList() {
		setEditingListId(null);
		setEditingListNameInput("");
	}

	async function saveRenameList(listId: string) {
		const nextName = editingListNameInput.trim();
		if (!nextName) {
			setMessage("El nombre de la lista no puede estar vacio.");
			return;
		}

		setRenamingListId(listId);
		setMessage(null);

		try {
			const supabase = getSupabaseClient();
			const currentList = lists.find((list) => list.id === listId) ?? null;
			const finalName = currentList && isSaleListName(currentList.name) ? `${SALE_LIST_PREFIX}${nextName}` : nextName;
			const { error } = await supabase.from("lists").update({ name: finalName }).eq("id", listId);

			if (error) {
				setMessage(error.message);
				return;
			}

			setLists((current) => current.map((list) => (list.id === listId ? { ...list, name: finalName } : list)));
			setEditingListId(null);
			setEditingListNameInput("");
		} finally {
			setRenamingListId(null);
		}
	}

	async function confirmDeleteList() {
		if (!deleteTarget) return;
		if (deleteTarget.is_auto_generated) {
			setDeleteTarget(null);
			setMessage("La lista automatica de minifiguras no se puede eliminar.");
			return;
		}

		setDeletingListId(deleteTarget.id);
		setMessage(null);

		try {
			const supabase = getSupabaseClient();

			const { error: deleteItemsError } = await supabase.from("list_items").delete().eq("list_id", deleteTarget.id);

			if (deleteItemsError) {
				setMessage(`No se pudieron borrar los items de la lista: ${deleteItemsError.message}`);
				return;
			}

			const { error: deleteListError } = await supabase.from("lists").delete().eq("id", deleteTarget.id);

			if (deleteListError) {
				setMessage(`No se pudo eliminar la lista: ${deleteListError.message}`);
				return;
			}

			setLists((current) => current.filter((list) => list.id !== deleteTarget.id));
			setDeleteTarget(null);
			setMessage("Lista eliminada correctamente.");
		} finally {
			setDeletingListId(null);
		}
	}

	function openUserSettings() {
		setSettingsNameInput(displayName || "");
		setSettingsEmailInput(userEmail || "");
		setSettingsSocialPlatform(socialPlatform || "instagram");
		setSettingsSocialHandle(socialHandle || "");
		setSelectedFace((current) => normalizeFaceValue(current));
		setShowPasswordModal(false);
		setCurrentPasswordInput("");
		setNewPasswordInput("");
		setNewPasswordConfirmInput("");
		setShowUserSettings(true);
	}

	function openPasswordSettings() {
		setCurrentPasswordInput("");
		setNewPasswordInput("");
		setNewPasswordConfirmInput("");
		setShowPasswordModal(true);
	}

	async function saveUserSettings() {
		setSettingsSaving(true);
		setMessage(null);

		try {
			const supabase = getSupabaseClient();
			const nextName = settingsNameInput.trim();
			const nextEmail = settingsEmailInput.trim().toLowerCase();
			const nextSocialPlatform = settingsSocialPlatform;
			const nextSocialHandle = settingsSocialHandle.trim().replace(/^@+/, "");

			const faceValue = normalizeFaceValue(selectedFace);
			const updatePayload: {
				data: { display_name: string; minifig_face: number; social_platform: string | null; social_handle: string | null };
				email?: string;
			} = {
				data: {
					display_name: nextName,
					minifig_face: faceValue,
					social_platform: nextSocialPlatform || null,
					social_handle: nextSocialHandle || null,
				},
			};

			if (nextEmail && nextEmail !== userEmail.toLowerCase()) {
				updatePayload.email = nextEmail;
			}

			const { error } = await supabase.auth.updateUser(updatePayload);

			if (error) {
				setMessage(`No se pudo actualizar usuario: ${error.message}`);
				return;
			}

			setDisplayName(nextName);
			setSocialPlatform(nextSocialPlatform);
			setSocialHandle(nextSocialHandle);
			setSelectedFace(faceValue);
			if (nextEmail) {
				setUserEmail(nextEmail);
			}
			setShowPasswordModal(false);
			setShowUserSettings(false);
			setMessage(updatePayload.email ? "Usuario actualizado. Revisa tu correo para confirmar el nuevo email." : "Usuario actualizado.");
		} finally {
			setSettingsSaving(false);
		}
	}

	async function savePasswordSettings() {
		setPasswordSaving(true);
		setMessage(null);

		try {
			const supabase = getSupabaseClient();
			const oldPassword = currentPasswordInput.trim();
			const nextPassword = newPasswordInput.trim();
			const nextPasswordConfirm = newPasswordConfirmInput.trim();

			if (!oldPassword) {
				setMessage("Completa la contrasena vieja.");
				return;
			}

			if (nextPassword.length < 6) {
				setMessage("La nueva contrasena debe tener al menos 6 caracteres.");
				return;
			}

			if (nextPassword !== nextPasswordConfirm) {
				setMessage("Las contrasenas nuevas no coinciden.");
				return;
			}

			const { error: verifyError } = await supabase.auth.signInWithPassword({
				email: userEmail,
				password: oldPassword,
			});

			if (verifyError) {
				setMessage("La contrasena vieja no coincide.");
				return;
			}

			const { error: updateError } = await supabase.auth.updateUser({ password: nextPassword });
			if (updateError) {
				setMessage(`No se pudo actualizar la contrasena: ${updateError.message}`);
				return;
			}

			setShowPasswordModal(false);
			setCurrentPasswordInput("");
			setNewPasswordInput("");
			setNewPasswordConfirmInput("");
			setMessage("Contrasena actualizada correctamente.");
		} finally {
			setPasswordSaving(false);
		}
	}

	function renderListItem(list: UserList) {
		const isSaleList = isSaleListName(list.name);
		const displayListName = getDisplayListName(list.name);
		const privateTooltipText = isSaleList
			? "Las piezas de esta lista solo las ves vos."
			: "Solo vos vas a poder ver estas listas.";
		const publicTooltipText = isSaleList
			? "Las piezas de esta lista se muestran a la venta."
			: "Estas listas entran en el pool de piezas para que otros usuarios puedan dartelas.";

		return (
			<li key={list.id} className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
				<div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
					<div className="flex items-start gap-3">
						<div className="h-14 w-14 shrink-0 overflow-hidden">
							<img
								src={list.is_auto_generated ? "/Minifigura_silueta_B.png?v=5" : "/pieza_silueta.png?v=5"}
								alt={list.is_auto_generated ? "Minifiguras" : "Piezas"}
								className={`h-14 w-14 object-contain ${list.is_auto_generated ? "" : "-translate-x-1"}`}
							/>
						</div>
						<div>
							{editingListId === list.id ? (
								<div className="flex flex-wrap items-center gap-2">
									<input
										type="text"
										value={editingListNameInput}
										onChange={(event) => setEditingListNameInput(event.target.value)}
										disabled={renamingListId === list.id}
										className="rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-900"
									/>
									<button
										type="button"
										onClick={() => void saveRenameList(list.id)}
										disabled={renamingListId === list.id}
										className="rounded-md bg-slate-900 px-2 py-1 text-[11px] font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
									>
										Guardar
									</button>
									<button
										type="button"
										onClick={cancelRenameList}
										disabled={renamingListId === list.id}
										className="rounded-md border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
									>
										Cancelar
									</button>
								</div>
							) : (
								<div className="flex items-center gap-1.5">
									<Link href={`/dashboard/lists/${list.id}`} className="text-base font-semibold text-slate-900 hover:underline">
										{displayListName}
									</Link>
									<button
										type="button"
										onClick={() => openRenameList(list)}
										disabled={renamingListId === list.id || list.is_auto_generated}
										className="rounded border border-slate-300 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
										title="Editar nombre"
									>
										✎
									</button>
								</div>
							)}
							<p className="mt-1 text-xs text-slate-500">
								<span className="sm:hidden">Lotes: {list.lots_count} - Piezas: {list.pieces_count}</span>
								<span className="hidden sm:inline">Lotes: {list.lots_count} - Piezas: {list.pieces_count}</span>
							</p>
						</div>
					</div>
					<div className="w-full md:w-auto">
						<div className="flex flex-wrap items-center justify-between gap-2 md:flex-col md:items-end md:justify-start">
							<div className="flex items-center gap-2">
								<div className="group relative">
									<button
										type="button"
										onClick={() => switchVisibility(list.id, false)}
										disabled={switchingId === list.id || !list.is_public || deletingListId === list.id}
										className={`rounded-md px-2.5 py-1 text-xs font-medium ${!list.is_public ? "bg-slate-900 text-white" : "border border-slate-300 text-slate-700"}`}
									>
										Privado
									</button>
									<div className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 w-48 -translate-x-1/2 scale-95 rounded-[4px] border border-slate-300 bg-slate-100 px-3 py-2 text-center text-[11px] font-normal text-slate-900 opacity-0 shadow-lg transition-all duration-200 ease-out group-hover:delay-[1000ms] group-hover:scale-100 group-hover:opacity-100 group-focus-within:delay-[1000ms] group-focus-within:scale-100 group-focus-within:opacity-100">
										{privateTooltipText}
									</div>
								</div>
								<div className="group relative">
									<button
										type="button"
										onClick={() => switchVisibility(list.id, true)}
										disabled={switchingId === list.id || list.is_public || deletingListId === list.id}
										className={`rounded-md px-2.5 py-1 text-xs font-medium ${list.is_public ? "bg-slate-900 text-white" : "border border-slate-300 text-slate-700"}`}
									>
										Publico
									</button>
									<div className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 w-56 -translate-x-1/2 scale-95 rounded-[4px] border border-slate-300 bg-slate-100 px-3 py-2 text-center text-[11px] font-normal text-slate-900 opacity-0 shadow-lg transition-all duration-200 ease-out group-hover:delay-[1000ms] group-hover:scale-100 group-hover:opacity-100 group-focus-within:delay-[1000ms] group-focus-within:scale-100 group-focus-within:opacity-100">
										{publicTooltipText}
									</div>
								</div>
							</div>
							{list.is_auto_generated ? null : (
								<button
									type="button"
									onClick={() => setDeleteTarget(list)}
									disabled={switchingId === list.id || deletingListId === list.id}
									className="rounded-md border border-red-200 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
								>
									Chau lista
								</button>
							)}
						</div>
					</div>
				</div>
			</li>
		);
	}

	if (loading) {
		return (
			<div className="bg-lego-tile font-chewy flex min-h-screen items-center justify-center px-6 text-center text-2xl text-white sm:text-3xl">
				{loadingMessage}
			</div>
		);
	}

	if (!isMasterUser && maintenanceActive) {
		return (
			<div className="bg-lego-tile flex min-h-screen items-center justify-center px-6">
				<div className="mx-auto w-full max-w-3xl text-center text-white">
					<div className="flex justify-center">
						<Image src={constructorImage} alt="Constructor" className="h-40 w-40 object-contain sm:h-52 sm:w-52" />
					</div>
					<p className="mt-5 whitespace-pre-line text-lg sm:text-2xl">{maintenanceText || "Estamos realizando tareas de mantenimiento."}</p>
				</div>
			</div>
		);
	}

	const showPoolWantedModule = isMasterUser || masterModules.poolWanted;
	const showPoolSaleModule = isMasterUser || masterModules.poolSale;
	const showMinifigurasModule = isMasterUser || masterModules.minifiguras;
	const hasSocialProfile = (socialPlatform === "instagram" || socialPlatform === "facebook") && Boolean(socialHandle.trim());
	const wishLists = lists.filter((list) => {
		if (isSaleListName(list.name)) return false;
		if (!showMinifigurasModule && list.is_auto_generated) return false;
		return true;
	});
	const saleLists = lists.filter((list) => isSaleListName(list.name));

	return (
		<div className="bg-lego-tile min-h-screen px-4 py-6 sm:px-6 sm:py-8">
			<main className="mx-auto flex w-full max-w-3xl flex-col gap-6 rounded-2xl bg-white p-4 shadow-xl sm:p-8">
				<header className="border-b border-slate-200 pb-5">
					<div>
						<div className="flex items-center justify-between gap-3">
							<div className="flex min-w-0 items-center gap-2">
								<h1 className="break-all text-3xl font-semibold text-slate-900 sm:text-5xl">{displayName || userEmail}</h1>
								<div className="group relative">
									<button
										type="button"
										onClick={openUserSettings}
										className="rounded-md border border-slate-300 p-1.5 text-slate-700 hover:bg-slate-50"
										aria-label="Configuracion de usuario"
									>
										<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
											<path d="M12 8.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7Z" />
											<path d="m19.4 13.5.1-3-1.9-.5a6 6 0 0 0-.6-1.4l1-1.7-2.1-2.1-1.7 1a6 6 0 0 0-1.4-.6L12.5 3h-3l-.5 1.9a6 6 0 0 0-1.4.6l-1.7-1-2.1 2.1 1 1.7a6 6 0 0 0-.6 1.4L3 10.5v3l1.9.5a6 6 0 0 0 .6 1.4l-1 1.7 2.1 2.1 1.7-1a6 6 0 0 0 1.4.6l.5 1.9h3l.5-1.9a6 6 0 0 0 1.4-.6l1.7 1 2.1-2.1-1-1.7a6 6 0 0 0 .6-1.4l1.9-.5Z" />
										</svg>
									</button>
									<div className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 -translate-x-1/2 scale-95 opacity-0 transition-all duration-200 ease-out group-hover:delay-[1000ms] group-hover:scale-100 group-hover:opacity-100 group-focus-within:delay-[1000ms] group-focus-within:scale-100 group-focus-within:opacity-100">
										<div className="relative whitespace-nowrap rounded-[4px] border border-slate-300 bg-slate-100 px-3 py-1.5 text-xs font-normal text-slate-900 shadow-lg">
											Configuración del Usuario
										</div>
									</div>
								</div>
								{isMasterUser ? (
									<button
										type="button"
										onClick={() => setShowMasterModal(true)}
										className="rounded-md bg-black px-2.5 py-1 text-[10px] font-semibold text-white hover:bg-slate-800"
									>
										MASTER
									</button>
								) : null}
							</div>
							<div className="flex shrink-0 flex-col items-end gap-1">
								<img src={getFaceImagePath(selectedFace)} alt="Avatar minifig" className="h-20 w-20 object-contain" />
							</div>
						</div>
						{hasSocialProfile ? (
							<p className="mt-0.5 inline-flex items-center gap-1 text-sm text-slate-700">
								<SocialIcon platform={socialPlatform === "facebook" ? "facebook" : "instagram"} />
								<span>@{socialHandle}</span>
							</p>
						) : null}
					</div>
				</header>

				<section className="rounded-xl border border-slate-300 bg-[#f5f5f5] p-3 sm:p-4">
					<div className="flex flex-wrap items-center gap-2">
						<h2 className="text-xl font-semibold text-slate-900">Crear una:</h2>
						<div className="group relative">
							<button
								type="button"
								onClick={() => setCreateListKind("wish")}
								className={`rounded-md px-3 py-1 text-xs font-semibold ${createListKind === "wish" ? "bg-slate-900 text-white" : "border border-slate-300 text-slate-700 hover:bg-slate-100"}`}
							>
								Lista de deseos
							</button>
							<div className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 w-56 -translate-x-1/2 scale-95 rounded-[4px] border border-slate-300 bg-slate-100 px-3 py-2 text-center text-[11px] font-normal text-slate-900 opacity-0 shadow-lg transition-all duration-200 ease-out group-hover:delay-[1000ms] group-hover:scale-100 group-hover:opacity-100 group-focus-within:delay-[1000ms] group-focus-within:scale-100 group-focus-within:opacity-100">
								Armá una lista de deseos y juntá en un solo lugar todas las piezas que te faltan.
							</div>
						</div>
						{showPoolSaleModule ? (
							<div className="group relative">
								<button
									type="button"
									onClick={() => setCreateListKind("sale")}
									className={`rounded-md px-3 py-1 text-xs font-semibold ${createListKind === "sale" ? "bg-slate-900 text-white" : "border border-slate-300 text-slate-700 hover:bg-slate-100"}`}
								>
									Lista de venta
								</button>
								<div className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 w-56 -translate-x-1/2 scale-95 rounded-[4px] border border-slate-300 bg-slate-100 px-3 py-2 text-center text-[11px] font-normal text-slate-900 opacity-0 shadow-lg transition-all duration-200 ease-out group-hover:delay-[1000ms] group-hover:scale-100 group-hover:opacity-100 group-focus-within:delay-[1000ms] group-focus-within:scale-100 group-focus-within:opacity-100">
									Creá listas para vender tus piezas y ponelas a circular en el pool con otros usuarios.
								</div>
							</div>
						) : null}
					</div>
					<form onSubmit={createList} className="mt-3 space-y-3">
						<div>
							<input
								id="listName"
								type="text"
								value={newListName}
								onChange={(event) => setNewListName(event.target.value)}
								placeholder="Ej: Faltantes set 75367"
								className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
							/>
						</div>

						<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:pr-2">
							{createListKind === "sale" ? (
								<p className="text-sm text-slate-700">La lista de venta se crea publica automaticamente.</p>
							) : (
								<label className="flex items-center gap-2 text-sm text-slate-700">
									<input
										type="checkbox"
										checked={isPublic}
										onChange={(event) => setIsPublic(event.target.checked)}
										className="h-4 w-4"
									/>
									Lista publica (visible en el pool)
								</label>
							)}

							<button
								type="submit"
								disabled={saving}
								className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
							>
								{saving ? "Guardando..." : "Crear lista"}
							</button>
						</div>
					</form>
				</section>

				<section className="grid gap-4 md:grid-cols-3">
					<div className="rounded-xl border border-slate-200 p-4 sm:p-5 md:col-span-2">
						<h2 className="text-xl font-semibold text-slate-900">Tus listas de deseos creadas</h2>
						<ul className="mt-4 space-y-3">
							{wishLists.length === 0 ? (
								<li className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
									Todavia no creaste listas de deseos.
								</li>
							) : (
								wishLists.map((list) => renderListItem(list))
							)}

							<li className="rounded-lg border border-[#007bb8] bg-[#0093DD] px-4 py-3 text-white">
								<div className="flex items-start justify-between gap-3">
									<div>
										<Link href="/dashboard/offered" className="text-base font-semibold hover:underline">
											Items Ofertados
										</Link>
										<p className="mt-1 text-xs text-white/90">Lista automatica. Resume tus "Yo tengo".</p>
									</div>
									<img src="/handShake.png?v=2" alt="Items ofertados" className="h-[60px] w-[60px] shrink-0 object-contain" />
								</div>
							</li>
						</ul>

						{showPoolSaleModule ? (
							<>
								<h2 className="mt-6 text-xl font-semibold text-slate-900">Tus listas de ventas creadas</h2>
								<ul className="mt-4 space-y-3">
									{saleLists.length === 0 ? (
										<li className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
											Todavia no creaste listas de venta.
										</li>
									) : (
										saleLists.map((list) => renderListItem(list))
									)}
								</ul>
							</>
						) : null}
					</div>

					<div className="flex flex-col gap-4">
						<div className="rounded-xl border border-slate-200 p-4 text-center sm:p-5">
							<div className="flex justify-center">
								<Image src="/pool-logo.svg" alt="Pool" width={160} height={44} />
							</div>
							<p className="mt-2 text-sm text-slate-600">Revisa listas publicas de otros usuarios.</p>
							<div className="mt-4 flex flex-col items-center gap-2">
								<button
									type="button"
									onClick={() => void openBalugMembersModal()}
									className="inline-flex h-10 w-[90%] items-center justify-center rounded-lg border border-black bg-black px-4 text-sm font-semibold text-white hover:bg-slate-800"
								>
									Intergrantes Balug
								</button>
								{showPoolWantedModule ? (
									<div className="group relative flex w-full justify-center">
										<Link
											href="/pool"
											className="inline-flex h-10 w-[90%] items-center justify-center rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-700"
										>
											Pool de items deseados
										</Link>
										<div className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 w-72 -translate-x-1/2 scale-95 rounded-[4px] border border-slate-300 bg-slate-100 px-3 py-2 text-center text-[11px] font-normal text-slate-900 opacity-0 shadow-lg transition-all duration-200 ease-out group-hover:delay-[1000ms] group-hover:scale-100 group-hover:opacity-100 group-focus-within:delay-[1000ms] group-focus-within:scale-100 group-focus-within:opacity-100">
											En este sector vas a poder ver los items que desean otros miembros; si ves que tenes algo pone "Yo tengo" y arregla como le das esas piezas.
										</div>
									</div>
								) : null}
								{showPoolSaleModule ? (
									<div className="group relative flex w-full justify-center">
										<Link
											href="/pool-venta"
											className="inline-flex h-10 w-[90%] items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 hover:bg-slate-100"
										>
											Pool de items a la venta
										</Link>
										<div className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 w-64 -translate-x-1/2 scale-95 rounded-[4px] border border-slate-300 bg-slate-100 px-3 py-2 text-center text-[11px] font-normal text-slate-900 opacity-0 shadow-lg transition-all duration-200 ease-out group-hover:delay-[1000ms] group-hover:scale-100 group-hover:opacity-100 group-focus-within:delay-[1000ms] group-focus-within:scale-100 group-focus-within:opacity-100">
											Aca vas a poder poner piezas a la venta para otros miembros.
										</div>
									</div>
								) : (
									<button
										type="button"
										disabled
										className="inline-flex h-10 w-[90%] cursor-not-allowed items-center justify-center rounded-lg border border-slate-300 bg-slate-200 px-4 text-sm font-semibold text-slate-500"
									>
										Pool de ventas proximamente
									</button>
								)}
								{!showPoolWantedModule && !showPoolSaleModule ? <p className="text-xs text-slate-500">Modulos de pool desactivados.</p> : null}
							</div>
						</div>

						<div className="rounded-xl border border-slate-200 p-4 text-center sm:p-5">
							<div className="flex justify-center">
								<img src="/Minifigura_silueta.png?v=3" alt="Minifiguras" className="h-28 w-28 object-contain" />
							</div>
							<div className="mt-4 flex justify-center">
								<div className="group relative">
									{showMinifigurasModule ? (
										<Link
											href="/dashboard/minifiguras"
											className="inline-flex h-10 items-center rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-700"
										>
											Minifiguras CMF
										</Link>
									) : (
										<button
											type="button"
											disabled
											className="inline-flex h-10 cursor-not-allowed items-center rounded-lg border border-slate-300 bg-slate-200 px-4 text-sm font-semibold text-slate-500"
										>
											Proximamente
										</button>
									)}
									<div className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 w-72 -translate-x-1/2 scale-95 rounded-[4px] border border-slate-300 bg-slate-100 px-3 py-2 text-center text-[11px] font-normal text-slate-900 opacity-0 shadow-lg transition-all duration-200 ease-out group-hover:delay-[1000ms] group-hover:scale-100 group-hover:opacity-100 group-focus-within:delay-[1000ms] group-focus-within:scale-100 group-focus-within:opacity-100">
										Lleva la cuenta de tus colecciones de minifiguras de coleccion de todas las series.
									</div>
								</div>
							</div>
						</div>
					</div>
				</section>

				{message ? <p className="text-sm text-slate-700">{message}</p> : null}

				{showMasterModal ? (
					<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4" onClick={() => setShowMasterModal(false)}>
						<div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl" onClick={(event) => event.stopPropagation()}>
							<div className="flex items-center justify-between">
								<h3 className="text-xl font-semibold text-slate-900">Panel MASTER</h3>
								<button
									type="button"
									onClick={() => setShowMasterModal(false)}
									className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
								>
									Cerrar
								</button>
							</div>
							<p className="mt-2 text-xs text-slate-600">Activa o desactiva modulos del dashboard.</p>
							<div className="mt-4 space-y-3">
								<button
									type="button"
									onClick={() => setShowMaintenanceModal(true)}
									className="flex w-full items-center justify-center rounded-lg border border-slate-900 bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
								>
									Mantenimiento
								</button>

								<div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
									<p className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Modulos</p>
									<div className="space-y-2">
										<button
											type="button"
											onClick={() => toggleMasterModule("poolWanted")}
											className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-sm font-semibold ${masterModules.poolWanted ? "border-[#006eb2] bg-[#e8f4fb] text-[#005f9a]" : "border-slate-300 bg-white text-slate-700"}`}
										>
											<span>Pool de items deseados</span>
											<span>{masterModules.poolWanted ? "Activo" : "Inactivo"}</span>
										</button>
										<button
											type="button"
											onClick={() => toggleMasterModule("poolSale")}
											className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-sm font-semibold ${masterModules.poolSale ? "border-[#006eb2] bg-[#e8f4fb] text-[#005f9a]" : "border-slate-300 bg-white text-slate-700"}`}
										>
											<span>Pool de items a la venta</span>
											<span>{masterModules.poolSale ? "Activo" : "Inactivo"}</span>
										</button>
										<button
											type="button"
											onClick={() => toggleMasterModule("minifiguras")}
											className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-sm font-semibold ${masterModules.minifiguras ? "border-[#006eb2] bg-[#e8f4fb] text-[#005f9a]" : "border-slate-300 bg-white text-slate-700"}`}
										>
											<span>Minifiguras CMF</span>
											<span>{masterModules.minifiguras ? "Activo" : "Inactivo"}</span>
										</button>
									</div>
								</div>

								<div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
									<p className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Info</p>
									<div className="space-y-2">
										<button
											type="button"
											onClick={() => void openMasterUsersModal()}
											className="flex w-full items-center justify-center rounded-lg border border-black bg-black px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
										>
											Usuarios
										</button>
									</div>
								</div>

								<div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
									<p className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Updates</p>
									<div className="space-y-2">
										<button
											type="button"
											onClick={() => setShowCacheImagesModal(true)}
											className="flex w-full items-center justify-center rounded-lg border border-[#006eb2] bg-[#006eb2] px-3 py-2 text-sm font-semibold text-white hover:bg-[#005f9a]"
										>
											Cache imagenes
										</button>
										<button
											type="button"
											onClick={() => setShowUpdatesModal(true)}
											className="flex w-full items-center justify-center rounded-lg border border-emerald-700 bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
										>
											Check new things
										</button>
									</div>
								</div>
							</div>
						</div>
					</div>
				) : null}

				{showCacheImagesModal ? (
					<div className="fixed inset-0 z-[56] flex items-center justify-center bg-slate-900/45 p-4" onClick={() => setShowCacheImagesModal(false)}>
						<div className="h-[82vh] w-full max-w-5xl rounded-xl bg-white p-5 shadow-xl" onClick={(event) => event.stopPropagation()}>
							<div className="flex items-center justify-between border-b border-slate-200 pb-2">
								<h3 className="text-xl font-semibold text-slate-900">Cache imagenes</h3>
								<div className="flex items-center gap-2">
									<button
										type="button"
										onClick={() => setCacheImagesPage((current) => Math.max(1, current - 1))}
										disabled={cacheImagesLoading || cacheImagesPage <= 1}
										className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
									>
										Anterior
									</button>
									<span className="text-xs text-slate-600">Pagina {cacheImagesPage} de {cacheImagesTotalPages}</span>
									<button
										type="button"
										onClick={() => setCacheImagesPage((current) => Math.min(cacheImagesTotalPages, current + 1))}
										disabled={cacheImagesLoading || cacheImagesPage >= cacheImagesTotalPages}
										className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
									>
										Siguiente
									</button>
									<button
										type="button"
										onClick={() => setShowCacheImagesModal(false)}
										className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
									>
										Cerrar
									</button>
								</div>
							</div>
							<div className="mt-4 h-[calc(82vh-84px)] overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-4">
								{cacheImagesLoading ? <p className="text-sm text-slate-600">Cargando imagenes cacheadas...</p> : null}
								{cacheImagesError ? <p className="text-sm text-red-700">{cacheImagesError}</p> : null}
								{!cacheImagesLoading && !cacheImagesError ? (
									<div className="grid grid-cols-5 gap-2 md:grid-cols-10">
										{cacheImages.map((row, index) => (
											<div key={`${row.part_num}:${row.color_name}:${row.updated_at}:${index}`} className="rounded border border-slate-300 bg-white p-1">
												<div className="flex h-16 items-center justify-center overflow-hidden rounded bg-slate-100">
													<img src={row.part_img_url} alt={`${row.part_num} ${row.color_name}`} className="h-full w-full object-contain" loading="lazy" />
												</div>
												<p className="mt-1 truncate text-[9px] font-semibold text-slate-800">{row.part_num}</p>
												<p className="truncate text-[8px] text-slate-500">{row.color_name}</p>
												<p className="truncate text-[8px] text-slate-400">{formatCacheDate(row.updated_at)}</p>
											</div>
										))}
									</div>
								) : null}
								{!cacheImagesLoading && !cacheImagesError && cacheImages.length === 0 ? <p className="text-sm text-slate-600">No hay imagenes cacheadas para mostrar.</p> : null}
							</div>
						</div>
					</div>
				) : null}

				{showUpdatesModal ? (
					<div className="fixed inset-0 z-[58] flex items-center justify-center bg-slate-900/45 p-4" onClick={() => setShowUpdatesModal(false)}>
						<div className="h-[82vh] w-full max-w-3xl rounded-xl bg-white p-5 shadow-xl" onClick={(event) => event.stopPropagation()}>
							<div className="flex items-center justify-between border-b border-slate-200 pb-2">
								<h3 className="text-xl font-semibold text-slate-900">Check new things</h3>
								<button
									type="button"
									onClick={() => setShowUpdatesModal(false)}
									className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
								>
									Cerrar
								</button>
							</div>

							<div className="mt-4 h-[calc(82vh-84px)] space-y-4 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-4">

								<div className="rounded-lg border border-slate-300 bg-white p-3">
									<p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Update CMF</p>
									<p className="mt-1 text-xs text-slate-600">Busca novedades, actualiza KV y carga partes nuevas en DB de forma lenta.</p>
									<button
										type="button"
										onClick={() => void checkNewThings()}
										disabled={checkingNewThings}
										className="mt-3 inline-flex items-center justify-center rounded-lg border border-emerald-700 bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
									>
										{checkingNewThings ? "Running..." : "Run update"}
									</button>
									{checkProgressText ? <p className="mt-2 text-xs text-slate-600">{checkProgressText}</p> : null}
								</div>

								<div className="rounded-lg border border-slate-300 bg-white p-3">
									<p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Ultimos checks</p>
									<div className="mt-2 space-y-2">
										{cmfCheckLogs.map((item) => (
											<div key={item.id} className="rounded border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700">
												<p className="font-semibold text-slate-900">
													{item.label === "initial" ? "Carga inicial" : "Check"} - {formatCheckDate(item.created_at)}
												</p>
												<p>
													Nuevas series: <span className="font-semibold">{item.new_series}</span> | Minifiguras nuevas: <span className="font-semibold">{item.new_minifigures}</span> | Partes nuevas: <span className="font-semibold">{item.new_parts}</span>
												</p>
											</div>
										))}
										{cmfCheckLogs.length === 0 ? <p className="text-sm text-slate-600">No hay checks registrados.</p> : null}
									</div>
								</div>
							</div>
						</div>
					</div>
				) : null}

				{showMaintenanceModal ? (
					<div className="fixed inset-0 z-[57] flex items-center justify-center bg-slate-900/45 p-4" onClick={() => setShowMaintenanceModal(false)}>
						<div className="h-[82vh] w-full max-w-2xl rounded-xl bg-white p-5 shadow-xl" onClick={(event) => event.stopPropagation()}>
							<div className="flex items-center justify-between border-b border-slate-200 pb-2">
								<button
									type="button"
									onClick={() => void setMaintenanceState(!maintenanceActive)}
									disabled={maintenanceSaving}
									className={`rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${maintenanceActive ? "border border-black bg-black hover:bg-slate-800" : "border border-[#006eb2] bg-[#006eb2] hover:bg-[#005f9a]"}`}
								>
									{maintenanceActive ? "DESACTIVAR" : "ACTIVAR"}
								</button>
								<button
									type="button"
									onClick={() => setShowMaintenanceModal(false)}
									className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
								>
									Cerrar
								</button>
							</div>
							<div className="mt-4 h-[calc(82vh-84px)] overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-4">
								<textarea
									value={maintenanceText}
									onChange={(event) => setMaintenanceText(event.target.value)}
									placeholder="Escribi el texto de mantenimiento..."
									rows={5}
									className="w-full resize-none rounded-md border border-slate-300 bg-white p-3 text-sm text-slate-900 outline-none focus:border-slate-500"
								/>
								<div className="mt-4">
									<p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Vista previa</p>
									<div className="bg-lego-tile mx-auto w-full max-w-md rounded-lg border border-slate-300 px-4 py-6 text-center text-white">
										<div className="flex justify-center">
											<Image src={constructorImage} alt="Constructor" className="h-24 w-24 object-contain sm:h-28 sm:w-28" />
										</div>
										<p className="mt-3 whitespace-pre-line text-base sm:text-lg">{maintenanceText || "Estamos realizando tareas de mantenimiento."}</p>
									</div>
								</div>
							</div>
						</div>
					</div>
				) : null}

				{showMasterUsersModal ? (
					<div className="fixed inset-0 z-[55] flex items-center justify-center bg-slate-900/45 p-4" onClick={() => setShowMasterUsersModal(false)}>
						<div className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl" onClick={(event) => event.stopPropagation()}>
							<div className="flex items-center justify-between border-b border-slate-200 pb-2">
								<h3 className="text-xl font-semibold text-slate-900">Usuarios Registrados ({registeredUsers.length})</h3>
								<button
									type="button"
									onClick={() => setShowMasterUsersModal(false)}
									className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
								>
									Cerrar
								</button>
							</div>

							<div className="mt-3 max-h-[60vh] space-y-2 overflow-auto pr-1">
								<div className="mb-2 flex items-center justify-end gap-2">
									<label htmlFor="master-users-sort" className="text-xs text-slate-600">
										Ordenar por
									</label>
									<select
										id="master-users-sort"
										value={masterUsersSort}
										onChange={(event) => setMasterUsersSort(event.target.value as "created" | "alpha")}
										className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-800"
									>
										<option value="created">Por orden de creacion</option>
										<option value="alpha">Alfabeticamente</option>
									</select>
								</div>
								{loadingRegisteredUsers ? (
									<p className="text-sm text-slate-600">Cargando usuarios...</p>
								) : registeredUsers.length === 0 ? (
									<p className="text-sm text-slate-600">No hay usuarios para mostrar.</p>
								) : (
									sortedRegisteredUsers.map((registeredUser) => (
										<div key={registeredUser.user_id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
											<div className="flex items-center justify-between gap-3">
												<p className="font-semibold text-slate-900">{registeredUser.display_name}</p>
												<p className="text-right text-sm text-slate-700">{registeredUser.email}</p>
											</div>
										</div>
									))
								)}
							</div>
						</div>
					</div>
				) : null}

				{showBalugMembersModal ? (
					<div className="fixed inset-0 z-[54] flex items-center justify-center bg-slate-900/45 p-4" onClick={() => setShowBalugMembersModal(false)}>
						<div className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl" onClick={(event) => event.stopPropagation()}>
							<div className="flex items-center justify-between border-b border-slate-200 pb-2">
								<h3 className="text-xl font-semibold text-slate-900">Integrantes BALUG ({balugMembers.length})</h3>
								<button
									type="button"
									onClick={() => setShowBalugMembersModal(false)}
									className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
								>
									Cerrar
								</button>
							</div>

							<div className="mt-3 max-h-[60vh] space-y-2 overflow-auto pr-1">
								{loadingBalugMembers ? (
									<p className="text-sm text-slate-600">Cargando integrantes...</p>
								) : balugMembers.length === 0 ? (
									<p className="text-sm text-slate-600">No hay integrantes para mostrar.</p>
								) : (
									balugMembers.map((member, index) => (
										<div key={`${member.display_name}-${index}`} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
											<div className="flex items-center justify-between gap-3">
												<p className="font-semibold text-slate-900">{member.display_name}</p>
												<div className="inline-flex items-center gap-1 text-sm text-slate-700">
													{member.social_platform === "instagram" || member.social_platform === "facebook" ? (
														<SocialIcon platform={member.social_platform} className="h-5 w-5" />
													) : null}
													<span>{member.social_handle ? `@${member.social_handle}` : "-"}</span>
												</div>
											</div>
										</div>
									))
								)}
							</div>
						</div>
					</div>
				) : null}

				{deleteTarget ? (
					<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
						<div className="w-full max-w-xs rounded-xl bg-white p-5 shadow-xl">
							<div className="flex flex-col items-center text-center">
								<Image src="/LEGO-ICON_A.svg" alt="Lego icon" width={128} height={128} />
								<div className="mt-3">
									<p className="text-base font-medium text-slate-700">Esta lista va a ser desarmada</p>
									<h3 className="mt-1 text-2xl text-slate-900">{getDisplayListName(deleteTarget.name)}</h3>
								</div>
								<div className="mt-5 flex items-center gap-2">
									<button
										type="button"
										onClick={confirmDeleteList}
										disabled={deletingListId === deleteTarget.id}
										className="rounded-md bg-[#006eb2] px-4 py-2 text-sm font-semibold text-white hover:bg-[#005f9a] disabled:opacity-50"
									>
										Si
									</button>
									<button
										type="button"
										onClick={() => setDeleteTarget(null)}
										disabled={deletingListId === deleteTarget.id}
										className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
									>
										No
									</button>
								</div>
							</div>
						</div>
					</div>
				) : null}

				{showUserSettings ? (
					<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
						<div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
							<h3 className="text-xl text-slate-900">Configuracion de usuario</h3>
							<label className="mt-4 block text-sm text-slate-700" htmlFor="settingsDisplayName">
								Nombre
							</label>
							<input
								id="settingsDisplayName"
								type="text"
								value={settingsNameInput}
								onChange={(event) => setSettingsNameInput(event.target.value)}
								className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-slate-500"
							/>
							<label className="mt-3 block text-sm text-slate-700" htmlFor="settingsEmail">
								Email
							</label>
							<input
								id="settingsEmail"
								type="email"
								value={settingsEmailInput}
								onChange={(event) => setSettingsEmailInput(event.target.value)}
								className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-slate-500"
							/>
							<div className="mt-3 grid grid-cols-[140px_minmax(0,1fr)] gap-2">
								<select
									value={settingsSocialPlatform}
									onChange={(event) => setSettingsSocialPlatform(event.target.value as "instagram" | "facebook" | "")}
									className="rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-slate-500"
								>
									<option value="instagram">Instagram</option>
									<option value="facebook">Facebook</option>
								</select>
								<input
									type="text"
									value={settingsSocialHandle}
									onChange={(event) => setSettingsSocialHandle(event.target.value)}
									placeholder="usuario"
									className="rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-slate-500"
								/>
							</div>
							<button
								type="button"
								onClick={openPasswordSettings}
								className="mt-3 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
							>
								Cambiar contrasena
							</button>
							<div className="mt-4 grid grid-cols-4 gap-2">
								{Array.from({ length: FACE_TOTAL }, (_, index) => {
									const faceNum = index + 1;
									const isSelected = selectedFace === faceNum;
									return (
										<button
											key={`slot-${faceNum}`}
											type="button"
											onClick={() => setSelectedFace(faceNum)}
											className={`flex aspect-square w-full items-center justify-center overflow-hidden rounded-md border p-1 ${isSelected ? "border-[#006eb2] bg-[#cfeeff]" : "border-slate-200 bg-slate-50"}`}
										>
											<img src={getFaceImagePath(faceNum)} alt={`Cara minifig ${faceNum}`} className="h-full w-full object-contain" />
										</button>
									);
								})}
							</div>
							<div className="mt-4 flex justify-end gap-2">
								<button
									type="button"
									onClick={() => {
										setShowPasswordModal(false);
										setShowUserSettings(false);
									}}
									disabled={settingsSaving}
									className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
								>
									Cancelar
								</button>
								<button
									type="button"
									onClick={saveUserSettings}
									disabled={settingsSaving}
									className="rounded-md bg-[#006eb2] px-4 py-2 text-sm font-semibold text-white hover:bg-[#005f9a] disabled:opacity-50"
								>
									{settingsSaving ? "Guardando..." : "Guardar"}
								</button>
							</div>
						</div>
					</div>
				) : null}

				{showPasswordModal ? (
					<div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/55 p-4">
						<div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
							<h3 className="text-xl text-slate-900">Cambiar contrasena</h3>
							<label className="mt-4 block text-sm text-slate-700" htmlFor="currentPassword">
								Contrasena vieja
							</label>
							<input
								id="currentPassword"
								type="password"
								value={currentPasswordInput}
								onChange={(event) => setCurrentPasswordInput(event.target.value)}
								className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-slate-500"
							/>
							<label className="mt-3 block text-sm text-slate-700" htmlFor="newPassword">
								Contrasena nueva
							</label>
							<input
								id="newPassword"
								type="password"
								value={newPasswordInput}
								onChange={(event) => setNewPasswordInput(event.target.value)}
								className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-slate-500"
							/>
							<label className="mt-3 block text-sm text-slate-700" htmlFor="newPasswordConfirm">
								Repetir contrasena nueva
							</label>
							<input
								id="newPasswordConfirm"
								type="password"
								value={newPasswordConfirmInput}
								onChange={(event) => setNewPasswordConfirmInput(event.target.value)}
								className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-slate-500"
							/>
							<div className="mt-4 flex justify-end gap-2">
								<button
									type="button"
									onClick={() => setShowPasswordModal(false)}
									disabled={passwordSaving}
									className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
								>
									Cancelar
								</button>
								<button
									type="button"
									onClick={savePasswordSettings}
									disabled={passwordSaving}
									className="rounded-md bg-[#006eb2] px-4 py-2 text-sm font-semibold text-white hover:bg-[#005f9a] disabled:opacity-50"
								>
									{passwordSaving ? "Guardando..." : "Guardar"}
								</button>
							</div>
						</div>
					</div>
				) : null}

				<div className="border-t border-slate-200 pt-2">
					<button
						type="button"
						onClick={logout}
						className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
					>
						Cerrar sesion
					</button>
					<p className="mt-2 text-center text-xs text-slate-500">Version by Martin Dasnoy - Faltantes_1.4</p>
				</div>
			</main>
		</div>
	);
}
