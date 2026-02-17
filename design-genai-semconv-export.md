# Design Doc: Export MLflow Traces in OpenTelemetry GenAI Semantic Convention Format

**Status:** Draft — Exploration
**Author:** MLflow Team
**Date:** 2025-02

---

## 1. Problem Statement

MLflow captures rich LLM tracing data through its auto-instrumentation of libraries like OpenAI, Anthropic, LangChain, and others. Today, when MLflow exports traces via OTLP to external OpenTelemetry collectors (Jaeger, Grafana Tempo, Datadog, etc.), it sends spans with **MLflow-proprietary attribute keys** (`mlflow.spanInputs`, `mlflow.chat.tokenUsage`, `mlflow.spanType`, etc.). These attributes are opaque to downstream systems that expect the emerging **OpenTelemetry GenAI Semantic Conventions** (`gen_ai.usage.input_tokens`, `gen_ai.operation.name`, `gen_ai.input.messages`, etc.).

This means:
- Downstream OTel-native dashboards and tools cannot interpret MLflow-exported LLM spans.
- Users who want a vendor-neutral observability pipeline cannot use MLflow as the instrumentation source.
- The growing ecosystem of GenAI semconv-aware tools (OpenLIT, Traceloop, Langtrace, etc.) cannot consume MLflow traces.

MLflow already supports **inbound** translation (GenAI semconv → MLflow format) via `GenAiTranslator` in `mlflow/tracing/otel/translation/`. This doc explores adding **outbound** translation (MLflow format → GenAI semconv) so that MLflow-instrumented traces can be exported in the standard format.

## 2. Goals & Non-Goals

### Goals
- Enable MLflow to export traces in OTel GenAI Semantic Convention format to any OTLP-compatible collector.
- Cover all auto-instrumentation integrations (OpenAI, Anthropic, LangChain, LlamaIndex, Bedrock, Gemini, etc.).
- Keep the new logic encapsulated within the exporter layer — do not complicate MLflow's core tracing logic.
- Best-effort mapping for non-LLM span types (CHAIN, RETRIEVER, WORKFLOW, etc.).

### Non-Goals
- Improving inbound translation (already supported).
- Full round-trip fidelity — this is a one-way translation; MLflow-specific attributes are dropped.
- Changes to MLflow's internal trace data model or storage format.
- GenAI semconv event emission — attributes-only to keep the system simple.

## 3. Background

### 3.1 OTel GenAI Semantic Conventions (v1.39.0, Development status)

The spec defines standardized telemetry for GenAI operations:

**Span Naming:** `{gen_ai.operation.name} {gen_ai.request.model}` (e.g., `chat gpt-4o`)

**Span Kinds:**
| Operation | Span Kind | Example |
|---|---|---|
| `chat` | CLIENT | Chat completions |
| `text_completion` | CLIENT | Text completions |
| `embeddings` | CLIENT | Embedding generation |
| `generate_content` | CLIENT | General content generation |
| `execute_tool` | INTERNAL | Tool/function execution |
| `create_agent` / `invoke_agent` | INTERNAL | Agent operations |

**Key Attributes:**

| GenAI Semconv Attribute | Description | Required? |
|---|---|---|
| `gen_ai.operation.name` | Operation type | Required |
| `gen_ai.provider.name` | Provider (openai, anthropic, etc.) | Required |
| `gen_ai.request.model` | Requested model name | Conditionally Required |
| `gen_ai.response.model` | Actual model used | Recommended |
| `gen_ai.usage.input_tokens` | Input token count | Recommended |
| `gen_ai.usage.output_tokens` | Output token count | Recommended |
| `gen_ai.response.finish_reasons` | Why generation stopped | Recommended |
| `gen_ai.request.temperature` | Temperature setting | Recommended |
| `gen_ai.request.max_tokens` | Max output tokens | Recommended |
| `gen_ai.input.messages` | Input messages (structured JSON) | Opt-in |
| `gen_ai.output.messages` | Output messages (structured JSON) | Opt-in |
| `gen_ai.system_instructions` | System prompt | Opt-in |
| `gen_ai.tool.definitions` | Tool schemas | Opt-in |

**SpanKind requirements:** The spec requires `CLIENT` for inference spans (chat, embeddings, text_completion, generate_content) and `INTERNAL` for tool/agent spans. This is significant because MLflow currently creates all spans with `INTERNAL` kind.

### 3.2 MLflow's Current Tracing Architecture

MLflow wraps OpenTelemetry with a custom span processor/exporter pipeline:

```
User Code / Auto-instrumentation
    │
    ▼
OTel Span (with mlflow.* attributes)
    │
    ▼
SpanProcessor.on_start() / on_end()
    │
    ▼
SpanExporter.export()   ──►  MLflow Backend (default)
    │                         or
    └─────────────────────►  OTLP Collector (when OTEL_EXPORTER_OTLP_ENDPOINT is set)
```

### 3.3 How Autologging Integrations Store Data

Each auto-instrumentation integration sets `SpanAttributeKey.MESSAGE_FORMAT` to identify its format and stores inputs/outputs in its provider-native structure:

| Integration | `MESSAGE_FORMAT` | Input Format | Output Format |
|---|---|---|---|
| OpenAI | `"openai"` | `{messages, model, temperature, ...}` | `{choices: [{message, finish_reason}], usage, ...}` |
| Anthropic | `"anthropic"` | `{messages, model, max_tokens, ...}` | `{content: [{type, text}], stop_reason, ...}` |
| Gemini | `"gemini"` | `{contents: [{role, parts}], model, ...}` | `{candidates: [{content: {parts}}], ...}` |
| Bedrock | `"bedrock"` | `{modelId, messages, ...}` | Varies by model |
| LangChain | `"langchain"` | Varies by component (messages, strings, dicts) | Varies (LLMResult, strings, dicts) |
| LlamaIndex | `"llamaindex"` | Bound function arguments | Raw return values |
| Groq | `"groq"` | OpenAI-compatible | OpenAI-compatible |

However, **all integrations normalize these attributes consistently**:
- `mlflow.llm.model` — model name (string)
- `mlflow.llm.provider` — provider name (string)
- `mlflow.chat.tokenUsage` — `{input_tokens, output_tokens, total_tokens}`
- `mlflow.spanType` — `CHAT_MODEL`, `LLM`, `EMBEDDING`, `TOOL`, `AGENT`, etc.

This means: **simple attributes are universal, but message content is format-specific**. The `MESSAGE_FORMAT` attribute is the natural dispatch key for format-specific message translation.

### 3.4 Distinction: Inbound Translation vs Outbound Export

The existing `mlflow/tracing/otel/translation/` module handles **inbound** translation — converting external OTel semantic conventions (GenAI semconv, OpenInference, Traceloop, etc.) into MLflow's internal format at storage time. It runs in `translate_span_when_storing()` called by the SQL store.

The outbound GenAI semconv export is a **different concern**: it translates MLflow's internal format to GenAI semconv at OTLP export time. This logic belongs in the **exporter layer** (`mlflow/tracing/export/`), not the inbound translation layer, because:
1. It only runs when OTLP export is configured — it has no effect on MLflow backend storage.
2. It needs format-specific message handlers keyed by `MESSAGE_FORMAT`, which is an export concern.
3. Mixing outbound logic into the inbound translation module would complicate both.

## 4. Design Alternatives

### Alternative A: Translating SpanExporter Wrapper (Recommended)

**Approach:** Create a new `SpanExporter` that wraps the standard `OTLPSpanExporter`, translating MLflow attributes to GenAI semconv format before delegating to the underlying OTLP exporter.

```
OTel Span (mlflow.* attributes)
    │
    ▼
OtelSpanProcessor (BatchSpanProcessor)
    │
    ▼
GenAiSemconvSpanExporter.export(spans)
    │  ── translates attributes ──
    ▼
OTLPSpanExporter.export(translated_spans)
    │
    ▼
OTLP Collector
```

**New components:**
- `mlflow/tracing/export/genai_semconv.py` — `GenAiSemconvSpanExporter(SpanExporter)` wrapping `OTLPSpanExporter`
- `mlflow/tracing/export/genai_semconv/translator.py` — Two-phase translation logic
- `mlflow/tracing/export/genai_semconv/message_handlers.py` — Format-specific message handlers

**Pros:**
- Minimal changes to existing code — only touches `provider.py` (a few lines) and adds new files.
- Cleanly encapsulated — the core pipeline doesn't know about GenAI semconv.
- Easy to test — mock the inner OTLP exporter and verify translated attributes.
- Natural extension point — other export formats could be added the same way.

**Cons:**
- The exporter receives `ReadableSpan` objects (frozen OTel spans). To change attributes, we must create new `ReadableSpan` instances with translated attributes, which involves some OTel SDK internals. (Note: Alternative B has the same limitation — `on_end()` also receives frozen `ReadableSpan` objects.)

---

### Alternative B: Translating SpanProcessor

**Approach:** Create a new `SpanProcessor` that translates MLflow attributes to GenAI semconv format in `on_end()` before the spans reach the exporter.

**Cons:**
- Same frozen-span limitation as Alt A.
- Tighter coupling to the processor chain — more complex interaction with `OtelSpanProcessor`'s existing logic (metrics recording, trace registration).
- If dual-export were ever needed, translating in the processor would affect all downstream exporters. By contrast, doing it in the exporter (Alt A) only affects the OTLP path.

---

### Alternative C: ReadableSpan Proxy (Lazy Translation)

**Approach:** Create a proxy class wrapping the original span to lazily translate attribute access.

**Cons:**
- The proxy must perfectly match the `ReadableSpan` interface that `OTLPSpanExporter` expects, including protobuf serialization.
- Fragile across OTel SDK version upgrades.

---

### Alternative D: Post-Processor with OTel Collector

**Approach:** Don't translate in MLflow at all. Use a collector-side Transform Processor.

**Cons:**
- Shifts burden to every user.
- MLflow's JSON-encoded attribute serialization makes collector-side transforms brittle.
- Not a real solution.

## 5. Recommendation

**Alternative A (Translating SpanExporter Wrapper)** is recommended because:

1. **Encapsulation:** Translation logic is fully contained in new export modules. No changes to the core tracing pipeline, span processor logic, or data model.
2. **Simplicity:** Wrap the OTLP exporter, translate spans, delegate. Easy to understand, test, and maintain.
3. **Precedent:** MLflow already uses the exporter wrapper pattern (e.g., `MlflowV3SpanExporter`).
4. **Correct layer:** Translation at the exporter level means it only affects the OTLP path, not the MLflow backend storage path.

## 6. Detailed Design (Alternative A)

### 6.1 File Structure

```
mlflow/tracing/export/
├── genai_semconv.py                    # SpanExporter wrapper (entry point)
└── genai_semconv/
    ├── __init__.py
    ├── translator.py                   # Two-phase core translation
    └── message_handlers.py             # FORMAT-specific message handlers
```

All outbound translation logic lives under `mlflow/tracing/export/genai_semconv/` — separate from the inbound `mlflow/tracing/otel/translation/` module. Neither modifies the other.

### 6.2 New Environment Variables

Registered in `mlflow/environment_variables.py`:

```bash
# Enable GenAI semconv export format (only effective when OTEL_EXPORTER_OTLP_ENDPOINT is also set)
MLFLOW_OTLP_EXPORT_FORMAT="genai_semconv"

# Controls whether to include opt-in content (messages, tool args)
# Default: true — MLflow already captures this data in its normal flow
MLFLOW_GENAI_SEMCONV_CAPTURE_CONTENT="true"
```

**Edge case:** If `MLFLOW_OTLP_EXPORT_FORMAT=genai_semconv` is set but `OTEL_EXPORTER_OTLP_ENDPOINT` is not configured, the setting is silently ignored.

**Interaction with dual-export:** If both `MLFLOW_TRACE_ENABLE_OTLP_DUAL_EXPORT=true` and `MLFLOW_OTLP_EXPORT_FORMAT=genai_semconv` are set, the GenAI semconv translation applies only to the OTLP export path. The MLflow backend export path remains unchanged.

### 6.3 Two-Phase Translation Architecture

The key insight: **simple attributes (model, provider, tokens, span type) are already normalized across all integrations**, but **message content (inputs/outputs) is format-specific**. This leads to a two-phase approach:

```
Phase 1: Universal Translation (all formats)
├── mlflow.spanType → gen_ai.operation.name
├── mlflow.llm.model → gen_ai.request.model
├── mlflow.llm.provider → gen_ai.provider.name
├── mlflow.chat.tokenUsage → gen_ai.usage.{input,output}_tokens
├── SpanKind override (INTERNAL → CLIENT for inference)
└── Span name rewrite ("{operation} {model}")

Phase 2: Format-Specific Message Translation (dispatch on MESSAGE_FORMAT)
├── "openai"    → OpenAI handler (messages/choices)
├── "anthropic" → Anthropic handler (content blocks)
├── "gemini"    → Gemini handler (contents/candidates)
├── "bedrock"   → Bedrock handler (delegates to OpenAI handler)
├── "groq"      → Groq handler (delegates to OpenAI handler)
├── "langchain" → LangChain handler (variable formats)
├── unknown     → Default heuristic handler
└── Also extracts: temperature, max_tokens, finish_reasons, response.id, etc.
```

### 6.4 Core Translator: `translator.py`

```python
def translate_span_to_genai(span: ReadableSpan) -> ReadableSpan:
    """Translate a single MLflow span to GenAI semconv format."""
    original_attrs = dict(span.attributes or {})

    # Phase 1: Universal translation (works for all formats)
    genai_attrs = _translate_universal_attributes(original_attrs)

    if not genai_attrs:
        # No GenAI mapping — strip mlflow.* attrs and pass through
        return _create_passthrough_span(span, original_attrs)

    # Phase 2: Format-specific message translation
    message_format = _parse_json_attr(original_attrs.get(SpanAttributeKey.MESSAGE_FORMAT))
    _translate_message_content(original_attrs, genai_attrs, message_format)

    # Merge: Keep non-mlflow.* attrs, add GenAI attrs
    merged_attrs = {k: v for k, v in original_attrs.items() if not k.startswith("mlflow.")}
    merged_attrs.update(genai_attrs)

    new_name = _build_genai_span_name(span.name, genai_attrs)
    new_kind = _get_genai_span_kind(genai_attrs, span.kind)

    return _build_readable_span(span, name=new_name, attributes=merged_attrs, kind=new_kind)
```

**Phase 1 — Universal attributes:**

```python
def _translate_universal_attributes(mlflow_attrs: dict) -> dict:
    genai_attrs = {}

    # 1. Operation name from span type
    span_type = _parse_json_attr(mlflow_attrs.get(SpanAttributeKey.SPAN_TYPE))
    if operation := _SPAN_TYPE_TO_OPERATION.get(span_type):
        genai_attrs["gen_ai.operation.name"] = operation

    # 2. Model
    if model := _parse_json_attr(mlflow_attrs.get(SpanAttributeKey.MODEL)):
        genai_attrs["gen_ai.request.model"] = model

    # 3. Provider
    if provider := _parse_json_attr(mlflow_attrs.get(SpanAttributeKey.MODEL_PROVIDER)):
        genai_attrs["gen_ai.provider.name"] = provider

    # 4. Token usage
    if usage := _parse_json_attr(mlflow_attrs.get(SpanAttributeKey.CHAT_USAGE)):
        if input_tokens := usage.get("input_tokens"):
            genai_attrs["gen_ai.usage.input_tokens"] = input_tokens
        if output_tokens := usage.get("output_tokens"):
            genai_attrs["gen_ai.usage.output_tokens"] = output_tokens

    # 5. Tool attributes (for TOOL spans)
    if span_type == SpanType.TOOL:
        if inputs := _parse_json_attr(mlflow_attrs.get(SpanAttributeKey.INPUTS)):
            genai_attrs["gen_ai.tool.call.arguments"] = json.dumps(inputs)
        if outputs := _parse_json_attr(mlflow_attrs.get(SpanAttributeKey.OUTPUTS)):
            genai_attrs["gen_ai.tool.call.result"] = json.dumps(outputs)

    return genai_attrs
```

**Span type → operation name mapping:**

```python
_SPAN_TYPE_TO_OPERATION = {
    SpanType.CHAT_MODEL: "chat",
    SpanType.LLM: "generate_content",
    SpanType.EMBEDDING: "embeddings",
    SpanType.TOOL: "execute_tool",
    SpanType.AGENT: "invoke_agent",
    SpanType.RETRIEVER: "execute_tool",
    SpanType.RERANKER: "execute_tool",
    # No natural GenAI semconv equivalent — pass through as-is
    SpanType.CHAIN: None,
    SpanType.WORKFLOW: None,
    SpanType.PARSER: None,
    SpanType.MEMORY: None,
    SpanType.GUARDRAIL: None,
    SpanType.EVALUATOR: None,
    SpanType.TASK: None,
    SpanType.UNKNOWN: None,
}
```

**SpanKind override:**

```python
_OPERATION_TO_SPAN_KIND = {
    "chat": SpanKind.CLIENT,
    "text_completion": SpanKind.CLIENT,
    "embeddings": SpanKind.CLIENT,
    "generate_content": SpanKind.CLIENT,
    "execute_tool": SpanKind.INTERNAL,
    "invoke_agent": SpanKind.INTERNAL,
}
```

**`_build_readable_span` helper:**

```python
def _build_readable_span(original, name, attributes, kind):
    return ReadableSpan(
        name=name,
        context=original.context,
        parent=original.parent,
        resource=original.resource,
        attributes=attributes,
        events=original.events,
        links=original.links,
        kind=kind,
        instrumentation_info=original.instrumentation_info,
        status=original.status,
        start_time=original.start_time,
        end_time=original.end_time,
    )
```

### 6.5 Format-Specific Message Handlers: `message_handlers.py`

The `MESSAGE_FORMAT` attribute is the dispatch key. Each handler knows how to extract messages from its format:

```python
# Registry of format-specific handlers
_FORMAT_HANDLERS: dict[str, Callable] = {
    "openai":     _openai_handler,
    "anthropic":  _anthropic_handler,
    "gemini":     _gemini_handler,
    "bedrock":    _openai_handler,      # Bedrock converse uses similar format
    "groq":       _openai_handler,      # Groq uses OpenAI-compatible format
    "langchain":  _langchain_handler,
    # llamaindex, ag2, autogen — handled by default heuristic
}

def translate_messages_for_format(message_format, inputs, outputs) -> dict[str, str]:
    handler = _FORMAT_HANDLERS.get(message_format)
    if handler:
        try:
            return handler(inputs, outputs)
        except Exception:
            _logger.debug(f"Handler for '{message_format}' failed", exc_info=True)
    # Fall back to heuristic
    return _default_handler(inputs, outputs)
```

**OpenAI handler** (also covers Groq, Bedrock, LiteLLM):

```python
def _openai_handler(inputs, outputs) -> dict[str, str]:
    result = {}

    # Input: {"messages": [{"role": "user", "content": "Hello"}], "model": "gpt-4"}
    if isinstance(inputs, dict) and "messages" in inputs:
        genai_msgs = [_convert_openai_message(m) for m in inputs["messages"]]
        result["gen_ai.input.messages"] = json.dumps(genai_msgs)

    # Output: {"choices": [{"message": {"role": "assistant", "content": "Hi"}, "finish_reason": "stop"}]}
    if isinstance(outputs, dict) and "choices" in outputs:
        out_msgs = []
        for choice in outputs["choices"]:
            msg = _convert_openai_message(choice.get("message", {}))
            if fr := choice.get("finish_reason"):
                msg["finish_reason"] = fr
            out_msgs.append(msg)
        result["gen_ai.output.messages"] = json.dumps(out_msgs)

    return result

def _convert_openai_message(msg: dict) -> dict:
    role = msg.get("role", "user")
    content = msg.get("content")
    parts = []

    if isinstance(content, str):
        parts.append({"type": "text", "text": content})
    elif isinstance(content, list):
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text":
                parts.append({"type": "text", "text": item.get("text", "")})
            else:
                parts.append({"type": "text", "text": json.dumps(item)})
    elif content is not None:
        parts.append({"type": "text", "text": str(content)})

    # Handle tool_calls on the message
    if tool_calls := msg.get("tool_calls"):
        for tc in tool_calls:
            func = tc.get("function", {})
            parts.append({
                "type": "tool_call",
                "id": tc.get("id"),
                "name": func.get("name"),
                "arguments": func.get("arguments", "{}"),
            })

    return {"role": role, "content": parts}
```

**Anthropic handler:**

```python
def _anthropic_handler(inputs, outputs) -> dict[str, str]:
    result = {}

    # Input: {"messages": [{"role": "user", "content": "Hello"}], "model": "claude-3-5-sonnet"}
    if isinstance(inputs, dict) and "messages" in inputs:
        genai_msgs = [_convert_anthropic_message(m) for m in inputs["messages"]]
        result["gen_ai.input.messages"] = json.dumps(genai_msgs)

    # Output: {"content": [{"type": "text", "text": "Hi!"}], "stop_reason": "end_turn"}
    if isinstance(outputs, dict) and "content" in outputs:
        msg = _convert_anthropic_message({"role": "assistant", "content": outputs["content"]})
        if sr := outputs.get("stop_reason"):
            msg["finish_reason"] = sr
        result["gen_ai.output.messages"] = json.dumps([msg])

    return result

def _convert_anthropic_message(msg: dict) -> dict:
    role = msg.get("role", "user")
    content = msg.get("content")
    parts = []

    if isinstance(content, str):
        parts.append({"type": "text", "text": content})
    elif isinstance(content, list):
        for block in content:
            if isinstance(block, dict):
                if block.get("type") == "text":
                    parts.append({"type": "text", "text": block.get("text", "")})
                elif block.get("type") == "tool_use":
                    parts.append({
                        "type": "tool_call",
                        "id": block.get("id"),
                        "name": block.get("name"),
                        "arguments": json.dumps(block.get("input", {})),
                    })
                else:
                    parts.append({"type": "text", "text": json.dumps(block)})

    return {"role": role, "content": parts}
```

**Gemini handler:**

```python
def _gemini_handler(inputs, outputs) -> dict[str, str]:
    result = {}

    # Input: {"contents": [{"role": "user", "parts": [{"text": "Hello"}]}]}
    if isinstance(inputs, dict) and "contents" in inputs:
        genai_msgs = [_convert_gemini_content(c) for c in inputs["contents"]]
        result["gen_ai.input.messages"] = json.dumps(genai_msgs)

    # Output: {"candidates": [{"content": {"parts": [{"text": "Hi!"}]}}]}
    if isinstance(outputs, dict) and "candidates" in outputs:
        out_msgs = []
        for candidate in outputs["candidates"]:
            if "content" in candidate:
                out_msgs.append(_convert_gemini_content(candidate["content"]))
        result["gen_ai.output.messages"] = json.dumps(out_msgs)

    return result

def _convert_gemini_content(content: dict) -> dict:
    role = content.get("role", "user")
    parts = []
    for part in content.get("parts", []):
        if isinstance(part, dict) and "text" in part:
            parts.append({"type": "text", "text": part["text"]})
        else:
            parts.append({"type": "text", "text": json.dumps(part)})
    return {"role": role, "content": parts}
```

**LangChain handler:**

```python
def _langchain_handler(inputs, outputs) -> dict[str, str]:
    result = {}

    # LangChain is variable — detect structure
    if isinstance(inputs, list) and inputs:
        first = inputs[0]
        if isinstance(first, dict) and "role" in first:
            result["gen_ai.input.messages"] = json.dumps(
                [_convert_openai_message(m) for m in inputs]
            )
        elif isinstance(first, dict) and "type" in first and "content" in first:
            # LangChain BaseMessage-like: {"type": "human", "content": "Hello"}
            role_map = {"human": "user", "ai": "assistant", "system": "system", "tool": "tool"}
            genai_msgs = []
            for m in inputs:
                role = role_map.get(m.get("type", ""), "user")
                genai_msgs.append({
                    "role": role,
                    "content": [{"type": "text", "text": str(m.get("content", ""))}],
                })
            result["gen_ai.input.messages"] = json.dumps(genai_msgs)

    if isinstance(outputs, str):
        result["gen_ai.output.messages"] = json.dumps([{
            "role": "assistant",
            "content": [{"type": "text", "text": outputs}],
        }])

    return result
```

**Default heuristic handler** (for unknown MESSAGE_FORMAT or when format handler fails):

```python
def _default_handler(inputs, outputs) -> dict[str, str]:
    result = {}

    # Try to detect format from structure
    if isinstance(inputs, dict):
        if "messages" in inputs:
            return _openai_handler(inputs, outputs)
        if "contents" in inputs:
            return _gemini_handler(inputs, outputs)

    # Direct message list
    if isinstance(inputs, list) and inputs and isinstance(inputs[0], dict) and "role" in inputs[0]:
        result["gen_ai.input.messages"] = json.dumps(
            [_convert_openai_message(m) for m in inputs]
        )

    # Plain string
    elif isinstance(inputs, str):
        result["gen_ai.input.messages"] = json.dumps([{
            "role": "user", "content": [{"type": "text", "text": inputs}],
        }])

    # Unknown → JSON-stringify
    elif inputs is not None:
        result["gen_ai.input.messages"] = json.dumps([{
            "role": "user", "content": [{"type": "text", "text": json.dumps(inputs)}],
        }])

    # Output handling
    if isinstance(outputs, dict) and "choices" in outputs:
        return _openai_handler(inputs, outputs)
    elif isinstance(outputs, dict) and "content" in outputs and isinstance(outputs["content"], list):
        return _anthropic_handler(inputs, outputs)
    elif isinstance(outputs, str):
        result["gen_ai.output.messages"] = json.dumps([{
            "role": "assistant", "content": [{"type": "text", "text": outputs}],
        }])
    elif outputs is not None:
        result["gen_ai.output.messages"] = json.dumps([{
            "role": "assistant", "content": [{"type": "text", "text": json.dumps(outputs)}],
        }])

    return result
```

### 6.6 Extracting Additional GenAI Attributes from Inputs/Outputs

Beyond messages, the translator extracts GenAI attributes from the structured inputs/outputs:

```python
def _extract_request_params(inputs: dict) -> dict[str, Any]:
    params = {}
    if "temperature" in inputs:
        params["gen_ai.request.temperature"] = inputs["temperature"]
    if "max_tokens" in inputs:
        params["gen_ai.request.max_tokens"] = inputs["max_tokens"]
    if "top_p" in inputs:
        params["gen_ai.request.top_p"] = inputs["top_p"]
    if "stop" in inputs:
        params["gen_ai.request.stop_sequences"] = inputs["stop"]
    if "tools" in inputs:
        params["gen_ai.tool.definitions"] = json.dumps(inputs["tools"])
    return params

def _extract_response_attrs(outputs: dict) -> dict[str, Any]:
    attrs = {}
    if "id" in outputs:
        attrs["gen_ai.response.id"] = outputs["id"]
    if "model" in outputs:
        attrs["gen_ai.response.model"] = outputs["model"]
    if "choices" in outputs:
        reasons = [c.get("finish_reason") for c in outputs["choices"] if c.get("finish_reason")]
        if reasons:
            attrs["gen_ai.response.finish_reasons"] = reasons
    elif "stop_reason" in outputs:
        attrs["gen_ai.response.finish_reasons"] = [outputs["stop_reason"]]
    return attrs
```

### 6.7 Exporter Wrapper: `genai_semconv.py`

```python
class GenAiSemconvSpanExporter(SpanExporter):
    def __init__(self, inner_exporter: SpanExporter):
        self._inner = inner_exporter

    def export(self, spans: Sequence[ReadableSpan]) -> SpanExportResult:
        try:
            translated = [translate_span_to_genai(span) for span in spans]
            return self._inner.export(translated)
        except Exception:
            _logger.error("Failed to translate spans to GenAI semconv", exc_info=True)
            return self._inner.export(spans)  # Fallback: export original

    def shutdown(self) -> None:
        self._inner.shutdown()

    def force_flush(self, timeout_millis: int = 30000) -> bool:
        return self._inner.force_flush(timeout_millis)
```

### 6.8 Integration Point in `provider.py`

Minimal change to `_get_span_processors()`:

```python
if should_use_otlp_exporter():
    from mlflow.tracing.processor.otel import OtelSpanProcessor

    exporter = get_otlp_exporter()

    # Wrap with GenAI semconv translator if configured
    if MLFLOW_OTLP_EXPORT_FORMAT.get() == "genai_semconv":
        from mlflow.tracing.export.genai_semconv import GenAiSemconvSpanExporter
        exporter = GenAiSemconvSpanExporter(exporter)

    otel_processor = OtelSpanProcessor(span_exporter=exporter, ...)
    processors.append(otel_processor)
```

### 6.9 Error Handling

All message translation is wrapped in try/except. If any step fails, the span is exported as a pass-through (mlflow.* stripped, no GenAI attrs added) with a debug log. Translation failures never prevent span export.

### 6.10 Streaming Traces

MLflow captures streaming responses via chunk events (`mlflow.chunk.item.{index}`). The translator works with the final aggregated `mlflow.spanOutputs` — streaming traces are handled identically to non-streaming traces.

### 6.11 Performance

Translation happens in `BatchSpanProcessor`'s background thread. Overhead is JSON parsing + ReadableSpan construction per span, which is comparable to existing work done in the MLflow backend exporter.

## 7. Testing Strategy

### Unit Tests: `tests/tracing/export/genai_semconv/test_translator.py`
- Test Phase 1: each universal attribute mapping (span type → operation, model, provider, tokens)
- Test SpanKind mapping (CHAT_MODEL → CLIENT, TOOL → INTERNAL)
- Test span name rewriting (`"chat gpt-4o"`)
- Test pass-through for unmapped span types (CHAIN, WORKFLOW)
- Test `mlflow.*` attribute stripping
- Test error handling: malformed JSON, missing attributes → graceful fallback

### Unit Tests: `tests/tracing/export/genai_semconv/test_message_handlers.py`
- Test OpenAI handler: messages input, choices output, tool_calls
- Test Anthropic handler: content blocks, tool_use blocks, stop_reason
- Test Gemini handler: contents/parts input, candidates output
- Test LangChain handler: message list, BaseMessage-like dicts, plain strings
- Test default heuristic handler: format detection, fallbacks
- Test `_extract_request_params()` and `_extract_response_attrs()`

### Integration Tests: `tests/tracing/export/test_genai_semconv_exporter.py`
- Test `GenAiSemconvSpanExporter` with mocked inner exporter
- Verify full span translation end-to-end
- Verify `MLFLOW_GENAI_SEMCONV_CAPTURE_CONTENT=false` strips messages
- Verify dual-export interaction
- Verify fallback on translation error

### End-to-End Tests
- Instrument an OpenAI call with `mlflow.openai.autolog()`
- Export via OTLP with `MLFLOW_OTLP_EXPORT_FORMAT=genai_semconv`
- Collect with in-process OTel collector
- Verify: `gen_ai.operation.name`=`chat`, `gen_ai.request.model`, `gen_ai.provider.name`=`openai`, `gen_ai.usage.*`, `gen_ai.input/output.messages`, span name=`chat gpt-4o`, SpanKind=CLIENT

## 8. Future Considerations

- **Metrics:** The GenAI semconv also defines metrics (`gen_ai.client.token.usage`, `gen_ai.client.operation.duration`).
- **Spec Stability:** The GenAI semconv is in "Development" status. The translator should be versioned to track spec evolution.
- **Per-Provider sub-translators:** If the handler registry grows complex, individual handlers could become separate modules.

## 9. Resolved Decisions

1. **Content capture → Default to including.** MLflow already captures message content. Stripping by default would be surprising.
2. **SpanKind → Override for inference spans.** Inference → `CLIENT`, tool/agent → `INTERNAL`.
3. **Events → Not emitted.** Attributes-only keeps the system simple. The spec's attribute-based approach is the latest direction.
4. **Translation placement → Exporter layer**, not `otel/translation/`. The outbound export is a different concern from inbound storage translation.
5. **Message dispatch → `MESSAGE_FORMAT` attribute.** Each integration already sets this. Format-specific handlers are keyed by it.

## 10. Remaining Open Questions

1. **Env var naming:** Is `MLFLOW_OTLP_EXPORT_FORMAT` the right name? The value `genai_semconv` could also be just `genai`.

2. **`ReadableSpan` constructor stability:** The `_build_readable_span` helper depends on `ReadableSpan`'s constructor signature, which is an internal OTel SDK API. Should we add a defensive wrapper?
