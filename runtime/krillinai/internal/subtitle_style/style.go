package subtitlestyle

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"regexp"
	"strconv"
	"strings"
)

var controlledOverrideTagPattern = regexp.MustCompile(`\\(xshad|yshad|blur)(-?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+))`)

type StyleSet struct {
	Version    int         `json:"version,omitempty"`
	Horizontal ScreenStyle `json:"horizontal"`
	Vertical   ScreenStyle `json:"vertical"`
}

type ScreenStyle struct {
	Major Style `json:"major"`
	Minor Style `json:"minor"`
}

type Style struct {
	Name           string   `json:"name"`
	FontName       string   `json:"font_name"`
	FontSize       *int     `json:"font_size"`
	PrimaryColor   string   `json:"primary_color"`
	SecondaryColor string   `json:"secondary_color"`
	OutlineColor   string   `json:"outline_color"`
	BackColor      string   `json:"back_color"`
	Bold           *bool    `json:"bold"`
	Italic         *bool    `json:"italic"`
	Underline      *bool    `json:"underline"`
	StrikeOut      *bool    `json:"strike_out"`
	ScaleX         *int     `json:"scale_x"`
	ScaleY         *int     `json:"scale_y"`
	Spacing        *float64 `json:"spacing"`
	Angle          *float64 `json:"angle"`
	BorderStyle    *int     `json:"border_style"`
	Outline        *float64 `json:"outline"`
	Shadow         *float64 `json:"shadow"`
	AlignmentValue *int     `json:"alignment"`
	MarginL        *int     `json:"margin_l"`
	MarginR        *int     `json:"margin_r"`
	MarginV        *int     `json:"margin_v"`
	Encoding       *int     `json:"encoding"`
	RawASSStyle    string   `json:"raw_ass_style"`
	FadeInMS       *int     `json:"fade_in_ms"`
	FadeOutMS      *int     `json:"fade_out_ms"`
	OverrideTags   string   `json:"override_tags"`
}

func DefaultStyleSet() *StyleSet {
	return &StyleSet{
		Version: 1,
		Horizontal: ScreenStyle{
			Major: defaultStyle("Major", 14, 2.5, 1.5, 20),
			Minor: defaultStyle("Minor", 10, 2.5, 1.5, 30),
		},
		Vertical: ScreenStyle{
			Major: defaultStyle("Major", 12, 2.2, 1.2, 101),
			Minor: defaultStyle("Minor", 7, 2.0, 1.0, 92),
		},
	}
}

func LoadOverrideFile(path string) (*StyleSet, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return Decode(data, path)
}

func Decode(data []byte, source string) (*StyleSet, error) {
	var set StyleSet
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&set); err != nil {
		return nil, fmt.Errorf("%s: %w", source, err)
	}
	var extra json.RawMessage
	if err := decoder.Decode(&extra); err != io.EOF {
		if err != nil {
			return nil, fmt.Errorf("%s: trailing JSON: %w", source, err)
		}
		return nil, fmt.Errorf("%s: trailing JSON after style object", source)
	}
	if err := Validate(&set); err != nil {
		return nil, fmt.Errorf("%s: %w", source, err)
	}
	return &set, nil
}

func Merge(base, override *StyleSet) (*StyleSet, error) {
	if base == nil {
		base = DefaultStyleSet()
	}
	merged := cloneStyleSet(base)
	if override != nil {
		if override.Version != 0 {
			merged.Version = override.Version
		}
		mergeScreen(&merged.Horizontal, override.Horizontal)
		mergeScreen(&merged.Vertical, override.Vertical)
	}
	if err := Validate(&merged); err != nil {
		return nil, err
	}
	return &merged, nil
}

func Validate(set *StyleSet) error {
	if set == nil {
		return nil
	}
	if err := validateScreen("horizontal", set.Horizontal); err != nil {
		return err
	}
	return validateScreen("vertical", set.Vertical)
}

func BuildAssHeader(set *StyleSet, horizontal bool) string {
	if set == nil {
		set = DefaultStyleSet()
	}
	screen := set.Vertical
	if horizontal {
		screen = set.Horizontal
	}
	var builder strings.Builder
	builder.WriteString("[Script Info]\n")
	builder.WriteString("Title: Example\n")
	builder.WriteString("Original Script: \n")
	builder.WriteString("ScriptType: v4.00+\n")
	builder.WriteString("PlayDepth: 0\n\n")
	builder.WriteString("[V4+ Styles]\n")
	builder.WriteString("Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n")
	builder.WriteString(assStyleLine(screen.Major, "Major"))
	builder.WriteByte('\n')
	builder.WriteString(assStyleLine(screen.Minor, "Minor"))
	builder.WriteString("\n\n\n")
	builder.WriteString("[Events]\n")
	builder.WriteString("Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n")
	return builder.String()
}

func DialogueTags(s Style) string {
	var tags strings.Builder
	overrideTags := normalizeOverrideTags(s.OverrideTags)
	if s.FadeInMS != nil || s.FadeOutMS != nil || overrideTags != "" {
		tags.WriteString("{")
		if s.FadeInMS != nil || s.FadeOutMS != nil {
			in := 0
			out := 0
			if s.FadeInMS != nil {
				in = *s.FadeInMS
			}
			if s.FadeOutMS != nil {
				out = *s.FadeOutMS
			}
			tags.WriteString(fmt.Sprintf(`\fad(%d,%d)`, in, out))
		}
		tags.WriteString(overrideTags)
		tags.WriteString("}")
	}
	return tags.String()
}

func Alignment(s Style) int {
	if s.AlignmentValue == nil || *s.AlignmentValue < 1 || *s.AlignmentValue > 9 {
		return 2
	}
	return *s.AlignmentValue
}

func NormalizeASSColor(input string) (string, error) {
	color := strings.TrimSpace(input)
	if color == "" {
		return "", fmt.Errorf("color is empty")
	}
	if strings.HasPrefix(color, "&H") || strings.HasPrefix(color, "&h") {
		if len(color) != 10 {
			return "", fmt.Errorf("ASS color %q must be &HAABBGGRR", input)
		}
		hex := strings.ToUpper(color[2:])
		if _, err := strconv.ParseUint(hex, 16, 32); err != nil {
			return "", fmt.Errorf("invalid ASS color %q: %w", input, err)
		}
		return "&H" + hex, nil
	}
	if !strings.HasPrefix(color, "#") {
		return "", fmt.Errorf("color %q must start with # or &H", input)
	}
	hex := color[1:]
	if len(hex) != 6 && len(hex) != 8 {
		return "", fmt.Errorf("HTML color %q must be #RRGGBB or #RRGGBBAA", input)
	}
	if _, err := strconv.ParseUint(hex, 16, 32); err != nil {
		return "", fmt.Errorf("invalid HTML color %q: %w", input, err)
	}
	hex = strings.ToUpper(hex)
	alpha := "00"
	if len(hex) == 8 {
		alphaValue, err := strconv.ParseUint(hex[6:8], 16, 8)
		if err != nil {
			return "", fmt.Errorf("invalid HTML alpha %q: %w", input, err)
		}
		alpha = fmt.Sprintf("%02X", 255-alphaValue)
	}
	red := hex[0:2]
	green := hex[2:4]
	blue := hex[4:6]
	return "&H" + alpha + blue + green + red, nil
}

func defaultStyle(name string, fontSize int, outline, shadow float64, marginV int) Style {
	return Style{
		Name:           name,
		FontName:       "Arial",
		FontSize:       styleIntPtr(fontSize),
		PrimaryColor:   "#FFBF00",
		SecondaryColor: "&H000000FF",
		OutlineColor:   "&H00000000",
		BackColor:      "&H64000000",
		Bold:           styleBoolPtr(true),
		Italic:         styleBoolPtr(false),
		Underline:      styleBoolPtr(false),
		StrikeOut:      styleBoolPtr(false),
		ScaleX:         styleIntPtr(100),
		ScaleY:         styleIntPtr(100),
		Spacing:        styleFloatPtr(0),
		Angle:          styleFloatPtr(0),
		BorderStyle:    styleIntPtr(1),
		Outline:        styleFloatPtr(outline),
		Shadow:         styleFloatPtr(shadow),
		AlignmentValue: styleIntPtr(2),
		MarginL:        styleIntPtr(10),
		MarginR:        styleIntPtr(10),
		MarginV:        styleIntPtr(marginV),
		Encoding:       styleIntPtr(1),
	}
}

func assStyleLine(style Style, fallbackName string) string {
	if style.RawASSStyle != "" {
		return style.RawASSStyle
	}
	name := valueOr(style.Name, fallbackName)
	fontName := valueOr(style.FontName, "Arial")
	primary := normalizeColorOrEmptyDefault("primary_color", style.PrimaryColor, "&H0000BFFF")
	secondary := normalizeColorOrEmptyDefault("secondary_color", style.SecondaryColor, "&H000000FF")
	outlineColor := normalizeColorOrEmptyDefault("outline_color", style.OutlineColor, "&H00000000")
	backColor := normalizeColorOrEmptyDefault("back_color", style.BackColor, "&H64000000")
	return fmt.Sprintf("Style: %s,%s,%d,%s,%s,%s,%s,%d,%d,%d,%d,%d,%d,%s,%s,%d,%s,%s,%d,%d,%d,%d,%d",
		name,
		fontName,
		intValue(style.FontSize, 14),
		primary,
		secondary,
		outlineColor,
		backColor,
		boolASSValue(style.Bold, true),
		boolASSValue(style.Italic, false),
		boolASSValue(style.Underline, false),
		boolASSValue(style.StrikeOut, false),
		intValue(style.ScaleX, 100),
		intValue(style.ScaleY, 100),
		formatFloat(floatValue(style.Spacing, 0)),
		formatFloat(floatValue(style.Angle, 0)),
		intValue(style.BorderStyle, 1),
		formatFloat(floatValue(style.Outline, 2.5)),
		formatFloat(floatValue(style.Shadow, 1.5)),
		Alignment(style),
		intValue(style.MarginL, 10),
		intValue(style.MarginR, 10),
		intValue(style.MarginV, 20),
		intValue(style.Encoding, 1),
	)
}

func mergeScreen(base *ScreenStyle, override ScreenStyle) {
	base.Major = mergeStyle(base.Major, override.Major)
	base.Minor = mergeStyle(base.Minor, override.Minor)
}

func mergeStyle(base, override Style) Style {
	if override.Name != "" {
		base.Name = override.Name
	}
	if override.FontName != "" {
		base.FontName = override.FontName
	}
	if override.FontSize != nil {
		base.FontSize = styleIntPtr(*override.FontSize)
	}
	if override.PrimaryColor != "" {
		base.PrimaryColor = override.PrimaryColor
	}
	if override.SecondaryColor != "" {
		base.SecondaryColor = override.SecondaryColor
	}
	if override.OutlineColor != "" {
		base.OutlineColor = override.OutlineColor
	}
	if override.BackColor != "" {
		base.BackColor = override.BackColor
	}
	if override.Bold != nil {
		base.Bold = styleBoolPtr(*override.Bold)
	}
	if override.Italic != nil {
		base.Italic = styleBoolPtr(*override.Italic)
	}
	return mergeStyleRest(base, override)
}

func mergeStyleRest(base, override Style) Style {
	if override.Underline != nil {
		base.Underline = styleBoolPtr(*override.Underline)
	}
	if override.StrikeOut != nil {
		base.StrikeOut = styleBoolPtr(*override.StrikeOut)
	}
	if override.ScaleX != nil {
		base.ScaleX = styleIntPtr(*override.ScaleX)
	}
	if override.ScaleY != nil {
		base.ScaleY = styleIntPtr(*override.ScaleY)
	}
	if override.Spacing != nil {
		base.Spacing = styleFloatPtr(*override.Spacing)
	}
	if override.Angle != nil {
		base.Angle = styleFloatPtr(*override.Angle)
	}
	if override.BorderStyle != nil {
		base.BorderStyle = styleIntPtr(*override.BorderStyle)
	}
	if override.Outline != nil {
		base.Outline = styleFloatPtr(*override.Outline)
	}
	if override.Shadow != nil {
		base.Shadow = styleFloatPtr(*override.Shadow)
	}
	if override.AlignmentValue != nil {
		base.AlignmentValue = styleIntPtr(*override.AlignmentValue)
	}
	if override.MarginL != nil {
		base.MarginL = styleIntPtr(*override.MarginL)
	}
	if override.MarginR != nil {
		base.MarginR = styleIntPtr(*override.MarginR)
	}
	if override.MarginV != nil {
		base.MarginV = styleIntPtr(*override.MarginV)
	}
	if override.Encoding != nil {
		base.Encoding = styleIntPtr(*override.Encoding)
	}
	if override.RawASSStyle != "" {
		base.RawASSStyle = override.RawASSStyle
	}
	if override.FadeInMS != nil {
		base.FadeInMS = styleIntPtr(*override.FadeInMS)
	}
	if override.FadeOutMS != nil {
		base.FadeOutMS = styleIntPtr(*override.FadeOutMS)
	}
	if override.OverrideTags != "" {
		base.OverrideTags = override.OverrideTags
	}
	return base
}

func validateScreen(path string, screen ScreenStyle) error {
	if err := validateStyle(path+".major", "Major", screen.Major); err != nil {
		return err
	}
	return validateStyle(path+".minor", "Minor", screen.Minor)
}

func validateStyle(path, expectedName string, style Style) error {
	if err := validateRawASSStyle(path+".raw_ass_style", expectedName, style.RawASSStyle); err != nil {
		return err
	}
	if err := validateASSFieldString(path+".name", style.Name); err != nil {
		return err
	}
	if err := validateASSFieldString(path+".font_name", style.FontName); err != nil {
		return err
	}
	if err := validateColor(path+".primary_color", style.PrimaryColor); err != nil {
		return err
	}
	if err := validateColor(path+".secondary_color", style.SecondaryColor); err != nil {
		return err
	}
	if err := validateColor(path+".outline_color", style.OutlineColor); err != nil {
		return err
	}
	if err := validateColor(path+".back_color", style.BackColor); err != nil {
		return err
	}
	if err := validateInt(path+".font_size", style.FontSize, 1, 200); err != nil {
		return err
	}
	if err := validateInt(path+".scale_x", style.ScaleX, 1, 400); err != nil {
		return err
	}
	if err := validateInt(path+".scale_y", style.ScaleY, 1, 400); err != nil {
		return err
	}
	if err := validateInt(path+".alignment", style.AlignmentValue, 1, 9); err != nil {
		return err
	}
	if err := validateInt(path+".border_style", style.BorderStyle, 1, 3); err != nil {
		return err
	}
	if err := validateInt(path+".encoding", style.Encoding, 0, 255); err != nil {
		return err
	}
	if err := validateInt(path+".margin_l", style.MarginL, 0, 2000); err != nil {
		return err
	}
	if err := validateInt(path+".margin_r", style.MarginR, 0, 2000); err != nil {
		return err
	}
	if err := validateInt(path+".margin_v", style.MarginV, 0, 2000); err != nil {
		return err
	}
	if err := validateFloat(path+".outline", style.Outline, 0, 20); err != nil {
		return err
	}
	if err := validateFloat(path+".shadow", style.Shadow, 0, 20); err != nil {
		return err
	}
	if err := validateFloat(path+".spacing", style.Spacing, -100, 100); err != nil {
		return err
	}
	if err := validateFloat(path+".angle", style.Angle, -360, 360); err != nil {
		return err
	}
	if err := validateInt(path+".fade_in_ms", style.FadeInMS, 0, 10000); err != nil {
		return err
	}
	if err := validateInt(path+".fade_out_ms", style.FadeOutMS, 0, 10000); err != nil {
		return err
	}
	return validateOverrideTags(path+".override_tags", style.OverrideTags)
}

func validateRawASSStyle(path, expectedName, raw string) error {
	if raw == "" {
		return nil
	}
	if !strings.HasPrefix(raw, "Style: ") {
		return fmt.Errorf("%s must start with \"Style: \"", path)
	}
	if len(strings.Split(raw, ",")) != 23 {
		return fmt.Errorf("%s must be a complete simple Style line with 23 comma-separated fields; escaped commas are not supported", path)
	}
	fields := strings.Split(raw, ",")
	name := strings.TrimPrefix(fields[0], "Style: ")
	if name != expectedName {
		return fmt.Errorf("%s style name must be %q, got %q", path, expectedName, name)
	}
	return nil
}

func validateOverrideTags(path, tags string) error {
	normalized := normalizeOverrideTags(tags)
	if normalized == "" {
		return nil
	}
	if strings.ContainsAny(normalized, "{}\n\r") {
		return fmt.Errorf("%s must not contain braces, newline, or carriage return", path)
	}
	if !strings.HasPrefix(normalized, `\`) {
		return fmt.Errorf("%s must start with an ASS override tag backslash", path)
	}
	matches := controlledOverrideTagPattern.FindAllStringSubmatch(normalized, -1)
	consumed := strings.Builder{}
	for _, match := range matches {
		consumed.WriteString(match[0])
		value, err := strconv.ParseFloat(match[2], 64)
		if err != nil {
			return fmt.Errorf("%s contains an invalid %s value", path, match[1])
		}
		if match[1] == "blur" && (value < 0 || value > 10) {
			return fmt.Errorf("%s blur must be between 0 and 10", path)
		}
		if match[1] != "blur" && (value < -20 || value > 20) {
			return fmt.Errorf("%s %s must be between -20 and 20", path, match[1])
		}
	}
	if consumed.String() != normalized {
		return fmt.Errorf("%s only supports controlled xshad, yshad, and blur tags", path)
	}
	return nil
}

func normalizeOverrideTags(tags string) string {
	trimmed := strings.TrimSpace(tags)
	if strings.HasPrefix(trimmed, "{") && strings.HasSuffix(trimmed, "}") {
		trimmed = strings.TrimSpace(strings.TrimSuffix(strings.TrimPrefix(trimmed, "{"), "}"))
	}
	return trimmed
}

func validateColor(path, value string) error {
	if value == "" {
		return nil
	}
	if _, err := NormalizeASSColor(value); err != nil {
		return fmt.Errorf("%s: %w", path, err)
	}
	return nil
}

func validateASSFieldString(path, value string) error {
	if value == "" {
		return nil
	}
	if strings.ContainsAny(value, ",\n\r") {
		return fmt.Errorf("%s must not contain comma, newline, or carriage return", path)
	}
	return nil
}

func validateInt(path string, value *int, min, max int) error {
	if value == nil {
		return nil
	}
	if *value < min || *value > max {
		return fmt.Errorf("%s must be between %d and %d", path, min, max)
	}
	return nil
}

func validateFloat(path string, value *float64, min, max float64) error {
	if value == nil {
		return nil
	}
	if *value < min || *value > max {
		return fmt.Errorf("%s must be between %s and %s", path, formatFloat(min), formatFloat(max))
	}
	return nil
}

func cloneStyleSet(set *StyleSet) StyleSet {
	return StyleSet{
		Version: set.Version,
		Horizontal: ScreenStyle{
			Major: cloneStyle(set.Horizontal.Major),
			Minor: cloneStyle(set.Horizontal.Minor),
		},
		Vertical: ScreenStyle{
			Major: cloneStyle(set.Vertical.Major),
			Minor: cloneStyle(set.Vertical.Minor),
		},
	}
}

func cloneStyle(style Style) Style {
	return mergeStyle(Style{}, style)
}

func normalizeColorOrEmptyDefault(path, input, fallback string) string {
	if input == "" {
		return fallback
	}
	normalized, err := NormalizeASSColor(input)
	if err != nil {
		panic(fmt.Sprintf("%s: invalid style color reached ASS generation: %v", path, err))
	}
	return normalized
}

func valueOr(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}

func intValue(value *int, fallback int) int {
	if value == nil {
		return fallback
	}
	return *value
}

func floatValue(value *float64, fallback float64) float64 {
	if value == nil {
		return fallback
	}
	return *value
}

func boolASSValue(value *bool, fallback bool) int {
	result := fallback
	if value != nil {
		result = *value
	}
	if result {
		return -1
	}
	return 0
}

func formatFloat(value float64) string {
	return strconv.FormatFloat(value, 'f', -1, 64)
}

func styleIntPtr(v int) *int { return &v }

func styleFloatPtr(v float64) *float64 { return &v }

func styleBoolPtr(v bool) *bool { return &v }
