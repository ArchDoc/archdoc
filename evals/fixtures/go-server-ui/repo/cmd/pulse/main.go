package main

import (
	"flag"
	"log"

	"github.com/example/pulse/config"
	"github.com/example/pulse/notify"
	"github.com/example/pulse/probe"
	"github.com/example/pulse/rules"
	"github.com/example/pulse/store"
	"github.com/example/pulse/web"
)

func main() {
	path := flag.String("config", "pulse.json", "config file")
	addr := flag.String("listen", ":9100", "address to serve on")
	flag.Parse()
	c, err := config.Load(*path)
	if err != nil {
		log.Fatal(err)
	}
	s, err := store.Open(c.DataDir)
	if err != nil {
		log.Fatal(err)
	}
	probe.Run(c, s)
	m := rules.New(c, s, notify.New(c.WebhookURL))
	go m.Run()
	log.Fatal(web.Serve(*addr, s, m))
}
