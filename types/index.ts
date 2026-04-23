type Prettify<T> = {
	[K in keyof T]: T[K];
} & {};

type Locale = "ar" | "en" | "id";

type TranslationStatus = "source" | "missing" | "draft" | "verified";

interface RawHadith {
	id: number;
	idInBook: number;
	arabic: string;
	english: {
		narrator: string;
		text: string;
	};
	chapterId: number;
	bookId: number;
}

interface ScrapedIntroduction {
	arabic: string;
	english: string;
}

interface ScrapedChapter {
	id: number;
	bookId: number;
	arabic: string;
	english: string;
}

interface ScrapedData {
	hadiths: RawHadith[];
	introduction?: ScrapedIntroduction;
	chapter?: ScrapedChapter;
}

interface LocalizedText {
	text: string;
	narrator?: string;
	status: TranslationStatus;
}

interface LocalizedChapter {
	id: number;
	bookId: number;
	title: string;
	status: TranslationStatus;
}

interface LocalizedBookInfo {
	title: string;
	author: string;
	introduction: string | undefined;
	status: TranslationStatus;
}

interface LocalizedMetadata {
	locale: Locale;
	length: number;
	book: Prettify<LocalizedBookInfo>;
}

interface LocalizedHadith {
	id: number;
	idInBook: number;
	chapterId: number;
	bookId: number;
	translation: Prettify<LocalizedText>;
}

interface LocalizedChapterFile {
	metadata: Prettify<LocalizedMetadata>;
	hadiths: LocalizedHadith[];
	chapter: LocalizedChapter | undefined;
}

interface LocalizedBookMetadata extends LocalizedMetadata {
	id: number;
}

interface LocalizedBookFile {
	id: number;
	metadata: Prettify<LocalizedBookMetadata>;
	chapters: LocalizedChapter[];
	hadiths: LocalizedHadith[];
}

interface ScrapedBook {
	id: number;
	arabic: {
		title: string;
		author: string;
	};
	english: {
		title: string;
		author: string;
	};
	length?: number;
	path: string[];
	route: {
		base: string;
		chapters: string[];
	};
}
