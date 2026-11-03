package postings

import (
	"context"

	"github.com/acme/ledger/internal/store"
)

func Settle(id string) {
	store.MarkSettled(context.Background(), id)
}
