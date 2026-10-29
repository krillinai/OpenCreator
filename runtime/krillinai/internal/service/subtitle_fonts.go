package service

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"unicode"

	"github.com/clipperhouse/uax29/v2/graphemes"
)

// Select bundled families explicitly. libass retains logical order and performs BiDi/shaping.
func packagedSubtitleFallbacks() map[string]string {
	result := map[string]string{}
	root := strings.TrimSpace(os.Getenv("KRILLINAI_RESOURCE_ROOT"))
	if root == "" {
		return result
	}
	data, err := os.ReadFile(filepath.Join(root, "fonts", "manifest.json"))
	if err != nil {
		return result
	} // Render entry validates resources before conversion.
	var manifest subtitleFontManifest
	if json.Unmarshal(data, &manifest) != nil {
		return result
	}
	for _, font := range manifest.FallbackFonts {
		for _, script := range font.Scripts {
			result[script] = font.Family
		}
	}
	return result
}

var subtitleScriptTables = map[string]*unicode.RangeTable{
	"Latn": unicode.Latin, "Grek": unicode.Greek, "Cyrl": unicode.Cyrillic,
	"Arab": unicode.Arabic, "Hebr": unicode.Hebrew, "Deva": unicode.Devanagari,
	"Beng": unicode.Bengali, "Guru": unicode.Gurmukhi, "Gujr": unicode.Gujarati,
	"Taml": unicode.Tamil, "Telu": unicode.Telugu, "Thai": unicode.Thai,
	"Mymr": unicode.Myanmar, "Khmr": unicode.Khmer, "Laoo": unicode.Lao,
	"Hang": unicode.Hangul,
	"Ethi": unicode.Ethiopic, "Java": unicode.Javanese, "Mlym": unicode.Malayalam,
	"Knda": unicode.Kannada, "Orya": unicode.Oriya, "Geor": unicode.Georgian,
	"Armn": unicode.Armenian, "Sinh": unicode.Sinhala, "Tibt": unicode.Tibetan,
}

func subtitleFallbackFontTags(text, primary string, families map[string]string) string {
	if len(families) == 0 {
		return text
	}
	var result strings.Builder
	current := primary
	latinFallback := strings.IndexFunc(text, func(r rune) bool { return r > 127 && unicode.Is(unicode.Latin, r) }) >= 0
	iter := graphemes.FromString(strings.ReplaceAll(text, `\N`, "\n"))
	for iter.Next() {
		cluster := iter.Value()
		chosen := current // Spaces, marks and numbers stay with the surrounding script.
		for _, r := range cluster {
			if !unicode.IsLetter(r) {
				continue
			}
			chosen = primary
			for script, table := range subtitleScriptTables {
				if unicode.Is(table, r) {
					if family := families[script]; family != "" {
						chosen = family
					}
					break
				}
			}
			// Keep existing preset styling for basic Latin text.
			if r < 128 && !latinFallback {
				chosen = primary
			}
			break
		}
		if chosen != current {
			result.WriteString(`{\fn` + chosen + `}`)
			current = chosen
		}
		result.WriteString(cluster)
	}
	return strings.ReplaceAll(result.String(), "\n", `\N`)
}
