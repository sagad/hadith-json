import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.join(process.cwd(), "db", "by_locale", "id", "by_chapter");

const EN_MARKERS = new Set([
	"the",
	"and",
	"of",
	"to",
	"in",
	"that",
	"is",
	"was",
	"with",
	"for",
	"narrated",
	"messenger",
	"allah",
]);

const ID_MARKERS = new Set([
	"dan",
	"yang",
	"di",
	"ke",
	"dari",
	"untuk",
	"dengan",
	"adalah",
	"beliau",
	"rasulullah",
	"allah",
]);

main().catch((error) => {
	console.error(error);
	process.exit(1);
});

async function main() {
	if (!existsSync(ROOT)) {
		throw new Error("Folder db/by_locale/id/by_chapter tidak ditemukan");
	}

	const files = await walk(ROOT);
	let hadithCount = 0;
	let draftCount = 0;
	let missingCount = 0;
	let englishLikeDraftCount = 0;

	for (const filePath of files) {
		const raw = await readFile(filePath, "utf8");
		const json = JSON.parse(raw) as {
			hadiths?: Array<{
				translation?: {
					text?: string;
					status?: string;
				};
			}>;
		};

		for (const hadith of json.hadiths || []) {
			hadithCount += 1;
			const text = String(hadith.translation?.text || "");
			const status = String(hadith.translation?.status || "");

			if (status === "draft") {
				draftCount += 1;
				if (looksLikeEnglish(text)) {
					englishLikeDraftCount += 1;
				}
			}

			if (status === "missing") {
				missingCount += 1;
			}
		}
	}

	const englishLikeRatio =
		draftCount === 0 ? 0 : Number((englishLikeDraftCount / draftCount).toFixed(4));

	console.log("Validation summary (id locale)");
	console.log(`files: ${files.length}`);
	console.log(`hadiths: ${hadithCount}`);
	console.log(`draft: ${draftCount}`);
	console.log(`missing: ${missingCount}`);
	console.log(`english-like draft: ${englishLikeDraftCount}`);
	console.log(`english-like draft ratio: ${englishLikeRatio}`);

	if (missingCount > 0) {
		console.error("Validation failed: masih ada hadith berstatus missing.");
		process.exit(1);
	}

	if (englishLikeRatio > 0.2) {
		console.error(
			"Validation failed: terlalu banyak teks draft yang terdeteksi masih dominan English.",
		);
		process.exit(1);
	}

	console.log("Validation passed: locale id terlihat sudah terisi dengan baik.");
}

function looksLikeEnglish(text: string) {
	const words = text
		.toLowerCase()
		.replace(/[^a-z\s]/g, " ")
		.split(/\s+/)
		.filter(Boolean);

	if (words.length < 6) {
		return false;
	}

	let enCount = 0;
	let idCount = 0;
	for (const word of words) {
		if (EN_MARKERS.has(word)) enCount += 1;
		if (ID_MARKERS.has(word)) idCount += 1;
	}

	return enCount >= 2 && enCount > idCount;
}

async function walk(dir: string): Promise<string[]> {
	const entries = await readdir(dir, { withFileTypes: true });
	const out: string[] = [];

	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			out.push(...(await walk(fullPath)));
			continue;
		}

		if (entry.isFile() && entry.name.endsWith(".json")) {
			out.push(fullPath);
		}
	}

	return out;
}
