import { describe, expect, it, vi } from 'vitest';
import { RemoteTranscriptionClient } from './remoteTranscriptionClient';

/**
 * A stand-in for React Native's FormData.
 *
 * Node's spec-compliant FormData stringifies anything that is not a Blob, whereas
 * React Native's keeps the `{ uri, name, type }` object and lets the native
 * networking layer stream the file from disk. That difference is the entire reason
 * the client takes a `formDataImpl`, and the reason this double exists.
 */
interface RnFileEntry {
  uri: string;
  name: string;
  type: string;
}

class RecordingFormData {
  readonly entries: { field: string; value: RnFileEntry }[] = [];
  append(field: string, value: unknown): void {
    this.entries.push({ field, value: value as RnFileEntry });
  }
}

function clientReturning(body: unknown, status = 200) {
  const fetchImpl = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);

  const forms: RecordingFormData[] = [];

  return {
    fetchImpl,
    forms,
    client: new RemoteTranscriptionClient({
      endpoint: 'https://example.invalid/api/transcribe',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      formDataImpl: () => {
        const form = new RecordingFormData();
        forms.push(form);
        return form as unknown as FormData;
      },
    }),
  };
}

const file = { uri: 'file:///clip.mp4', mediaType: 'video/mp4' };

describe('RemoteTranscriptionClient', () => {
  it('uploads the file as multipart and carries no credential', async () => {
    const { client, fetchImpl } = clientReturning({ status: 'no_speech' });
    await client.transcribeFile(file);

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://example.invalid/api/transcribe');
    expect((init as RequestInit).body).toBeDefined();

    // The runtime must set the multipart boundary itself; setting Content-Type by
    // hand produces a body the server cannot parse.
    expect((init as RequestInit).headers).toBeUndefined();

    // No key ever reaches the device.
    const serialized = JSON.stringify(init ?? {}).toLowerCase();
    expect(serialized).not.toContain('authorization');
    expect(serialized).not.toContain('deepgram');
  });

  it('streams the file by reference rather than reading it into memory', async () => {
    // A minute of phone video is tens of megabytes; base64 in a JSON body would
    // inflate it by a third and risk an out-of-memory crash on a mid-range device.
    const { client, forms } = clientReturning({ status: 'no_speech' });
    await client.transcribeFile(file);

    const entry = forms[0]?.entries[0];
    expect(entry?.field).toBe('file');
    expect(entry?.value.uri).toBe('file:///clip.mp4');
    expect(entry?.value.type).toBe('video/mp4');
    expect(entry?.value.name).toBe('upload.mp4');
  });

  it('passes a transcript through', async () => {
    const { client } = clientReturning({
      status: 'ok',
      transcript: { text: 'Three rounds.', utterances: [], confidence: 0.9 },
    });
    expect((await client.transcribeFile(file)).status).toBe('ok');
  });

  it('marks server errors retryable and client errors not', async () => {
    expect(await clientReturning({}, 503).client.transcribeFile(file)).toMatchObject({ retryable: true });
    expect(await clientReturning({}, 413).client.transcribeFile(file)).toMatchObject({ retryable: false });
  });

  it('rejects an envelope it does not recognise', async () => {
    expect(await clientReturning({ nope: 1 }).client.transcribeFile(file)).toMatchObject({
      status: 'failed',
      retryable: true,
    });
  });

  it('surfaces a network failure rather than throwing', async () => {
    const client = new RemoteTranscriptionClient({
      endpoint: 'https://example.invalid/api/transcribe',
      fetchImpl: (() => Promise.reject(new Error('down'))) as unknown as typeof fetch,
    });
    expect(await client.transcribeFile(file)).toMatchObject({ status: 'failed', retryable: true });
  });

  it('names a .mov upload correctly', async () => {
    const { client, forms } = clientReturning({ status: 'no_speech' });
    await client.transcribeFile({ uri: 'file:///clip.mov', mediaType: 'video/quicktime' });

    expect(forms[0]?.entries[0]?.value.name).toBe('upload.mov');
  });
});
