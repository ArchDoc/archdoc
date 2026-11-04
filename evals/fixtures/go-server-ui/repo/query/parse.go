package query

import (
	"fmt"
	"strings"
	"time"
)

// Expr is a parsed query, such as up(api)[5m] or latency(api)[1m] > 0.5.
type Expr struct {
	Func      string
	Target    string
	Window    time.Duration
	Op        string
	Threshold float64
}

// Parse parses a query.
func Parse(s string) (*Expr, error) {
	open := strings.Index(s, "(")
	close := strings.Index(s, ")")
	if open < 0 || close < open {
		return nil, fmt.Errorf("bad query %q", s)
	}
	e := &Expr{Func: s[:open], Target: s[open+1 : close], Window: 5 * time.Minute}
	if rest := strings.TrimSpace(s[close+1:]); rest != "" {
		fmt.Sscanf(rest, "%s %f", &e.Op, &e.Threshold)
	}
	return e, nil
}
