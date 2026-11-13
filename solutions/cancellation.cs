using Moderato.Effects;

namespace AgentDx;

public static class Submission
{
    public static Effect<int, Never, EmptyEnvironment> Load(Func<CancellationToken, ValueTask<int>> load) =>
        Effect<EmptyEnvironment>.Async(load);
}
