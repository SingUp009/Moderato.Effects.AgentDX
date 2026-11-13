using Moderato.Effects;

namespace AgentDx;

public static class Submission
{
    public static Effect<int, ReadFailure, EmptyEnvironment> Read(Func<ILease> open) =>
        throw new NotImplementedException();
}
