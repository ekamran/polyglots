// The page carries both languages at once and CSS shows one, because the
// alternative is JavaScript and this file has to survive being mailed as an
// attachment and opened offline years later.

export type Lang = 'en' | 'tr'

export interface Phrase {
  en: string
  tr: string
}

// Turkish capitalises only the first word of a heading and proper nouns, which
// is the same rule the review command enforces on contributors. A stats page
// that broke it while reporting on it would be quietly ridiculous.
export const PHRASES = {
  title: { en: 'Review statistics', tr: 'İnceleme istatistikleri' },
  generated: { en: 'generated', tr: 'oluşturuldu' },
  rangeTo: { en: 'to', tr: '–' },
  noneYet: { en: 'No finished reviews recorded yet.', tr: 'Henüz tamamlanmış inceleme yok.' },

  submissions: { en: 'submissions reviewed', tr: 'incelenen gönderi' },
  entries: { en: 'entries', tr: 'dizge' },
  flagged: { en: 'flagged', tr: 'işaretlenen' },
  repaired: { en: 'repaired automatically', tr: 'otomatik düzeltilen' },
  turnaround: { en: 'median turnaround', tr: 'ortanca süre' },

  weeklyHeading: { en: 'Entries reviewed, by week', tr: 'Haftalara göre incelenen dizgeler' },
  peak: { en: 'peak', tr: 'en yüksek' },
  donutHeading: { en: 'What gets flagged', tr: 'Neler işaretleniyor' },
  projectHeading: { en: 'By project', tr: 'Projeye göre' },

  colProject: { en: 'Project', tr: 'Proje' },
  colSubmissions: { en: 'Submissions', tr: 'Gönderi' },
  colEntries: { en: 'Entries', tr: 'Dizge' },
  colFlagged: { en: 'Flagged', tr: 'İşaretlenen' },
  colRate: { en: 'Rate', tr: 'Oran' },

  emptyBody: {
    en: 'No finished reviews have been recorded yet. Run a review over a submission and its totals will appear here.',
    tr: 'Henüz tamamlanmış inceleme kaydı yok. Bir gönderiyi incelediğinizde toplamları burada görünür.',
  },
  // Said plainly and in both languages, because the people who volunteered
  // these translations may be the ones reading the page.
  caveat: {
    en: '“Flagged” counts entries polyglots raised for a human to look at — a mix of mechanical faults and judgement calls. It measures what this tool flags, not the quality of anyone’s work, and a flag is not a judgement about the contributor who submitted it.',
    tr: '“İşaretlenen”, polyglots’un bir insanın bakması için öne çıkardığı dizgeleri sayar; bunlar hem mekanik hatalar hem de yorum gerektiren durumlardır. Bu sayı, aracın neyi işaretlediğini ölçer; kimsenin emeğinin kalitesini değil. Bir işaret, gönderiyi yapan katkıcı hakkında bir yargı değildir.',
  },
  incompleteOne: { en: 'review did not finish and contributed nothing to these totals.', tr: 'inceleme tamamlanmadı ve bu toplamlara katkı vermedi.' },
  incompleteMany: { en: 'reviews did not finish and contributed nothing to these totals.', tr: 'inceleme tamamlanmadı ve bu toplamlara katkı vermedi.' },

  theme: { en: 'Theme', tr: 'Tema' },
  themeAuto: { en: 'Auto', tr: 'Otomatik' },
  themeLight: { en: 'Light', tr: 'Açık' },
  themeDark: { en: 'Dark', tr: 'Koyu' },
} as const satisfies Record<string, Phrase>

export type PhraseKey = keyof typeof PHRASES

// Turkish groups thousands with a dot and marks decimals with a comma, so the
// same figure has to be printed twice rather than once in a neutral format.
export function count(n: number, lang: Lang): string {
  return n.toLocaleString(lang === 'tr' ? 'tr-TR' : 'en-US')
}

export function duration(ms: number, lang: Lang): string {
  if (ms < 60_000) {
    const s = Math.round(ms / 1000)
    return lang === 'tr' ? `${s} sn` : `${s}s`
  }
  if (ms < 3_600_000) {
    const m = Math.round(ms / 60_000)
    return lang === 'tr' ? `${m} dk` : `${m}m`
  }
  const h = ms / 3_600_000
  return lang === 'tr' ? `${h.toFixed(1).replace('.', ',')} saat` : `${h.toFixed(1)}h`
}
