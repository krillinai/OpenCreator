package subtitlestyle

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDefaultStyleBuildsCurrentHorizontalHeader(t *testing.T) {
	style := DefaultStyleSet()
	header := BuildAssHeader(style, true)

	if !strings.Contains(header, "Style: Major,Arial,14,&H0000BFFF,&H000000FF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,2.5,1.5,2,10,10,20,1") {
		t.Fatalf("horizontal Major style missing current defaults:\n%s", header)
	}
	if !strings.Contains(header, "Style: Minor,Arial,10,&H0000BFFF,&H000000FF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,2.5,1.5,2,10,10,30,1") {
		t.Fatalf("horizontal Minor style missing current defaults:\n%s", header)
	}
}

func TestParseColorConvertsHTMLToASS(t *testing.T) {
	got, err := NormalizeASSColor("#3366CC")
	if err != nil {
		t.Fatalf("NormalizeASSColor() error = %v", err)
	}
	if got != "&H00CC6633" {
		t.Fatalf("NormalizeASSColor() = %q, want &H00CC6633", got)
	}

	got, err = NormalizeASSColor("#3366CC80")
	if err != nil {
		t.Fatalf("NormalizeASSColor(alpha) error = %v", err)
	}
	if got != "&H7FCC6633" {
		t.Fatalf("NormalizeASSColor(alpha) = %q, want &H7FCC6633", got)
	}
}

func TestLoadOverrideRejectsUnknownField(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "style.json")
	if err := os.WriteFile(path, []byte(`{"horizontal":{"major":{"font_colour":"#fff"}}}`), 0644); err != nil {
		t.Fatal(err)
	}

	_, err := LoadOverrideFile(path)
	if err == nil {
		t.Fatal("LoadOverrideFile() error = nil, want unknown field error")
	}
	if !strings.Contains(err.Error(), "font_colour") {
		t.Fatalf("error = %v, want field path containing font_colour", err)
	}
}

func TestDecodeAcceptsVersion(t *testing.T) {
	got, err := Decode([]byte(`{"version":1,"horizontal":{"major":{"primary_color":"#FFFFFF"}}}`), "style.json")
	if err != nil {
		t.Fatalf("Decode() error = %v", err)
	}
	if got.Version != 1 {
		t.Fatalf("version = %d, want 1", got.Version)
	}
}

func TestMergeKeepsDefaultsForMissingFields(t *testing.T) {
	base := DefaultStyleSet()
	override := &StyleSet{
		Horizontal: ScreenStyle{
			Major: Style{PrimaryColor: "#FFFFFF", Outline: floatPtr(3)},
		},
	}

	got, err := Merge(base, override)
	if err != nil {
		t.Fatalf("Merge() error = %v", err)
	}
	if got.Horizontal.Major.PrimaryColor != "#FFFFFF" {
		t.Fatalf("primary color = %q, want override", got.Horizontal.Major.PrimaryColor)
	}
	if got.Horizontal.Major.FontSize == nil || *got.Horizontal.Major.FontSize != 14 {
		t.Fatalf("font size not inherited: %#v", got.Horizontal.Major.FontSize)
	}
	if got.Vertical.Minor.FontSize == nil || *got.Vertical.Minor.FontSize != 7 {
		t.Fatalf("vertical minor font size not inherited: %#v", got.Vertical.Minor.FontSize)
	}
}

func TestMergeOverridesVersion(t *testing.T) {
	got, err := Merge(DefaultStyleSet(), &StyleSet{Version: 2})
	if err != nil {
		t.Fatalf("Merge() error = %v", err)
	}
	if got.Version != 2 {
		t.Fatalf("version = %d, want 2", got.Version)
	}
}

func TestValidateRejectsInvalidColorWithFieldPath(t *testing.T) {
	style := DefaultStyleSet()
	style.Horizontal.Major.PrimaryColor = "not-a-color"

	err := Validate(style)
	if err == nil {
		t.Fatal("Validate() error = nil, want invalid color error")
	}
	if !strings.Contains(err.Error(), "horizontal.major.primary_color") {
		t.Fatalf("error = %v, want field path containing primary_color", err)
	}
}

func TestDecodeRejectsTrailingJSON(t *testing.T) {
	_, err := Decode([]byte(`{"horizontal":{"major":{"primary_color":"#FFFFFF"}}} {"vertical":{}}`), "style.json")
	if err == nil {
		t.Fatal("Decode() error = nil, want trailing JSON error")
	}
	if !strings.Contains(err.Error(), "trailing") {
		t.Fatalf("error = %v, want trailing JSON error", err)
	}
}

func TestValidateRejectsUnsafeFontName(t *testing.T) {
	style := DefaultStyleSet()
	style.Horizontal.Major.FontName = "Arial,Injected"

	err := Validate(style)
	if err == nil {
		t.Fatal("Validate() error = nil, want invalid font_name error")
	}
	if !strings.Contains(err.Error(), "horizontal.major.font_name") {
		t.Fatalf("error = %v, want field path containing font_name", err)
	}
}

func TestMergeNilBaseUsesDefaults(t *testing.T) {
	override := &StyleSet{
		Horizontal: ScreenStyle{
			Major: Style{PrimaryColor: "#FFFFFF"},
		},
	}

	got, err := Merge(nil, override)
	if err != nil {
		t.Fatalf("Merge(nil, override) error = %v", err)
	}
	if got.Horizontal.Major.PrimaryColor != "#FFFFFF" {
		t.Fatalf("primary color = %q, want override", got.Horizontal.Major.PrimaryColor)
	}
	if got.Vertical.Minor.MarginV == nil || *got.Vertical.Minor.MarginV != 92 {
		t.Fatalf("vertical minor margin not inherited from defaults: %#v", got.Vertical.Minor.MarginV)
	}
	if got.Vertical.Major.Outline == nil || *got.Vertical.Major.Outline != 2.2 {
		t.Fatalf("vertical major outline not inherited from defaults: %#v", got.Vertical.Major.Outline)
	}
}

func TestDefaultVerticalMajorRendersAboveMinor(t *testing.T) {
	style := DefaultStyleSet()
	if Alignment(style.Vertical.Major) != 2 || Alignment(style.Vertical.Minor) != 2 {
		t.Fatalf("vertical subtitles must use bottom alignment for MarginV ordering")
	}
	if style.Vertical.Major.MarginV == nil || style.Vertical.Minor.MarginV == nil {
		t.Fatalf("vertical subtitle margins must be defined")
	}
	if *style.Vertical.Major.MarginV <= *style.Vertical.Minor.MarginV {
		t.Fatalf(
			"vertical Major subtitle should render above Minor: major MarginV=%d minor MarginV=%d",
			*style.Vertical.Major.MarginV,
			*style.Vertical.Minor.MarginV,
		)
	}
}

func TestRawStyleAndDialogueTags(t *testing.T) {
	style := DefaultStyleSet()
	style.Horizontal.Major.RawASSStyle = "Style: Major,Arial,30,&H00FFFFFF,&H000000FF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,4,2,2,20,20,40,1"
	style.Horizontal.Major.FadeInMS = intPtr(120)
	style.Horizontal.Major.FadeOutMS = intPtr(180)
	style.Horizontal.Major.OverrideTags = `\blur1`

	header := BuildAssHeader(style, true)
	if !strings.Contains(header, style.Horizontal.Major.RawASSStyle) {
		t.Fatalf("raw style was not used:\n%s", header)
	}
	tags := DialogueTags(style.Horizontal.Major)
	if tags != `{\fad(120,180)\blur1}` {
		t.Fatalf("DialogueTags() = %q", tags)
	}
}

func TestValidateRejectsRawStyleWithWrongName(t *testing.T) {
	style := DefaultStyleSet()
	style.Horizontal.Major.RawASSStyle = "Style: MyMajor,Arial,30,&H00FFFFFF,&H000000FF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,4,2,2,20,20,40,1"

	err := Validate(style)
	if err == nil {
		t.Fatal("Validate() error = nil, want raw style name error")
	}
	if !strings.Contains(err.Error(), "horizontal.major.raw_ass_style") || !strings.Contains(err.Error(), "Major") {
		t.Fatalf("error = %v, want raw style name context", err)
	}
}

func TestValidateRejectsUnsafeOverrideTags(t *testing.T) {
	style := DefaultStyleSet()
	style.Horizontal.Major.OverrideTags = `\blur1}
Dialogue: 0,0:00:00.00,0:00:01.00,Major,,0,0,0,,Injected`

	err := Validate(style)
	if err == nil {
		t.Fatal("Validate() error = nil, want unsafe override_tags error")
	}
	if !strings.Contains(err.Error(), "horizontal.major.override_tags") {
		t.Fatalf("error = %v, want override_tags context", err)
	}
}

func TestValidateRejectsUncontrolledOrOutOfRangeOverrideTags(t *testing.T) {
	for _, tags := range []string{`\bord5`, `\xshad21`, `\yshad-21`, `\blur10.1`} {
		style := DefaultStyleSet()
		style.Horizontal.Major.OverrideTags = tags
		if err := Validate(style); err == nil {
			t.Fatalf("Validate() error = nil for %q, want controlled tag validation error", tags)
		}
	}
}

func TestDialogueTagsNormalizesBraces(t *testing.T) {
	style := DefaultStyleSet()
	style.Horizontal.Major.OverrideTags = `{\blur1}`

	tags := DialogueTags(style.Horizontal.Major)
	if tags != `{\blur1}` {
		t.Fatalf("DialogueTags() = %q, want normalized override tags", tags)
	}
}

func TestValidateRejectsOutOfRangeStyleFields(t *testing.T) {
	style := DefaultStyleSet()
	borderStyle := 4
	encoding := -1
	spacing := 1001.0
	angle := 361.0
	style.Horizontal.Major.BorderStyle = &borderStyle
	style.Horizontal.Minor.Encoding = &encoding
	style.Vertical.Major.Spacing = &spacing
	style.Vertical.Minor.Angle = &angle

	err := Validate(style)
	if err == nil {
		t.Fatal("Validate() error = nil, want out-of-range field error")
	}
	if !strings.Contains(err.Error(), "border_style") {
		t.Fatalf("error = %v, want first invalid field path", err)
	}
}

func intPtr(v int) *int           { return &v }
func floatPtr(v float64) *float64 { return &v }
