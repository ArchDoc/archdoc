package notify

import (
	"bytes"
	"encoding/json"
	"net/http"
	"time"
)

// Message is what the webhook receives.
type Message struct {
	Alert string    `json:"alert"`
	Value float64   `json:"value"`
	Since time.Time `json:"since"`
}

// Notifier posts alerts to the webhook.
type Notifier struct{ url string }

// New makes a notifier for a webhook URL.
func New(url string) *Notifier { return &Notifier{url: url} }

// Send posts one alert.
func (n *Notifier) Send(m Message) {
	b, _ := json.Marshal(m)
	http.Post(n.url, "application/json", bytes.NewReader(b))
}
