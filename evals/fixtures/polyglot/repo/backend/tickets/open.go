package tickets

import (
	"context"

	"github.com/acme/tickets/queue"
)

func Open(ctx context.Context, title string) {
	queue.Publish("ticket.opened", title)
}
