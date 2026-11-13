using Moderato.Results;

namespace AgentDx;

public sealed record RateFailure(string Currency);

public interface IRateSource
{
    ValueTask<Result<decimal, RateFailure>> Rate(string currency, CancellationToken cancellationToken);
}
