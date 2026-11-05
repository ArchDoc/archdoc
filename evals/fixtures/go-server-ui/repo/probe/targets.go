package probe

import "github.com/example/pulse/config"

// Targets returns the targets to probe from the config.
func Targets(c *config.Config) []config.Target {
	return c.Targets
}
