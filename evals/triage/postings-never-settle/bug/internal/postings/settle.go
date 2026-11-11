package postings

import (
	"context"
	"log"
	"time"

	"github.com/acme/ledger/internal/store"
)

// Settlement should be quick: don't let one posting hold the worker up.
const settleTimeout = 5 * time.Millisecond

func Settle(id string) {
	ctx, cancel := context.WithTimeout(context.Background(), settleTimeout)
	defer cancel()
	if err := store.MarkSettled(ctx, id); err != nil {
		log.Printf("settle %s: %v", id, err)
	}
}
