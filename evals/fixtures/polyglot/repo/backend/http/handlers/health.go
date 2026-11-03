package handlers

import "net/http"

func Health(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) }
