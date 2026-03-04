import { getSupabaseClient } from "@/lib/supabase";

const SESSION_STARTED_AT_KEY = "session_started_at";
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function markSessionStart(now = Date.now()) {
	if (typeof window === "undefined") return;
	window.localStorage.setItem(SESSION_STARTED_AT_KEY, String(now));
}

export function clearSessionStart() {
	if (typeof window === "undefined") return;
	window.localStorage.removeItem(SESSION_STARTED_AT_KEY);
}

export async function enforceSessionTtl() {
	if (typeof window === "undefined") return false;

	const supabase = getSupabaseClient();
	const {
		data: { session },
	} = await supabase.auth.getSession();

	if (!session) {
		clearSessionStart();
		return false;
	}

	const rawStartedAt = window.localStorage.getItem(SESSION_STARTED_AT_KEY);
	let startedAt = rawStartedAt ? Number(rawStartedAt) : Number.NaN;

	if (!Number.isFinite(startedAt) || startedAt <= 0) {
		const fallback = session.user.last_sign_in_at ? Date.parse(session.user.last_sign_in_at) : Date.now();
		startedAt = Number.isFinite(fallback) ? fallback : Date.now();
		markSessionStart(startedAt);
	}

	if (Date.now() - startedAt > SESSION_MAX_AGE_MS) {
		await supabase.auth.signOut();
		clearSessionStart();
		return false;
	}

	return true;
}
