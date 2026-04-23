import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import axios from "axios";

const CACHE_DIR = path.join(process.cwd(), ".cache");
const CACHE_FILE = path.join(CACHE_DIR, "id-translation-cache.json");
const MAX_RETRIES = 3;
const MAX_TRANSLATE_CHUNK = 12000;
const BATCH_MARKER = "\n<<<HTJ_SPLIT_v1>>>\n";

type TranslatedText = {
	text: string;
	status: TranslationStatus;
};

let translationCache: Record<string, string> | null = null;
let newCacheEntries = 0;

async function loadCache() {
	if (translationCache) return translationCache;

	if (!existsSync(CACHE_FILE)) {
		translationCache = {};
		return translationCache;
	}

	const raw = await readFile(CACHE_FILE, "utf8");
	translationCache = JSON.parse(raw) as Record<string, string>;
	return translationCache;
}

async function persistCache(force = false) {
	if (!translationCache) return;
	if (!force && newCacheEntries < 100) return;

	await mkdir(CACHE_DIR, { recursive: true });
	await writeFile(CACHE_FILE, JSON.stringify(translationCache));
	newCacheEntries = 0;
}

async function translateWithRetry(text: string) {
	let lastError: unknown;

	for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
		try {
			const response = await axios.get(
				"https://translate.googleapis.com/translate_a/single",
				{
					params: {
						client: "gtx",
						sl: "en",
						tl: "id",
						dt: "t",
						q: text,
					},
					timeout: 15000,
				},
			);

			const translated = (response.data?.[0] as Array<[string, string?]>)
				?.map((chunk) => chunk?.[0] || "")
				.join("")
				.trim();

			if (!translated) {
				throw new Error("Empty translation response");
			}

			return translated;
		} catch (error) {
			lastError = error;
			if (attempt < MAX_RETRIES) {
				await new Promise((resolve) => {
					setTimeout(resolve, attempt * 1200);
				});
			}
		}
	}

	const fallback = await translateWithFallbackProviders(text);
	if (fallback) {
		return fallback;
	}

	throw lastError;
}

async function translateWithFallbackProviders(text: string) {
	const libre = await tryLibreTranslate(text);
	if (libre) return libre;

	const myMemory = await tryMyMemoryTranslate(text);
	if (myMemory) return myMemory;

	return null;
}

async function tryLibreTranslate(text: string) {
	try {
		const response = await axios.post(
			"https://libretranslate.de/translate",
			{
				q: text,
				source: "en",
				target: "id",
				format: "text",
			},
			{
				headers: {
					"Content-Type": "application/json",
				},
				timeout: 20000,
			},
		);

		const translated = String(response.data?.translatedText || "").trim();
		return translated || null;
	} catch {
		return null;
	}
}

async function tryMyMemoryTranslate(text: string) {
	try {
		const response = await axios.get(
			"https://api.mymemory.translated.net/get",
			{
				params: {
					q: text,
					langpair: "en|id",
				},
				timeout: 20000,
			},
		);

		const translated = String(response.data?.responseData?.translatedText || "").trim();
		return translated || null;
	} catch {
		return null;
	}
}

async function translateToIndonesian(text: string): Promise<TranslatedText> {
	const normalized = text.trim();
	if (!normalized) {
		return {
			text: "",
			status: "source",
		};
	}

	const cache = await loadCache();
	if (cache[normalized]) {
		return {
			text: cache[normalized],
			status: "draft",
		};
	}

	try {
		const translated = await translateLargeText(normalized);
		cache[normalized] = translated;
		newCacheEntries += 1;
		await persistCache();
		return {
			text: translated,
			status: "draft",
		};
	} catch {
		// Keep source text with explicit missing status when providers fail.
		return {
			text: normalized,
			status: "missing",
		};
	}
}

async function translateBatch(texts: string[]): Promise<TranslatedText[]> {
	if (texts.length === 0) {
		return [];
	}

	const cache = await loadCache();
	const normalized = texts.map((text) => text.trim());
	const output: TranslatedText[] = normalized.map((text) => {
		if (!text) {
			return {
				text: "",
				status: "source",
			};
		}

		if (cache[text]) {
			return {
				text: cache[text],
				status: "draft",
			};
		}

		return {
			text: "",
			status: "missing",
		};
	});

	const pendingIndexes = normalized
		.map((text, index) => ({ text, index }))
		.filter((item) => item.text && !output[item.index].text)
		.map((item) => item.index);

	while (pendingIndexes.length > 0) {
		const batchIndexes: number[] = [];
		let estimatedLength = 0;

		while (pendingIndexes.length > 0) {
			const nextIndex = pendingIndexes[0];
			const nextText = normalized[nextIndex].replaceAll(BATCH_MARKER, " ");
			const addedLength =
				nextText.length + (batchIndexes.length > 0 ? BATCH_MARKER.length : 0);

			if (
				batchIndexes.length > 0 &&
				estimatedLength + addedLength > MAX_TRANSLATE_CHUNK
			) {
				break;
			}

			pendingIndexes.shift();
			batchIndexes.push(nextIndex);
			estimatedLength += addedLength;
		}

		const joined = batchIndexes
			.map((index) => normalized[index].replaceAll(BATCH_MARKER, " "))
			.join(BATCH_MARKER);

		try {
			const translatedJoined = await translateWithRetry(joined);
			const translatedParts = translatedJoined.split(BATCH_MARKER);

			if (translatedParts.length !== batchIndexes.length) {
				throw new Error(
					`Batch split mismatch: got ${translatedParts.length}, expected ${batchIndexes.length}`,
				);
			}

			for (const [partIndex, sourceIndex] of batchIndexes.entries()) {
				const translated = translatedParts[partIndex].trim();
				cache[normalized[sourceIndex]] = translated;
				output[sourceIndex] = {
					text: translated,
					status: "draft",
				};
				newCacheEntries += 1;
			}
		} catch {
			for (const sourceIndex of batchIndexes) {
				try {
					const translated = await translateLargeText(normalized[sourceIndex]);
					cache[normalized[sourceIndex]] = translated;
					output[sourceIndex] = {
						text: translated,
						status: "draft",
					};
					newCacheEntries += 1;
				} catch {
					output[sourceIndex] = {
						text: normalized[sourceIndex],
						status: "missing",
					};
				}
			}
		}

		await persistCache();
	}

	return output;
}

function chunkText(text: string) {
	if (text.length <= MAX_TRANSLATE_CHUNK) {
		return [text];
	}

	const chunks: string[] = [];
	let current = "";

	for (const token of text.split(/(\s+)/)) {
		if (!token) continue;
		if ((current + token).length > MAX_TRANSLATE_CHUNK && current.trim()) {
			chunks.push(current.trim());
			current = token;
			continue;
		}

		current += token;
	}

	if (current.trim()) {
		chunks.push(current.trim());
	}

	return chunks;
}

async function translateLargeText(text: string) {
	const chunks = chunkText(text);
	const translatedChunks: string[] = [];

	for (const chunk of chunks) {
		translatedChunks.push(await translateWithRetry(chunk));
	}

	return translatedChunks.join(" ").replace(/\s+/g, " ").trim();
}

export async function buildIndonesianChapterFile(
	englishFile: Prettify<LocalizedChapterFile>,
) {
	const metadataTitle = await translateToIndonesian(englishFile.metadata.book.title);
	const metadataAuthor = await translateToIndonesian(englishFile.metadata.book.author);
	const metadataIntroduction = englishFile.metadata.book.introduction
		? await translateToIndonesian(englishFile.metadata.book.introduction)
		: undefined;

	const translatedTexts = await translateBatch(
		englishFile.hadiths.map((hadith) => hadith.translation.text),
	);
	const translatedNarrators = await translateBatch(
		englishFile.hadiths.map((hadith) => hadith.translation.narrator?.trim() || ""),
	);

	const translatedHadiths = englishFile.hadiths.map((hadith, index) => ({
		...hadith,
		translation: {
			text: translatedTexts[index].text,
			narrator: hadith.translation.narrator
				? translatedNarrators[index].text
				: undefined,
			status:
				translatedTexts[index].status === "missing" ||
				translatedNarrators[index].status === "missing"
					? ("missing" as TranslationStatus)
					: ("draft" as TranslationStatus),
		},
	}));

	const translatedChapter = englishFile.chapter
		? {
				...englishFile.chapter,
				title: (await translateToIndonesian(englishFile.chapter.title)).text,
				status:
					translatedTexts.some((item) => item.status === "missing") ||
					translatedNarrators.some((item) => item.status === "missing")
						? ("missing" as TranslationStatus)
						: ("draft" as TranslationStatus),
		  }
		: undefined;

	const hasMissingSegments =
		metadataTitle.status === "missing" ||
		metadataAuthor.status === "missing" ||
		metadataIntroduction?.status === "missing" ||
		translatedTexts.some((item) => item.status === "missing") ||
		translatedNarrators.some((item) => item.status === "missing");

	const output: Prettify<LocalizedChapterFile> = {
		metadata: {
			locale: "id",
			length: englishFile.metadata.length,
			book: {
				title: metadataTitle.text,
				author: metadataAuthor.text,
				introduction: metadataIntroduction?.text,
				status: hasMissingSegments ? "missing" : "draft",
			},
		},
		hadiths: translatedHadiths,
		chapter: translatedChapter,
	};

	await persistCache(true);
	return output;
}
