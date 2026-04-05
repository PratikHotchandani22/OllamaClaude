#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import axios from "axios";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OLLAMA_BASE_URL = "http://localhost:11434";

// Available models - you can customize this
const DEFAULT_MODEL = "qwen3.5:35b-a3b";
const FALLBACK_MODEL = "qwen2.5-coder:32b";
const DEFAULT_VISION_MODEL = "qwen2.5vl:7b";
const DEFAULT_WHISPER_MODEL = "mlx-community/whisper-large-v3-turbo";

// Claude API pricing (per million tokens) as of 2025
const CLAUDE_PRICING = {
  "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
  "claude-opus-4-6": { input: 15.0, output: 75.0 },
  "claude-haiku-4-5": { input: 0.80, output: 4.0 },
};

const STATS_FILE = path.join(__dirname, "token_stats.json");

class OllamaServer {
  constructor() {
    this.server = new Server(
      {
        name: "ollama-mcp-server",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.stats = null; // loaded async in run()

    this.setupToolHandlers();

    this.server.onerror = (error) => console.error("[MCP Error]", error);
    process.on("SIGINT", async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  async loadStats() {
    try {
      const data = await fs.readFile(STATS_FILE, "utf-8");
      this.stats = JSON.parse(data);
    } catch {
      this.stats = {
        total_input_tokens: 0,
        total_output_tokens: 0,
        total_calls: 0,
        total_duration_ms: 0,
        by_tool: {},
        by_model: {},
        daily: {},
        history: [],
      };
    }
  }

  async saveStats() {
    await fs.writeFile(STATS_FILE, JSON.stringify(this.stats, null, 2));
  }

  async recordUsage(toolName, model, inputTokens, outputTokens, durationMs) {
    if (!this.stats) await this.loadStats();

    const today = new Date().toISOString().split("T")[0];

    this.stats.total_input_tokens += inputTokens;
    this.stats.total_output_tokens += outputTokens;
    this.stats.total_calls += 1;
    this.stats.total_duration_ms += durationMs;

    // By tool
    if (!this.stats.by_tool[toolName]) {
      this.stats.by_tool[toolName] = { input_tokens: 0, output_tokens: 0, calls: 0 };
    }
    this.stats.by_tool[toolName].input_tokens += inputTokens;
    this.stats.by_tool[toolName].output_tokens += outputTokens;
    this.stats.by_tool[toolName].calls += 1;

    // By model
    if (!this.stats.by_model[model]) {
      this.stats.by_model[model] = { input_tokens: 0, output_tokens: 0, calls: 0 };
    }
    this.stats.by_model[model].input_tokens += inputTokens;
    this.stats.by_model[model].output_tokens += outputTokens;
    this.stats.by_model[model].calls += 1;

    // Daily
    if (!this.stats.daily[today]) {
      this.stats.daily[today] = { input_tokens: 0, output_tokens: 0, calls: 0 };
    }
    this.stats.daily[today].input_tokens += inputTokens;
    this.stats.daily[today].output_tokens += outputTokens;
    this.stats.daily[today].calls += 1;

    // Recent history (keep last 100 entries)
    this.stats.history.push({
      timestamp: new Date().toISOString(),
      tool: toolName,
      model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      duration_ms: durationMs,
    });
    if (this.stats.history.length > 100) {
      this.stats.history = this.stats.history.slice(-100);
    }

    await this.saveStats();
  }

  calculateSavings(inputTokens, outputTokens) {
    const savings = {};
    for (const [model, pricing] of Object.entries(CLAUDE_PRICING)) {
      const inputCost = (inputTokens / 1_000_000) * pricing.input;
      const outputCost = (outputTokens / 1_000_000) * pricing.output;
      savings[model] = {
        input_cost: inputCost,
        output_cost: outputCost,
        total: inputCost + outputCost,
      };
    }
    return savings;
  }

  setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "ollama_generate_code",
          description: "Generate code using Ollama. Use this for writing new functions, classes, or code snippets. Provide detailed requirements and context.",
          inputSchema: {
            type: "object",
            properties: {
              prompt: {
                type: "string",
                description: "Detailed description of the code to generate, including requirements, language, and context",
              },
              language: {
                type: "string",
                description: "Programming language (e.g., javascript, python, rust)",
              },
              model: {
                type: "string",
                description: "Ollama model to use (default: mistral-small)",
                default: DEFAULT_MODEL,
              },
            },
            required: ["prompt", "language"],
          },
        },
        {
          name: "ollama_explain_code",
          description: "Explain how code works using Ollama. Use this to understand complex code sections, algorithms, or patterns.",
          inputSchema: {
            type: "object",
            properties: {
              code: {
                type: "string",
                description: "The code to explain",
              },
              context: {
                type: "string",
                description: "Additional context about what you want to understand",
              },
              model: {
                type: "string",
                description: "Ollama model to use (default: mistral-small)",
                default: DEFAULT_MODEL,
              },
            },
            required: ["code"],
          },
        },
        {
          name: "ollama_review_code",
          description: "Review code for issues, bugs, or improvements using Ollama. Use this for code quality checks and suggestions.",
          inputSchema: {
            type: "object",
            properties: {
              code: {
                type: "string",
                description: "The code to review",
              },
              focus: {
                type: "string",
                description: "What to focus on (e.g., 'performance', 'security', 'best practices', 'bugs')",
                default: "general code quality",
              },
              model: {
                type: "string",
                description: "Ollama model to use (default: mistral-small)",
                default: DEFAULT_MODEL,
              },
            },
            required: ["code"],
          },
        },
        {
          name: "ollama_refactor_code",
          description: "Refactor code to improve quality, readability, or structure using Ollama.",
          inputSchema: {
            type: "object",
            properties: {
              code: {
                type: "string",
                description: "The code to refactor",
              },
              goal: {
                type: "string",
                description: "Refactoring goal (e.g., 'improve readability', 'reduce complexity', 'modernize syntax')",
              },
              model: {
                type: "string",
                description: "Ollama model to use (default: mistral-small)",
                default: DEFAULT_MODEL,
              },
            },
            required: ["code", "goal"],
          },
        },
        {
          name: "ollama_fix_code",
          description: "Fix bugs or errors in code using Ollama. Provide the broken code and error details.",
          inputSchema: {
            type: "object",
            properties: {
              code: {
                type: "string",
                description: "The code with issues",
              },
              error: {
                type: "string",
                description: "Error message or description of the problem",
              },
              model: {
                type: "string",
                description: "Ollama model to use (default: mistral-small)",
                default: DEFAULT_MODEL,
              },
            },
            required: ["code", "error"],
          },
        },
        {
          name: "ollama_write_tests",
          description: "Generate unit tests for code using Ollama.",
          inputSchema: {
            type: "object",
            properties: {
              code: {
                type: "string",
                description: "The code to write tests for",
              },
              framework: {
                type: "string",
                description: "Testing framework to use (e.g., 'jest', 'pytest', 'mocha')",
              },
              model: {
                type: "string",
                description: "Ollama model to use (default: mistral-small)",
                default: DEFAULT_MODEL,
              },
            },
            required: ["code", "framework"],
          },
        },
        {
          name: "ollama_general_task",
          description: "Execute any general coding task using Ollama. Use this for tasks that don't fit other categories.",
          inputSchema: {
            type: "object",
            properties: {
              task: {
                type: "string",
                description: "Detailed description of the task to perform",
              },
              context: {
                type: "string",
                description: "Any relevant context, code, or background information",
              },
              model: {
                type: "string",
                description: "Ollama model to use (default: mistral-small)",
                default: DEFAULT_MODEL,
              },
            },
            required: ["task"],
          },
        },
        {
          name: "ollama_review_file",
          description: "Review a file by path using Ollama. The MCP server reads the file directly, reducing token usage.",
          inputSchema: {
            type: "object",
            properties: {
              file_path: {
                type: "string",
                description: "Absolute path to the file to review",
              },
              focus: {
                type: "string",
                description: "What to focus on (e.g., 'performance', 'security', 'best practices', 'bugs')",
                default: "general code quality",
              },
              model: {
                type: "string",
                description: "Ollama model to use (default: gemma3:27b)",
                default: DEFAULT_MODEL,
              },
            },
            required: ["file_path"],
          },
        },
        {
          name: "ollama_explain_file",
          description: "Explain a file by path using Ollama. The MCP server reads the file directly, reducing token usage.",
          inputSchema: {
            type: "object",
            properties: {
              file_path: {
                type: "string",
                description: "Absolute path to the file to explain",
              },
              context: {
                type: "string",
                description: "Additional context about what you want to understand",
              },
              model: {
                type: "string",
                description: "Ollama model to use (default: gemma3:27b)",
                default: DEFAULT_MODEL,
              },
            },
            required: ["file_path"],
          },
        },
        {
          name: "ollama_analyze_files",
          description: "Analyze multiple files together using Ollama. Useful for understanding relationships between files.",
          inputSchema: {
            type: "object",
            properties: {
              file_paths: {
                type: "array",
                items: { type: "string" },
                description: "Array of absolute paths to files to analyze together",
              },
              task: {
                type: "string",
                description: "What analysis to perform (e.g., 'find dependencies', 'check consistency', 'summarize architecture')",
              },
              model: {
                type: "string",
                description: "Ollama model to use (default: gemma3:27b)",
                default: DEFAULT_MODEL,
              },
            },
            required: ["file_paths", "task"],
          },
        },
        {
          name: "ollama_generate_code_with_context",
          description: "Generate code using Ollama with context from existing files. Reads reference files to understand patterns.",
          inputSchema: {
            type: "object",
            properties: {
              prompt: {
                type: "string",
                description: "Detailed description of the code to generate",
              },
              language: {
                type: "string",
                description: "Programming language (e.g., javascript, python, rust)",
              },
              context_files: {
                type: "array",
                items: { type: "string" },
                description: "Array of file paths to use as context/examples",
              },
              model: {
                type: "string",
                description: "Ollama model to use (default: gemma3:27b)",
                default: DEFAULT_MODEL,
              },
            },
            required: ["prompt", "language"],
          },
        },
        {
          name: "ollama_analyze_image",
          description: "Analyze an image/screenshot using a local vision model. Use this to understand UI issues, read text from screenshots, describe visual content, or debug layout problems.",
          inputSchema: {
            type: "object",
            properties: {
              image_path: {
                type: "string",
                description: "Absolute path to the image file to analyze (PNG, JPG, etc.)",
              },
              prompt: {
                type: "string",
                description: "What to analyze or look for in the image (e.g., 'describe the UI layout', 'what errors are visible?', 'compare with expected design')",
              },
              model: {
                type: "string",
                description: "Ollama vision model to use (default: qwen2.5vl:7b)",
                default: DEFAULT_VISION_MODEL,
              },
            },
            required: ["image_path", "prompt"],
          },
        },
        {
          name: "ollama_transcribe_audio",
          description: "Transcribe audio/voice files to text using local mlx-whisper. Does not use Ollama. Supports mp3, wav, m4a, webm, etc.",
          inputSchema: {
            type: "object",
            properties: {
              audio_path: {
                type: "string",
                description: "Absolute path to the audio file to transcribe",
              },
              language: {
                type: "string",
                description: "ISO language code (default: en)",
                default: "en",
              },
              model: {
                type: "string",
                description: "mlx-whisper model to use (default: mlx-community/whisper-large-v3-turbo)",
                default: DEFAULT_WHISPER_MODEL,
              },
            },
            required: ["audio_path"],
          },
        },
        {
          name: "ollama_token_stats",
          description: "View token usage statistics and estimated cost savings from using local Ollama models instead of Claude API.",
          inputSchema: {
            type: "object",
            properties: {
              period: {
                type: "string",
                description: "Time period: 'all', 'today', 'week', or 'month'",
                default: "all",
              },
              reset: {
                type: "boolean",
                description: "Set to true to reset all stats",
                default: false,
              },
            },
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case "ollama_generate_code":
            return await this.generateCode(args);
          case "ollama_explain_code":
            return await this.explainCode(args);
          case "ollama_review_code":
            return await this.reviewCode(args);
          case "ollama_refactor_code":
            return await this.refactorCode(args);
          case "ollama_fix_code":
            return await this.fixCode(args);
          case "ollama_write_tests":
            return await this.writeTests(args);
          case "ollama_general_task":
            return await this.generalTask(args);
          case "ollama_review_file":
            return await this.reviewFile(args);
          case "ollama_explain_file":
            return await this.explainFile(args);
          case "ollama_analyze_files":
            return await this.analyzeFiles(args);
          case "ollama_generate_code_with_context":
            return await this.generateCodeWithContext(args);
          case "ollama_analyze_image":
            return await this.analyzeImage(args);
          case "ollama_transcribe_audio":
            return await this.transcribeAudio(args);
          case "ollama_token_stats":
            return await this.getTokenStats(args);
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${error.message}`,
            },
          ],
        };
      }
    });
  }

  async callOllama(prompt, model = DEFAULT_MODEL, toolName = "unknown") {
    try {
      const response = await axios.post(
        `${OLLAMA_BASE_URL}/api/generate`,
        {
          model: model,
          prompt: prompt,
          stream: true,
        },
        {
          timeout: 900000,
          responseType: "stream",
        }
      );

      let fullText = "";
      let finalStats = {};

      const result = await new Promise((resolve, reject) => {
        let buffer = "";

        response.data.on("data", (chunk) => {
          buffer += chunk.toString();
          const lines = buffer.split("\n");
          buffer = lines.pop(); // keep incomplete line in buffer

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const parsed = JSON.parse(line);
              if (parsed.response) {
                fullText += parsed.response;
              }
              if (parsed.done) {
                finalStats = parsed;
              }
            } catch {
              // skip malformed JSON chunks
            }
          }
        });

        response.data.on("end", () => {
          // process any remaining buffer
          if (buffer.trim()) {
            try {
              const parsed = JSON.parse(buffer);
              if (parsed.response) fullText += parsed.response;
              if (parsed.done) finalStats = parsed;
            } catch {}
          }
          resolve();
        });

        response.data.on("error", reject);
      });

      const inputTokens = finalStats.prompt_eval_count || 0;
      const outputTokens = finalStats.eval_count || 0;
      const durationMs = Math.round((finalStats.total_duration || 0) / 1_000_000);

      await this.recordUsage(toolName, model, inputTokens, outputTokens, durationMs);

      const savings = this.calculateSavings(inputTokens, outputTokens);
      const opusSaved = savings["claude-opus-4-6"].total;

      return {
        text: fullText,
        tokenInfo: `\n\n---\n📊 Tokens: ${inputTokens.toLocaleString()} in / ${outputTokens.toLocaleString()} out | Est. savings vs Opus: $${opusSaved.toFixed(4)}`,
      };
    } catch (error) {
      if (error.code === "ECONNREFUSED") {
        throw new Error(
          "Cannot connect to Ollama. Make sure Ollama is running on localhost:11434"
        );
      }
      throw new Error(`Ollama error: ${error.message}`);
    }
  }

  async generateCode(args) {
    const { prompt, language, model } = args;
    const fullPrompt = `You are a code generation assistant. Generate clean, well-commented ${language} code based on the following requirements:

${prompt}

Respond with ONLY the code, no explanations or markdown formatting. Make sure the code is production-ready and follows best practices.`;

    const result = await this.callOllama(fullPrompt, model, "ollama_generate_code");

    return {
      content: [
        {
          type: "text",
          text: result.text + result.tokenInfo,
        },
      ],
    };
  }

  async explainCode(args) {
    const { code, context, model } = args;
    const fullPrompt = `You are a code explanation assistant. Explain the following code in detail:

${code}

${context ? `Context: ${context}` : ""}

Provide a clear, comprehensive explanation of what this code does, how it works, and any important patterns or considerations.`;

    const result = await this.callOllama(fullPrompt, model, "ollama_explain_code");

    return {
      content: [
        {
          type: "text",
          text: result.text + result.tokenInfo,
        },
      ],
    };
  }

  async reviewCode(args) {
    const { code, focus, model } = args;
    const fullPrompt = `You are a code review assistant. Review the following code with focus on ${focus}:

${code}

Provide specific, actionable feedback including:
1. Issues or bugs found
2. Potential improvements
3. Best practice violations
4. Security concerns (if applicable)

Be concise and specific.`;

    const result = await this.callOllama(fullPrompt, model, "ollama_review_code");

    return {
      content: [
        {
          type: "text",
          text: result.text + result.tokenInfo,
        },
      ],
    };
  }

  async refactorCode(args) {
    const { code, goal, model } = args;
    const fullPrompt = `You are a code refactoring assistant. Refactor the following code with the goal to ${goal}:

${code}

Provide the refactored code with a brief explanation of the changes made. Format your response as:

REFACTORED CODE:
[code here]

CHANGES MADE:
[brief explanation]`;

    const result = await this.callOllama(fullPrompt, model, "ollama_refactor_code");

    return {
      content: [
        {
          type: "text",
          text: result.text + result.tokenInfo,
        },
      ],
    };
  }

  async fixCode(args) {
    const { code, error, model } = args;
    const fullPrompt = `You are a debugging assistant. Fix the following code that has this error:

ERROR: ${error}

CODE:
${code}

Provide the fixed code with a brief explanation of what was wrong and how you fixed it. Format your response as:

FIXED CODE:
[code here]

EXPLANATION:
[brief explanation of the fix]`;

    const result = await this.callOllama(fullPrompt, model, "ollama_fix_code");

    return {
      content: [
        {
          type: "text",
          text: result.text + result.tokenInfo,
        },
      ],
    };
  }

  async writeTests(args) {
    const { code, framework, model } = args;
    const fullPrompt = `You are a test writing assistant. Write comprehensive unit tests for the following code using ${framework}:

${code}

Generate complete, runnable tests with good coverage of different scenarios including edge cases. Include only the test code, properly formatted for ${framework}.`;

    const result = await this.callOllama(fullPrompt, model, "ollama_write_tests");

    return {
      content: [
        {
          type: "text",
          text: result.text + result.tokenInfo,
        },
      ],
    };
  }

  async generalTask(args) {
    const { task, context, model } = args;
    const fullPrompt = `You are a coding assistant. Complete the following task:

TASK: ${task}

${context ? `CONTEXT:\n${context}` : ""}

Provide a clear, complete response.`;

    const result = await this.callOllama(fullPrompt, model, "ollama_general_task");

    return {
      content: [
        {
          type: "text",
          text: result.text + result.tokenInfo,
        },
      ],
    };
  }

  async readFile(filePath) {
    try {
      const content = await fs.readFile(filePath, "utf-8");
      return content;
    } catch (error) {
      throw new Error(`Failed to read file ${filePath}: ${error.message}`);
    }
  }

  async reviewFile(args) {
    const { file_path, focus, model } = args;
    const code = await this.readFile(file_path);
    const fileName = path.basename(file_path);

    const fullPrompt = `You are a code review assistant. Review the following file with focus on ${focus}:

FILE: ${fileName}
PATH: ${file_path}

CODE:
${code}

Provide specific, actionable feedback including:
1. Issues or bugs found
2. Potential improvements
3. Best practice violations
4. Security concerns (if applicable)

Be concise and specific.`;

    const result = await this.callOllama(fullPrompt, model, "ollama_review_file");

    return {
      content: [
        {
          type: "text",
          text: result.text + result.tokenInfo,
        },
      ],
    };
  }

  async explainFile(args) {
    const { file_path, context, model } = args;
    const code = await this.readFile(file_path);
    const fileName = path.basename(file_path);

    const fullPrompt = `You are a code explanation assistant. Explain the following file in detail:

FILE: ${fileName}
PATH: ${file_path}

CODE:
${code}

${context ? `Context: ${context}` : ""}

Provide a clear, comprehensive explanation of what this file does, how it works, and any important patterns or considerations.`;

    const result = await this.callOllama(fullPrompt, model, "ollama_explain_file");

    return {
      content: [
        {
          type: "text",
          text: result.text + result.tokenInfo,
        },
      ],
    };
  }

  async analyzeFiles(args) {
    const { file_paths, task, model } = args;

    const filesContent = await Promise.all(
      file_paths.map(async (filePath) => {
        const content = await this.readFile(filePath);
        const fileName = path.basename(filePath);
        return `FILE: ${fileName}\nPATH: ${filePath}\n\nCODE:\n${content}\n\n${"=".repeat(80)}\n`;
      })
    );

    const fullPrompt = `You are a code analysis assistant. Analyze the following files together:

TASK: ${task}

${filesContent.join("\n")}

Provide a comprehensive analysis addressing the task. Focus on relationships, patterns, and insights across all files.`;

    const result = await this.callOllama(fullPrompt, model, "ollama_analyze_files");

    return {
      content: [
        {
          type: "text",
          text: result.text + result.tokenInfo,
        },
      ],
    };
  }

  async generateCodeWithContext(args) {
    const { prompt, language, context_files, model } = args;

    let contextSection = "";
    if (context_files && context_files.length > 0) {
      const contextContent = await Promise.all(
        context_files.map(async (filePath) => {
          const content = await this.readFile(filePath);
          const fileName = path.basename(filePath);
          return `EXAMPLE FILE: ${fileName}\n${content}\n\n${"=".repeat(80)}\n`;
        })
      );
      contextSection = `\n\nREFERENCE FILES (for context and patterns):\n${contextContent.join("\n")}`;
    }

    const fullPrompt = `You are a code generation assistant. Generate clean, well-commented ${language} code based on the following requirements:

REQUIREMENTS:
${prompt}
${contextSection}

Respond with ONLY the code, no explanations or markdown formatting. Make sure the code is production-ready and follows best practices shown in the reference files.`;

    const result = await this.callOllama(fullPrompt, model, "ollama_generate_code_with_context");

    return {
      content: [
        {
          type: "text",
          text: result.text + result.tokenInfo,
        },
      ],
    };
  }

  async callOllamaVision(prompt, images, model = DEFAULT_VISION_MODEL, toolName = "unknown") {
    try {
      const response = await axios.post(
        `${OLLAMA_BASE_URL}/api/generate`,
        {
          model: model,
          prompt: prompt,
          images: images,
          stream: true,
        },
        {
          timeout: 900000,
          responseType: "stream",
        }
      );

      let fullText = "";
      let finalStats = {};

      await new Promise((resolve, reject) => {
        let buffer = "";

        response.data.on("data", (chunk) => {
          buffer += chunk.toString();
          const lines = buffer.split("\n");
          buffer = lines.pop();

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const parsed = JSON.parse(line);
              if (parsed.response) {
                fullText += parsed.response;
              }
              if (parsed.done) {
                finalStats = parsed;
              }
            } catch {
              // skip malformed JSON chunks
            }
          }
        });

        response.data.on("end", () => {
          if (buffer.trim()) {
            try {
              const parsed = JSON.parse(buffer);
              if (parsed.response) fullText += parsed.response;
              if (parsed.done) finalStats = parsed;
            } catch {}
          }
          resolve();
        });

        response.data.on("error", reject);
      });

      const inputTokens = finalStats.prompt_eval_count || 0;
      const outputTokens = finalStats.eval_count || 0;
      const durationMs = Math.round((finalStats.total_duration || 0) / 1_000_000);

      await this.recordUsage(toolName, model, inputTokens, outputTokens, durationMs);

      const savings = this.calculateSavings(inputTokens, outputTokens);
      const opusSaved = savings["claude-opus-4-6"].total;

      return {
        text: fullText,
        tokenInfo: `\n\n---\n📊 Tokens: ${inputTokens.toLocaleString()} in / ${outputTokens.toLocaleString()} out | Est. savings vs Opus: $${opusSaved.toFixed(4)}`,
      };
    } catch (error) {
      if (error.code === "ECONNREFUSED") {
        throw new Error(
          "Cannot connect to Ollama. Make sure Ollama is running on localhost:11434"
        );
      }
      throw new Error(`Ollama vision error: ${error.message}`);
    }
  }

  async analyzeImage(args) {
    const { image_path, prompt, model } = args;

    const imageBuffer = await fs.readFile(image_path);
    const base64String = imageBuffer.toString("base64");

    const fullPrompt = `You are a UI/visual analysis assistant. Analyze the following image and respond to this request:

${prompt}

Be specific and detailed about what you observe. If this is a UI screenshot, mention layout, colors, text content, errors, and any visual issues.`;

    const result = await this.callOllamaVision(
      fullPrompt,
      [base64String],
      model || DEFAULT_VISION_MODEL,
      "ollama_analyze_image"
    );

    return {
      content: [
        {
          type: "text",
          text: result.text + result.tokenInfo,
        },
      ],
    };
  }

  async transcribeAudio(args) {
    const { audio_path, language = "en", model = DEFAULT_WHISPER_MODEL } = args;

    const { execFile } = await import("child_process");
    const execFileAsync = (cmd, cmdArgs) =>
      new Promise((resolve, reject) => {
        execFile(cmd, cmdArgs, { timeout: 300000 }, (err, stdout, stderr) => {
          if (err) reject(err);
          else resolve({ stdout, stderr });
        });
      });

    const startTime = Date.now();
    const audioDir = path.dirname(audio_path);
    const audioStem = path.basename(audio_path, path.extname(audio_path));
    const outputPath = path.join(audioDir, audioStem + ".txt");

    try {
      await execFileAsync("/Library/Developer/CommandLineTools/usr/bin/python3", [
        "-m",
        "mlx_whisper",
        audio_path,
        "--model",
        model,
        "--language",
        language,
        "--output-format",
        "txt",
        "--output-dir",
        audioDir,
      ]);

      const transcribedText = await fs.readFile(outputPath, "utf-8");

      // Clean up output file
      try { await fs.unlink(outputPath); } catch {}

      const durationMs = Date.now() - startTime;
      await this.recordUsage("ollama_transcribe_audio", model, 0, 0, durationMs);

      return {
        content: [
          {
            type: "text",
            text: transcribedText.trim() +
              `\n\n---\n🎤 Transcription complete | Duration: ${(durationMs / 1000).toFixed(1)}s | Model: ${model}`,
          },
        ],
      };
    } catch (error) {
      try { await fs.unlink(outputPath); } catch {}
      throw new Error(`Transcription failed: ${error.message}. Make sure mlx-whisper is installed: pip install mlx-whisper`);
    }
  }

  async getTokenStats(args) {
    if (!this.stats) await this.loadStats();

    const { period = "all", reset = false } = args || {};

    if (reset) {
      this.stats = {
        total_input_tokens: 0,
        total_output_tokens: 0,
        total_calls: 0,
        total_duration_ms: 0,
        by_tool: {},
        by_model: {},
        daily: {},
        history: [],
      };
      await this.saveStats();
      return {
        content: [{ type: "text", text: "All token stats have been reset." }],
      };
    }

    let inputTokens, outputTokens, calls;

    if (period === "today") {
      const today = new Date().toISOString().split("T")[0];
      const todayStats = this.stats.daily[today] || { input_tokens: 0, output_tokens: 0, calls: 0 };
      inputTokens = todayStats.input_tokens;
      outputTokens = todayStats.output_tokens;
      calls = todayStats.calls;
    } else if (period === "week" || period === "month") {
      const now = new Date();
      const daysBack = period === "week" ? 7 : 30;
      inputTokens = 0;
      outputTokens = 0;
      calls = 0;
      for (const [date, dayStats] of Object.entries(this.stats.daily)) {
        const d = new Date(date);
        const diffDays = (now - d) / (1000 * 60 * 60 * 24);
        if (diffDays <= daysBack) {
          inputTokens += dayStats.input_tokens;
          outputTokens += dayStats.output_tokens;
          calls += dayStats.calls;
        }
      }
    } else {
      inputTokens = this.stats.total_input_tokens;
      outputTokens = this.stats.total_output_tokens;
      calls = this.stats.total_calls;
    }

    const totalTokens = inputTokens + outputTokens;
    const savings = this.calculateSavings(inputTokens, outputTokens);

    let report = `# Ollama Token Usage Stats (${period})\n\n`;
    report += `| Metric | Value |\n|--------|-------|\n`;
    report += `| Total calls | ${calls.toLocaleString()} |\n`;
    report += `| Input tokens | ${inputTokens.toLocaleString()} |\n`;
    report += `| Output tokens | ${outputTokens.toLocaleString()} |\n`;
    report += `| Total tokens | ${totalTokens.toLocaleString()} |\n\n`;

    report += `## Estimated Cost Savings\n\n`;
    report += `| If this were... | Input cost | Output cost | Total saved |\n`;
    report += `|-----------------|-----------|-------------|-------------|\n`;
    for (const [model, cost] of Object.entries(savings)) {
      report += `| ${model} | $${cost.input_cost.toFixed(4)} | $${cost.output_cost.toFixed(4)} | **$${cost.total.toFixed(4)}** |\n`;
    }

    if (period === "all" && Object.keys(this.stats.by_tool).length > 0) {
      report += `\n## By Tool\n\n`;
      report += `| Tool | Calls | Input | Output |\n`;
      report += `|------|-------|-------|--------|\n`;
      for (const [tool, ts] of Object.entries(this.stats.by_tool)) {
        report += `| ${tool.replace("ollama_", "")} | ${ts.calls} | ${ts.input_tokens.toLocaleString()} | ${ts.output_tokens.toLocaleString()} |\n`;
      }
    }

    if (period === "all" && Object.keys(this.stats.by_model).length > 0) {
      report += `\n## By Model\n\n`;
      report += `| Model | Calls | Input | Output |\n`;
      report += `|-------|-------|-------|--------|\n`;
      for (const [m, ms] of Object.entries(this.stats.by_model)) {
        report += `| ${m} | ${ms.calls} | ${ms.input_tokens.toLocaleString()} | ${ms.output_tokens.toLocaleString()} |\n`;
      }
    }

    // Show last 7 days if available
    const dailyEntries = Object.entries(this.stats.daily).sort().slice(-7);
    if (dailyEntries.length > 0) {
      report += `\n## Recent Daily Usage\n\n`;
      report += `| Date | Calls | Tokens |\n`;
      report += `|------|-------|--------|\n`;
      for (const [date, ds] of dailyEntries) {
        report += `| ${date} | ${ds.calls} | ${(ds.input_tokens + ds.output_tokens).toLocaleString()} |\n`;
      }
    }

    return {
      content: [{ type: "text", text: report }],
    };
  }

  async run() {
    await this.loadStats();
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Ollama MCP server running on stdio");
  }
}

const server = new OllamaServer();
server.run();
