namespace ShramSafal.Infrastructure.Integrations.Sarvam;

public sealed class SarvamOptions
{
    public const string SectionName = "Sarvam";

    public string ApiSubscriptionKey { get; set; } = string.Empty;
    public string SttEndpoint { get; set; } = "https://api.sarvam.ai/speech-to-text";
    public string SttModel { get; set; } = "saaras:v3";
    public string SttMode { get; set; } = "codemix";
    public string SttLanguage { get; set; } = "mr-IN";
    public string StreamingSttEndpoint { get; set; } = "wss://api.sarvam.ai/speech-to-text/ws";
    public string StreamingSttModel { get; set; } = "saaras:v3";
    public string StreamingSttMode { get; set; } = "codemix";
    public string StreamingSttLanguage { get; set; } = "mr-IN";
    public int StreamingSampleRate { get; set; } = 16000;
    public string StreamingInputAudioCodec { get; set; } = "wav";
    public bool StreamingHighVadSensitivity { get; set; } = true;
    public bool StreamingVadSignals { get; set; } = true;
    public bool StreamingFlushSignal { get; set; } = true;
    public int StreamingTimeoutSeconds { get; set; } = 30;
    public string ChatEndpoint { get; set; } = "https://api.sarvam.ai/v1/chat/completions";
    // The Sarvam structurer model. This value has now been deprecated out from
    // under us TWICE, so it is recorded with the date and the probe that
    // established it — a model name is a perishable fact, not a constant.
    //
    //   sarvam-m    DEPRECATED 2026-06.
    //   sarvam-30b  DEPRECATED by 2026-08-25. The comment that stood here said
    //               "Verified sarvam-30b works via a live probe" — true when
    //               written, false by the time it shipped. A live probe on
    //               2026-08-25 returned HTTP 400: "Model 'sarvam-30b' has been
    //               deprecated. Please use one of the available models instead:
    //               sarvam-105b, sarvam-105b-conversations."
    //
    // Both survivors were probed 2026-08-25 with the EXACT body SarvamChatClient
    // sends (model + messages + temperature, no max_tokens) on the Marathi
    // structuring case "पंधरा मजूर, चार तास":
    //
    //   sarvam-105b                -> content {"workers":15,"hours":4}, 277 completion tokens
    //                                 (a reasoning model: emits reasoning_content, and returns
    //                                  content=null if max_tokens is ever capped small)
    //   sarvam-105b-conversations  -> content {"workers":15,"hours":4},  12 completion tokens
    //
    // Same answer, ~23x the completion cost. The reasoning variant's accuracy
    // advantage on our real 700-line bucket prompt is UNMEASURED — the golden-set
    // delta has been owed since 2026-05 and has never run — so paying 23x for an
    // unproven benefit is a guess, not a trade. Chose the cheaper, lower-latency,
    // non-reasoning variant, which is also robust to a future max_tokens cap.
    // Revisit when the golden set actually runs.
    public string ChatModel { get; set; } = "sarvam-105b-conversations";
    public string VisionModel { get; set; } = "sarvam-vision";
    public decimal ChatTemperature { get; set; } = 0.2m;
    public int TimeoutSeconds { get; set; } = 45;
    public string DocIntelEndpoint { get; set; } = "https://api.sarvam.ai/doc-digitization/job/v1";
    public int DocIntelTimeoutSeconds { get; set; } = 120;
}
