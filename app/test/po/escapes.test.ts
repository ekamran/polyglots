import { describe, expect, it } from 'vitest'
import { matchSourceEscaping } from '../../src/po/escapes.js'

/**
 * Seen on a real run: the source carries a plain quote and the model returned
 * the translation with the quote escaped, as if it were writing the .po line
 * rather than the string it holds. The file then reads
 * `<a href=\"%1$s\">`, with a backslash that belongs to nobody. It reached the
 * memory too, in 7 rows of 102,200.
 */
describe('matchSourceEscaping', () => {
  const source = 'Ready to publish your first post? <a href="%1$s">Get started here</a>.'

  it('drops a backslash the source does not have', () => {
    const text = 'İlk yazınızı yayınlamaya hazır mısınız? <a href=\\"%1$s\\">Buradan başlayın</a>.'
    expect(matchSourceEscaping(source, text)).toBe(
      'İlk yazınızı yayınlamaya hazır mısınız? <a href="%1$s">Buradan başlayın</a>.',
    )
  })

  it('leaves a translation that already matches the source alone', () => {
    const text = 'İlk yazınızı yayınlamaya hazır mısınız? <a href="%1$s">Buradan başlayın</a>.'
    expect(matchSourceEscaping(source, text)).toBe(text)
  })

  /**
   * The other half of the rule, and it is not hypothetical: the memory holds 7
   * rows whose source is about the backslash character itself, where the
   * sequence is the text rather than an escape.
   */
  it('keeps the escaping when the source itself carries it', () => {
    const backslash = 'Passwords may not contain the character "\\".'
    const text = 'Parola "\\" karakterini içermemeli.'
    expect(matchSourceEscaping(backslash, text)).toBe(text)
  })

  it('collapses a run of backslashes, however many the model piled up', () => {
    expect(matchSourceEscaping('say "hi"', 'de \\\\\\"merhaba\\\\\\"')).toBe('de "merhaba"')
  })

  it('leaves a backslash that is not escaping a quote', () => {
    expect(matchSourceEscaping('a path', 'C:\\Users\\emre')).toBe('C:\\Users\\emre')
  })
})
