import * as vscode from 'vscode';
import type { CommitMessageContext } from '@git4vsc/git-core';
import { buildCommitPrompt, cleanGeneratedCommitMessage } from './ai-commit-prompt.js';

export type AiLanguage = 'system' | 'zh' | 'en';

export interface AiSettings {
  baseUrl: string;
  model: string;
  language: AiLanguage;
  commitPrompt: string;
  hasApiKey: boolean;
}

export interface AiSettingsInput {
  baseUrl: string;
  model: string;
  language: AiLanguage;
  commitPrompt: string;
  apiKey: string;
}

const secretKey = 'git4vsc.ai.apiKey';
const settingsChanged = new vscode.EventEmitter<void>();
export const onDidChangeAiSettings = settingsChanged.event;

export class AiRequestCancelledError extends Error {
  constructor() {
    super('AI request cancelled.');
    this.name = 'AiRequestCancelledError';
  }
}

export async function readAiSettings(context: vscode.ExtensionContext): Promise<AiSettings> {
  const configuration = vscode.workspace.getConfiguration('git4vsc.ai');
  return {
    baseUrl: configuration.get<string>('baseUrl', ''),
    model: configuration.get<string>('model', ''),
    language: configuration.get<AiLanguage>('language', 'system'),
    commitPrompt: configuration.get<string>('commitPrompt', ''),
    hasApiKey: Boolean(await context.secrets.get(secretKey))
  };
}

export function validAiSettings(value: unknown): value is AiSettingsInput {
  if (!value || typeof value !== 'object') return false;
  const settings = value as Record<string, unknown>;
  return typeof settings.baseUrl === 'string'
    && typeof settings.model === 'string'
    && (settings.language === 'system' || settings.language === 'zh' || settings.language === 'en')
    && typeof settings.commitPrompt === 'string'
    && typeof settings.apiKey === 'string';
}

export async function saveAiSettings(context: vscode.ExtensionContext, input: AiSettingsInput): Promise<void> {
  const configuration = vscode.workspace.getConfiguration('git4vsc.ai');
  await Promise.all([
    configuration.update('baseUrl', input.baseUrl.trim(), vscode.ConfigurationTarget.Global),
    configuration.update('model', input.model.trim(), vscode.ConfigurationTarget.Global),
    configuration.update('language', input.language, vscode.ConfigurationTarget.Global),
    configuration.update('commitPrompt', input.commitPrompt.trim(), vscode.ConfigurationTarget.Global)
  ]);
  if (input.apiKey.trim()) await context.secrets.store(secretKey, input.apiKey.trim());
  settingsChanged.fire();
}

export async function clearAiApiKey(context: vscode.ExtensionContext): Promise<void> {
  await context.secrets.delete(secretKey);
  settingsChanged.fire();
}

export async function aiIsConfigured(context: vscode.ExtensionContext): Promise<boolean> {
  const settings = await readAiSettings(context);
  return Boolean(settings.baseUrl.trim() && settings.model.trim() && settings.hasApiKey);
}

export async function generateAiCommitMessage(context: vscode.ExtensionContext, repository: string, branch: string, changes: CommitMessageContext, signal: AbortSignal): Promise<string> {
  const settings = await readAiSettings(context);
  const apiKey = await resolveApiKey(context, '');
  if (!settings.baseUrl.trim() || !settings.model.trim()) throw new Error('Configure the AI Base URL and commit model in Git4VSC Settings.');
  const response = await request(aiEndpoint(settings.baseUrl, 'chat'), apiKey, {
    model: settings.model,
    messages: [
      { role: 'system', content: 'You write accurate, concise Git commit messages. Follow the requested repository style and return only the commit message.' },
      { role: 'user', content: buildCommitPrompt({ repository, branch, context: changes, language: aiLanguage(settings.language), instructions: settings.commitPrompt }) }
    ],
    max_tokens: 500,
    temperature: 0.2
  }, signal, 60_000);
  const body = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
  const content = body.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new Error('The AI service returned an empty commit message.');
  return cleanGeneratedCommitMessage(content);
}

export async function listAiModels(context: vscode.ExtensionContext, input: AiSettingsInput): Promise<string[]> {
  const apiKey = await resolveApiKey(context, input.apiKey);
  const response = await request(aiEndpoint(input.baseUrl, 'models'), apiKey);
  const body = await response.json() as { data?: Array<{ id?: unknown }> };
  return (body.data ?? []).map(item => item.id).filter((id): id is string => typeof id === 'string').sort();
}

export async function testAiConnection(context: vscode.ExtensionContext, input: AiSettingsInput): Promise<void> {
  const apiKey = await resolveApiKey(context, input.apiKey);
  if (!input.model.trim()) {
    await request(aiEndpoint(input.baseUrl, 'models'), apiKey);
    return;
  }
  await request(aiEndpoint(input.baseUrl, 'chat'), apiKey, {
    model: input.model.trim(),
    messages: [{ role: 'user', content: 'Reply with OK.' }],
    max_tokens: 8,
    temperature: 0
  });
}

export function aiEndpoint(baseUrl: string, kind: 'chat' | 'models'): string {
  const value = baseUrl.trim().replace(/\/+$/, '');
  if (!value) throw new Error('Enter an API base URL.');
  if (/\/chat\/completions$/i.test(value)) return kind === 'chat' ? value : value.replace(/\/chat\/completions$/i, '/models');
  if (/\/models$/i.test(value)) return kind === 'models' ? value : value.replace(/\/models$/i, '/chat/completions');
  return `${value}/${kind === 'chat' ? 'chat/completions' : 'models'}`;
}

async function resolveApiKey(context: vscode.ExtensionContext, value: string): Promise<string> {
  const apiKey = value.trim() || await context.secrets.get(secretKey);
  if (!apiKey) throw new Error('Enter an API key.');
  return apiKey;
}

function aiLanguage(language: AiLanguage): string {
  if (language === 'zh') return 'Chinese';
  if (language === 'en') return 'English';
  return vscode.env.language;
}

async function request(url: string, apiKey: string, body?: object, signal?: AbortSignal, timeoutMs = 15_000): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort();
  if (signal?.aborted) cancel();
  else signal?.addEventListener('abort', cancel, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${apiKey}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal
    });
    if (!response.ok) {
      const text = (await response.text()).slice(0, 500);
      throw new Error(`AI service returned ${response.status}${text ? `: ${text}` : ''}`);
    }
    return response;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      if (signal?.aborted && !timedOut) throw new AiRequestCancelledError();
      throw new Error('AI service request timed out.', { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', cancel);
  }
}
