package main

import "testing"

func TestAllowedLoopbackListen(t *testing.T) {
	cases := map[string]bool{
		"tcp://127.0.0.1:26658":    true,
		"tcp://127.0.0.1:28088":    true,
		"tcp://[::1]:28058":        true,
		"tcp://localhost:26658":    true,
		"tcp://0.0.0.0:26658":      false,
		"tcp://192.168.1.10:26658": false,
		"tcp://[::]:26658":         false,
		"http://127.0.0.1:26658":   false,
		"tcp://127.0.0.1:80":       false,
		"tcp://127.0.0.1:99999":    false,
		"tcp://localhost:wat":      false,
	}
	for input, want := range cases {
		if got := allowedLoopbackListen(input); got != want {
			t.Errorf("allowedLoopbackListen(%q) = %v; want %v", input, got, want)
		}
	}
}