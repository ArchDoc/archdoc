package rules

import (
	"time"

	"github.com/example/pulse/config"
	"github.com/example/pulse/notify"
	"github.com/example/pulse/query"
	"github.com/example/pulse/store"
)

// Alert is a rule that's firing.
type Alert struct {
	Name   string    `json:"name"`
	Expr   string    `json:"expr"`
	Value  float64   `json:"value"`
	Since  time.Time `json:"since"`
}

// Manager evaluates the rules every 15 seconds.
type Manager struct {
	rules  []config.Rule
	store  *store.Store
	notify *notify.Notifier
	firing map[string]*Alert
}

// New makes a manager.
func New(c *config.Config, s *store.Store, n *notify.Notifier) *Manager {
	return &Manager{rules: c.Rules, store: s, notify: n, firing: map[string]*Alert{}}
}

// Run evaluates each rule and sends the alerts that fire.
func (m *Manager) Run() {
	for range time.Tick(15 * time.Second) {
		for _, r := range m.rules {
			res, err := query.Eval(m.store, r.Expr)
			if err != nil || !res.True {
				delete(m.firing, r.Alert)
				continue
			}
			a := m.firing[r.Alert]
			if a == nil {
				a = &Alert{Name: r.Alert, Expr: r.Expr, Since: time.Now()}
				m.firing[r.Alert] = a
			}
			a.Value = res.Value
			if time.Since(a.Since) >= r.For {
				m.notify.Send(notify.Message{Alert: a.Name, Value: a.Value, Since: a.Since})
			}
		}
	}
}

// Firing lists the alerts that are firing.
func (m *Manager) Firing() []*Alert {
	out := []*Alert{}
	for _, a := range m.firing {
		out = append(out, a)
	}
	return out
}
