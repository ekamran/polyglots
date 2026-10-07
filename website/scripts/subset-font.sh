#!/bin/sh
# Rebuilds public/fonts/ from the JetBrains Mono release. Run by hand, only when
# the glyph list below changes; the output is committed.
#
# Needs python3; fonttools and brotli go into a throwaway venv. The NL cut has no
# ligatures, which is what a terminal shows: `->` and `!=` in a command must
# read as typed.
#
# The range is Latin plus Turkish and the rest of Latin Extended-A, the
# punctuation the CLI prints, box drawing and block elements. ▰ and ▱ (the
# progress bar) are not in JetBrains Mono at all and fall back to a system
# font; the bar sits at the start of its line, so nothing after it has a
# column to keep.
set -eu

VERSION=2.304
OUT="$(cd "$(dirname "$0")/.." && pwd)/public/fonts"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

curl -sfL -o "$WORK/jbm.zip" "https://github.com/JetBrains/JetBrainsMono/releases/download/v$VERSION/JetBrainsMono-$VERSION.zip"
unzip -qo "$WORK/jbm.zip" -d "$WORK/x"
python3 -m venv "$WORK/venv"
"$WORK/venv/bin/pip" install -q fonttools brotli

UNICODES="U+0020-007E,U+00A0-017F,U+2010-2027,U+2030-203A,U+2190-2193,U+2500-259F,U+25A0-25FF,U+2713,U+2717"
mkdir -p "$OUT"
for weight in Regular Bold; do
  "$WORK/venv/bin/pyftsubset" "$WORK/x/fonts/ttf/JetBrainsMonoNL-$weight.ttf" \
    --unicodes="$UNICODES" --flavor=woff2 --layout-features='kern' \
    --output-file="$OUT/jetbrains-mono-$(echo $weight | tr 'A-Z' 'a-z').woff2"
done
cp "$WORK/x/OFL.txt" "$OUT/OFL.txt"
ls -l "$OUT"
