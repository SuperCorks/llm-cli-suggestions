package model

import "context"

type Client interface {
	Suggest(ctx context.Context, prompt string) (string, error)
}
