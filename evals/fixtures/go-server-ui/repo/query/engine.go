package query

import (
	"time"

	"github.com/example/pulse/store"
)

// Result is a query's value.
type Result struct {
	Value float64 `json:"value"`
	True  bool    `json:"true"`
}

// Eval runs a query against the store.
func Eval(s *store.Store, q string) (*Result, error) {
	e, err := Parse(q)
	if err != nil {
		return nil, err
	}
	samples := s.Select(e.Target, time.Now().Add(-e.Window))
	var v float64
	for _, x := range samples {
		switch e.Func {
		case "up":
			if x.Up {
				v++
			}
		case "latency":
			v += x.Latency.Seconds()
		}
	}
	if len(samples) > 0 {
		v /= float64(len(samples))
	}
	r := &Result{Value: v}
	switch e.Op {
	case ">":
		r.True = v > e.Threshold
	case "<":
		r.True = v < e.Threshold
	}
	return r, nil
}
