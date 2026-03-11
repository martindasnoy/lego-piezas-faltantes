import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

const MASTER_EMAIL = "martindasnoy@gmail.com";

type Body = {
	list_id?: string;
	list_item_id?: string;
	part_num?: string;
	part_name?: string;
};

function normalizePartNum(value: string | undefined) {
	return String(value ?? "")
		.trim()
		.replace(/^#+\s*/, "")
		.toUpperCase();
}

export async function POST(request: Request) {
	let body: Body = {};
	try {
		body = (await request.json()) as Body;
	} catch {
		return NextResponse.json({ error: "Body invalido." }, { status: 400 });
	}

	const listId = String(body.list_id ?? "").trim();
	const listItemId = String(body.list_item_id ?? "").trim();
	const partNum = normalizePartNum(body.part_num);
	const partName = String(body.part_name ?? "").trim();

	if (!listId || !listItemId || !partNum || !partName) {
		return NextResponse.json({ error: "Faltan datos requeridos." }, { status: 400 });
	}

	const authHeader = request.headers.get("authorization") ?? "";
	const token = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";
	if (!token) {
		return NextResponse.json({ error: "No autenticado." }, { status: 401 });
	}

	try {
		const supabase = getSupabaseAdminClient();
		const { data: userData, error: userError } = await supabase.auth.getUser(token);
		if (userError || !userData.user) {
			return NextResponse.json({ error: "Sesion invalida." }, { status: 401 });
		}

		const email = String(userData.user.email ?? "").trim().toLowerCase();
		if (email !== MASTER_EMAIL) {
			return NextResponse.json({ error: "Solo master puede editar part_num y nombre." }, { status: 403 });
		}

		const { data: listItemRow, error: listItemError } = await supabase
			.from("list_items")
			.select("id,list_id")
			.eq("id", listItemId)
			.maybeSingle();

		if (listItemError || !listItemRow) {
			return NextResponse.json({ error: "Item no encontrado." }, { status: 404 });
		}

		const resolvedListId = String((listItemRow as { list_id?: string }).list_id ?? "").trim();
		if (!resolvedListId) {
			return NextResponse.json({ error: "Item sin lista asociada." }, { status: 400 });
		}

		if (listId && resolvedListId !== listId) {
			return NextResponse.json({ error: "El item no pertenece a la lista indicada." }, { status: 400 });
		}

		const { data: listData, error: listError } = await supabase
			.from("lists")
			.select("id,is_public")
			.eq("id", resolvedListId)
			.maybeSingle();

		if (listError || !listData) {
			return NextResponse.json({ error: "Lista no encontrada para el item." }, { status: 404 });
		}

		if (!Boolean((listData as { is_public?: boolean }).is_public)) {
			return NextResponse.json({ error: "Solo se permite editar items de listas publicas." }, { status: 400 });
		}

		const { data: updatedRow, error: updateError } = await supabase
			.from("list_items")
			.update({ part_num: partNum, part_name: partName })
			.eq("id", listItemId)
			.select("id,list_id,part_num,part_name")
			.maybeSingle();

		if (updateError) {
			return NextResponse.json({ error: updateError.message }, { status: 500 });
		}

		if (!updatedRow) {
			return NextResponse.json({ error: "No se encontro ese item en la lista indicada." }, { status: 404 });
		}

		return NextResponse.json({
			ok: true,
			list_item_id: listItemId,
			list_id: resolvedListId,
			part_num: partNum,
			part_name: partName,
		});
	} catch (error) {
		const detail = error instanceof Error ? error.message : "error";
		return NextResponse.json({ error: `No se pudo actualizar item (${detail}).` }, { status: 500 });
	}
}

export async function GET() {
	try {
		getSupabaseAdminClient();
		return NextResponse.json({ ok: true, service_role_loaded: true });
	} catch (error) {
		const detail = error instanceof Error ? error.message : "error";
		return NextResponse.json({ ok: false, service_role_loaded: false, error: detail }, { status: 500 });
	}
}
