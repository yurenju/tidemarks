#!/bin/sh
#
# Build-time verification of the image's font bindings. Ported from frond's
# docker/verify-fonts.sh.
#
# Why at build rather than in the tests: a broken font binding fails **silently**. Nothing
# throws, no assertion goes red — the browsers just fall back to another face and every
# geometric number after that is built on it. Issue #25 is what that costs: serif resolved
# to WenQuanYi Zen Hei, whose Han glyphs carry no vertical advance, so every kanji in the
# vertical book was drawn on top of the character after it. The behaviour suite stayed
# green throughout, the evidence screenshots did not, and the cause took a long time to
# find because nothing pointed at the image.
#
# So: blow up here instead.

set -eu

failed=0

report_failure() {
    echo "  ✗ $1"
    echo "      expected to contain: $2"
    echo "      actually resolved:   $3"
    failed=1
}

# Asserts that a fontconfig pattern resolves to the expected face.
assert_face() {
    pattern="$1"
    expected="$2"

    actual="$(fc-match --format='%{family}' "$pattern")"

    case "$actual" in
        *"$expected"*)
            echo "  ✓ $pattern → $actual"
            ;;
        *)
            report_failure "$pattern" "$expected" "$actual"
            ;;
    esac
}

echo "Tidemarks font binding verification"
echo

echo "default resolution of the generic families (no lang information)"
assert_face 'serif'      'Noto Serif CJK TC'
assert_face 'sans-serif' 'Noto Sans CJK TC'
echo

echo "regional face resolution by lang"
assert_face 'serif:lang=ja'         'Noto Serif CJK JP'
assert_face 'sans-serif:lang=ja'    'Noto Sans CJK JP'
assert_face 'serif:lang=zh-tw'      'Noto Serif CJK TC'
assert_face 'sans-serif:lang=zh-tw' 'Noto Sans CJK TC'
assert_face 'serif:lang=zh-cn'      'Noto Serif CJK SC'
assert_face 'sans-serif:lang=zh-cn' 'Noto Sans CJK SC'
echo

if [ "$failed" -ne 0 ]; then
    cat <<'EOF'

Font binding verification failed.

The Noto CJK faces actually installed in the image are listed below, to compare against the
"actually resolved" values above:

EOF
    fc-list : family | tr ',' '\n' | grep -i 'noto.*cjk' | sort -u | sed 's/^/  /'

    cat <<'EOF'

Common causes and what to do:

  * No Noto Serif CJK in the list at all
    → this version of fonts-noto-cjk does not cover Serif. Get it separately and pin it the
      same way. serif must not be left to fall back on its own; that is issue #25.

  * The face names differ from what is expected (a different regional suffix, or a switch
    to variable-font naming)
    → Noto CJK's distribution form has changed across versions. Update
      docker/fontconfig/75-tidemarks-cjk.conf and the expectations here against the real names,
      and record the version-to-name correspondence in the commit message.

  * The names are all there, but serif / sans-serif land on a Latin font (DejaVu Serif,
    Liberation Serif, …) or on WenQuanYi Zen Hei
    → the conf.d filename ordering has been overridden. Both the base image's 60-latin.conf
      and the 70-fonts-noto-cjk.conf that ships with fonts-noto-cjk touch the same generic
      families, and this project's file has to come after both (currently 75).

  * The names are all there, but the lang-specific regional face does not take effect
    (lang=ja yields TC, say)
    → the rule order inside the file is reversed. mode="prepend" inserts before the value
      the test matched, so a rule applied later ends up further back — an earlier-applied
      rule has higher priority. Language specialisations go before the general rules.

      `fc-pattern -c "serif:lang=ja"` shows the full family list after configuration, which
      makes the ordering clearer than fc-match does.

EOF
    exit 1
fi

echo "Font binding verification passed."
