# Ollama MCP Server for Claude Code

This MCP (Model Context Protocol) server integrates your local Ollama instance with Claude Code, allowing Claude to delegate coding tasks to your local models (Gemma3, Mistral, etc.) to minimize API token usage.

## How It Works

Claude Code acts as an **orchestrator**, calling tools provided by this MCP server. The tools run on your local Ollama instance, and Claude reviews/refines the results as needed. This approach:

- ✅ Minimizes Anthropic API token usage (up to 98.75% reduction with file-aware tools!)
- ✅ Leverages your local compute resources
- ✅ Works across any Claude Code project/session
- ✅ Allows Claude to provide oversight and corrections

## Available Tools

### String-Based Tools (Pass code as arguments)

These tools accept code as string parameters - useful when code is already in the conversation:

1. **ollama_generate_code** - Generate new code from requirements
2. **ollama_explain_code** - Explain how code works
3. **ollama_review_code** - Review code for issues and improvements
4. **ollama_refactor_code** - Refactor code to improve quality
5. **ollama_fix_code** - Fix bugs or errors in code
6. **ollama_write_tests** - Generate unit tests
7. **ollama_general_task** - Execute any general coding task

### File-Aware Tools (Massive token savings!)

These tools read files directly on the MCP server, dramatically reducing conversation token usage:

8. **ollama_review_file** - Review a file by path (saves ~98.75% tokens vs reading + reviewing)
9. **ollama_explain_file** - Explain a file by path
10. **ollama_analyze_files** - Analyze multiple files together to understand relationships
11. **ollama_generate_code_with_context** - Generate code using existing files as reference patterns

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

### 2. Ensure Ollama is Running

Make sure Ollama is running on `localhost:11434`:

```bash
ollama serve
```

Verify you have the models installed:

```bash
ollama list
```

You should see `gemma3:12b`, `gemma3:4b`, or other models you want to use. The default model is `gemma3:12b` with `gemma3:4b` as a faster fallback for simpler tasks.

### 3. Configure Claude Code

Add this MCP server to your Claude Code configuration. The config file location depends on your OS:

- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

Add the following to your config (or merge with existing `mcpServers`):

```json
{
  "mcpServers": {
    "ollama": {
      "command": "node",
      "args": ["G:\\Projects\\OllamaClaude\\index.js"]
    }
  }
}
```

**Note**: Update the path in `args` to match your actual installation location.

### 4. Restart Claude Code

After updating the configuration, restart Claude Code for the changes to take effect.

## Usage

Once configured, Claude Code will automatically have access to the Ollama tools. You can:

### Direct Usage
Ask Claude to use specific tools:
- "Use ollama_generate_code to create a function that..."
- "Use ollama_review_code to check this code for issues"

### Automatic Orchestration
Simply ask Claude to do tasks, and it will decide when to delegate to Ollama:
- "Write a function to parse JSON" → Claude may delegate to Ollama
- "Review this code" → Claude may use Ollama for initial review, then add insights
- "Fix this bug" → Ollama attempts fix, Claude verifies and corrects if needed

## Customization

### Change Default Model

Edit `index.js` and update these lines (near the top of the file):

```javascript
const DEFAULT_MODEL = "gemma3:12b";  // Change to your preferred model
const FALLBACK_MODEL = "gemma3:4b";  // Faster model for simpler tasks
```

Popular Ollama models to consider:
- `gemma3:12b` - Good balance of quality and speed (default)
- `gemma3:27b` - Highest quality, slower, requires more VRAM
- `gemma3:4b` - Fastest, good for simple tasks
- `qwen2.5-coder:7b` - Specialized for coding
- `mistral-small:latest` - Good balance of speed and quality

### Modify Tool Prompts

Each tool method in `index.js` contains a prompt template. You can customize these to get better results from your specific models.

### Add New Tools

Add new tools by:
1. Adding a tool definition in `ListToolsRequestSchema` handler
2. Creating a new method (like `generateCode`, `reviewCode`, etc.)
3. Adding a case in the `CallToolRequestSchema` handler

## Troubleshooting

### "Cannot connect to Ollama" Error
- Ensure Ollama is running: `ollama serve`
- Check it's on the default port: `http://localhost:11434`
- Test with: `curl http://localhost:11434/api/tags`

### Tools Not Appearing in Claude Code
- Verify the config path is correct
- Restart Claude Code completely
- Check Claude Code logs for MCP connection errors

### Slow Responses / Timeouts
- **Expected behavior**: Ollama calls typically take 60-180 seconds with gemma3:12b on single GPU setups
- Consider using faster models for simple tasks (e.g., `gemma3:4b` instead of `gemma3:12b`)
- Adjust the timeout in `index.js` line 362 (currently 900000ms = 15 minutes)
- Ensure your machine has adequate resources for the model
- For large files, consider using smaller models or breaking the analysis into chunks

## Example Workflows

### Basic Workflow
1. **User asks**: "Create a function to validate email addresses"
2. **Claude decides**: "This is a code generation task, I'll use ollama_generate_code"
3. **Ollama generates**: Initial code implementation
4. **Claude reviews**: Checks the code, may suggest improvements or fixes
5. **Result**: User gets Ollama-generated code with Claude's oversight

### File-Aware Workflow (Token Saver!)
1. **User asks**: "Review the code in index.js for security issues"
2. **Claude calls**: `ollama_review_file` with the file path and focus="security"
3. **MCP server**: Reads index.js directly (no tokens used in conversation!)
4. **Ollama analyzes**: Reviews the ~700 lines of code
5. **Claude refines**: Adds context or additional insights
6. **Token savings**: ~98.75% compared to reading the file into conversation first

### Multi-File Analysis Workflow
1. **User asks**: "How do index.js and package.json relate?"
2. **Claude calls**: `ollama_analyze_files` with both file paths
3. **MCP server**: Reads both files server-side
4. **Ollama analyzes**: Identifies dependencies, patterns, relationships
5. **Result**: Cross-file insights without sending files through Claude conversation

This hybrid approach gives you the speed and cost savings of local models with the intelligence and quality assurance of Claude.

## Performance Expectations

### Response Times
- **Small tasks** (simple code snippets): 20-60 seconds
- **Medium tasks** (function reviews, file analysis): 60-120 seconds
- **Large tasks** (multiple files, complex analysis): 120-180 seconds

Response time depends on:
- Your GPU/CPU capabilities
- Model size (`gemma3:4b` is ~3x faster than `gemma3:12b`, `gemma3:27b` is ~2x slower)
- Task complexity
- File size for file-aware tools

### Token Usage
- **Traditional approach**: Read 700-line file (2000 tokens) + Review (2000 tokens) = **4000 tokens**
- **File-aware approach**: Call `ollama_review_file` with path = **~50 tokens**
- **Savings**: ~98.75% reduction in Claude API token usage!

## Benefits Over Pure Local or Pure Cloud

- **vs Pure Ollama**: Claude provides architectural guidance, catches errors, and ensures quality
- **vs Pure Claude**: Significant token savings on routine coding tasks (up to 98.75%!)
- **Best of Both**: Local compute for heavy lifting, Claude for orchestration and refinement

## Project Structure

```
OllamaClaude/
├── index.js              # Main MCP server implementation
├── package.json          # Node.js dependencies
├── README.md             # This file
├── test.md               # Test cases and validation guide
└── .gitignore            # Git ignore patterns
```

## Contributing & Future Improvements

Potential enhancements to consider:
- **Caching**: Cache file contents for repeated operations
- **Glob support**: Pass patterns like `*.js` to analyze multiple files
- **Streaming responses**: Stream Ollama output for faster perceived performance
- **Auto-context**: Automatically find and include related files
- **File writing**: Allow Ollama to write generated code directly to files

See `test.md` for detailed test cases and validation procedures.
