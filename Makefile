BIN_DIR := bin

.PHONY: build tidy test bench-models smoke-shell

build:
	mkdir -p $(BIN_DIR)
	go build -o $(BIN_DIR)/autocomplete-daemon ./cmd/autocomplete-daemon
	go build -o $(BIN_DIR)/autocomplete-client ./cmd/autocomplete-client
	go build -o $(BIN_DIR)/model-bench ./cmd/model-bench

tidy:
	go mod tidy

test:
	go test ./...

bench-models:
	./bin/model-bench

smoke-shell:
	bash ./scripts/smoke_zsh.sh
