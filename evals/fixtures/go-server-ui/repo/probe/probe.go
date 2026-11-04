package probe

import (
	"net/http"
	"time"

	"github.com/example/pulse/config"
	"github.com/example/pulse/store"
)

// Run probes each target on its interval and appends the result to the store.
func Run(c *config.Config, s *store.Store) {
	for _, t := range Targets(c) {
		go func(t config.Target) {
			for range time.Tick(t.Interval) {
				start := time.Now()
				resp, err := http.Get(t.URL)
				up := err == nil && resp.StatusCode < 500
				s.Append(store.Sample{Target: t.Name, At: start, Up: up, Latency: time.Since(start)})
			}
		}(t)
	}
}
