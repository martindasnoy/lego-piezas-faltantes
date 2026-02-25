import { unstable_cache } from "next/cache";

const REBRICKABLE_API_BASE = "https://rebrickable.com/api/v3/lego/parts/";
const PREWARM_REVALIDATE_SECONDS = 60 * 60 * 24 * 10;

type RebrickablePart = {
	part_num: string;
	name?: string;
	part_img_url?: string | null;
	print_of?: string | null;
};

export type CachedCategoryPart = {
	part_num: string;
	name: string;
	part_img_url: string | null;
	is_printed: boolean;
};

export async function getCachedCategoryParts(categoryId: string, apiKey: string): Promise<CachedCategoryPart[]> {
	const cacheFn = unstable_cache(
		async () => {
			const upstreamPageSize = 1000;
			const first = await fetchRebrickablePage(categoryId, apiKey, 1, upstreamPageSize);
			const totalCount = Number(first.count ?? 0);
			const totalPages = Math.max(1, Math.ceil(totalCount / upstreamPageSize));

			const allParts: RebrickablePart[] = [...(first.results ?? [])];
			for (let page = 2; page <= totalPages; page += 1) {
				const payload = await fetchRebrickablePage(categoryId, apiKey, page, upstreamPageSize);
				allParts.push(...(payload.results ?? []));
			}

			return allParts.map((part) => ({
				part_num: part.part_num,
				name: part.name ?? part.part_num,
				part_img_url: part.part_img_url ?? null,
				is_printed: Boolean(part.print_of),
			}));
		},
		["rebrickable-category-all-parts", categoryId],
		{ revalidate: PREWARM_REVALIDATE_SECONDS },
	);

	return cacheFn();
}

async function fetchRebrickablePage(categoryId: string, apiKey: string, page: number, pageSize: number) {
	const url = new URL(REBRICKABLE_API_BASE);
	url.searchParams.set("part_cat_id", categoryId);
	url.searchParams.set("page", String(page));
	url.searchParams.set("page_size", String(pageSize));
	url.searchParams.set("inc_part_details", "1");
	url.searchParams.set("key", apiKey);

	const response = await fetch(url.toString(), {
		headers: { Accept: "application/json" },
	});

	if (!response.ok) {
		throw new Error(String(response.status));
	}

	return (await response.json()) as {
		count?: number;
		results?: RebrickablePart[];
	};
}
