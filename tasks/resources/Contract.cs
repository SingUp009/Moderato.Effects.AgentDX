using Moderato.Effects;
using Moderato.Results;

namespace AgentDx;

public sealed record ReadFailure(string Reason);

public interface ILease
{
    ValueTask<Result<int, ReadFailure>> Read(CancellationToken cancellationToken);
    ValueTask Close(ExitCase exit, CancellationToken cancellationToken);
}
