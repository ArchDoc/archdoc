package store

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// WAL is the write-ahead log on disk.
type WAL struct{ f *os.File }

// OpenWAL opens the log in dir.
func OpenWAL(dir string) (*WAL, error) {
	f, err := os.OpenFile(filepath.Join(dir, "wal.jsonl"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	return &WAL{f: f}, err
}

// Write appends a sample to the log.
func (w *WAL) Write(x Sample) {
	b, _ := json.Marshal(x)
	w.f.Write(append(b, '\n'))
}
