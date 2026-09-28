/**
 * Makes a proposed translation escape quotes the way its source does.
 *
 * A `.po` line quotes its string, so a quote inside it is written `\"` in the
 * file and is a plain quote in the string. An agent asked for a translation
 * sometimes answers with the file's spelling rather than the string's, and the
 * backslash then belongs to nobody: the catalogue ends up holding
 * `<a href=\"%1$s\">`, which is not what the source says and not what any
 * renderer wants. Seen on a real review, and in 7 rows of a 102,200 row memory
 * imported from work that had the same slip.
 *
 * The source decides, because it is the one text nobody has retyped. Where it
 * spells a quote plainly, so does the translation. Where the source really does
 * carry a backslash before a quote, which happens when the string is about the
 * backslash character itself ("Passwords may not contain the character \"),
 * the translation is left exactly as it is: the sequence is the content there,
 * not an escape, and stripping it would break the string it describes.
 *
 * Only quotes. A backslash before anything else is left alone, since a path
 * like C:\\Users is ordinary text and nothing here can tell a stray escape from
 * a deliberate one without a convention to compare against.
 */
export function matchSourceEscaping(source: string, text: string): string {
  if (source.includes('\\"')) return text
  return text.replace(/\\+"/g, '"')
}
