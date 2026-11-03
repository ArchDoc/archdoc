package main

import (
	"net/http"

	"github.com/acme/tickets/http/handlers"
)

func main() {
	http.HandleFunc("/api/tickets", handlers.Tickets)
	http.ListenAndServe(":8080", nil)
}
