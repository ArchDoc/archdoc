package main

import (
	"github.com/acme/ledger/internal/events"
	"github.com/acme/ledger/internal/postings"
)

func main() {
	events.Connect().Subscribe("posting.created", postings.Settle)
}
