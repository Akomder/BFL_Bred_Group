#!/usr/bin/env bash
# Regenerates web/public/fonts.
#
# The same TTFs are used by the UI (@font-face in src/index.css) and embedded
# into the PDF by src/lib/pdf.ts. They are committed so a branch tablet works
# offline; this script only needs running to change or update a font.
#
# They are embedded whole rather than subset at runtime: pdf-lib's built-in
# subsetter silently drops glyphs from these fonts, so the files are subset
# here instead, which keeps a generated form around 100 kB.
#
# The Latin fonts drop their ligature features. pdf-lib applies GSUB when it
# encodes text but writes the glyph's own advance width, and the subset "fi"
# ligature comes out with the wrong advance — printing "fi fty" for "fifty".
# No ligatures, no problem; Latin needs no other shaping. Lao keeps every
# feature, because its marks are positioned by GPOS (see drawShapedText in
# src/lib/pdf.ts).
#
# Requires: fonttools (pip install fonttools brotli)
set -euo pipefail

OUT="$(dirname "$0")/../public/fonts"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$OUT"

# Latin: everything a name, address or amount can need — ASCII, Latin-1,
# Latin Extended-A, general punctuation and currency symbols.
LATIN_RANGES="U+0020-007E,U+00A0-00FF,U+0100-024F,U+2000-206F,U+20A0-20BF,U+2212"
# Lao: the Lao block plus basic Latin, so a mixed Lao/Latin line stays in one font.
LAO_RANGES="U+0020-007E,U+00A0-00FF,U+0E80-0EFF,U+2000-206F,U+20A0-20BF"

# Static TTF URLs come from the Google Fonts CSS API asked with a legacy
# user-agent, which serves truetype instead of woff2.
declare -A FONTS=(
  ["NotoSans-Regular"]="https://fonts.gstatic.com/s/notosans/v42/o-0mIpQlx3QUlC5A4PNB6Ryti20_6n1iPHjcz6L1SoM-jCpoiyD9A99d.ttf"
  ["NotoSans-Bold"]="https://fonts.gstatic.com/s/notosans/v42/o-0mIpQlx3QUlC5A4PNB6Ryti20_6n1iPHjcz6L1SoM-jCpoiyAaBN9d.ttf"
  ["NotoSansLao-Regular"]="https://fonts.gstatic.com/s/notosanslao/v33/bx6lNx2Ol_ixgdYWLm9BwxM3NW6BOkuf763Clj73CiQ_J1Djx9pidOt4ccbdfw.ttf"
  ["NotoSansLao-Bold"]="https://fonts.gstatic.com/s/notosanslao/v33/bx6lNx2Ol_ixgdYWLm9BwxM3NW6BOkuf763Clj73CiQ_J1Djx9pidOt4lsHdfw.ttf"
)

for name in "${!FONTS[@]}"; do
  echo "→ $name"
  curl -sSfL -o "$TMP/$name.ttf" "${FONTS[$name]}"
  if [[ "$name" == NotoSansLao-* ]]; then
    pyftsubset "$TMP/$name.ttf" \
      --unicodes="$LAO_RANGES" \
      --layout-features='*' \
      --notdef-outline \
      --output-file="$OUT/$name.ttf"
  else
    pyftsubset "$TMP/$name.ttf" \
      --unicodes="$LATIN_RANGES" \
      --layout-features-='liga,dlig,clig,hlig,rlig' \
      --notdef-outline \
      --output-file="$OUT/$name.ttf"
  fi
  echo "  $(du -h "$OUT/$name.ttf" | cut -f1)"
done

echo "Done. Fonts written to $OUT"
