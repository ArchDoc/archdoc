package store

import (
	"context"
	"os"

	"github.com/jackc/pgx/v5/pgxpool"
)

func Open(ctx context.Context) error {
	p, err := pgxpool.New(ctx, os.Getenv("DATABASE_URL"))
	pool = p
	return err
}
