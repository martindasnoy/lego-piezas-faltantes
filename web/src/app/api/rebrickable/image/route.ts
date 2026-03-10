import { NextResponse } from "next/server";

export async function GET() {
	return NextResponse.json({ error: "Servicio de imagenes deshabilitado." }, { status: 410 });
}
