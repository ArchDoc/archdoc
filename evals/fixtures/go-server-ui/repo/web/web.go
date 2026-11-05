package web

import (
	"net/http"

	"github.com/example/pulse/rules"
	"github.com/example/pulse/store"
	"github.com/example/pulse/web/api"
)

// Serve serves the API under /api and the built web UI at /.
func Serve(addr string, s *store.Store, m *rules.Manager) error {
	mux := http.NewServeMux()
	api.Register(mux, s, m)
	mux.Handle("/", http.FileServer(http.Dir("web/ui/app/dist")))
	return http.ListenAndServe(addr, mux)
}
