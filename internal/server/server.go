package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"time"

	"github.com/SuperCorks/cli-auto-complete/internal/api"
	"github.com/SuperCorks/cli-auto-complete/internal/config"
	"github.com/SuperCorks/cli-auto-complete/internal/db"
	"github.com/SuperCorks/cli-auto-complete/internal/engine"
)

type Server struct {
	config *config.Config
	engine *engine.Engine
	store  *db.Store
}

func New(cfg *config.Config, eng *engine.Engine, store *db.Store) *Server {
	return &Server{
		config: cfg,
		engine: eng,
		store:  store,
	}
}

func (s *Server) Run(ctx context.Context) error {
	if err := os.RemoveAll(s.config.SocketPath); err != nil {
		return fmt.Errorf("remove stale socket: %w", err)
	}

	listener, err := net.Listen("unix", s.config.SocketPath)
	if err != nil {
		return fmt.Errorf("listen on unix socket: %w", err)
	}
	defer func() {
		_ = listener.Close()
		_ = os.Remove(s.config.SocketPath)
	}()

	if err := os.Chmod(s.config.SocketPath, 0o600); err != nil {
		return fmt.Errorf("chmod socket: %w", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", s.handleHealth)
	mux.HandleFunc("/suggest", s.handleSuggest)
	mux.HandleFunc("/feedback", s.handleFeedback)
	mux.HandleFunc("/command", s.handleRecordCommand)

	server := &http.Server{
		Handler:           mux,
		ReadHeaderTimeout: 2 * time.Second,
	}

	errCh := make(chan error, 1)
	go func() {
		err := server.Serve(listener)
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
			return
		}
		errCh <- nil
	}()

	select {
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdownCtx)
		return ctx.Err()
	case err := <-errCh:
		return err
	}
}

func (s *Server) handleHealth(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet {
		writeError(writer, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	writeJSON(writer, http.StatusOK, api.HealthResponse{
		Status:    "ok",
		ModelName: s.config.ModelName,
		Socket:    s.config.SocketPath,
	})
}

func (s *Server) handleSuggest(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodPost {
		writeError(writer, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var payload api.SuggestRequest
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
		writeError(writer, http.StatusBadRequest, "invalid suggest payload")
		return
	}

	response, err := s.engine.Suggest(request.Context(), payload)
	if err != nil {
		writeError(writer, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(writer, http.StatusOK, response)
}

func (s *Server) handleFeedback(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodPost {
		writeError(writer, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var payload api.FeedbackRequest
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
		writeError(writer, http.StatusBadRequest, "invalid feedback payload")
		return
	}

	if err := s.store.EnsureSession(request.Context(), payload.SessionID); err != nil {
		writeError(writer, http.StatusInternalServerError, err.Error())
		return
	}
	if err := s.store.RecordFeedback(request.Context(), db.FeedbackRecord{
		SuggestionID:    payload.SuggestionID,
		SessionID:       payload.SessionID,
		EventType:       payload.EventType,
		Buffer:          payload.Buffer,
		Suggestion:      payload.Suggestion,
		AcceptedCommand: payload.AcceptedCommand,
		ActualCommand:   payload.ActualCommand,
		CreatedAtMS:     time.Now().UnixMilli(),
	}); err != nil {
		writeError(writer, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(writer, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleRecordCommand(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodPost {
		writeError(writer, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var payload api.RecordCommandRequest
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
		writeError(writer, http.StatusBadRequest, "invalid command payload")
		return
	}

	if err := s.store.EnsureSession(request.Context(), payload.SessionID); err != nil {
		writeError(writer, http.StatusInternalServerError, err.Error())
		return
	}
	if err := s.store.RecordCommand(request.Context(), db.CommandRecord{
		SessionID:     payload.SessionID,
		Command:       payload.Command,
		CWD:           payload.CWD,
		RepoRoot:      payload.RepoRoot,
		Branch:        payload.Branch,
		ExitCode:      payload.ExitCode,
		DurationMS:    payload.DurationMS,
		StartedAtMS:   payload.StartedAtMS,
		FinishedAtMS:  payload.FinishedAtMS,
		StdoutExcerpt: payload.StdoutExcerpt,
		StderrExcerpt: payload.StderrExcerpt,
	}); err != nil {
		writeError(writer, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(writer, http.StatusOK, map[string]string{"status": "ok"})
}

func writeJSON(writer http.ResponseWriter, status int, payload any) {
	writer.Header().Set("Content-Type", "application/json")
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(payload)
}

func writeError(writer http.ResponseWriter, status int, message string) {
	writeJSON(writer, status, map[string]string{"error": message})
}
