"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabase";
import { gobrickColors, type GobrickColor } from "@/lib/gobrick-colors";
import { getRandomLoadingMessage } from "@/lib/loading-messages";

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
};

type PartSuggestion = {
	part_num: string;
	name: string;
	part_img_url: string | null;
};

type PartImageLookup = Record<string, string | null>;
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

export default function ListDetailPage() {
	const params = useParams<{ id: string }>();
	const router = useRouter();
	const loadingMessage = useMemo(() => getRandomLoadingMessage(), []);
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
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [updatingLotId, setUpdatingLotId] = useState<string | null>(null);
	const [deletingLotId, setDeletingLotId] = useState<string | null>(null);
	const [offersByLot, setOffersByLot] = useState<OfferSummaryByLot>({});
	const [message, setMessage] = useState<string | null>(null);
	const colorDropdownRef = useRef<HTMLDivElement | null>(null);

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

	useEffect(() => {
		const query = partInput.trim();
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
	}, [partInput]);

	useEffect(() => {
		async function loadDetail() {
			try {
				const supabase = getSupabaseClient();
				const {
					data: { user },
				} = await supabase.auth.getUser();

				if (!user) {
					router.replace("/");
					return;
				}

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

				setList(listData as ListInfo);

				const { data: lotRows, error: lotError } = await supabase
					.from("list_items")
					.select("id,part_name,part_num,color_name,quantity")
					.eq("list_id", listId)
					.order("created_at", { ascending: false });

				if (lotError) {
					setMessage("No se pudieron cargar los lotes de esta lista.");
				} else {
					const loadedLots = (lotRows as Lot[]) ?? [];
					setLots(loadedLots);
					void loadPartImages(loadedLots.map((lot) => lot.part_num));
					void loadOffersForLots(loadedLots.map((lot) => String(lot.id)));
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

	async function loadPartImages(partNums: string[]) {
		const uniqueNums = [...new Set(partNums.map((num) => num.trim()).filter(Boolean))];
		if (uniqueNums.length === 0) return;

		const missingNums = uniqueNums.filter((num) => !(num in partImages));
		if (missingNums.length === 0) return;

		try {
			const response = await fetch(`/api/rebrickable/parts-by-num?nums=${encodeURIComponent(missingNums.join(","))}`);
			if (!response.ok) return;

			const payload = (await response.json()) as {
				results?: Array<{ part_num: string; part_img_url: string | null }>;
			};

			const additions: PartImageLookup = {};
			for (const part of payload.results ?? []) {
				additions[part.part_num] = part.part_img_url;
			}

			if (Object.keys(additions).length > 0) {
				setPartImages((current) => ({ ...current, ...additions }));
			}
		} catch {
			// No bloquea si falla carga de imagenes.
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

	async function createLot(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setSaving(true);
		setMessage(null);

		try {
			const supabase = getSupabaseClient();
			const piece = partInput.trim();
			const partNum = selectedPart?.part_num || piece;
			const partName = selectedPart?.name || piece;
			const selectedColorName = selectedColor
				? useBricklinkNomenclature
					? selectedColor.blName?.trim() || selectedColor.name
					: selectedColor.name
				: "";

			const color = selectedColor
				? `${selectedColorName}${selectedColor.uniqueFlag ? " (Chino)" : ""}`
				: colorInput.trim();
			const quantity = Number(quantityInput);

			if (!piece) {
				setMessage("Escribe la pieza para crear el lote.");
				setSaving(false);
				return;
			}

			if (!Number.isFinite(quantity) || quantity <= 0) {
				setMessage("La cantidad debe ser mayor a 0.");
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
				})
				.select("id,part_name,part_num,color_name,quantity")
				.single();

			if (error) {
				setMessage(error.message);
				setSaving(false);
				return;
			}

			setLots((current) => [data as Lot, ...current]);
			if (selectedPart?.part_img_url) {
				setPartImages((current) => ({ ...current, [partNum]: selectedPart.part_img_url }));
			} else {
				void loadPartImages([partNum]);
			}
			void loadOffersForLots([...(lots.map((lot) => String(lot.id))), String((data as Lot).id)]);
			setPartInput("");
			setSelectedPart(null);
			setSuggestions([]);
			setColorInput("");
			setSelectedColor(null);
			setShowColorSuggestions(false);
			setQuantityInput(1);
		} catch (error) {
			const text = error instanceof Error ? error.message : "No se pudo crear el lote.";
			setMessage(text);
		} finally {
			setSaving(false);
		}
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

	function setLocalLotQuantity(lotId: string, nextQuantity: number) {
		setLots((current) =>
			current.map((lot) => (lot.id === lotId ? { ...lot, quantity: Number.isFinite(nextQuantity) ? nextQuantity : lot.quantity } : lot)),
		);
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
		} finally {
			setDeletingLotId(null);
		}
	}

	if (loading) {
		return <div className="min-h-screen bg-[#006eb2] p-8 text-white">{loadingMessage}</div>;
	}

	if (!list) {
		return (
			<div className="min-h-screen bg-[#006eb2] p-8 text-white">
				<p>No encontramos esa lista.</p>
				<Link href="/dashboard" className="mt-4 inline-block underline">
					Volver al dashboard
				</Link>
			</div>
		);
	}

	return (
		<div className="min-h-screen bg-[#006eb2] px-6 py-8">
			<main className="mx-auto flex w-full max-w-3xl flex-col gap-6 rounded-2xl bg-white p-6 shadow-xl sm:p-8">
				<header className="border-b border-slate-200 pb-5">
					<div className="flex items-start justify-between gap-3">
						<h1 className="text-3xl font-semibold text-slate-900">Lista {list.name.toLocaleUpperCase("es-AR")}</h1>
						<Link href="/dashboard" className="text-sm text-slate-600 hover:underline">
							← Volver
						</Link>
					</div>
					<p className="mt-1 text-sm text-slate-600">
						Visibilidad: {list.is_public ? "Publica" : "Privada"} - Lotes: {totals.lots} - Piezas: {totals.pieces}
					</p>
				</header>

				<section className="rounded-xl border border-slate-200 p-4 sm:p-5">
					<h2 className="text-2xl font-semibold text-slate-900">Agregar item</h2>
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

						<div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_200px] md:items-start">
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
								<div className="mt-2 flex gap-2">
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
								</div>
							</div>

							<div className="flex flex-col items-end gap-2">
								<div className="w-28">
									<input
										type="number"
										min={1}
										step={1}
										value={quantityInput}
										onChange={(event) => setQuantityInput(Number(event.target.value))}
										className="quantity-input w-full appearance-auto rounded-lg border border-slate-300 px-2 py-2 text-center text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
									/>
								</div>
								<button
									type="submit"
									disabled={saving}
									className="h-11 w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
								>
									{saving ? "Guardando..." : "Agregar lote"}
								</button>
							</div>
						</div>
					</form>
				</section>

				<section className="rounded-xl border border-slate-200 p-4 sm:p-5">
					<h2 className="text-2xl font-semibold text-slate-900">Lotes de la lista</h2>
					{lots.length === 0 ? (
						<p className="mt-3 text-sm text-slate-600">Todavia no agregaste lotes.</p>
					) : (
						<ul className="mt-4 space-y-3">
							{lots.map((lot) => (
								<li key={lot.id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
									<div className="flex items-start gap-3 text-sm text-slate-800">
										{partImages[lot.part_num] ? (
											<img
												src={partImages[lot.part_num] ?? undefined}
												alt={lot.part_name || lot.part_num}
												className="h-16 w-16 rounded border border-slate-200 bg-white object-contain"
											/>
										) : (
											<div className="h-16 w-16 rounded border border-slate-200 bg-white" />
										)}

										<div className="min-w-0 flex-1">
											<div className="flex items-start justify-between gap-2">
												<p className="max-w-[520px] overflow-hidden text-slate-900 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">
													{lot.part_name || "Sin nombre"}
												</p>
												<div
													className={`shrink-0 rounded-md px-3 py-1 text-xs ${offersByLot[String(lot.id)] ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-600"}`}
												>
													{offersByLot[String(lot.id)]
														? offersByLot[String(lot.id)].byUser
															.map((u) => `${u.name} (${u.pieces})`)
															.join(", ")
														: "Sin ofertas"}
												</div>
											</div>

									<div className="mt-2 flex items-center justify-between gap-2">
										<div className="flex items-center gap-2">
											<span
												className="h-4 w-4 rounded border border-slate-300"
												style={{ backgroundColor: getColorHexFromName(lot.color_name) }}
												title={lot.color_name || "Sin color"}
											/>
											<span className="font-semibold text-slate-900">#{lot.part_num}</span>
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
										</div>

										<div className="flex items-center gap-1">
											<button
												type="button"
												onClick={() => deleteLot(lot.id)}
														disabled={deletingLotId === lot.id}
														className="rounded-md border border-red-200 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
													>
														Eliminar
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

				{message ? <p className="text-sm text-slate-700">{message}</p> : null}
			</main>
		</div>
	);
}
