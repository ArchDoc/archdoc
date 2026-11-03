package store

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

var pool *pgxpool.Pool

func Accounts(ctx context.Context) {}

func InsertPosting(ctx context.Context) string { return "" }

func MarkSettled(ctx context.Context, id string) {}
