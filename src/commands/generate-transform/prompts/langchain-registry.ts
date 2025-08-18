import { PromptTemplate, ChatPromptTemplate } from '@langchain/core/prompts';
import { promises as fs } from 'fs';
import path from 'path';

export type PromptKey =
  | 'system-rules'
  | 'owner-analysis'
  | 'structure-generator'
  | 'structure-evaluator'
  | 'extraction-generator'
  | 'extraction-evaluator';

/**
 * Registry for managing LangChain prompt templates
 * Loads prompts from markdown files and converts them to LangChain templates
 */
class PromptRegistry {
  private cache = new Map<PromptKey, PromptTemplate>();
  private chatCache = new Map<string, ChatPromptTemplate>();
  private basePath: string;

  constructor() {
    this.basePath = path.dirname(new URL(import.meta.url).pathname);
  }

  /**
   * Get a basic PromptTemplate for the given key
   * Templates are cached after first load
   */
  async getPromptTemplate(key: PromptKey): Promise<PromptTemplate> {
    if (this.cache.has(key)) {
      return this.cache.get(key)!;
    }

    const content = await this.loadPromptContent(key);
    // Convert {{variable}} syntax to {variable} for LangChain
    // and escape literal braces
    const langchainContent = this.convertToLangChainSyntax(content);
    const template = PromptTemplate.fromTemplate(langchainContent);
    this.cache.set(key, template);

    return template;
  }

  /**
   * Get a ChatPromptTemplate for agent use
   * Includes system message, human input, and agent scratchpad
   */
  async getChatPromptTemplate(
    key: PromptKey,
    includeHuman = true,
    includeScratchpad = true
  ): Promise<ChatPromptTemplate> {
    const cacheKey = `${key}-${includeHuman}-${includeScratchpad}`;

    if (this.chatCache.has(cacheKey)) {
      return this.chatCache.get(cacheKey)!;
    }

    const systemTemplate = await this.getPromptTemplate(key);

    // Build message list with proper types
    const messages: any[] = [['system', systemTemplate.template]];

    if (includeHuman) {
      messages.push(['human', '{input}']);
    }

    if (includeScratchpad) {
      // Use MessagesPlaceholder for agent scratchpad
      messages.push(['placeholder', '{agent_scratchpad}']);
    }

    const chatTemplate = ChatPromptTemplate.fromMessages(messages);
    this.chatCache.set(cacheKey, chatTemplate);

    return chatTemplate;
  }

  /**
   * Load prompt content from file
   */
  private async loadPromptContent(key: PromptKey): Promise<string> {
    const file = path.join(this.basePath, `${key}.md`);
    return fs.readFile(file, 'utf-8');
  }

  /**
   * Convert {{variable}} syntax to {variable} for LangChain
   * Also escape literal braces that are not template variables
   */
  private convertToLangChainSyntax(content: string): string {
    // Protect template variables before escaping other braces.
    // Support both {{ var }} and {var} syntaxes.
    const placeholder = '___TEMPLATE_VAR___';
    const templateVars: string[] = [];

    // 1) Capture double-brace variables: {{ var }}
    let tempContent = content.replace(
      /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g,
      (_m, varName) => {
        templateVars.push(varName);
        return `${placeholder}${templateVars.length - 1}${placeholder}`;
      }
    );

    // 2) Capture single-brace variables: {var}
    // Limit to safe identifiers to avoid JSON examples like {"key": "value"}
    // We only replace when the token is exactly {identifier} (letters, numbers, underscore)
    tempContent = tempContent.replace(
      /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g,
      (_m, varName) => {
        templateVars.push(varName);
        return `${placeholder}${templateVars.length - 1}${placeholder}`;
      }
    );

    // 3) Escape remaining braces so JSON examples are preserved literally
    tempContent = tempContent.replace(/\{/g, '{{');
    tempContent = tempContent.replace(/\}/g, '}}');

    // 4) Restore template variables with single braces
    templateVars.forEach((varName, index) => {
      const pattern = new RegExp(`${placeholder}${index}${placeholder}`, 'g');
      tempContent = tempContent.replace(pattern, `{${varName}}`);
    });

    return tempContent;
  }

  /**
   * Clear all caches
   */
  clearCache(): void {
    this.cache.clear();
    this.chatCache.clear();
  }
}

// Export singleton instance
export const promptRegistry = new PromptRegistry();
