using Moderato.Effects;
using Moderato.Results;

namespace AgentDx;

public static class Submission
{
    public static Effect<int, ReadFailure, EmptyEnvironment> Read(Func<ILease> open)
    {
        Resource<ILease, ReadFailure, EmptyEnvironment> lease = Resource.Make(
            Effect<EmptyEnvironment>.Sync(open),
            (handle, exit) => Effect<EmptyEnvironment>.Async(async cancellationToken =>
            {
                await handle.Close(exit, cancellationToken);
                return Unit.Value;
            }));

        return lease.Use(handle => Effect<EmptyEnvironment>.FromResultAsync<int, ReadFailure>(handle.Read));
    }
}
