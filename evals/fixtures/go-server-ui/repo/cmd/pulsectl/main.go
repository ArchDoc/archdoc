package main

import (
	"fmt"
	"os"

	"github.com/example/pulse/config"
	"github.com/example/pulse/query"
	"github.com/example/pulse/store"
)

// pulsectl check <config> | pulsectl query <data-dir> <query>
func main() {
	if len(os.Args) < 3 {
		fmt.Println("usage: pulsectl check <config> | pulsectl query <data-dir> <query>")
		os.Exit(2)
	}
	switch os.Args[1] {
	case "check":
		if _, err := config.Load(os.Args[2]); err != nil {
			fmt.Println(err)
			os.Exit(1)
		}
		fmt.Println("ok")
	case "query":
		s, err := store.Open(os.Args[2])
		if err != nil {
			fmt.Println(err)
			os.Exit(1)
		}
		r, err := query.Eval(s, os.Args[3])
		if err != nil {
			fmt.Println(err)
			os.Exit(1)
		}
		fmt.Println(r.Value)
	}
}
