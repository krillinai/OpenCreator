package dubbing

import "github.com/clipperhouse/uax29/v2/graphemes"

func subtitleLength(text string) int {
	length := 0
	iter := graphemes.FromString(text)
	for iter.Next() {
		length++
	}
	return length
}
