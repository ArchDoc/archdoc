package postings

import (
	"net/http"

	"github.com/acme/ledger/internal/events"
	"github.com/acme/ledger/internal/store"
)

func Handler(pub *events.Bus) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := store.InsertPosting(r.Context())
		pub.Publish("posting.created", id)
	}
}
