using System.Text;
using System.Text.Json;

namespace ShramSafal.Infrastructure.AI;

// Phase 3 (VOICE_LATENCY_PIPELINE_V2 §7 Task 3.2) — incremental JSON state
// machine. Buffers chunked text from a streaming Gemini call and emits
// FieldComplete / Complete events as top-level fields (or top-level array
// elements) finish arriving so the wizard can render progressively.
//
// Boundaries it cares about:
//   * `,` at depth 1                     → previous top-level field done
//   * `]` at depth 1                     → top-level array field done
//   * `}` from depth 2 with array parent → element of a top-level array done
//   * `}` from depth 1 → 0               → entire document done (Complete)
//
// Value extraction is best-effort and only attempted on FieldComplete /
// Complete; partial-buffer parse failures are swallowed (Gemini may emit
// trailing whitespace or non-JSON sentinels that downstream cleaners handle).
public enum PartialJsonEventType
{
    FieldComplete,
    Complete
}

public sealed record PartialJsonEvent(
    PartialJsonEventType Type,
    string? FieldPath,
    JsonElement? Value);

public sealed class PartialJsonParser
{
    private readonly StringBuilder _buffer = new();
    private readonly Stack<bool> _isArrayStack = new();   // top = current container; true = array
    private int _depth;
    private bool _inString;
    private bool _escaped;
    private bool _expectingKey;
    private int _stringStart = -1;
    private string? _currentKey;

    public event Action<PartialJsonEvent>? OnEvent;

    public void Feed(string chunk)
    {
        if (string.IsNullOrEmpty(chunk))
        {
            return;
        }

        foreach (var c in chunk)
        {
            _buffer.Append(c);
            var idx = _buffer.Length - 1;

            if (_escaped)
            {
                _escaped = false;
                continue;
            }

            if (_inString)
            {
                if (c == '\\')
                {
                    _escaped = true;
                }
                else if (c == '"')
                {
                    _inString = false;
                    if (_expectingKey && _depth == 1)
                    {
                        var keyLen = idx - _stringStart - 1;
                        _currentKey = keyLen > 0
                            ? _buffer.ToString(_stringStart + 1, keyLen)
                            : string.Empty;
                        _expectingKey = false;
                    }
                }
                continue;
            }

            switch (c)
            {
                case '"':
                    _inString = true;
                    _stringStart = idx;
                    break;

                case '{':
                    _depth++;
                    _isArrayStack.Push(false);
                    if (_depth == 1)
                    {
                        _expectingKey = true;
                    }
                    break;

                case '[':
                    _depth++;
                    _isArrayStack.Push(true);
                    break;

                case '}':
                    if (_isArrayStack.Count > 0) _isArrayStack.Pop();
                    _depth--;

                    // Element inside a top-level array just finished
                    if (_depth == 2 && _isArrayStack.Count > 0 && _isArrayStack.Peek())
                    {
                        EmitFieldComplete();
                    }

                    if (_depth == 0)
                    {
                        EmitComplete();
                    }
                    break;

                case ']':
                    if (_isArrayStack.Count > 0) _isArrayStack.Pop();
                    _depth--;

                    if (_depth == 1)
                    {
                        EmitFieldComplete();
                        _currentKey = null;
                        _expectingKey = false;
                    }
                    break;

                case ',':
                    if (_depth == 1)
                    {
                        if (_currentKey is not null)
                        {
                            EmitFieldComplete();
                            _currentKey = null;
                        }
                        _expectingKey = true;
                    }
                    break;
            }
        }
    }

    private void EmitFieldComplete()
    {
        OnEvent?.Invoke(new PartialJsonEvent(
            PartialJsonEventType.FieldComplete,
            _currentKey,
            null));
    }

    private void EmitComplete()
    {
        JsonElement? value = null;
        try
        {
            using var doc = JsonDocument.Parse(_buffer.ToString());
            value = doc.RootElement.Clone();
        }
        catch (JsonException)
        {
            // Final buffer wasn't valid JSON; consumer falls back to text events.
        }

        OnEvent?.Invoke(new PartialJsonEvent(
            PartialJsonEventType.Complete,
            null,
            value));
    }
}
