export type CatalogFilter = "popular" | "minifigs" | "technic" | "others" | "all";

const popularIds = new Set<number>([
	3, 5, 6, 7, 9, 11, 14, 15, 16, 19, 20, 21, 23, 29, 32, 33, 34, 35, 36, 37, 38, 47, 49, 67, 76,
]);

const minifigsIds = new Set<number>([
	13, 27, 28, 41, 59, 60, 61, 62, 63, 64, 65, 70, 71, 72, 73, 74, 75,
]);

const technicIds = new Set<number>([
	1, 8, 12, 17, 25, 26, 31, 40, 44, 46, 51, 52, 53, 54, 55,
]);

const othersIds = new Set<number>([
	4, 18, 22, 24, 30, 39, 42, 43, 45, 48, 50, 56, 57, 58, 66, 68, 69, 77, 78,
]);

export function categoryMatchesFilter(categoryId: number, filter: CatalogFilter) {
	if (filter === "all") return true;
	if (filter === "popular") return popularIds.has(categoryId);
	if (filter === "minifigs") return minifigsIds.has(categoryId);
	if (filter === "technic") return technicIds.has(categoryId);
	return othersIds.has(categoryId);
}
