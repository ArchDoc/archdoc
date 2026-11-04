// Package sales totals a day's orders and emails the summary.
package sales

import (
	"context"
	"fmt"
	"net/smtp"

	"github.com/jackc/pgx/v5"
)

type Summary struct {
	Day    string
	Orders int
	Total  int
}

// Summarize totals the orders placed on day.
func Summarize(ctx context.Context, dsn, day string) (Summary, error) {
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		return Summary{}, err
	}
	defer conn.Close(ctx)
	s := Summary{Day: day}
	err = conn.QueryRow(ctx, "select count(*), coalesce(sum(total), 0) from orders where created_at::date = $1", day).Scan(&s.Orders, &s.Total)
	return s, err
}

// Email sends the summary to finance through the SMTP relay.
func Email(host, to string, s Summary) error {
	body := fmt.Sprintf("Subject: Sales for %s\r\n\r\n%d orders, %d cents", s.Day, s.Orders, s.Total)
	return smtp.SendMail(host+":25", nil, "reports@example.com", []string{to}, []byte(body))
}
