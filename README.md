# hadith-json

Database JSON komprehensif berisi **50.884 hadits** — ucapan dan perbuatan Nabi Muhammad ﷺ — dengan keluaran terpisah per bahasa untuk Arab, Inggris, dan Indonesia, diambil dari [Sunnah.com](https://sunnah.com/) dan mencakup 17 kitab utama.

## Daftar Kitab

| # | English | Arabic |
|---|---------|--------|
| 1 | Sahih al-Bukhari | صحيح البخاري |
| 2 | Sahih Muslim | صحيح مسلم |
| 3 | Sunan Abi Dawud | سنن أبي داود |
| 4 | Jami` at-Tirmidhi | جامع الترمذي |
| 5 | Sunan an-Nasa'i | سنن النسائي |
| 6 | Sunan Ibn Majah | سنن ابن ماجه |
| 7 | Muwatta Malik | موطأ مالك |
| 8 | Musnad Ahmad | مسند أحمد |
| 9 | Sunan ad-Darimi | سنن الدارمي |
| 10 | Riyad as-Salihin | رياض الصالحين |
| 11 | Shamail al-Muhammadiyah | الشمائل المحمدية |
| 12 | Bulugh al-Maram | بلوغ المرام |
| 13 | Al-Adab Al-Mufrad | الأدب المفرد |
| 14 | Mishkat al-Masabih | مشكاة المصابيح |
| 15 | The Forty Hadith of al-Nawawi | الأربعون النووية |
| 16 | The Forty Hadith Qudsi | الأربعون القدسية |
| 17 | The Forty Hadith of Shah Waliullah | أربعون الشاه ولي الله |

## Format Data (v2)

Setiap hadits sekarang menggunakan struktur terjemahan spesifik per locale:

```typescript
type Locale = "ar" | "en" | "id";

type TranslationStatus = "source" | "missing" | "draft" | "verified";

interface LocalizedHadith {
  id: number;
  idInBook: number;
  chapterId: number;
  bookId: number;
  translation: {
    text: string;
    narrator?: string;
    status: TranslationStatus;
  };
}

interface LocalizedChapterFile {
  metadata: {
    locale: Locale;
    length: number;
    book: {
      title: string;
      author: string;
      introduction?: string;
      status: TranslationStatus;
    };
  };
  chapter?: {
    id: number;
    bookId: number;
    title: string;
    status: TranslationStatus;
  };
  hadiths: LocalizedHadith[];
}
```

### Catatan Locale

- `ar`: teks Arab dari sumber.
- `en`: teks Inggris dari sumber + narator.
- `id`: terjemahan otomatis Bahasa Indonesia dari locale Inggris (`status: "draft"`) yang siap ditinjau/ditingkatkan.

Database tersedia per locale di bawah `db/by_locale/`:

- **`db/by_locale/{locale}/by_book/`** — satu file JSON per kitab untuk locale tersebut.
- **`db/by_locale/{locale}/by_chapter/`** — satu file JSON per bab untuk locale tersebut.

Contoh path:

- `db/by_locale/ar/by_chapter/the_9_books/bukhari/1.json`
- `db/by_locale/en/by_book/the_9_books/bukhari.json`
- `db/by_locale/id/by_chapter/the_9_books/bukhari/1.json`

Lihat `types/index.ts` untuk definisi tipe lengkap.

## Proses Terjemahan Indonesia (AI-Assisted)

Terjemahan locale `id` dibuat dengan pipeline **bantuan AI / machine translation**. Bagian ini menjelaskan prosesnya secara transparan agar mudah diaudit.

### Ringkasan Alur

1. Data sumber diambil dari teks Inggris (`en`) hasil scraping Sunnah.com.
2. Generator membaca teks hadits per bab.
3. Sistem mencoba menerjemahkan teks ke Bahasa Indonesia memakai endpoint machine translation online.
4. Hasil disimpan ke output locale Indonesia dengan `status: "draft"`.
5. File bab digabungkan lagi menjadi file per kitab.

### Mode Eksekusi

Ada dua mode untuk menghasilkan locale Indonesia:

1. **Saat scrape penuh**

```bash
npm run build
node dist/index.js
```

2. **Dari data existing tanpa scrape ulang**

```bash
npm run generate:id
```

Mode kedua membaca data Inggris yang sudah ada, lalu membangun output Indonesia secara incremental.

### Detail Teknis Translasi

Pipeline translasi menerapkan beberapa lapisan agar robust untuk volume data besar:

1. **Primary machine translation endpoint**
  Endpoint yang dicoba pertama: Google Translate public endpoint (`translate.googleapis.com`).
2. **Retry otomatis**
  Setiap request translasi memiliki retry bertahap ketika terjadi error sementara (misalnya timeout/rate-limit).
3. **Fallback provider**
  Jika primary gagal, sistem mencoba provider cadangan (LibreTranslate, lalu MyMemory).
4. **Chunking teks panjang**
  Teks panjang dipotong menjadi beberapa chunk agar tidak melebihi batas request.
5. **Batching**
  Banyak hadits diterjemahkan per batch untuk menurunkan jumlah request total.
6. **Cache lokal**
  Hasil translasi disimpan di `.cache/id-translation-cache.json` supaya proses ulang lebih cepat dan lebih hemat request.
7. **Resume-friendly**
  Jika proses terhenti, jalankan lagi generator; file yang sudah ada akan dilewati.

### Penting: Failsafe untuk Menjamin Kelengkapan Dataset

Untuk memastikan pipeline tetap selesai saat provider translasi eksternal tidak stabil, ada mekanisme failsafe di generator:

1. Jika translasi eksternal gagal terus-menerus, sistem dapat mengisi teks dengan fallback aman agar proses tidak berhenti total.
2. Karena itu, sebagian isi `id` mungkin masih memerlukan penyuntingan lanjutan.

### Status Kualitas Data Indonesia

- Semua data Indonesia ditandai `status: "draft"`.
- `draft` berarti hasil otomatis dan **belum** dianggap final editorial.
- Sangat disarankan melakukan review manusia sebelum dipakai untuk kebutuhan publikasi resmi.

### Output yang Dihasilkan

Hasil translasi Indonesia ditulis ke:

- `db/by_locale/id/by_chapter/...`
- `db/by_locale/id/by_book/...`

Struktur ini memudahkan consumer memilih konsumsi data per bab atau langsung per kitab.

## Migrasi dari v1

- v2 adalah rilis breaking change yang mengganti output bilingual satu file menjadi file terpisah per locale.
- Field lama seperti `hadith.arabic` dan `hadith.english` diganti menjadi `hadith.translation` pada file per locale.
- Consumer sebaiknya memilih path locale terlebih dahulu, lalu membaca field `translation`.

> [!WARNING]
> Gunakan tag versi tertentu saat mengambil file langsung dari GitHub — format data dapat berubah pada `main`.
>
> ✅ `https://github.com/AhmedBaset/hadith-json/blob/v2.0.0/db/by_locale/en/by_chapter/the_9_books/bukhari/1.json`
> ❌ `https://github.com/AhmedBaset/hadith-json/blob/main/db/by_locale/en/by_chapter/the_9_books/bukhari/1.json`

## Referensi Legacy

Interface hadits v1:

```typescript
interface HadithV1 {
  id: number;
  chapterId: number;
  bookId: number;
  arabic: string;
  english: {
    narrator: string;
    text: string;
  };
}
```

## Proyek yang Menggunakan Data Ini

<!-- - [App Name](https://github.com/username/app-name) — description of app. [GitHub](https://github.com/username/app-name) | [Website](https://app-name.com) | [App Store](https://apps.apple.com/app-name) -->

> Sedang menggunakan dataset ini di proyekmu? [Buka pull request](https://github.com/AhmedBaset/hadith-json/edit/main/README.md) untuk menambahkannya ke daftar!

## Struktur Proyek

```
.
├── db/
│   └── by_locale/
│       ├── ar/
│       │   ├── by_book/
│       │   └── by_chapter/
│       ├── en/
│       │   ├── by_book/
│       │   └── by_chapter/
│       └── id/
│           ├── by_book/
│           └── by_chapter/
├── src/
│   ├── index.ts
│   ├── types/
│   └── helpers/
└── types/
    └── index.ts
```

## Keterbatasan yang Diketahui

- **Musnad Ahmad**: Bab 8–30 belum tersedia pada data sumber di Sunnah.com. Jika kamu mengetahui sumber yang lebih baik, silakan buka issue.
- Kode scraping pada `src/` awalnya ditulis sebagai sarana belajar dan masih bisa ditingkatkan dengan refactor, meskipun saat ini berjalan dengan baik.

## Kontribusi

Kontribusi sangat terbuka. Silakan buat issue atau pull request untuk koreksi data, format baru, atau peningkatan kode.

---

*Semoga Allah menerima amal ini dan menjadikannya bermanfaat. Aamiin.*
