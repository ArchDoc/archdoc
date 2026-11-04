package store

import (
	"sync"
	"time"
)

// Sample is one probe result.
type Sample struct {
	Target  string
	At      time.Time
	Up      bool
	Latency time.Duration
}

// Store keeps samples in memory and in a write-ahead log on disk.
type Store struct {
	mu      sync.Mutex
	samples map[string][]Sample
	wal     *WAL
}

// Open opens the store in dir.
func Open(dir string) (*Store, error) {
	w, err := OpenWAL(dir)
	if err != nil {
		return nil, err
	}
	return &Store{samples: map[string][]Sample{}, wal: w}, nil
}

// Append adds a sample.
func (s *Store) Append(x Sample) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.samples[x.Target] = append(s.samples[x.Target], x)
	s.wal.Write(x)
}

// Select returns a target's samples since a time.
func (s *Store) Select(target string, since time.Time) []Sample {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []Sample
	for _, x := range s.samples[target] {
		if x.At.After(since) {
			out = append(out, x)
		}
	}
	return out
}
