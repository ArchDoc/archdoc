package events

import "github.com/nats-io/nats.go"

type Bus struct{ conn *nats.Conn }

func Connect() *Bus {
	c, _ := nats.Connect(nats.DefaultURL)
	return &Bus{conn: c}
}

func (b *Bus) Publish(subject, id string) { b.conn.Publish(subject, []byte(id)) }

func (b *Bus) Subscribe(subject string, fn func(string)) {
	b.conn.Subscribe(subject, func(m *nats.Msg) { fn(string(m.Data)) })
}
