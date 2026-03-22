package main

import (
	"context"
	"flag"
	"log"
	"os/signal"
	"syscall"

	"github.com/SuperCorks/llm-cli-suggestions/internal/config"
	"github.com/SuperCorks/llm-cli-suggestions/internal/db"
	"github.com/SuperCorks/llm-cli-suggestions/internal/engine"
	"github.com/SuperCorks/llm-cli-suggestions/internal/model/ollama"
	"github.com/SuperCorks/llm-cli-suggestions/internal/server"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("load config: %v", err)
	}

	socketPath := flag.String("socket", cfg.SocketPath, "unix socket path")
	dbPath := flag.String("db", cfg.DBPath, "sqlite database path")
	modelName := flag.String("model", cfg.ModelName, "local model name")
	modelBaseURL := flag.String("model-url", cfg.ModelBaseURL, "local model base URL")
	suggestStrategy := flag.String("strategy", cfg.SuggestStrategy, "suggestion strategy")
	flag.Parse()

	cfg.SocketPath = *socketPath
	cfg.DBPath = *dbPath
	cfg.ModelName = *modelName
	cfg.ModelBaseURL = *modelBaseURL
	cfg.SuggestStrategy = config.NormalizeSuggestStrategy(*suggestStrategy)

	store, err := db.NewStore(cfg.DBPath)
	if err != nil {
		log.Fatalf("open store: %v", err)
	}
	defer func() {
		if err := store.Close(); err != nil {
			log.Printf("close store: %v", err)
		}
	}()

	modelClient := ollama.New(cfg.ModelBaseURL, cfg.ModelName)
	eng := engine.New(store, modelClient, cfg.ModelName, cfg.ModelBaseURL, cfg.SuggestStrategy, cfg.SuggestTimeout)
	srv := server.New(&cfg, eng, store)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	log.Printf("autocomplete daemon listening on %s using model %s", cfg.SocketPath, cfg.ModelName)
	if err := srv.Run(ctx); err != nil && err != context.Canceled {
		log.Fatalf("run server: %v", err)
	}
}
