import { writeFile } from "node:fs/promises";

const SOURCE_URL = "https://mygobricks.com/pages/color";
const FALLBACK_SOURCE_URL = "https://r.jina.ai/http://mygobricks.com/pages/color";
const OUTPUT_FILE = "./supabase/gobrick_colors_seed.csv";

function htmlToLines(html) {
  const noScript = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ");
  const text = noScript
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/td>/gi, "\n")
    .replace(/<\/th>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\r/g, "");

  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function isMappingValue(value) {
  return value === "/" || /^\d+\s*\[[^\]]+\](\/\d+)?$/u.test(value);
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (text.includes('"') || text.includes(",") || text.includes("\n")) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function parseRows(lines) {
  const rows = [];
  let i = 0;

  while (i < lines.length) {
    if (!/^\d{3}$/u.test(lines[i])) {
      i += 1;
      continue;
    }

    const gbId = Number(lines[i]);
    let j = i + 1;
    let uniqueFlag = false;

    if (lines[j] === "Unique") {
      uniqueFlag = true;
      j += 1;
    }

    let name = "";
    while (j < lines.length) {
      const token = lines[j];
      if (token === "Unique" || token === "Plate") {
        j += 1;
        continue;
      }
      if (!isMappingValue(token)) {
        name = token;
        j += 1;
        break;
      }
      j += 1;
    }

    const mappings = [];
    while (j < lines.length && mappings.length < 4) {
      const token = lines[j];
      if (isMappingValue(token)) {
        mappings.push(token);
      }
      j += 1;
    }

    const [legoNo = "/", ldrawNo = "/", bricklinkNo = "/", brickowlNo = "/"] = mappings;

    if (name) {
      rows.push({
        gb_id: gbId,
        name,
        hex: "",
        lego_no: legoNo,
        ldraw_no: ldrawNo,
        bricklink_no: bricklinkNo,
        brickowl_no: brickowlNo,
        lego_available: legoNo !== "/",
        bricklink_available: bricklinkNo !== "/",
        unique_flag: uniqueFlag,
        note: uniqueFlag ? "Unique" : "",
      });
    }

    i = j;
  }

  return rows;
}

function parseRowsFromMarkdownTable(markdown) {
  const rows = [];
  const lines = markdown.split("\n").map((line) => line.trim());

  for (const line of lines) {
    if (!line.startsWith("|")) continue;
    const cols = line.split("|").map((col) => col.trim());
    if (cols.length < 10) continue;

    const gb = cols[1];
    if (!/^\d{3}$/u.test(gb)) continue;

    const uniqueToken = cols[2] || "";
    const name = cols[4] || "";
    const legoNo = cols[5] || "/";
    const ldrawNo = cols[6] || "/";
    const bricklinkNo = cols[7] || "/";
    const brickowlNo = cols[8] || "/";

    rows.push({
      gb_id: Number(gb),
      name,
      hex: "",
      lego_no: legoNo,
      ldraw_no: ldrawNo,
      bricklink_no: bricklinkNo,
      brickowl_no: brickowlNo,
      lego_available: legoNo !== "/",
      bricklink_available: bricklinkNo !== "/",
      unique_flag: uniqueToken.toLowerCase() === "unique",
      note: uniqueToken.toLowerCase() === "unique" ? "Unique" : "",
    });
  }

  return rows;
}

async function main() {
  let html = "";
  let usedFallback = false;

  const primary = await fetch(SOURCE_URL, {
    headers: {
      "user-agent": "Mozilla/5.0",
      accept: "text/html",
    },
  });

  if (primary.ok) {
    html = await primary.text();
  } else {
    const fallback = await fetch(FALLBACK_SOURCE_URL, {
      headers: { "user-agent": "Mozilla/5.0", accept: "text/plain" },
    });
    if (!fallback.ok) {
      throw new Error(`No pude leer ${SOURCE_URL} (status ${primary.status}) ni fallback (status ${fallback.status}).`);
    }
    html = await fallback.text();
    usedFallback = true;
  }

  const rows = usedFallback
    ? parseRowsFromMarkdownTable(html)
    : parseRows(htmlToLines(html));

  if (rows.length === 0) {
    throw new Error("No se encontraron filas de colores para exportar.");
  }

  const header = [
    "gb_id",
    "name",
    "hex",
    "lego_no",
    "ldraw_no",
    "bricklink_no",
    "brickowl_no",
    "lego_available",
    "bricklink_available",
    "unique_flag",
    "note",
  ];

  const csv = [
    header.join(","),
    ...rows.map((row) =>
      [
        row.gb_id,
        row.name,
        row.hex,
        row.lego_no,
        row.ldraw_no,
        row.bricklink_no,
        row.brickowl_no,
        row.lego_available,
        row.bricklink_available,
        row.unique_flag,
        row.note,
      ]
        .map(csvEscape)
        .join(","),
    ),
  ].join("\n");

  await writeFile(OUTPUT_FILE, csv, "utf8");
  console.log(`OK: ${rows.length} colores exportados en ${OUTPUT_FILE}${usedFallback ? " (usando fallback)" : ""}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
