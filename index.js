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

const OLLAMA_BASE_URL = "http://localhost:11434";

// Available models - you can customize this
const DEFAULT_MODEL = "gemma3:14b";
const FALLBACK_MODEL = "gemma3:4b";

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

    this.setupToolHandlers();

    this.server.onerror = (error) => console.error("[MCP Error]", error);
    process.on("SIGINT", async () => {
      await this.server.close();
      process.exit(0);
    });
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

  async callOllama(prompt, model = DEFAULT_MODEL) {
    try {
      const response = await axios.post(
        `${OLLAMA_BASE_URL}/api/generate`,
        {
          model: model,
          prompt: prompt,
          stream: false,
        },
        {
          timeout: 900000, // 15 minute timeout (overly long, to account for slow local models)
        }
      );

      return response.data.response;
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

    const response = await this.callOllama(fullPrompt, model);

    return {
      content: [
        {
          type: "text",
          text: response,
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

    const response = await this.callOllama(fullPrompt, model);

    return {
      content: [
        {
          type: "text",
          text: response,
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

    const response = await this.callOllama(fullPrompt, model);

    return {
      content: [
        {
          type: "text",
          text: response,
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

    const response = await this.callOllama(fullPrompt, model);

    return {
      content: [
        {
          type: "text",
          text: response,
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

    const response = await this.callOllama(fullPrompt, model);

    return {
      content: [
        {
          type: "text",
          text: response,
        },
      ],
    };
  }

  async writeTests(args) {
    const { code, framework, model } = args;
    const fullPrompt = `You are a test writing assistant. Write comprehensive unit tests for the following code using ${framework}:

${code}

Generate complete, runnable tests with good coverage of different scenarios including edge cases. Include only the test code, properly formatted for ${framework}.`;

    const response = await this.callOllama(fullPrompt, model);

    return {
      content: [
        {
          type: "text",
          text: response,
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

    const response = await this.callOllama(fullPrompt, model);

    return {
      content: [
        {
          type: "text",
          text: response,
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

    const response = await this.callOllama(fullPrompt, model);

    return {
      content: [
        {
          type: "text",
          text: response,
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

    const response = await this.callOllama(fullPrompt, model);

    return {
      content: [
        {
          type: "text",
          text: response,
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

    const response = await this.callOllama(fullPrompt, model);

    return {
      content: [
        {
          type: "text",
          text: response,
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

    const response = await this.callOllama(fullPrompt, model);

    return {
      content: [
        {
          type: "text",
          text: response,
        },
      ],
    };
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Ollama MCP server running on stdio");
  }
}

const server = new OllamaServer();
server.run();
