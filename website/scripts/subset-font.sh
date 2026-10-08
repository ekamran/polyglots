#!/bin/sh
# Rebuilds public/fonts/ from the MesloLGS NF and Fira Code releases. Run by
# hand, only when a font or the glyph lists below change; the output is
# committed.
#
# The pair is what a common terminal setup draws polyglots with: MesloLGS NF
# for ASCII and Fira Code for everything else, box drawing and block elements
# included. The site's terminal panels use the same split, so the app's cards
# and wordmark look on the page as they do in that terminal. CSS shrinks Fira
# Code to Meslo's cell width (a browser, unlike a terminal, keeps no grid),
# and turns ligatures off: `->` and `!=` must read as typed.
#
# Meslo also carries the four symbols Fira Code lacks (the progress bar's ▰ ▱,
# the ❯ pointer and ✗), so the browser finds them there before falling back.
#
# Needs python3; fonttools and brotli go into a throwaway venv.
set -eu

FIRA_VERSION=6.2
MESLO_BASE=https://github.com/romkatv/powerlevel10k-media/raw/master
OUT="$(cd "$(dirname "$0")/.." && pwd)/public/fonts"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

curl -sfL -o "$WORK/fira.zip" "https://github.com/tonsky/FiraCode/releases/download/$FIRA_VERSION/Fira_Code_v$FIRA_VERSION.zip"
unzip -qo "$WORK/fira.zip" -d "$WORK/fira"
for weight in Regular Bold; do
  curl -sfL -o "$WORK/meslo-$weight.ttf" "$MESLO_BASE/MesloLGS%20NF%20$weight.ttf"
done
python3 -m venv "$WORK/venv"
"$WORK/venv/bin/pip" install -q fonttools brotli

MESLO_UNICODES="U+0020-007E,U+25B0-25B1,U+2717,U+276F"
FIRA_UNICODES="U+00A0-017F,U+2010-2027,U+2030-203A,U+2190-2193,U+2261,U+2500-259F,U+25A0-25AF,U+25B2-25FF,U+2713"
mkdir -p "$OUT"
for weight in Regular Bold; do
  lower=$(echo $weight | tr 'A-Z' 'a-z')
  "$WORK/venv/bin/pyftsubset" "$WORK/meslo-$weight.ttf" \
    --unicodes="$MESLO_UNICODES" --flavor=woff2 --layout-features='kern' \
    --output-file="$OUT/meslo-$lower.woff2"
  "$WORK/venv/bin/pyftsubset" "$WORK/fira/ttf/FiraCode-$weight.ttf" \
    --unicodes="$FIRA_UNICODES" --flavor=woff2 --layout-features='kern' \
    --output-file="$OUT/fira-code-$lower.woff2"
done
ls -l "$OUT"
