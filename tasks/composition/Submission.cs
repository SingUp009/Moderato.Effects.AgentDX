using Moderato.Effects;

namespace AgentDx;

public static class Submission
{
    public static Effect<int, FetchError, R> Fetch<R>(Effect<int, FetchError, R> request, TimeSpan deadline)
        where R : IHas<TimeProvider> =>
        throw new NotImplementedException();
}
