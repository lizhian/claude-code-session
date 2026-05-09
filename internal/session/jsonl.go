package session

import (
	"bufio"
	"encoding/json"
	"os"
)

// JSONLResult holds the parsed records and error count from a JSONL file.
type JSONLResult struct {
	Records        []map[string]interface{}
	ParseErrorCount int
}

// ReadJSONLines reads a JSONL file, parsing each non-empty line as JSON.
// Malformed lines are counted but do not stop parsing.
func ReadJSONLines(filePath string) (JSONLResult, error) {
	f, err := os.Open(filePath)
	if err != nil {
		return JSONLResult{}, err
	}
	defer f.Close()

	var result JSONLResult
	scanner := bufio.NewScanner(f)
	// Allow up to 10MB per line to match the JS maxBuffer.
	scanner.Buffer(make([]byte, 0, 64*1024), 10*1024*1024)

	for scanner.Scan() {
		line := scanner.Text()
		trimmed := []byte(line)
		// Skip blank lines.
		if len(trimmed) == 0 {
			continue
		}
		var record map[string]interface{}
		if err := json.Unmarshal(trimmed, &record); err != nil {
			result.ParseErrorCount++
			continue
		}
		result.Records = append(result.Records, record)
	}

	if err := scanner.Err(); err != nil {
		return JSONLResult{}, err
	}
	return result, nil
}
