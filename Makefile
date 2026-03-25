BIN_DIR := bin

.PHONY: build tidy test bench-models bench-static bench-replay bench-all smoke-shell ghost-shell pty-shell

build:
	mkdir -p $(BIN_DIR)
	go build -o $(BIN_DIR)/autocomplete-daemon ./cmd/autocomplete-daemon
	go build -o $(BIN_DIR)/autocomplete-client ./cmd/autocomplete-client
	go build -o $(BIN_DIR)/model-bench ./cmd/model-bench

tidy:
	go mod tidy

test:
	go test ./...

bench-models: bench-static

bench-static:
	./bin/model-bench static

bench-replay:
	./bin/model-bench replay

bench-all:
	./bin/model-bench static --suite all --protocol full
	./bin/model-bench replay --protocol mixed

smoke-shell:
	bash ./scripts/smoke_zsh.sh

ghost-shell:
	bash ./scripts/test_ghost_text.sh

pty-shell:
	bash ./scripts/test_pty_capture.sh
