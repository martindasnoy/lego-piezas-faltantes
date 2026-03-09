const ALLOWED_IMAGE_HOSTS = new Set([
	"rebrickable.com",
	"cdn.rebrickable.com",
	"images.rebrickable.com",
]);

export function isAllowedRebrickableImageUrl(rawUrl: string) {
	try {
		const parsed = new URL(rawUrl);
		if (parsed.protocol !== "https:") return false;

		const host = parsed.hostname.toLowerCase();
		if (ALLOWED_IMAGE_HOSTS.has(host)) return true;
		if (host.endsWith(".rebrickable.com")) return true;

		return false;
	} catch {
		return false;
	}
}

export function toRebrickableImageProxyUrl(rawUrl: string | null | undefined) {
	if (!rawUrl) return null;
	if (!isAllowedRebrickableImageUrl(rawUrl)) return null;
	return `/api/rebrickable/image?src=${encodeURIComponent(rawUrl)}`;
}
