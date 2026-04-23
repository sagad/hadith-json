export function formatFile(
	book: ScrapedBook,
	data: ScrapedData,
): Record<Locale, Prettify<LocalizedChapterFile>> {
	const arabicFile: Prettify<LocalizedChapterFile> = {
		metadata: {
			locale: "ar",
			length: data.hadiths.length,
			book: {
				title: book.arabic.title,
				author: book.arabic.author,
				introduction: data.introduction?.arabic,
				status: "source",
			},
		},
		hadiths: data.hadiths.map((hadith) => ({
			id: hadith.id,
			idInBook: hadith.idInBook,
			chapterId: hadith.chapterId,
			bookId: hadith.bookId,
			translation: {
				text: hadith.arabic,
				status: "source",
			},
		})),
		chapter: data.chapter
			? {
					id: data.chapter.id,
					bookId: data.chapter.bookId,
					title: data.chapter.arabic,
					status: "source",
			  }
			: undefined,
	};

	const englishFile: Prettify<LocalizedChapterFile> = {
		metadata: {
			locale: "en",
			length: data.hadiths.length,
			book: {
				title: book.english.title,
				author: book.english.author,
				introduction: data.introduction?.english,
				status: "source",
			},
		},
		hadiths: data.hadiths.map((hadith) => ({
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
		chapter: data.chapter
			? {
					id: data.chapter.id,
					bookId: data.chapter.bookId,
					title: data.chapter.english,
					status: "source",
			  }
			: undefined,
	};

	const indonesianFile: Prettify<LocalizedChapterFile> = {
		metadata: {
			locale: "id",
			length: data.hadiths.length,
			book: {
				title: "",
				author: "",
				introduction: undefined,
				status: "missing",
			},
		},
		hadiths: data.hadiths.map((hadith) => ({
			id: hadith.id,
			idInBook: hadith.idInBook,
			chapterId: hadith.chapterId,
			bookId: hadith.bookId,
			translation: {
				text: "",
				status: "missing",
			},
		})),
		chapter: data.chapter
			? {
					id: data.chapter.id,
					bookId: data.chapter.bookId,
					title: "",
					status: "missing",
			  }
			: undefined,
	};

	return {
		ar: arabicFile,
		en: englishFile,
		id: indonesianFile,
	};
}
