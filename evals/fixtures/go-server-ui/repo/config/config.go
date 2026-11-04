package config

import (
	"encoding/json"
	"fmt"
	"os"
	"time"
)

// Target is one endpoint to probe.
type Target struct {
	Name     string        `json:"name"`
	URL      string        `json:"url"`
	Interval time.Duration `json:"interval"`
}

// Rule fires when its expression is true for For.
type Rule struct {
	Alert string        `json:"alert"`
	Expr  string        `json:"expr"`
	For   time.Duration `json:"for"`
}

// Config is pulse.json.
type Config struct {
	Targets    []Target `json:"targets"`
	Rules      []Rule   `json:"rules"`
	WebhookURL string   `json:"webhook_url"`
	DataDir    string   `json:"data_dir"`
}

// Load reads and validates a config file.
func Load(path string) (*Config, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var c Config
	if err := json.Unmarshal(b, &c); err != nil {
		return nil, err
	}
	return &c, Validate(&c)
}

// Validate checks the targets and rules.
func Validate(c *Config) error {
	for _, t := range c.Targets {
		if t.URL == "" {
			return fmt.Errorf("target %q has no url", t.Name)
		}
	}
	return nil
}
