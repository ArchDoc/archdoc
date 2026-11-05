package api

import (
	"encoding/json"
	"net/http"

	"github.com/example/pulse/query"
	"github.com/example/pulse/rules"
	"github.com/example/pulse/store"
)

// Register adds the API routes.
func Register(mux *http.ServeMux, s *store.Store, m *rules.Manager) {
	mux.HandleFunc("GET /api/query", func(w http.ResponseWriter, r *http.Request) {
		res, err := query.Eval(s, r.URL.Query().Get("q"))
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		json.NewEncoder(w).Encode(res)
	})
	mux.HandleFunc("GET /api/alerts", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(m.Firing())
	})
}
