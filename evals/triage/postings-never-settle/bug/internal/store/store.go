package store

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

var pool *pgxpool.Pool

func Accounts(ctx context.Context) {}

func InsertPosting(ctx context.Context) string { return "" }

func MarkSettled(ctx context.Context, id string) error {
	_, err := pool.Exec(ctx, "update postings set settled_at = now() where id = $1", id)
	return err
}
