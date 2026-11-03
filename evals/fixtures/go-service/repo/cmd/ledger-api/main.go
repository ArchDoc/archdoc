package main

import (
	"net/http"

	"github.com/acme/ledger/internal/accounts"
	"github.com/acme/ledger/internal/events"
	"github.com/acme/ledger/internal/postings"
)

func main() {
	pub := events.Connect()
	http.HandleFunc("/accounts", accounts.Handler)
	http.HandleFunc("/postings", postings.Handler(pub))
	http.ListenAndServe(":8080", nil)
}
