import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { Presets, SingleBar } from "cli-progress";
import { books } from "./books";
import { style } from "./helpers/consoleColor";
import createDirs from "./helpers/createDirs";
import createFile from "./helpers/createFile";
import { buildIndonesianChapterFile } from "./helpers/buildIndonesianChapterFile";

main()
	.catch((err) => {
		console.error("\n", style("fg.red", err));
	})
	.finally(() => {
		process.exit(0);
	});

async function main() {
	const START_TIME = Date.now();

	console.log("\n", "\t", style("fg.cyan", "Generating Indonesian locale from legacy data"));
	console.log();

	await createIndonesianChapterFilesFromLegacy();
	await createIndonesianBooksFromChapters();

	console.log(`Done generating Indonesian locale in ${(Date.now() - START_TIME) / 1000}s`);
}

async function createIndonesianChapterFilesFromLegacy() {
	for (const book of books) {
		const bar = new SingleBar(
			{
				format: "{value}/{total} | {bar} {percentage}% | {book}",
				hideCursor: true,
				stopOnComplete: true,
			},
			Presets.shades_classic,
		);
		bar.start(book.route.chapters.length, 0, {
			book: `${book.english.title} (id)` ,
		});

		await createDirs(["db", "by_locale", "id", "by_chapter"], ...book.path);

		for (const [index, chapter] of book.route.chapters.entries()) {
			bar.update(index + 1, {
				book: `${book.english.title} | ${chapter}`,
			});

			const outputPath = path.join(
				process.cwd(),
				"db",
				"by_locale",
				"id",
				"by_chapter",
				...book.path,
				`${chapter}.json`,
			);
			if (existsSync(outputPath)) {
				continue;
			}

			const sourcePath = path.join(
				process.cwd(),
				"db",
				"by_chapter",
				...book.path,
				`${chapter}.json`,
			);
			if (!existsSync(sourcePath)) {
				console.log(style("fg.yellow", `Skip missing source: ${sourcePath}`));
				continue;
			}

			const legacyChapterFile = require(sourcePath) as {
				metadata: {
					length: number;
					english: {
						title: string;
						author: string;
						introduction?: string;
					};
				};
				hadiths: Array<{
					id: number;
					idInBook: number;
					chapterId: number;
					bookId: number;
					english: {
						narrator: string;
						text: string;
					};
				}>;
				chapter?: {
					id: number;
					bookId: number;
					english: string;
				};
			};

			const englishLocalizedChapter: Prettify<LocalizedChapterFile> = {
				metadata: {
					locale: "en",
					length: legacyChapterFile.metadata.length,
					book: {
						title: legacyChapterFile.metadata.english.title,
						author: legacyChapterFile.metadata.english.author,
						introduction: legacyChapterFile.metadata.english.introduction,
						status: "source",
					},
				},
				hadiths: legacyChapterFile.hadiths.map((hadith) => ({
					id: hadith.id,
					idInBook: hadith.idInBook,
					chapterId: hadith.chapterId,
					bookId: hadith.bookId,
					translation: {
						narrator: hadith.english.narrator,
						text: hadith.english.text,
						status: "source",
					},
				})),
				chapter: legacyChapterFile.chapter
					? {
							id: legacyChapterFile.chapter.id,
							bookId: legacyChapterFile.chapter.bookId,
							title: legacyChapterFile.chapter.english,
							status: "source",
					  }
					: undefined,
			};

			const translated = await withChapterRetry(
				() => buildIndonesianChapterFile(englishLocalizedChapter),
				`${book.path.join("/")}/${chapter}`,
			);

			if (!translated) {
				continue;
			}

			await createFile(
				["db", "by_locale", "id", "by_chapter"],
				book.path,
				chapter,
				translated,
			);
		}
	}
}

async function withChapterRetry(
	runner: () => Promise<Prettify<LocalizedChapterFile>>,
	label: string,
) {
	const maxAttempts = 4;

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			return await runner();
		} catch (error) {
			if (attempt === maxAttempts) {
				console.log(style("fg.yellow", `Skip chapter after retries: ${label}`));
				console.log(style("fg.yellow", `${error}`));
				return null;
			}

			console.log(
				style(
					"fg.yellow",
					`Retry chapter ${label} (${attempt}/${maxAttempts - 1}) after transient translation error`,
				),
			);

			await new Promise((resolve) => {
				setTimeout(resolve, attempt * 15000);
			});
		}
	}

	return null;
}

async function createIndonesianBooksFromChapters() {
	let generalId = 1;

	for (const book of books) {
		let idInBook = 1;
		const chapterDir = path.join(
			process.cwd(),
			"db",
			"by_locale",
			"id",
			"by_chapter",
			...book.path,
		);

		if (!existsSync(chapterDir)) {
			continue;
		}

		const chapterFiles = sortChapterFiles(await readdir(chapterDir));
		if (chapterFiles.length === 0) {
			continue;
		}

		const firstChapter: LocalizedChapterFile = require(
			path.join(chapterDir, chapterFiles[0]),
		);

		const output: Prettify<LocalizedBookFile> = {
			id: book.id,
			metadata: {
				id: book.id,
				locale: "id",
				length: 0,
				book: firstChapter.metadata.book,
			},
			chapters: [],
			hadiths: [],
		};

		for (const chapterFile of chapterFiles) {
			const chapterData: LocalizedChapterFile = require(path.join(chapterDir, chapterFile));
			if (!chapterData.chapter) {
				continue;
			}

			output.chapters.push(chapterData.chapter);
			output.metadata.length += chapterData.metadata.length;
			output.hadiths.push(
				...chapterData.hadiths.map((hadith) => ({
					...hadith,
					id: generalId++,
					idInBook: idInBook++,
					bookId: book.id,
					chapterId: chapterData.chapter!.id,
				})),
			);
		}

		await createDirs(["db", "by_locale", "id", "by_book"], ...book.path.slice(0, -1));
		await createFile(
			["db", "by_locale", "id", "by_book"],
			book.path.slice(0, -1),
			book.path.at(-1)!,
			output,
		);
	}
}

function sortChapterFiles(files: string[]) {
	return files.sort((a, b) => {
		const aKey = a.split(".")[0];
		const bKey = b.split(".")[0];
		const aNum = Number.parseFloat(aKey);
		const bNum = Number.parseFloat(bKey);

		if (!Number.isNaN(aNum) && !Number.isNaN(bNum)) {
			return aNum - bNum;
		}

		if (!Number.isNaN(aNum)) return -1;
		if (!Number.isNaN(bNum)) return 1;

		return aKey.localeCompare(bKey);
	});
}
