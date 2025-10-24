# Ollama MCP Server - Test Documentation

This file contains test cases and examples for validating the Ollama MCP server functionality, especially the new file-aware tools.

## Purpose

Use this file to:
1. Verify that the MCP server is working correctly after changes
2. Test the file-aware tools that reduce token usage
3. Stress test Ollama integration with real project files

## Important Notes

- **Timeout Considerations**: Ollama calls typically take 60-180 seconds with gemma3:12b on a single GPU. Be patient!
- **Model**: Default model is `gemma3:12b` with `gemma3:4b` as fallback
- **Restart Required**: After modifying `index.js`, restart Claude Code to reload the MCP server

## Test Cases

### 1. Basic String-Based Tools (Original)

These tools accept code as strings - useful when code is already in context:

```
Test: ollama_explain_code
- Pass a small code snippet
- Verify Ollama explains it correctly
- Expected time: 60-120 seconds
```

```
Test: ollama_review_code
- Pass a code snippet with potential issues
- Check if Ollama identifies problems
- Expected time: 60-120 seconds
```

### 2. File-Aware Tools (New - Token Savers!)

These tools read files directly on the MCP server, reducing conversation token usage:

#### Test: ollama_review_file

```javascript
// Usage example:
{
  file_path: "G:\\Projects\\OllamaClaude\\index.js",
  focus: "error handling",
  model: "gemma3:12b"
}
```

**Expected behavior:**
- MCP server reads the file internally
- Sends file content to Ollama
- Returns code review focused on error handling
- **Token savings**: File content doesn't go through Claude conversation

#### Test: ollama_explain_file

```javascript
// Usage example:
{
  file_path: "G:\\Projects\\OllamaClaude\\package.json",
  context: "Focus on dependencies and their purposes"
}
```

**Expected behavior:**
- MCP server reads package.json
- Ollama explains the file structure and dependencies
- **Token savings**: No need to read/paste file in conversation

#### Test: ollama_analyze_files

```javascript
// Usage example:
{
  file_paths: [
    "G:\\Projects\\OllamaClaude\\index.js",
    "G:\\Projects\\OllamaClaude\\package.json"
  ],
  task: "Analyze how the dependencies in package.json are used in index.js"
}
```

**Expected behavior:**
- MCP server reads both files
- Ollama analyzes relationships between them
- Returns insights about dependency usage
- **Token savings**: Multiple files read server-side

#### Test: ollama_generate_code_with_context

```javascript
// Usage example:
{
  prompt: "Create a new tool handler method following the same pattern",
  language: "javascript",
  context_files: ["G:\\Projects\\OllamaClaude\\index.js"]
}
```

**Expected behavior:**
- MCP server reads reference file(s)
- Ollama generates code matching the existing patterns
- Returns code that follows project conventions
- **Token savings**: Reference files handled server-side

### 3. Stress Tests

#### Multi-File Analysis
Test analyzing 3-4 files together to verify:
- Memory handling
- Timeout management
- Quality of cross-file analysis

#### Large File Review
Test with the full index.js file (600+ lines):
- Verify timeout is sufficient (120 seconds default)
- Check if response is complete or truncated
- Test different focus areas (performance, security, best practices)

## Validation Checklist

After making changes to the MCP server:

- [ ] Run `node --check index.js` to verify syntax
- [ ] Restart Claude Code to reload MCP server
- [ ] Verify new tools appear in Claude's tool list (check for `mcp__ollama__` prefix)
- [ ] Test at least one file-aware tool with a real project file
- [ ] Confirm Ollama is running (`http://localhost:11434`)
- [ ] Check that timeout warnings appear if calls take too long
- [ ] Verify error handling (try invalid file paths)

## Token Usage Comparison

### Before (String-Based)
```
Claude: Read file (2000 tokens)
Claude: Call ollama_review_code with content (2000 tokens sent)
Total conversation tokens: ~4000
```

### After (File-Aware)
```
Claude: Call ollama_review_file with path (50 tokens)
MCP Server: Reads file internally (0 conversation tokens)
Total conversation tokens: ~50
```

**Savings: ~98.75% reduction in conversation tokens!**

## Common Issues

### Issue: "Cannot connect to Ollama"
**Solution**: Ensure Ollama is running with `ollama serve`

### Issue: "Timeout exceeded"
**Solution**:
- Expected for large files or complex tasks
- Consider using smaller model (`gemma3:4b`) for simpler tasks
- Increase timeout in `index.js` if needed (currently 900000ms = 15 minutes)

### Issue: "Tools not appearing"
**Solution**:
- Verify `claude_desktop_config.json` has correct path to `index.js`
- Restart Claude Code completely
- Check MCP server logs for connection errors

### Issue: "File not found"
**Solution**:
- Use absolute paths (e.g., `G:\\Projects\\...`)
- Verify file exists before calling tool
- Check path escaping on Windows (use double backslashes or forward slashes)

## Example Test Session

```
1. Verify server is running:
   - Check Claude's available tools for mcp__ollama__ tools

2. Simple test:
   - Use ollama_explain_file on package.json
   - Wait 60-120 seconds
   - Verify response makes sense

3. Advanced test:
   - Use ollama_analyze_files with index.js and package.json
   - Task: "Identify which npm packages are imported and used"
   - Verify cross-file analysis works

4. Token savings test:
   - Compare using ollama_review_code (paste file) vs ollama_review_file (path)
   - Observe token usage difference in conversation
```

## Future Improvements to Test

When these features are added, test them here:

- [ ] Caching: Repeated calls on same file should be faster
- [ ] Glob support: Pass patterns like `*.js` instead of individual files
- [ ] Session memory: Maintain context across multiple Ollama calls
- [ ] Auto-context: Server automatically finds related files
- [ ] File writing: Generate code directly to files

## Notes for Future Self

- The file-aware tools are a huge token saver - use them whenever possible!
- Don't forget the 90-300 second wait time for Ollama responses
- Test with real project files to ensure patterns work in practice
- Consider creating smaller test files if full project files cause timeouts
- Remember: MCP server runs in Node.js, has full file system access within its permissions
