package handlers

import (
	"net/http"

	"github.com/acme/tickets/tickets"
)

func Tickets(w http.ResponseWriter, r *http.Request) {
	tickets.Open(r.Context(), r.FormValue("title"))
}
