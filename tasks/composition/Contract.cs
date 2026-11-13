using Moderato.Effects;

namespace AgentDx;

public sealed record TransientFetchError(int Code);
public sealed record PermanentFetchError(int Code);

[Error]
public partial union FetchError(TransientFetchError, PermanentFetchError, TimeoutError);
