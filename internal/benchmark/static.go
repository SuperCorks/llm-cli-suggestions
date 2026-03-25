package benchmark

import (
	_ "embed"
	"encoding/json"
	"fmt"
)

var (
	//go:embed fixtures/core.json
	staticCoreJSON []byte

	//go:embed fixtures/extended.json
	staticExtendedJSON []byte
)

func LoadStaticSuite(name string) ([]Case, error) {
	switch name {
	case "", "core":
		return decodeCases(staticCoreJSON)
	case "extended":
		return decodeCases(staticExtendedJSON)
	default:
		return nil, fmt.Errorf("unknown static suite %q", name)
	}
}

func decodeCases(payload []byte) ([]Case, error) {
	var cases []Case
	if err := json.Unmarshal(payload, &cases); err != nil {
		return nil, fmt.Errorf("decode static cases: %w", err)
	}
	return cases, nil
}
