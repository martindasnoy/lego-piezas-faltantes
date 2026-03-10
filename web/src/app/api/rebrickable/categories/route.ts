import { NextResponse } from "next/server";
import { staticRebrickableCategories } from "@/lib/rebrickable-categories-static";

export async function GET() {
	return NextResponse.json({ results: staticRebrickableCategories });
}
