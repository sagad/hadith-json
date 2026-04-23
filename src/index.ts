import "dotenv/config";

import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { Presets, SingleBar } from "cli-progress";
import { books } from "./books";
import { style } from "./helpers/consoleColor";
import createDirs from "./helpers/createDirs";
import createFile from "./helpers/createFile";
import { buildIndonesianChapterFile } from "./helpers/buildIndonesianChapterFile";
import { formatFile } from "./helpers/formatFile";
import { scrapeData } from "./helpers/scrapeData";

const SUPPORTED_LOCALES: Locale[] = ["ar", "en", "id"];

main()
	.catch((err) => {
		console.error("\n", style("fg.red", err));
	})
	.finally(() => {
		process.exit(0);
	});

async function main() {
	const START_TIME = Date.now();

	console.log(
		"\n",
		"\t",
		style(
			"fg.cyan",
			"In the name of Allah, the Most Gracious, the Most Merciful",
		),
	);
	console.log();

	console.log("Working on [db/by_chapter] folder...");
	await createChaptersFiles();
	console.log(
		`Done with [db/by_locale/*/by_chapter] folder in ${
			(Date.now() - START_TIME) / 1000
		}s\n`,
	);

	console.log("Working on [db/by_book] folder...");
	await createBooksFromChapters();
	console.log(
		`Done with [db/by_locale/*/by_book] folder in ${(Date.now() - START_TIME) / 1000}s`,
	);

	// console.log("Deploying to MongoDB");
	// await deployToMongoDB();
	// console.log(`Done MongoDB in ${(Date.now() - START_TIME) / 1000}s`);
}

async function createChaptersFiles() {
	//* For Each Book (Bukhari, Muslim, etc.)
	for (const book of books) {
		//* Create Progress Bar
		const bar = new SingleBar(
			{
				format: "{value}/{total} | {bar} {percentage}% | {book}",
				hideCursor: true,
				stopOnComplete: true,
			},
			Presets.shades_classic,
		);
		bar.start(book.route.chapters.length, 0, { book: book.english.title });

		//* Create Directories ./db/by_locale/${locale}/by_chapter/${book}/
		for (const locale of SUPPORTED_LOCALES) {
			await createDirs(["db", "by_locale", locale, "by_chapter"], ...book.path);
		}

		//* For Each Chapter in Book (1st, 2nd, etc.)
		for (const [index, chapter] of book.route.chapters.entries()) {
			//* Update Progress Bar
			bar.update(index + 1, {
				book: `${book.english.title} | ${chapter}`,
			});

			if (doesChapterExistForAllLocales(book.path, chapter)) {
				continue;
			}

			//* Get Data From `${URL}/${book}/${chapter}`
			const data = await scrapeData(`${book.route.base}/${chapter}`, book.id);
			if (!data) {
				return console.log(
					"Error getting data",
					`${book.route.base}/${chapter}`,
				);
			}

			//* Format Data to be like {ChapterFile} interface
			const formattedData = formatFile(book, data);
			formattedData.id = await buildIndonesianChapterFile(formattedData.en);

			for (const locale of SUPPORTED_LOCALES) {
				//* Create File db/by_locale/${locale}/by_chapter/{book}/{chapter}.json
				await createFile(
					["db", "by_locale", locale, "by_chapter"],
					book.path,
					chapter || "all",
					formattedData[locale],
				);
			}
		}
	}
}

async function createBooksFromChapters() {
	for (const locale of SUPPORTED_LOCALES) {
		let GENERAL_ID = 1;

		for (const book of books) {
			let idInBook = 1;
			//* Create Progress Bar
			const bar = new SingleBar(
				{
					format: "{value}/{total} | {bar} {percentage}% | {book}",
					hideCursor: true,
					stopOnComplete: true,
				},
				Presets.shades_classic,
			);
			bar.start(book.route.chapters.length, 0, {
				book: `${book.english.title} (${locale})`,
			});

			const bookDir: string = path.join(
				process.cwd(),
				"db",
				"by_locale",
				locale,
				"by_chapter",
				...book.path,
			);
			const bookDirFiles: string[] = await readdir(bookDir);

			const firstChapterData: LocalizedChapterFile = require(
				path.join(bookDir, sortChapterFiles(bookDirFiles)[0]),
			);

			const bookData: Prettify<LocalizedBookFile> = {
				id: book.id,
				metadata: {
					id: book.id,
					locale,
					length: 0,
					book: firstChapterData.metadata.book,
				},
				chapters: [],
				hadiths: [],
			};

			for (const chapterFileName of sortChapterFiles(bookDirFiles)) {
				const chapterData: LocalizedChapterFile = require(
					path.join(bookDir, chapterFileName),
				);

				const chapterId = chapterData.chapter?.id;
				if (typeof chapterId === "undefined") {
					console.log(chapterData.chapter);

					throw new Error(
						`Chapter ID not found for chapter in ${book.path.join(
							"/",
						)}/${chapterFileName} file for locale '${locale}'`,
					);
				}

				bookData.chapters.push(chapterData.chapter);

				bookData.metadata.length += chapterData.metadata.length;

				bookData.hadiths.push(
					...chapterData.hadiths.map(
						(hadith: Prettify<LocalizedHadith>): Prettify<LocalizedHadith> => ({
							...hadith,
							id: GENERAL_ID++,
							idInBook: idInBook++,
							bookId: book.id,
							chapterId,
						}),
					),
				);

				//* Update Progress Bar
				bar.update(bookData.chapters.length, {
					book: `${book.english.title} (${locale}) | ${chapterData.chapter.title}`,
				});
			}

			//* Create Folder {db/by_locale/${locale}/by_book/the_9_books}
			await createDirs(
				["db", "by_locale", locale, "by_book"],
				...book.path.slice(0, -1),
			);

			//* Create File {db/by_locale/${locale}/by_book/the_9_books/bukhari.json}
			await createFile(
				["db", "by_locale", locale, "by_book"],
				book.path.slice(0, -1),
				book.path.at(-1)!,
				bookData,
			);
		}
	}
}

function doesChapterExistForAllLocales(bookPath: string[], chapter: string) {
	return SUPPORTED_LOCALES.every((locale) =>
		existsSync(
			path.join(
				process.cwd(),
				"db",
				"by_locale",
				locale,
				"by_chapter",
				...bookPath,
				`${chapter}.json`,
			),
		),
	);
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

async function deployToMongoDB() {
	const { MongoClient } = await import("mongodb");

	const uri = process.env.MONGODB_URI;
	if (!uri) throw new Error("No MongoDB URI provided");

	const client = new MongoClient(uri);

	const db = client.db("hadiths");

	const hadiths = db.collection("hadiths");
	const booksMetadata = db.collection("booksMetadata");
	const chapters = db.collection("chapters");

	const folders = await readdir(
		path.join(process.cwd(), "db", "by_locale", "en", "by_book"),
	);

	const bar = new SingleBar(
		{
			format: "{value}/{total} | {bar} {percentage}% | {book}",
			hideCursor: true,
			stopOnComplete: true,
		},
		Presets.shades_classic,
	);

	for (const folder of folders) {
		const books = await readdir(
			path.join(process.cwd(), "db", "by_locale", "en", "by_book", folder),
		);

		bar.start(books.length, 0, { book: `${folder}` });

		for (const [index, book] of books.entries()) {
			const bookData: Prettify<LocalizedBookFile> = require(
				path.join(
					process.cwd(),
					"db",
					"by_locale",
					"en",
					"by_book",
					folder,
					book,
				),
			);

			await booksMetadata.insertOne(bookData.metadata);
			// await hadiths.insertMany(bookData.hadiths);
			await chapters.insertMany(bookData.chapters);

			bar.update(index + 1, {
				book: `${bookData.metadata.book.title}`,
			});
		}
	}
	return client.close();
}
