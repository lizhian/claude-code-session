package render

import (
	"reflect"
	"testing"
)

func TestWrapTextPreserveNewlines(t *testing.T) {
	got := WrapTextPreserveNewlines("line one\nline two", 80)
	want := []string{"line one", "line two"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("WrapTextPreserveNewlines() = %#v, want %#v", got, want)
	}
}

func TestWrapTextPreserveNewlinesWrapsEachLine(t *testing.T) {
	got := WrapTextPreserveNewlines("abcd\nefgh", 2)
	want := []string{"ab", "cd", "ef", "gh"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("WrapTextPreserveNewlines() = %#v, want %#v", got, want)
	}
}
