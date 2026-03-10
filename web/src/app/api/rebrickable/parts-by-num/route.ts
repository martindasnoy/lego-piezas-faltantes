import { NextResponse } from "next/server";

export async function GET(request: Request) {
	const { searchParams } = new URL(request.url);
	const rawNums = (searchParams.get("nums") ?? "").trim();

	if (!rawNums) {
		return NextResponse.json({ results: [] });
	}

	const results = rawNums
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean)
		.slice(0, 100)
		.map((part_num) => ({ part_num, name: part_num, part_img_url: null }));

	return NextResponse.json({ results });
}
