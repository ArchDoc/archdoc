package sales

import "testing"

func TestSummaryZero(t *testing.T) {
	if (Summary{}).Orders != 0 {
		t.Fatal("expected zero")
	}
}
