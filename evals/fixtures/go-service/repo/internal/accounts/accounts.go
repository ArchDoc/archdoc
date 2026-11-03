package accounts

import (
	"net/http"

	"github.com/acme/ledger/internal/store"
)

func Handler(w http.ResponseWriter, r *http.Request) {
	store.Accounts(r.Context())
}
