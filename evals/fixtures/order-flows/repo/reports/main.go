// Command reports emails finance the day's sales. A Kubernetes CronJob runs it nightly.
package main

import (
	"context"
	"flag"
	"os"

	"example.com/order-flows/reports/sales"
)

func main() {
	day := flag.String("day", "yesterday", "the day to report")
	flag.Parse()
	ctx := context.Background()
	summary, err := sales.Summarize(ctx, os.Getenv("DATABASE_URL"), *day)
	if err != nil {
		panic(err)
	}
	if err := sales.Email(os.Getenv("SMTP_HOST"), os.Getenv("FINANCE_EMAIL"), summary); err != nil {
		panic(err)
	}
}
