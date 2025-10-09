import type { Span as OTelSpan } from '@opentelemetry/sdk-trace-base';

const registerMock = jest.fn();
const unregisterMock = jest.fn();
const createAndRegisterMock = jest.fn();

jest.mock('mlflow-tracing', () => ({
  registerOnSpanStartHook: registerMock,
  unregisterOnSpanStartHook: unregisterMock
}));

jest.mock('@mlflow/core/src/core/api', () => ({
  createAndRegisterMlflowSpan: createAndRegisterMock
}));

jest.mock('@mlflow/core/src/core/constants', () => ({
  SpanType: { LLM: 'LLM' }
}));

describe('mlflow-vercel span processor hook', () => {
  beforeEach(() => {
    jest.resetModules();
    registerMock.mockClear();
    unregisterMock.mockClear();
    createAndRegisterMock.mockClear();
  });

  it('registers a start hook that handles Vercel AI spans', async () => {
    const module = await import('../src');

    expect(registerMock).toHaveBeenCalledTimes(1);
    const hook = registerMock.mock.calls[0][0] as (span: OTelSpan) => void;

    const span = {
      attributes: {
        'ai.operationId': 'op-123',
        'ai.prompt': 'Hello world'
      }
    } as unknown as OTelSpan;

    hook(span, {} as any);

    expect(createAndRegisterMock).toHaveBeenCalledWith(span, 'LLM', { prompt: 'Hello world' });

    module.unregisterVercelSpanProcessorHook();
    expect(unregisterMock).toHaveBeenCalledTimes(1);
  });

  it('ignores spans without Vercel AI attributes', async () => {
    await import('../src');
    const hook = registerMock.mock.calls[0][0] as (span: OTelSpan) => void;

    hook({ attributes: {} } as unknown as OTelSpan, {} as any);

    expect(createAndRegisterMock).not.toHaveBeenCalled();
  });
});
