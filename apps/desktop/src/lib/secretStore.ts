import * as api from '../api';

const OPENAI_KEY_ID = '__openai_api_key__';

function normalizeKey(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function getOpenAIKey(): Promise<string | null> {
  const key = await api.keychainGet(OPENAI_KEY_ID);
  return normalizeKey(key);
}

export async function setOpenAIKey(key: string): Promise<void> {
  const normalized = normalizeKey(key);
  if (!normalized) {
    throw new Error('OpenAI API key cannot be empty.');
  }
  await api.keychainSet(OPENAI_KEY_ID, normalized);
}

export async function clearOpenAIKey(): Promise<void> {
  await api.keychainDelete(OPENAI_KEY_ID);
}

export async function testOpenAIKey(key?: string): Promise<{ ok: boolean; message: string }> {
  const normalized = normalizeKey(key);
  return api.settingsTestOpenAiKey(normalized ?? null);
}
